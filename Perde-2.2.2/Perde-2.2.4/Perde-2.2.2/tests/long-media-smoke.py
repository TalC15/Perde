"""40-minute production-format streaming and MP3 timeline test, no Demucs."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import time
import numpy as np
import soundfile as sf
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1] / 'vocal-service'
sys.path.insert(0, str(ROOT))
from audio_stream import process_wav

with tempfile.TemporaryDirectory(prefix='perde-media-40-', dir=Path(__file__).parent) as scratch:
    folder = Path(scratch)
    rate, seconds = 44100, 40 * 60
    started = time.monotonic()
    t = np.arange(rate, dtype=np.float32) / rate
    signal = (.15 * np.sin(2 * np.pi * 220 * t)).astype('float32')
    stereo = np.column_stack([signal, signal * .9])
    with sf.SoundFile(str(folder / 'input.wav'), 'w', samplerate=rate, channels=2, subtype='PCM_16') as output:
        for _ in range(seconds):
            output.write(stereo)
    largest = blocks = 0
    def identity(block):
        global largest, blocks
        largest = max(largest, len(block)); blocks += 1
        return block
    frames, sample_rate = process_wav(folder / 'input.wav', folder / 'vocals.wav', lambda *args: identity)
    assert (frames, sample_rate) == (seconds * rate, rate)
    assert largest <= 30 * rate and blocks > 80
    print('PASS: 40-minute stereo WAV, bounded blocks and exact sample count.', flush=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(folder / 'vocals.wav'),
                    '-codec:a', 'libmp3lame', '-b:a', '192k', str(folder / 'vocals.mp3')],
                   check=True, timeout=300, **flags)
    subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(folder / 'vocals.mp3'), str(folder / 'decoded.wav')],
                   check=True, timeout=300, **flags)
    info = sf.info(str(folder / 'decoded.wav'))
    assert info.frames == frames and info.channels == 2 and info.samplerate == rate
    report = {'seconds': seconds, 'samples_per_channel': frames, 'largest_block_seconds': largest / rate,
              'blocks': blocks, 'mp3_bytes': (folder / 'vocals.mp3').stat().st_size,
              'elapsed_seconds': round(time.monotonic() - started, 2),
              'scope': '40-minute streaming identity and real MP3 encode/decode; no Demucs or perceptual quality benchmark.'}
    (Path(__file__).parent / 'long-media-result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report), flush=True)
print('PASS: MP3 roundtrip preserves the full 40-minute timeline; temporary media removed.')
