import http.client
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import test_service
from server import Jobs, cleanup_stale


class VocalCacheTests(unittest.TestCase):
    setUp = test_service.ServiceTests.setUp
    tearDown = test_service.ServiceTests.tearDown
    request = test_service.ServiceTests.request

    def ready(self, save=False, seconds=2300):
        with patch('server.subprocess.Popen') as process:
            process.return_value.poll.return_value = 0
            key = self.jobs.create({'videoId': 'abcdefghijk', 'saveVocal': save})['id']
        folder = self.jobs.jobs[key]['folder']
        (folder / 'vocals.mp3').write_bytes(b'complete audio' * 100)
        (folder / 'state.json').write_text(json.dumps({'state': 'ready', 'totalSeconds': seconds, 'audioSelection': 'turkish', 'audioLanguage': 'tr'}))
        return key

    def test_opt_in_survives_cleanup_and_service_restart(self):
        key = self.ready(True)
        self.assertTrue(self.jobs.status(key)['saved'])
        self.jobs.close()
        cleanup_stale(self.temp.name)
        restarted = Jobs(self.temp.name)
        with patch('server.subprocess.Popen') as process:
            new = restarted.create({'videoId': 'abcdefghijk'})
            process.assert_not_called()
        self.assertEqual(new['state'], 'ready')
        self.assertTrue(restarted.status(new['id'])['cached'])
        restarted.close()

    def test_unchecked_does_not_persist(self):
        key = self.ready()
        self.assertFalse(self.jobs.status(key)['saved'])
        self.jobs.close()
        self.assertIsNone(self.jobs.cache.get('abcdefghijk', 40))

    def test_shutdown_saves_completed_opt_in_before_the_first_final_poll(self):
        self.ready(True)
        self.jobs.close()
        self.assertIsNotNone(self.jobs.cache.get('abcdefghijk', 40))

    def test_ready_audio_can_be_saved_later_and_unchecking_keeps_saved_copy(self):
        key = self.ready()
        result = self.request('POST', '/jobs/' + key + '/retention', {'saveVocal': True})
        self.assertTrue(result[1]['saved'])
        self.request('POST', '/jobs/' + key + '/retention', {'saveVocal': False})
        self.jobs.close()
        self.assertIsNotNone(self.jobs.cache.get('abcdefghijk', 40))

    def test_clear_does_not_break_active_audio_or_resave_it(self):
        key = self.ready(True)
        self.jobs.status(key)
        self.assertEqual(self.request('DELETE', '/cache')[0], 200)
        self.assertFalse(self.jobs.status(key)['saved'])
        self.assertTrue((self.jobs.jobs[key]['folder'] / 'vocals.mp3').exists())
        self.assertIsNone(self.jobs.cache.get('abcdefghijk', 40))

    def test_integrity_and_duration_limits_are_checked_before_reuse(self):
        key = self.ready(True)
        self.jobs.status(key)
        self.assertIsNone(self.jobs.cache.get('abcdefghijk', 25))
        path, meta = self.jobs.cache.get('abcdefghijk', 40)
        path.write_bytes(b'X' * path.stat().st_size)
        self.assertIsNone(self.jobs.cache.get('abcdefghijk', 40))

    def test_disk_failure_keeps_playable_audio_and_reports_warning(self):
        key = self.ready(True)
        with patch.object(self.jobs.cache, 'save', side_effect=OSError('disk full')):
            result = self.jobs.status(key)
        self.assertEqual(result['state'], 'ready')
        self.assertFalse(result['saved'])
        self.assertIn('kaydedilemedi', result['cacheWarning'])

    def test_range_transfer_and_invalid_range(self):
        key = self.ready()
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        connection.request('GET', '/jobs/' + key + '/audio', headers={'Authorization': 'Bearer test-secret', 'Range': 'bytes=10-99'})
        response = connection.getresponse()
        self.assertEqual(response.status, 206)
        self.assertEqual(response.getheader('Content-Range'), 'bytes 10-99/1400')
        self.assertEqual(response.read(), (b'complete audio' * 100)[10:100])
        connection.close()
        self.assertEqual(self.request('GET', '/jobs/' + key + '/audio', headers={'Range': 'bytes=2000-3000'})[0], 416)

    def test_cache_endpoints_require_authorization_and_valid_boolean(self):
        self.assertEqual(self.request('DELETE', '/cache', headers={'Authorization': ''})[0], 401)
        self.assertEqual(self.request('POST', '/jobs', {'videoId': 'abcdefghijk', 'saveVocal': 'true'})[0], 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
