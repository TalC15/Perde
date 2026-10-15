"""Package source and bundled vision models, excluding all local user/runtime data."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'eklenti/manifest.json').read_text(encoding='utf-8'))['version']
EXCLUDED={'.venv','.models','.runtime','.saved-vocals','__pycache__','.browser-profile','.git','node_modules'}
FILES=[]


def visit(folder):
    for path in sorted(folder.iterdir()):
        if path.is_symlink():continue
        if path.is_dir():
            if path.name not in EXCLUDED and not path.name.startswith('.integration-'):
                visit(path)
        elif path.name not in ('SHA256SUMS.json','integration-error.txt','popup.png') and path.suffix not in ('.pyc','.zip'):
            FILES.append(path)


visit(ROOT)
checksums={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in FILES}
checksum_file=ROOT/'SHA256SUMS.json'
checksum_file.write_text(json.dumps(checksums,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
destination=ROOT.parent/f'Perde-{VERSION}.zip'
prefix=f'Perde-{VERSION}/'
with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in FILES+[checksum_file]:archive.write(path,prefix+path.relative_to(ROOT).as_posix())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    for name,digest in checksums.items():
        assert hashlib.sha256(archive.read(prefix+name)).hexdigest()==digest
    assert not any(part in EXCLUDED for name in archive.namelist() for part in Path(name).parts)
print(f'{destination.name}: {destination.stat().st_size} bytes; {len(checksums)} checked files. No local runtimes, tokens, or media caches included.')
