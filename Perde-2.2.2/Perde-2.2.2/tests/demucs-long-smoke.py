"""Real 25-minute inference; synthetic audio only, no downloads or user media."""
from pathlib import Path
import ctypes
from ctypes import wintypes
import json
import os
import subprocess
import sys
import tempfile
import time
import numpy as np
import soundfile as sf
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[1]/'vocal-service'
sys.path.insert(0,str(ROOT))
os.environ['TORCH_HOME']=str(ROOT/'.models')
from worker import separate


def peak_mb():
    if os.name!='nt':return None
    class Memory(ctypes.Structure):
        _fields_=[('cb',wintypes.DWORD),('faults',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in ('peak','working','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile')]
    counters=Memory();counters.cb=ctypes.sizeof(counters)
    ctypes.windll.kernel32.GetCurrentProcess.restype=wintypes.HANDLE
    function=ctypes.windll.psapi.GetProcessMemoryInfo
    function.argtypes=[wintypes.HANDLE,ctypes.POINTER(Memory),wintypes.DWORD]
    if function(ctypes.windll.kernel32.GetCurrentProcess(),ctypes.byref(counters),counters.cb):return round(counters.peak/1e6,1)


with tempfile.TemporaryDirectory(prefix='perde-long-test-') as folder:
    folder=Path(folder);sr=44100;seconds=25*60
    sample=np.arange(sr,dtype=np.float32)/sr
    with sf.SoundFile(str(folder/'input.wav'),'w',samplerate=sr,channels=2,subtype='PCM_16') as output:
        for index in range(seconds):
            signal=(.12*np.sin(2*np.pi*(180+index%13)*sample)+.07*np.sin(2*np.pi*440*sample)).astype('float32')
            output.write(np.column_stack([signal,signal*.9]))
    started=time.monotonic();checkpoints=[]
    def progress(done,total,rate):
        item={'percent':round(done*100/total),'elapsed_seconds':round(time.monotonic()-started,1),'peak_memory_mb':peak_mb()}
        checkpoints.append(item);print(json.dumps(item),flush=True)
    separate(folder/'input.wav',folder/'vocals.wav','cpu',progress)
    info=sf.info(str(folder/'vocals.wav'))
    assert info.frames==sr*seconds and info.samplerate==sr and info.channels==2
    with sf.SoundFile(str(folder/'vocals.wav')) as output:
        for block in output.blocks(blocksize=65536):assert np.isfinite(block).all()
    flags={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ffmpeg,'-nostdin','-v','error','-y','-i',str(folder/'vocals.wav'),'-codec:a','libmp3lame','-b:a','192k',str(folder/'vocals.mp3')],check=True,timeout=120,**flags)
    # Gapless metadata must preserve the timeline after actual MP3 decoding too.
    subprocess.run([ffmpeg,'-nostdin','-v','error','-y','-i',str(folder/'vocals.mp3'),str(folder/'decoded.wav')],check=True,timeout=120,**flags)
    assert sf.info(str(folder/'decoded.wav')).frames==sr*seconds
    report={'seconds':seconds,'samples_per_channel':info.frames,'elapsed_seconds':round(time.monotonic()-started,1),'peak_memory_mb':peak_mb(),'mp3_bytes':(folder/'vocals.mp3').stat().st_size,'checkpoints':checkpoints,'scope':'Synthetic real Demucs inference, sample length, MP3 roundtrip; not perceptual quality.'}
    (Path(__file__).parent/'long-audio-result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('PASS: real 25-minute Demucs and sample-exact MP3 roundtrip; temporary audio removed.',flush=True)
