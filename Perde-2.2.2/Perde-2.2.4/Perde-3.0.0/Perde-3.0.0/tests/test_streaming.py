"""The service hands out the vocal while it is still being separated."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1] / 'vocal-service'
sys.path.insert(0, str(ROOT))
import worker
from server import Server, Handler, Jobs


class StreamingServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.http = Server(('127.0.0.1', 0), Handler)
        self.http.jobs = Jobs(self.temp.name)
        self.http.token = 'test-secret'
        self.http.extension_origin = 'chrome-extension://' + 'a' * 32
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        with patch('server.subprocess.Popen') as popen:
            popen.return_value.poll.return_value = None
            self.job = self.http.jobs.create({'videoId': 'abcdefghijk'})['id']
        self.folder = Path(self.temp.name) / self.job

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.temp.cleanup()

    def get(self, path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=3)
        connection.request('GET', path, headers={'Authorization': 'Bearer test-secret', **(headers or {})})
        response = connection.getresponse(); body = response.read(); connection.close()
        return response, body

    def post(self, path, value):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=3)
        connection.request('POST', path, json.dumps(value), {'Authorization': 'Bearer test-secret', 'Content-Type': 'application/json'})
        response = connection.getresponse(); body = response.read(); connection.close()
        return response.status, json.loads(body)

    def test_growing_file_is_served_with_unknown_total_until_ready(self):
        audio = '/jobs/%s/audio' % self.job
        worker.write_state(self.folder, 'downloading')
        self.assertEqual(self.get(audio, {'Range': 'bytes=0-99'})[0].status, 409)
        worker.write_state(self.folder, 'separating', progress=10, processedSeconds=20, streamable=True)
        self.assertEqual(self.get(audio, {'Range': 'bytes=0-99'})[0].status, 204)  # Nothing encoded yet.
        (self.folder / 'vocals.mp3').write_bytes(b'x' * 1000)
        response, body = self.get(audio, {'Range': 'bytes=0-4095'})
        self.assertEqual((response.status, response.getheader('Content-Range'), len(body)), (206, 'bytes 0-999/*', 1000))
        self.assertEqual(self.get(audio, {'Range': 'bytes=1000-4095'})[0].status, 204)
        self.assertEqual(self.get(audio)[0].status, 416)  # A partial file is read in ranges only.
        with (self.folder / 'vocals.mp3').open('ab') as stream:
            stream.write(b'y' * 500)
        worker.write_state(self.folder, 'ready', totalSeconds=60, streamable=True)
        response, body = self.get(audio, {'Range': 'bytes=1000-4095'})
        self.assertEqual((response.status, response.getheader('Content-Range'), body), (206, 'bytes 1000-1499/1500', b'y' * 500))
        self.assertEqual(self.get(audio, {'Range': 'bytes=1500-4095'})[0].status, 416)

    def test_a_failed_separation_returns_its_reason_to_the_player(self):
        worker.write_state(self.folder, 'separating', streamable=True)
        (self.folder / 'vocals.mp3').write_bytes(b'x' * 100)
        worker.write_state(self.folder, 'error', 'Bellek yetersiz kaldı.')
        response, body = self.get('/jobs/%s/audio' % self.job, {'Range': 'bytes=100-200'})
        self.assertEqual(response.status, 409)
        self.assertIn('Bellek', json.loads(body)['error'])

    def test_position_reports_reach_the_worker_only_while_it_works(self):
        worker.write_state(self.folder, 'separating', streamable=True)
        self.http.jobs.status(self.job)
        self.assertEqual(self.post('/jobs/%s/position' % self.job, {'position': 42.5})[0], 200)
        control = json.loads((self.folder / 'control.json').read_text(encoding='utf-8'))
        self.assertEqual(control['position'], 42.5)
        self.assertEqual(self.post('/jobs/%s/position' % self.job, {'position': -1})[0], 400)
        self.assertEqual(self.post('/jobs/%s/position' % self.job, {'position': True})[0], 400)
        self.assertEqual(self.post('/jobs/%s/position' % ('b' * 32), {'position': 1})[0], 404)


class EncoderTests(unittest.TestCase):
    def test_codec_delay_is_removed_so_the_vocal_lines_up_with_the_video(self):
        import numpy as np
        import imageio_ffmpeg
        import subprocess
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'vocals.mp3'
            encoder = worker.Mp3Stream(ffmpeg, path, 44100, 2, {})
            signal = np.zeros((44100 * 2, 2), np.float32)
            signal[44100] = .9  # A click at exactly one second.
            for start in range(0, len(signal), 500):  # Small blocks: the skip spans several.
                encoder.write(signal[start:start + 500])
            encoder.finish()
            decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-f', 's16le', '-ac', '1', '-'], capture_output=True, check=True).stdout
            peak = int(np.argmax(np.abs(np.frombuffer(decoded, '<i2'))))
            self.assertLessEqual(abs(peak - 44100), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
