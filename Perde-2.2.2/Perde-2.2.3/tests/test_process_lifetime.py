"""Regression: force-close the service, release worker files, restart cleanup."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / 'vocal-service'
sys.path.insert(0, str(ROOT))
from server import cleanup_stale


class CleanupTests(unittest.TestCase):
    def test_locked_directory_is_retried_and_configuration_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stale = root / ('a' * 32)
            active = root / ('b' * 32)
            stale.mkdir(); active.mkdir()
            (root / 'environment.json').write_text('{}')
            with patch('server.shutil.rmtree', side_effect=PermissionError('locked')):
                self.assertEqual(cleanup_stale(root, active={active.name}), 1)
            self.assertEqual(cleanup_stale(root, active={active.name}), 0)
            self.assertFalse(stale.exists())
            self.assertTrue(active.exists())
            self.assertTrue((root / 'environment.json').exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows process containment')
    def test_forced_parent_exit_kills_descendants_and_releases_audio(self):
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = root / ('c' * 32); job.mkdir()
            ready = root / 'ready.json'
            child_code = (
                'import subprocess,sys,time,os,json\nfrom pathlib import Path\n'
                f'audio=open({str(job / "input.wav")!r},"wb")\n'
                'grand=subprocess.Popen([sys.executable,"-c","import time; time.sleep(120)"])\n'
                f'Path({str(ready)!r}).write_text(json.dumps([os.getpid(),grand.pid]))\n'
                'time.sleep(120)\n'
            )
            driver = root / 'driver.py'
            driver.write_text(
                'import sys,subprocess,time\n'
                f'sys.path.insert(0,{str(ROOT)!r})\n'
                'from process_lifetime import contain_process_tree\n'
                'contain_process_tree()\n'
                f'subprocess.Popen([sys.executable,"-c",{child_code!r}])\n'
                'time.sleep(120)\n', encoding='utf-8')
            parent = subprocess.Popen([sys._base_executable, str(driver)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                      creationflags=subprocess.CREATE_NO_WINDOW)
            handles = []
            try:
                deadline = time.monotonic() + 15
                while not ready.exists() and parent.poll() is None and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(ready.exists(), 'Child failed to start')
                for pid in json.loads(ready.read_text()):
                    handle = kernel.OpenProcess(0x100001, False, pid)
                    self.assertTrue(handle)
                    handles.append(handle)
                self.assertEqual(cleanup_stale(root), 1)  # Real Windows file lock.
                parent.kill(); parent.wait(timeout=5)
                for handle in handles:
                    self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0)
                self.assertEqual(cleanup_stale(root), 0)
                self.assertFalse(job.exists())
            finally:
                if parent.poll() is None:
                    parent.kill(); parent.wait(timeout=5)
                for handle in handles:
                    if kernel.WaitForSingleObject(handle, 0) != 0:
                        kernel.TerminateProcess(handle, 1)
                        kernel.WaitForSingleObject(handle, 5000)
                    kernel.CloseHandle(handle)
                parent.stderr.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
