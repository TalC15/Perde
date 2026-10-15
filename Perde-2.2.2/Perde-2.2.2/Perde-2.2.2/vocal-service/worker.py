"""A disposable process: validated YouTube audio -> local Demucs -> vocals only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import wave
from audio_selection import select_audio


def write_state(folder, state, error=None, **progress):
    value = {'state': state}
    value.update(progress)
    if error: value['error'] = error
    pending = folder / 'state.next'
    pending.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    pending.replace(folder / 'state.json')


def validate_info(info, limit):
    duration = info.get('duration')
    if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        raise ValueError('Canlı yayınlar desteklenmiyor.')
    if type(duration) not in (int, float) or not 0 < duration <= limit:
        raise ValueError('Video süre sınırını aşıyor veya süresi okunamıyor.')


def separate(wav_path, output_path, device, on_progress=None):
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from audio_stream import process_wav
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
    return process_wav(wav_path, output_path, prepare, on_progress)


def run(folder, video_id, minutes, device):
    import imageio_ffmpeg
    import yt_dlp
    limit = minutes*60
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    max_bytes = 160_000_000
    last_progress = 0
    selected_audio = {}
    def format_selector(context):
        selected, metadata = select_audio(context['formats'])
        selected_audio.update(metadata)
        write_state(folder, 'downloading', **selected_audio)
        yield selected
    def progress(data):
        nonlocal last_progress
        if data.get('downloaded_bytes', 0) > max_bytes:
            raise ValueError('Ses dosyası boyut sınırını aşıyor.')
        if time.monotonic()-last_progress > 1:
            last_progress = time.monotonic()
            size = data.get('total_bytes') or data.get('total_bytes_estimate')
            write_state(folder, 'downloading', progress=min(99, round(100*data.get('downloaded_bytes', 0)/size)) if size else None, **selected_audio)
    def match_filter(info, *, incomplete=False):
        if not incomplete:
            validate_info(info, limit)
        return None
    options = {
        'format': format_selector, 'noplaylist': True,
        'outtmpl': str(folder/'source.%(ext)s'), 'quiet': True, 'no_warnings': True, 'noprogress': True,
        'cachedir': False, 'writethumbnail': False, 'writeinfojson': False,
        'socket_timeout': 20, 'retries': 2, 'fragment_retries': 2,
        'max_filesize': max_bytes, 'progress_hooks': [progress], 'match_filter': match_filter,
        'js_runtimes': {'node': {}},
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        # One extraction and selection: do not fetch the URL a second time with
        # a default selector that could switch back to the original language.
        info = downloader.extract_info('https://www.youtube.com/watch?v='+video_id, download=True)
        validate_info(info, limit)
    inputs = [p for p in folder.glob('source.*') if p.suffix not in ('.part', '.ytdl')]
    if len(inputs) != 1 or inputs[0].stat().st_size > max_bytes:
        raise ValueError('Ses indirilemedi. Video erişime açık olmayabilir.')
    wav = folder/'input.wav'
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(inputs[0]), '-vn', '-t', str(limit+1), '-ar', '44100', '-ac', '2', str(wav)], check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
    with wave.open(str(wav), 'rb') as audio:
        seconds = audio.getnframes()/audio.getframerate()
        if not 0 < seconds <= limit+.15 or abs(seconds-info['duration']) > 2:
            raise ValueError('Ses süresi video ile uyuşmuyor veya sınırı aşıyor.')
    write_state(folder, 'separating', progress=0, **selected_audio)
    started = time.monotonic()
    def separated(done, total, sr):
        elapsed = time.monotonic()-started
        remaining = round(elapsed*(total-done)/done) if done else None
        write_state(folder, 'separating', progress=round(100*done/total), processedSeconds=round(done/sr), totalSeconds=round(total/sr), remainingSeconds=remaining, **selected_audio)
    separate(wav, folder/'vocals.wav', device, separated)
    write_state(folder, 'encoding', **selected_audio)
    subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(folder/'vocals.wav'), '-codec:a', 'libmp3lame', '-b:a', '192k', str(folder/'vocals.mp3')], check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
    return {**selected_audio, 'totalSeconds': seconds}


def main():
    from server import validate_request
    folder = Path(sys.argv[1]).resolve()
    video_id, minutes = validate_request({'videoId': sys.argv[2], 'maxMinutes': int(sys.argv[3])})
    device = sys.argv[4]
    # Keep model weights separate from temporary media. No browser data or cookies are read.
    os.environ.setdefault('TORCH_HOME', str(Path(__file__).resolve().parent/'.models'))
    ok = False
    error = None
    selected_audio = {}
    try:
        write_state(folder, 'downloading')
        selected_audio = run(folder, video_id, minutes, device)
        ok = True
    except ValueError as exc:
        error = str(exc)
    except BaseException:
        error = 'Ses işlenemedi. Bağımlılıkları, bağlantıyı, kullanılabilir belleği ve videonun erişimini kontrol et.'
    finally:
        # Inputs, partial downloads, and unwanted stems never remain after completion/failure.
        for item in folder.iterdir():
            if item.name == 'vocals.mp3' and ok: continue
            if item.is_file(): item.unlink(missing_ok=True)
        write_state(folder, 'ready' if ok else 'error', error, **selected_audio)


if __name__ == '__main__':
    main()
