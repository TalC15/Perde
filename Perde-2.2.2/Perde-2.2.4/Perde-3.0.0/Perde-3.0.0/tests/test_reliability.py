"""Regressions for jobs that failed mid-way with a generic error."""
import json
import multiprocessing
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock
ROOT = Path(__file__).resolve().parents[1] / 'vocal-service'
sys.path.insert(0, str(ROOT))
import worker
from server import Jobs, read_state


def keep_reading(folder, stop):
    # The service polls state.json while the worker replaces it.
    while not stop.is_set():
        try:
            json.loads((folder / 'state.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            pass


class StateFileTests(unittest.TestCase):
    def test_state_updates_survive_a_concurrent_reader(self):
        # On Windows the reader makes plain replace() fail most of the time;
        # before the fix one such failure ended the whole separation.
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            worker.write_state(folder, 'downloading')
            stop = multiprocessing.Event()
            reader = multiprocessing.Process(target=keep_reading, args=(folder, stop))
            reader.start()
            try:
                for index in range(300):
                    worker.write_state(folder, 'separating', required=False, progress=index)
                self.assertTrue(worker.write_state(folder, 'ready'))
            finally:
                stop.set()
                reader.join()
            self.assertEqual(json.loads((folder / 'state.json').read_text(encoding='utf-8'))['state'], 'ready')

    def test_required_state_reports_a_persistent_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            with unittest.mock.patch.object(Path, 'replace', side_effect=PermissionError), \
                 unittest.mock.patch.object(worker.time, 'sleep'):
                self.assertFalse(worker.write_state(folder, 'separating', required=False))
                with self.assertRaises(OSError):
                    worker.write_state(folder, 'ready')

    def test_service_read_retries_a_briefly_locked_or_partial_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'state.json'
            self.assertIsNone(read_state(path))
            path.write_text('{"state": "ready"}', encoding='utf-8')
            original, calls = Path.read_text, []
            def flaky(self, *args, **kwargs):
                calls.append(1)
                if len(calls) == 1:
                    raise PermissionError
                return original(self, *args, **kwargs)
            with unittest.mock.patch.object(Path, 'read_text', flaky):
                self.assertEqual(read_state(path, attempts=3), {'state': 'ready'})


class FinishedWorkerTests(unittest.TestCase):
    def test_final_state_written_just_before_exit_is_not_reported_as_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            jobs = Jobs(tmp)
            with unittest.mock.patch('server.subprocess.Popen') as popen:
                popen.return_value.poll.return_value = None
                job = jobs.create({'videoId': 'abcdefghijk'})
            folder = Path(tmp) / job['id']
            (folder / 'vocals.mp3').write_bytes(b'ID3')
            worker.write_state(folder, 'ready', totalSeconds=10)
            jobs.jobs[job['id']]['process'].poll.return_value = 0
            self.assertEqual(jobs.status(job['id'])['state'], 'ready')
            jobs.close()

    def test_a_worker_that_died_without_a_result_gets_a_specific_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            jobs = Jobs(tmp)
            with unittest.mock.patch('server.subprocess.Popen') as popen:
                popen.return_value.poll.return_value = 1
                job = jobs.create({'videoId': 'abcdefghijk'})
            status = jobs.status(job['id'])
            self.assertEqual(status['state'], 'error')
            self.assertIn('beklenmedik', status['error'])
            jobs.close()


class MessageTests(unittest.TestCase):
    def test_download_failures_name_their_cause(self):
        DownloadError = type('DownloadError', (Exception,), {})
        cases = {
            'ERROR: Sign in to confirm you’re not a bot': 'doğrulama',
            'ERROR: unable to download video data: HTTP Error 403: Forbidden': '403',
            'ERROR: Private video': 'özel',
            'ERROR: Connection reset by peer': 'İnternet',
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertIn(expected, worker.describe(DownloadError(text)))
        self.assertIn('Bellek', worker.describe(MemoryError()))
        self.assertIn('Diskte', worker.describe(OSError(28, 'No space left on device')))

    def test_pacing_waits_only_when_far_ahead_of_recent_playback(self):
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(worker.time, 'sleep') as sleep:
            folder = Path(tmp)
            worker.paced(folder, 600, 10)
            sleep.assert_not_called()
            (folder / 'control.json').write_text(json.dumps({'position': 100, 'at': time.time()}))
            worker.paced(folder, 200, 10)
            sleep.assert_not_called()
            worker.paced(folder, 300, 10)
            sleep.assert_called_with(10)
            worker.paced(folder, 600, 10)
            sleep.assert_called_with(20)
            (folder / 'control.json').write_text(json.dumps({'position': 100, 'at': time.time() - 60}))
            sleep.reset_mock()
            worker.paced(folder, 600, 10)
            sleep.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
