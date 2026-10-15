"""Opt-in, short synthetic Demucs CPU benchmark; uses existing local weights only."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def peak_memory_mb():
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
            'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    process = ctypes.windll.kernel32.GetCurrentProcess
    process.restype = wintypes.HANDLE
    query = ctypes.windll.psapi.GetProcessMemoryInfo
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if query(process(), ctypes.byref(counters), counters.cb):
        return round(counters.PeakWorkingSetSize / 1024**2, 1)


def sample(threads, seconds, models):
    os.environ['TORCH_HOME'] = str(models)
    if threads:
        for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
            os.environ[name] = str(threads)
    import numpy as np
    import soundfile as sf
    import torch
    if threads:
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vocal-service'))
    # Match production's exact model, normalization, chunking and overlap. The
    # direct pipeline keeps the old default profile measurable after tuning it.
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from audio_stream import process_wav
    sr = 44100
    t = np.arange(sr * seconds, dtype=np.float32) / sr
    rng = np.random.default_rng(22)
    mono = (.1 * np.sin(2 * np.pi * 180 * t) + .07 * np.sin(2 * np.pi * 440 * t)
            + rng.normal(0, .015, len(t))).astype('float32')
    audio = np.column_stack([mono, mono * .97])
    with tempfile.TemporaryDirectory(prefix='.integration-cpu-', dir=Path(__file__).parent) as temporary:
        folder = Path(temporary)
        sf.write(folder / 'input.wav', audio, sr)
        started, cpu_started = time.monotonic(), time.process_time()
        model = get_model('htdemucs').eval()
        def prepare(sr, channels, mean, std):
            def transform(block):
                wav = torch.from_numpy(block.T.copy())
                with torch.inference_mode():
                    sources = apply_model(model, ((wav - mean) / std)[None], device='cpu',
                        shifts=0, split=True, overlap=.25, progress=False, num_workers=0)[0]
                    return (sources[model.sources.index('vocals')].cpu() * std + mean).numpy().T.copy()
            return transform
        process_wav(folder / 'input.wav', folder / 'output.wav', prepare)
        elapsed, cpu = time.monotonic() - started, time.process_time() - cpu_started
        output, rate = sf.read(folder / 'output.wav')
        assert rate == sr and output.shape == audio.shape and np.isfinite(output).all()
        print(json.dumps({'threads': torch.get_num_threads(), 'interop': torch.get_num_interop_threads(),
            'seconds': seconds, 'elapsedSeconds': round(elapsed, 3), 'cpuSeconds': round(cpu, 3),
            'peakWorkingSetMB': peak_memory_mb(), 'samples': len(output),
            'syntheticOnly': True}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--seconds', type=int, default=10, choices=range(1, 16))
    parser.add_argument('--child-threads', type=int, choices=(0, 4))
    parser.add_argument('--reverse', action='store_true', help='Run the tuned profile first to check order effects.')
    args = parser.parse_args()
    # This exact model is already pinned by Demucs 4.0.1. Never download as part
    # of a performance check, and never use the user's recordings as fixtures.
    if not (args.models / 'hub/checkpoints/955717e8-8726e21a.th').is_file():
        parser.error('Mevcut yerel htdemucs ağırlıkları bulunamadı; indirme yapılmadı.')
    if args.child_threads is not None:
        sample(args.child_threads, args.seconds, args.models.resolve())
        return
    for threads in ((4, 0) if args.reverse else (0, 4)):
        flags = subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS if os.name == 'nt' else 0
        result = subprocess.run([sys.executable, __file__, '--models', str(args.models.resolve()),
            '--seconds', str(args.seconds), '--child-threads', str(threads)],
            capture_output=True, text=True, timeout=180, creationflags=flags)
        if result.returncode:
            raise RuntimeError(result.stderr)
        print(result.stdout.strip(), flush=True)


if __name__ == '__main__':
    main()
