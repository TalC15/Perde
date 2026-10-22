"""A disposable process: validated YouTube audio -> local separation -> vocals only."""
import errno
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import wave
from audio_selection import select_audio
from cpu_runtime import configure_torch, cpu_threads, worker_environment, background_creation_flags

ROOT = Path(__file__).resolve().parent
MP3_BYTES_PER_SECOND = 24000  # 192 kbit/s constant bitrate
# Separation slows down once it is this far ahead of the listener (seconds).
AHEAD_RELAXED, AHEAD_IDLE = 150, 300


def write_state(folder, state, error=None, required=True, **progress):
    """Atomic state file for the service. Windows refuses to replace a file that
    the service (or a virus scanner) is reading at that moment; that used to end
    the whole job, so retry instead. A skipped progress update is harmless."""
    value = {'state': state}
    value.update(progress)
    if error: value['error'] = error
    data = json.dumps(value, ensure_ascii=False)
    pending = folder / 'state.next'
    for attempt in range(60 if required else 6):
        try:
            pending.write_text(data, encoding='utf-8')
            pending.replace(folder / 'state.json')
            return True
        except PermissionError:
            time.sleep(min(.25, .02 * (attempt + 1)))
    if required:
        raise OSError(errno.EACCES, 'Durum dosyası yazılamadı.')
    return False


def keep_awake():
    # A long separation must not be cut by Windows sleep; the request ends with this process.
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED


def validate_info(info, limit):
    duration = info.get('duration')
    if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        raise ValueError('Canlı yayınlar desteklenmiyor.')
    if type(duration) not in (int, float) or not 0 < duration <= limit:
        raise ValueError('Video süre sınırını aşıyor veya süresi okunamıyor.')


def describe(error):
    """A user-facing reason instead of one generic failure message."""
    if isinstance(error, MemoryError):
        return 'Bellek yetersiz kaldı. Diğer programları kapatıp yeniden dene.'
    if isinstance(error, OSError) and error.errno == errno.ENOSPC:
        return 'Diskte yer kalmadı. Boş alan açıp yeniden dene.'
    text = str(error)
    if type(error).__name__ in ('DownloadError', 'ExtractorError'):
        lowered = text.lower()
        if 'sign in' in lowered or 'bot' in lowered or 'confirm your age' in lowered:
            return 'YouTube bu video için oturum veya doğrulama istedi; indirilemedi. Biraz sonra tekrar dene.'
        if 'http error 403' in lowered or 'forbidden' in lowered:
            return 'YouTube indirmeyi reddetti (403). Ses bileşenlerinin güncellenmesi gerekebilir: servisi BASLAT.cmd ile yeniden başlat.'
        if any(word in lowered for word in ('private', 'unavailable', 'members', 'removed', 'copyright')):
            return 'Video bu bilgisayardan indirilemiyor (özel, kısıtlı veya kaldırılmış olabilir).'
        if any(word in lowered for word in ('timed out', 'timeout', 'connection', 'getaddrinfo', 'network', 'unreachable')):
            return 'İnternet bağlantısı kesildi. Bağlantıyı kontrol edip yeniden dene.'
        return 'YouTube sesi indirilemedi. Biraz sonra yeniden dene.'
    if isinstance(error, subprocess.SubprocessError):
        return 'Ses dönüştürülemedi. Servisi yeniden başlatıp tekrar dene.'
    return 'Ses işlenemedi. Bağımlılıkları, bağlantıyı, kullanılabilir belleği ve videonun erişimini kontrol et.'


class Mp3Stream:
    """Separated PCM -> MP3 while separation continues: the file grows and the
    browser can start playing the beginning. No Xing header is written, so the
    bytes already sent never change. Without that header players cannot trim
    the codec delay (LAME 576 + decoder 529 samples), so those samples are
    dropped here instead and the decoded vocal lines up with the video."""
    DELAY = 1105

    def __init__(self, ffmpeg, path, sr, channels, flags):
        self.path = path
        self.skip = self.DELAY
        self.process = subprocess.Popen(
            [ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 's16le', '-ar', str(sr), '-ac', str(channels), '-i', 'pipe:0',
             '-codec:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '0', '-id3v2_version', '0',
             '-flush_packets', '1', '-threads', '1', str(path)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)

    def write(self, block):
        import numpy as np
        if self.skip:
            dropped = min(self.skip, len(block))
            block, self.skip = block[dropped:], self.skip - dropped
        pcm = (np.clip(block, -1, 1) * 32767).round().astype('<i2')
        try:
            self.process.stdin.write(pcm.tobytes())
            self.process.stdin.flush()
        except OSError:
            raise ValueError('Vokal MP3 kodlayıcısı beklenmedik biçimde durdu.')

    def finish(self, timeout=180):
        self.process.stdin.close()
        if self.process.wait(timeout=timeout) != 0 or not self.path.stat().st_size:
            raise ValueError('Vokal MP3 olarak kodlanamadı.')

    def abort(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)


def paced(folder, processed, spent):
    """Slow down while far ahead of the listener so playback keeps the machine."""
    try:
        control = json.loads((folder / 'control.json').read_text(encoding='utf-8'))
        position, reported = float(control['position']), float(control['at'])
    except (OSError, ValueError, KeyError, TypeError):
        return
    if time.time() - reported > 30:
        return  # No recent playback: finish as fast as possible.
    ahead = processed - position
    if ahead > AHEAD_IDLE:
        time.sleep(min(30, spent * 2))
    elif ahead > AHEAD_RELAXED:
        time.sleep(min(20, spent))


def load_mdx(engine):
    """The MDX-Net vocal model, or None so the caller falls back to Demucs.
    On the processor alone Demucs is faster, so "auto" uses MDX only with a GPU."""
    try:
        import mdx
        path = mdx.model_path(os.environ.get('TORCH_HOME', ROOT / '.models'))
        if not path.is_file() or path.stat().st_size != mdx.MODEL_BYTES:
            return None
        model = mdx.MDXVocals(path, cpu_threads())
        return model if engine == 'mdx' or model.device == 'gpu' else None
    except Exception:
        return None


def separate(wav_path, sink, device, engine, on_progress=None):
    """Returns the processor that did the work: 'gpu' or 'cpu'."""
    os.environ.update(worker_environment())
    from audio_stream import process_wav
    model = load_mdx(engine) if engine in ('auto', 'mdx') else None
    if model:
        # A short first block lets playback start early; longer blocks afterwards
        # spend less time on block seams.
        process_wav(wav_path, sink, model.prepare, on_progress, block_seconds=60, first_block_seconds=20)
        return model.device
    import torch
    configure_torch(torch)
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    model = get_model('htdemucs')
    model.eval()
    def prepare(sr, channels, mean, std):
        if sr != model.samplerate or channels != model.audio_channels:
            raise ValueError('Ses biçimi modelle uyuşmuyor.')
        def transform(data):
            if std < 1e-8:
                return data
            wav = torch.from_numpy(data.T.copy())
            with torch.inference_mode():
                sources = apply_model(model, ((wav-mean)/std)[None], device=device, shifts=0, split=True, overlap=.25, progress=False, num_workers=0)[0]
                return (sources[model.sources.index('vocals')].cpu()*std+mean).numpy().T.copy()
        return transform
    process_wav(wav_path, sink, prepare, on_progress)
    return 'gpu' if device == 'cuda' else 'cpu'


def download(folder, video_id, limit, max_bytes, selected_audio):
    import yt_dlp
    last_progress = 0
    def format_selector(context):
        selected, metadata = select_audio(context['formats'])
        selected_audio.update(metadata)
        write_state(folder, 'downloading', required=False, **selected_audio)
        yield selected
    def progress(data):
        nonlocal last_progress
        if data.get('downloaded_bytes', 0) > max_bytes:
            raise ValueError('Ses dosyası boyut sınırını aşıyor.')
        if time.monotonic()-last_progress > 1:
            last_progress = time.monotonic()
            size = data.get('total_bytes') or data.get('total_bytes_estimate')
            write_state(folder, 'downloading', required=False, progress=min(99, round(100*data.get('downloaded_bytes', 0)/size)) if size else None, **selected_audio)
    def match_filter(info, *, incomplete=False):
        if not incomplete:
            validate_info(info, limit)
        return None
    options = {
        'format': format_selector, 'noplaylist': True,
        'outtmpl': str(folder/'source.%(ext)s'), 'quiet': True, 'no_warnings': True, 'noprogress': True,
        'cachedir': False, 'writethumbnail': False, 'writeinfojson': False,
        'socket_timeout': 20, 'retries': 5, 'fragment_retries': 5, 'extractor_retries': 3,
        'max_filesize': max_bytes, 'progress_hooks': [progress], 'match_filter': match_filter,
        'js_runtimes': {'node': {}},
    }
    for attempt in range(2):
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                # One extraction and selection: do not fetch the URL a second time with
                # a default selector that could switch back to the original language.
                info = downloader.extract_info('https://www.youtube.com/watch?v='+video_id, download=True)
                validate_info(info, limit)
                return info
        except yt_dlp.utils.DownloadError as error:
            if attempt or isinstance(getattr(error, 'exc_info', [None, None])[1], ValueError):
                raise
            # A dropped connection or a momentary YouTube refusal often passes.
            for item in folder.glob('source.*'):
                item.unlink(missing_ok=True)
            time.sleep(3)


def run(folder, video_id, minutes, device, engine='auto'):
    import imageio_ffmpeg
    limit = minutes*60
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    max_bytes = 160_000_000
    selected_audio = {}
    info = download(folder, video_id, limit, max_bytes, selected_audio)
    inputs = [p for p in folder.glob('source.*') if p.suffix not in ('.part', '.ytdl')]
    if len(inputs) != 1 or inputs[0].stat().st_size > max_bytes:
        raise ValueError('Ses indirilemedi. Video erişime açık olmayabilir.')
    wav = folder/'input.wav'
    flags = {'creationflags': background_creation_flags()}
    subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-threads', '1', '-i', str(inputs[0]), '-vn', '-t', str(limit+1), '-ar', '44100', '-ac', '2', '-threads', '1', str(wav)], check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
    inputs[0].unlink(missing_ok=True)
    with wave.open(str(wav), 'rb') as audio:
        seconds = audio.getnframes()/audio.getframerate()
        # Audio tracks may end a little before/after the picture; the start is what aligns.
        if not 0 < seconds <= limit+.15 or abs(seconds-info['duration']) > max(2.5, info['duration']*.005):
            raise ValueError('Ses süresi video ile uyuşmuyor veya sınırı aşıyor.')
    write_state(folder, 'separating', progress=0, totalSeconds=round(seconds), streamable=True, **selected_audio)
    started = time.monotonic()
    block_started = [started]
    def separated(done, total, sr):
        now = time.monotonic()
        elapsed = now-started
        remaining = round(elapsed*(total-done)/done) if done else None
        write_state(folder, 'separating', required=False, progress=round(100*done/total), processedSeconds=round(done/sr, 1), totalSeconds=round(total/sr), remainingSeconds=remaining, streamable=True, device=processor[0], **selected_audio)
        if done < total:
            paced(folder, done/sr, now-block_started[0])
        block_started[0] = time.monotonic()
    processor = ['cpu']
    encoder = Mp3Stream(ffmpeg, folder/'vocals.mp3', 44100, 2, flags)
    try:
        processor[0] = 'gpu' if engine in ('auto', 'mdx') else 'cpu'
        processor[0] = separate(wav, encoder, device, engine, separated)
        write_state(folder, 'encoding', processedSeconds=round(seconds, 1), totalSeconds=round(seconds), streamable=True, **selected_audio)
        encoder.finish()
    except BaseException:
        encoder.abort()
        raise
    return {**selected_audio, 'totalSeconds': seconds, 'device': processor[0]}


def main():
    from server import validate_request
    folder = Path(sys.argv[1]).resolve()
    video_id, minutes = validate_request({'videoId': sys.argv[2], 'maxMinutes': int(sys.argv[3])})
    device = sys.argv[4]
    engine = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] in ('auto', 'mdx', 'demucs') else 'auto'
    # Keep model weights separate from temporary media. No browser data or cookies are read.
    os.environ.setdefault('TORCH_HOME', str(ROOT/'.models'))
    keep_awake()
    ok = False
    error = None
    result = {}
    try:
        write_state(folder, 'downloading')
        result = run(folder, video_id, minutes, device, engine)
        ok = True
    except ValueError as exc:
        error = str(exc)
    except BaseException as exc:
        error = describe(exc)
    finally:
        # Inputs, partial downloads, and unwanted stems never remain after completion/failure.
        for item in folder.iterdir():
            if item.name in ('vocals.mp3', 'state.json', 'control.json') and ok: continue
            if item.name == 'state.json': continue
            if item.is_file():
                try:
                    item.unlink(missing_ok=True)
                except OSError:
                    pass  # The service sweeper removes a file Windows briefly kept locked.
        write_state(folder, 'ready' if ok else 'error', error, streamable=ok, **result)


if __name__ == '__main__':
    main()
