"""Loopback-only, authenticated, ephemeral Demucs job service (stdlib HTTP)."""
from __future__ import annotations
import argparse
import atexit
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from process_lifetime import contain_process_tree
from vocal_cache import VocalCache

ROOT = Path(__file__).resolve().parent
MAX_MINUTES = 40
TTL = 15 * 60
JOB_TIMEOUT = 120 * 60
STALL_TIMEOUT = 10 * 60
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
JOB_ID = re.compile(r"^[a-f0-9]{32}$")


def validate_request(data):
    if not isinstance(data, dict) or not isinstance(data.get('videoId'), str) or not VIDEO_ID.fullmatch(data['videoId']):
        raise ValueError('Geçerli bir YouTube video kimliği gerekli.')
    minutes = data.get('maxMinutes', MAX_MINUTES)
    if type(minutes) is not int or minutes not in (3, 5, 10, 15, 25, 40):
        raise ValueError('Süre sınırı 3, 5, 10, 15, 25 veya 40 dakika olmalı.')
    return data['videoId'], minutes


def stop_process(process):
    if process and process.poll() is None:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        else:
            import signal
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)


def cleanup_stale(runtime, active=()):
    """A locked leftover must not prevent startup; retry on the next sweep."""
    runtime = Path(runtime).resolve()
    pending = 0
    for child in runtime.iterdir():
        if child.name in active or not JOB_ID.fullmatch(child.name):
            continue
        if child.is_symlink() or child.resolve().parent != runtime or not child.is_dir():
            continue
        try:
            shutil.rmtree(child)
        except OSError:
            pending += 1
    return pending


class Jobs:
    def __init__(self, runtime, device='cpu', cache_root=None):
        self.runtime = Path(runtime).resolve()
        self.device = device
        self.jobs = {}
        self.lock = threading.RLock()
        self.cache = VocalCache(cache_root or self.runtime / '.saved-vocals')

    def create(self, data):
        video_id, minutes = validate_request(data)
        if type(data.get('saveVocal', False)) is not bool:
            raise ValueError('Kayıt seçimi geçersiz.')
        with self.lock:
            if self.jobs:
                raise ValueError('Önce mevcut vokal oturumunu kapat. Aynı anda bir iş desteklenir.')
            key = secrets.token_hex(16)
            folder = self.runtime / key
            folder.mkdir(mode=0o700)
            job = {'id': key, 'state': 'downloading', 'folder': folder, 'process': None, 'last': time.monotonic(), 'created': time.monotonic(), 'progress_at': time.monotonic(), 'state_mtime': None}
            self.jobs[key] = job
            job.update(video_id=video_id, saveVocal=data.get('saveVocal', False), saved=False, cached=False)
            cached = self.cache.get(video_id, minutes)
            if cached:
                try:
                    shutil.copyfile(cached[0], folder / 'vocals.mp3')
                    (folder / 'state.json').write_text(json.dumps({'state': 'ready', **cached[1]}), encoding='utf-8')
                    job.update(state='ready', saved=True, cached=True)
                    return {'id': key, 'state': 'ready', 'cached': True}
                except OSError:
                    # An unavailable library must not prevent a fresh separation.
                    (folder / 'vocals.mp3').unlink(missing_ok=True)
            # Arguments are passed as an array; no shell or user-provided URL is used.
            args = [sys.executable, str(ROOT / 'worker.py'), str(folder), video_id, str(minutes), self.device]
            try:
                job['process'] = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, start_new_session=os.name != 'nt')
            except Exception:
                self.jobs.pop(key)
                shutil.rmtree(folder)
                raise ValueError('Ses işçisi başlatılamadı.')
            return {'id': key, 'state': 'downloading'}

    def status(self, key, touch=True):
        with self.lock:
            job = self.jobs.get(key)
            if not job:
                raise KeyError('Vokal oturumu sona erdi.')
            if touch:
                job['last'] = time.monotonic()
            try:
                state_path = job['folder'] / 'state.json'
                state = json.loads(state_path.read_text(encoding='utf-8'))
                modified = state_path.stat().st_mtime_ns
                if modified != job['state_mtime']:
                    job['state_mtime'] = modified
                    job['progress_at'] = time.monotonic()
                if state.get('state') in ('downloading', 'separating', 'encoding', 'ready', 'error'):
                    job['state'] = state['state']
                    if isinstance(state.get('error'), str): job['error'] = state['error'][:300]
                    if state.get('audioSelection') in ('turkish', 'fallback'):
                        job['audioSelection'] = state['audioSelection']
                    if isinstance(state.get('audioLanguage'), str) and re.fullmatch('[a-z]{2,3}', state['audioLanguage']):
                        job['audioLanguage'] = state['audioLanguage']
                    for field in ('progress', 'processedSeconds', 'totalSeconds', 'remainingSeconds'):
                        value = state.get(field)
                        if type(value) in (int, float) and 0 <= value <= 86400:
                            job[field] = min(value, 100) if field == 'progress' else value
                        else:
                            job.pop(field, None)
            except (FileNotFoundError, ValueError, OSError):
                pass
            if job['process'] and job['process'].poll() is not None and job['state'] not in ('ready', 'error'):
                job.update(state='error', error='Ses ayrılamadı. Kurulumu ve internet bağlantısını kontrol et.')
            if job['state'] == 'ready' and job['saveVocal'] and not job['saved'] and not job.get('saveAttempted'):
                job['saveAttempted'] = True
                try:
                    self.cache.save(job['video_id'], job['folder'] / 'vocals.mp3', job)
                    job.update(saved=True, cacheWarning=None)
                except (OSError, ValueError):
                    job['cacheWarning'] = 'Vokal oynatılabilir ancak diske kaydedilemedi. Boş alanı kontrol edip kayıt kutusunu yeniden aç.'
            return {k: job[k] for k in ('id', 'state', 'error', 'progress', 'processedSeconds', 'totalSeconds', 'remainingSeconds', 'audioLanguage', 'audioSelection', 'saveVocal', 'saved', 'cached', 'cacheWarning') if k in job}

    def retain(self, key, enabled):
        if type(enabled) is not bool:
            raise ValueError('Kayıt seçimi geçersiz.')
        with self.lock:
            job = self.jobs[key]
            job.update(saveVocal=enabled, saveAttempted=False, cacheWarning=None)
            return self.status(key)

    def clear_cache(self):
        with self.lock:
            self.cache.clear()
            for job in self.jobs.values():
                job.update(saved=False, saveVocal=False, saveAttempted=False)

    def remove(self, key):
        with self.lock:
            job = self.jobs.get(key)
            if not job:
                return
            # A completed opt-in result must survive cancellation/normal shutdown
            # even when the browser has not polled its final status yet.
            self.status(key, touch=False)
            stop_process(job['process'])
            folder = job['folder'].resolve()
            if folder.parent != self.runtime or not JOB_ID.fullmatch(folder.name):
                raise RuntimeError('Geçersiz geçici klasör.')
            try:
                shutil.rmtree(folder)
            except OSError:
                pass  # A cancelled download may still hold a Windows file handle; sweeper retries.
            self.jobs.pop(key, None)

    def cleanup(self):
        with self.lock:
            now = time.monotonic()
            for key, job in list(self.jobs.items()):
                self.status(key, touch=False)
                if now-job['last'] > TTL:
                    self.remove(key)
                elif job['state'] in ('downloading', 'separating', 'encoding') and (now-job['created'] > JOB_TIMEOUT or now-job['progress_at'] > STALL_TIMEOUT):
                    stop_process(job['process'])
                    for item in job['folder'].iterdir():
                        if item.is_file(): item.unlink(missing_ok=True)
                    error = 'İşlem süre sınırını aştı veya 10 dakikadır ilerlemiyor. Geçici sesler temizlendi.'
                    (job['folder']/'state.json').write_text(json.dumps({'state': 'error', 'error': error}), encoding='utf-8')
                    job.update(state='error', error=error)

    def close(self):
        for key in list(self.jobs):
            self.remove(key)


class Handler(BaseHTTPRequestHandler):
    server_version = 'PerdeLocal'

    def log_message(self, *_):
        pass  # No request, video ID, token, or browsing history logs.

    def send_json(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            self.send_json(403, {'error': 'Geçersiz sunucu adresi.'}); return False
        origin = self.headers.get('Origin')
        # Extension background requests can omit Origin. A supplied origin must match.
        if origin and origin != self.server.extension_origin:
            self.send_json(403, {'error': 'Kaynak izni yok.'}); return False
        auth = self.headers.get('Authorization', '')
        if not hmac.compare_digest(auth, 'Bearer '+self.server.token):
            self.send_json(401, {'error': 'Servis anahtarı geçersiz. Yeniden bağlan.'}); return False
        return True

    def do_OPTIONS(self):
        # Web pages cannot preflight this service; no wildcard CORS.
        self.send_json(403, {'error': 'Tarayıcı sayfalarına doğrudan erişim verilmez.'})

    def do_GET(self):
        if not self.authorized(): return
        if self.path == '/health':
            self.send_json(200, {'ok': True, 'maxMinutes': MAX_MINUTES}); return
        match = re.fullmatch(r'/jobs/([a-f0-9]{32})(/audio)?', self.path)
        if not match:
            self.send_json(404, {'error': 'İşlem bulunamadı.'}); return
        key, audio = match.groups()
        stream = None
        try:
            with self.server.jobs.lock:
                state = self.server.jobs.status(key)
                if not audio:
                    self.send_json(200, state); return
                if state['state'] != 'ready':
                    self.send_json(409, {'error': 'Vokal henüz hazır değil.'}); return
                path = self.server.jobs.jobs[key]['folder'] / 'vocals.mp3'
                size = path.stat().st_size
                start, end = 0, size - 1
                requested = self.headers.get('Range')
                if requested:
                    parts = re.fullmatch(r'bytes=(\d+)-(\d+)', requested)
                    if not parts or not 0 <= int(parts[1]) <= int(parts[2]) or int(parts[1]) >= size:
                        self.send_json(416, {'error': 'Geçersiz ses aralığı.'}); return
                    start, end = int(parts[1]), min(int(parts[2]), size - 1)
                stream = path.open('rb')
            # Never hold the job lock while sending media: polling and cancellation stay responsive.
            with stream:
                stream.seek(start)
                self.send_response(206 if requested else 200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(end - start + 1))
                self.send_header('Accept-Ranges', 'bytes')
                if requested:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk: break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (KeyError, FileNotFoundError):
            self.send_json(404, {'error': 'Vokal oturumu sona erdi.'})
        except (ConnectionError, TimeoutError):
            pass  # Client retries the interrupted range, retaining the finished job.

    def do_POST(self):
        if not self.authorized(): return
        retention = re.fullmatch(r'/jobs/([a-f0-9]{32})/retention', self.path)
        if self.path != '/jobs' and not retention:
            self.send_json(404, {'error': 'İşlem bulunamadı.'}); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1024:
                raise ValueError('İstek boyutu geçersiz.')
            data = json.loads(self.rfile.read(length))
            if retention:
                self.send_json(200, self.server.jobs.retain(retention[1], data.get('saveVocal') if isinstance(data, dict) else None))
            else:
                self.send_json(202, self.server.jobs.create(data))
        except KeyError:
            self.send_json(404, {'error': 'Vokal oturumu sona erdi.'})
        except (ValueError, UnicodeDecodeError) as error:
            self.send_json(400, {'error': str(error) if not isinstance(error, json.JSONDecodeError) else 'Geçersiz istek.'})

    def do_DELETE(self):
        if not self.authorized(): return
        if self.path == '/cache':
            try:
                self.server.jobs.clear_cache()
                self.send_json(200, {'ok': True})
            except OSError:
                self.send_json(500, {'error': 'Bazı kayıtlar silinemedi. Dosyaları kullanan programı kapatıp yeniden dene.'})
            return
        match = re.fullmatch(r'/jobs/([a-f0-9]{32})', self.path)
        if not match:
            self.send_json(404, {'error': 'İşlem bulunamadı.'}); return
        self.server.jobs.remove(match[1]); self.send_json(200, {'ok': True})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address
    def handle_error(self, *_):
        pass  # Do not expose request paths in default HTTP tracebacks.


def main():
    parser = argparse.ArgumentParser(description='Perde yerel vokal servisi')
    parser.add_argument('--extension-id', required=True, help='chrome://extensions sayfasındaki 32 harfli kimlik')
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    args = parser.parse_args()
    if not re.fullmatch('[a-p]{32}', args.extension_id):
        parser.error('Eklenti kimliği 32 küçük a-p harfinden oluşmalı.')
    contain_process_tree()
    server = Server(('127.0.0.1', 8765), Handler)
    runtime = ROOT / '.runtime'
    runtime.mkdir(exist_ok=True, mode=0o700)
    # Binding the sole service port succeeded; clean only our own prior job directories.
    if cleanup_stale(runtime):
        print('Önceki oturumdan kilitli bir dosya kaldı; servis açılıyor, temizlik yeniden denenecek.', flush=True)
    server.token = secrets.token_urlsafe(32)
    server.extension_origin = 'chrome-extension://'+args.extension_id
    server.jobs = Jobs(runtime, args.device, ROOT / '.saved-vocals')
    atexit.register(server.jobs.close)
    print('Perde hazır: http://127.0.0.1:8765\nBu oturumun anahtarını eklenti paneline yapıştır:\n'+server.token, flush=True)
    print('Anahtar kapanışta geçersiz olur. Çıkış: Ctrl+C. İşlem süresi donanımına bağlıdır.', flush=True)
    ending = threading.Event()
    def reap():
        while not ending.wait(20):
            try:
                server.jobs.cleanup()
                with server.jobs.lock:
                    cleanup_stale(runtime, active=server.jobs.jobs)
            except OSError:
                pass  # Transient Windows file locks must not kill the sweeper.
    threading.Thread(target=reap, daemon=True).start()
    try:
        server.serve_forever(poll_interval=.5)
    except KeyboardInterrupt:
        pass
    finally:
        ending.set(); server.server_close(); server.jobs.close()


if __name__ == '__main__':
    main()
