"""Optional network smoke test; no cookies, input/output removed afterward."""
from pathlib import Path
import os
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]/'vocal-service'
sys.path.insert(0,str(ROOT))
os.environ['TORCH_HOME']=str(ROOT/'.models')
from server import validate_request
from worker import run
video_id,minutes=validate_request({'videoId':sys.argv[1],'maxMinutes':3})
with tempfile.TemporaryDirectory(prefix='perde-pipeline-') as folder:
    started=time.monotonic()
    run(Path(folder),video_id,minutes,'cpu')
    result=Path(folder)/'vocals.mp3'
    assert result.is_file() and result.stat().st_size>0
    print(f'YouTube download -> Demucs -> MP3 passed in {time.monotonic()-started:.1f}s; temporary media removed on exit.')
