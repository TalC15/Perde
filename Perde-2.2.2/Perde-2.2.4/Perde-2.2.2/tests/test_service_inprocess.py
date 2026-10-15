"""Exercise production HTTP handlers without sockets (restricted workspaces)."""
from email.message import Message
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import test_service
import test_vocal_cache
from server import Handler, Jobs


class InProcess:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.jobs = Jobs(self.temp.name)
        self.http = SimpleNamespace(jobs=self.jobs, token='test-secret', server_port=8765,
                                    extension_origin='chrome-extension://' + 'a' * 32)

    def tearDown(self):
        self.jobs.close()
        self.temp.cleanup()

    def raw_request(self, method, path, body=None, headers=None):
        handler = object.__new__(Handler)
        handler.server = self.http
        handler.path = path
        handler.request_version = 'HTTP/1.1'
        handler.requestline = method + ' ' + path + ' HTTP/1.1'
        handler.command = method
        handler.headers = Message()
        payload = json.dumps(body).encode() if body is not None else b''
        for key, value in {'Host': '127.0.0.1:8765', 'Authorization': 'Bearer test-secret',
                           'Content-Length': str(len(payload)), **(headers or {})}.items():
            handler.headers[key] = value
        handler.rfile = BytesIO(payload)
        handler.wfile = BytesIO()
        getattr(handler, 'do_' + method)()
        head, data = handler.wfile.getvalue().split(b'\r\n\r\n', 1)
        return int(head.split()[1]), head.decode(), data

    def request(self, method, path, body=None, headers=None):
        status, _, data = self.raw_request(method, path, body, headers)
        return status, json.loads(data)


class InProcessServiceTests(InProcess, test_service.ServiceTests):
    pass


class InProcessLongTests(InProcess, test_service.LongSessionTests):
    pass


class InProcessCacheTests(InProcess, test_vocal_cache.VocalCacheTests):
    def test_range_transfer_and_invalid_range(self):
        key = self.ready()
        status, headers, data = self.raw_request('GET', '/jobs/' + key + '/audio', headers={'Range': 'bytes=10-99'})
        self.assertEqual(status, 206)
        self.assertIn('Content-Range: bytes 10-99/1400', headers)
        self.assertEqual(data, (b'complete audio' * 100)[10:100])
        self.assertEqual(self.request('GET', '/jobs/' + key + '/audio', headers={'Range': 'bytes=2000-3000'})[0], 416)


if __name__ == '__main__':
    unittest.main(verbosity=2)
