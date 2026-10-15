from pathlib import Path
import os
import sys
import tempfile
import time
import numpy as np
import soundfile as sf
ROOT=Path(__file__).resolve().parents[1]/'vocal-service'
sys.path.insert(0,str(ROOT))
os.environ['TORCH_HOME']=str(ROOT/'.models')
from worker import separate
with tempfile.TemporaryDirectory(prefix='perde-smoke-') as folder:
    folder=Path(folder)
    sr=44100
    samples=np.arange(sr*2,dtype=np.float32)/sr
    signal=(.15*np.sin(2*np.pi*440*samples)+.08*np.sin(2*np.pi*180*samples)).astype(np.float32)
    sf.write(folder/'input.wav',np.stack([signal,signal],axis=1),sr)
    started=time.monotonic()
    separate(folder/'input.wav',folder/'output.wav','cpu')
    output,rate=sf.read(folder/'output.wav')
    assert rate==sr and output.shape==(sr*2,2) and np.isfinite(output).all()
    print(f'Demucs real inference passed: {len(output)} samples, {rate} Hz, {time.monotonic()-started:.1f} seconds. Synthetic audio; not a perceptual quality test.')
