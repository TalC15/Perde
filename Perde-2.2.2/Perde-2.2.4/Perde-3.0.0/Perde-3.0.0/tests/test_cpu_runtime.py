"""Resource caps must hold before native libraries load or workers start."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vocal-service'))
from cpu_runtime import cpu_threads, worker_environment, configure_torch, background_creation_flags
from server import Jobs


class CpuRuntimeTests(unittest.TestCase):
    def test_cpu_budget_keeps_small_machines_usable_and_caps_ryzen(self):
        for logical, expected in ((1, 1), (2, 1), (4, 2), (6, 3), (12, 4), (64, 4)):
            with self.subTest(logical=logical):
                self.assertEqual(cpu_threads(logical), expected)
        with patch('cpu_runtime.os.cpu_count', return_value=None):
            self.assertEqual(cpu_threads(), 1)

    @patch('cpu_runtime.os.cpu_count', return_value=12)
    def test_native_pools_are_capped_without_mutating_parent_environment(self, _):
        source = {'SystemRoot': 'Windows', 'PATH': 'required-path', 'MKL_NUM_THREADS': '12'}
        result = worker_environment(source)
        self.assertEqual(result['SystemRoot'], 'Windows')
        self.assertEqual(result['PATH'], 'required-path')
        self.assertEqual(source['MKL_NUM_THREADS'], '12')
        for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
            self.assertEqual(result[name], '4')

    @patch('cpu_runtime.os.cpu_count', return_value=12)
    def test_torch_interop_is_initialized_once(self, _):
        torch = Mock()
        torch.get_num_interop_threads.return_value = 6
        configure_torch(torch)
        torch.set_num_threads.assert_called_once_with(4)
        torch.set_num_interop_threads.assert_called_once_with(1)
        torch.get_num_interop_threads.return_value = 1
        configure_torch(torch)
        torch.set_num_interop_threads.assert_called_once()

    @patch('server.subprocess.Popen')
    @patch('cpu_runtime.os.cpu_count', return_value=12)
    def test_production_job_starts_capped_and_below_normal_priority(self, _, popen):
        popen.return_value.poll.return_value = 0
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            jobs = Jobs(temporary)
            jobs.create({'videoId': 'abcdefghijk'})
            try:
                options = popen.call_args.kwargs
                self.assertEqual(options['env']['MKL_NUM_THREADS'], '4')
                self.assertEqual(options['env']['OMP_NUM_THREADS'], '4')
                self.assertEqual(options['creationflags'], background_creation_flags())
                if os.name == 'nt':
                    self.assertTrue(options['creationflags'] & subprocess.BELOW_NORMAL_PRIORITY_CLASS)
                    self.assertTrue(options['creationflags'] & subprocess.CREATE_NO_WINDOW)
                self.assertNotIn('shell', options)
            finally:
                jobs.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
