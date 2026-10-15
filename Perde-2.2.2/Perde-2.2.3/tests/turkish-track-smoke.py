"""Optional public-video test: real Turkish track download, decode, then delete."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[1] / 'vocal-service'
sys.path.insert(0, str(ROOT))
from audio_selection import select_audio
from server import validate_request
from worker import validate_info
import imageio_ffmpeg
import yt_dlp

video_id, minutes = validate_request({'videoId': sys.argv[1], 'maxMinutes': 25})
selected = {}


def selector(context):
    fmt, metadata = select_audio(context['formats'])
    if metadata['audioSelection'] != 'turkish':
        raise ValueError('Erişilebilir Türkçe ses bulunamadı; Türkçe indirme testi yapılamıyor.')
    selected.update(metadata)
    yield fmt


def match_filter(info, *, incomplete=False):
    if not incomplete:
        validate_info(info, minutes * 60)


with tempfile.TemporaryDirectory(prefix='perde-tr-track-') as scratch:
    folder = Path(scratch)
    options = {'format': selector, 'quiet': True, 'no_warnings': True, 'noprogress': True,
               'cachedir': False, 'noplaylist': True, 'socket_timeout': 20, 'retries': 2,
               'max_filesize': 100_000_000, 'match_filter': match_filter,
               'outtmpl': str(folder / 'source.%(ext)s'), 'js_runtimes': {'node': {}}}
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info('https://www.youtube.com/watch?v=' + video_id, download=True)
    source = list(folder.glob('source.*'))
    assert len(source) == 1 and 0 < source[0].stat().st_size <= 100_000_000
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    decoded = folder / 'sample.wav'
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error', '-y',
                    '-i', str(source[0]), '-vn', '-t', '5', '-ar', '44100', '-ac', '2', str(decoded)],
                   check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
    with wave.open(str(decoded), 'rb') as audio:
        decoded_seconds = audio.getnframes() / audio.getframerate()
        # Compressed input timestamps/encoder delay can trim the clip boundary.
        assert 4.8 <= decoded_seconds <= 5.15, decoded_seconds
    print(json.dumps({'audio': selected, 'videoSeconds': info.get('duration'),
                      'downloadBytes': source[0].stat().st_size, 'decodedSeconds': round(decoded_seconds, 4),
                      'scope': 'Real Turkish-labelled track download/decode, no Demucs or listening quality test.'}, ensure_ascii=False))
print('PASS: Turkish track downloaded and decoded; temporary media removed.')
