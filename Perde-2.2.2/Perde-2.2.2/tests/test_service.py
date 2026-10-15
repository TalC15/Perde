import http.client
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
ROOT=Path(__file__).resolve().parents[1]/'vocal-service'
sys.path.insert(0,str(ROOT))
from server import Server, Handler, Jobs, validate_request
from worker import validate_info

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.jobs=Jobs(self.temp.name)
        self.http=Server(('127.0.0.1',0),Handler)
        self.http.jobs=self.jobs
        self.http.token='test-secret'
        self.http.extension_origin='chrome-extension://'+'a'*32
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True)
        self.thread.start()
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join();self.temp.cleanup()
    def request(self,method,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.http.server_port,timeout=3)
        values={'Authorization':'Bearer test-secret','Content-Type':'application/json'}
        values.update(headers or {})
        connection.request(method,path,json.dumps(body) if body is not None else None,values)
        response=connection.getresponse();data=response.read();connection.close()
        return response.status,json.loads(data)
    def test_no_auth_no_access(self):
        self.assertEqual(self.request('GET','/health',headers={'Authorization':''})[0],401)
    def test_host_and_origin_validation(self):
        self.assertEqual(self.request('GET','/health',headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('GET','/health',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.request('GET','/health',headers={'Origin':self.http.extension_origin})[0],200)
        self.assertEqual(self.request('OPTIONS','/jobs')[0],403)
    def test_duration_and_url_validation(self):
        for body in ({'videoId':'https://youtube.com/abc'}, {'videoId':'abcdefghijk','maxMinutes':999}, {'videoId':'abcdefghijk','maxMinutes':True}, []):
            with self.subTest(body=body):self.assertEqual(self.request('POST','/jobs',body)[0],400)
    def test_worker_rejects_live_unknown_and_long(self):
        for info in ({'duration':601},{'duration':30,'is_live':True},{'duration':None},{'duration':float('nan')},{'duration':False}):
            with self.assertRaises(ValueError):validate_info(info,600)
        validate_info({'duration':50},600)
    def test_job_ownership_and_path_traversal(self):
        self.assertEqual(self.request('GET','/jobs/../../server.py')[0],404)
        self.assertEqual(self.request('GET','/jobs/'+'a'*32)[0],404)
    @patch('server.subprocess.Popen')
    def test_single_job_cancel_removes_files(self,popen):
        popen.return_value.poll.return_value=0
        status,job=self.request('POST','/jobs',{'videoId':'abcdefghijk','maxMinutes':3})
        self.assertEqual(status,202);folder=Path(self.temp.name)/job['id'];self.assertTrue(folder.exists())
        (folder/'source.wav').write_bytes(b'private media')
        self.assertEqual(self.request('POST','/jobs',{'videoId':'abcdefghijk'})[0],400)
        self.assertEqual(self.request('DELETE','/jobs/'+job['id'])[0],200)
        self.assertFalse(folder.exists());self.assertEqual(len(self.jobs.jobs),0)
        self.assertNotIn('shell',popen.call_args.kwargs)
    @patch('server.subprocess.Popen')
    def test_expiry_removes_abandoned_media(self,popen):
        popen.return_value.poll.return_value=0
        job=self.jobs.create({'videoId':'abcdefghijk'})
        self.jobs.jobs[job['id']]['last']=time.monotonic()-1000
        self.jobs.cleanup();self.assertEqual(len(self.jobs.jobs),0)
    @patch('server.subprocess.Popen')
    def test_crashed_worker_returns_error(self,popen):
        popen.return_value.poll.return_value=1
        job=self.jobs.create({'videoId':'abcdefghijk'})
        self.assertEqual(self.jobs.status(job['id'])['state'],'error')

class LongSessionTests(unittest.TestCase):
    setUp=ServiceTests.setUp
    tearDown=ServiceTests.tearDown
    request=ServiceTests.request
    def test_40_minute_limit_and_boundary(self):
        self.assertEqual(validate_request({'videoId':'abcdefghijk','maxMinutes':25})[1],25)
        self.assertEqual(validate_request({'videoId':'abcdefghijk','maxMinutes':40})[1],40)
        self.assertEqual(validate_request({'videoId':'abcdefghijk'})[1],40)
        self.assertEqual(self.request('GET','/health')[1]['maxMinutes'],40)
        validate_info({'duration':2400},2400)
        with self.assertRaises(ValueError):validate_info({'duration':2400.01},2400)
        with self.assertRaises(ValueError):validate_request({'videoId':'abcdefghijk','maxMinutes':41})
        with self.assertRaises(ValueError):validate_request({'videoId':'abcdefghijk','maxMinutes':26})
    @patch('server.subprocess.Popen')
    def test_active_ready_job_survives_idle_expiry_with_heartbeat(self,popen):
        popen.return_value.poll.return_value=0
        key=self.jobs.create({'videoId':'abcdefghijk','maxMinutes':40})['id']
        job=self.jobs.jobs[key]
        (job['folder']/'state.json').write_text(json.dumps({'state':'ready'}))
        job['last']=time.monotonic()-1000
        self.assertEqual(self.request('GET','/jobs/'+key)[1]['state'],'ready')
        self.jobs.cleanup()
        self.assertIn(key,self.jobs.jobs)
    @patch('server.stop_process')
    @patch('server.subprocess.Popen')
    def test_long_job_survives_90_minutes_but_ends_after_120(self,popen,stop):
        popen.return_value.poll.return_value=None
        key=self.jobs.create({'videoId':'abcdefghijk','maxMinutes':40})['id'];job=self.jobs.jobs[key]
        private=job['folder']/'private.wav';private.write_bytes(b'private')
        job['created']=time.monotonic()-91*60
        self.jobs.cleanup()
        stop.assert_not_called();self.assertTrue(private.exists())
        self.assertNotEqual(job['state'],'error')
        job['created']=time.monotonic()-121*60
        self.jobs.cleanup()
        stop.assert_called_once();self.assertFalse(private.exists())
        self.assertEqual(self.jobs.status(key)['state'],'error')
    @patch('server.stop_process')
    @patch('server.subprocess.Popen')
    def test_stalled_job_erases_media_and_exposes_error(self,popen,stop):
        popen.return_value.poll.return_value=None
        key=self.jobs.create({'videoId':'abcdefghijk'})['id'];job=self.jobs.jobs[key]
        (job['folder']/'private.wav').write_bytes(b'private')
        job['progress_at']=time.monotonic()-601
        self.jobs.cleanup()
        stop.assert_called_once()
        self.assertFalse((job['folder']/'private.wav').exists())
        self.assertEqual(self.jobs.status(key)['state'],'error')
    @patch('server.subprocess.Popen')
    def test_progress_cannot_overwrite_job_metadata(self,popen):
        popen.return_value.poll.return_value=None
        key=self.jobs.create({'videoId':'abcdefghijk'})['id'];job=self.jobs.jobs[key]
        folder=job['folder']
        (folder/'state.json').write_text(json.dumps({'state':'separating','progress':52,'processedSeconds':700,'remainingSeconds':40,'id':'evil','folder':'/','audioLanguage':'tr','audioSelection':'turkish'}))
        result=self.jobs.status(key)
        self.assertEqual(result['progress'],52)
        self.assertEqual(result['id'],key)
        self.assertEqual(job['folder'],folder)
        self.assertEqual(result['audioLanguage'],'tr')
        self.assertEqual(result['audioSelection'],'turkish')
        (folder/'state.json').write_text(json.dumps({'state':'ready','audioLanguage':'<script>','audioSelection':'evil'}))
        result=self.jobs.status(key)
        self.assertEqual(result['audioLanguage'],'tr')
        self.assertEqual(result['audioSelection'],'turkish')

if __name__=='__main__':unittest.main(verbosity=2)
