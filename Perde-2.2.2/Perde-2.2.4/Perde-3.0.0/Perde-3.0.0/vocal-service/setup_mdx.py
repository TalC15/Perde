"""Download the MDX-Net vocal model once; only the published file is accepted."""
from pathlib import Path
import sys
import time
import urllib.request
import mdx


def ensure(models_root):
    path = mdx.model_path(models_root)
    if mdx.verify(path):
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix('.part')
    print('Hızlı vokal modeli indiriliyor (67 MB, bir kez)...', flush=True)
    try:
        with urllib.request.urlopen(mdx.MODEL_URL, timeout=60) as response, pending.open('wb') as output:
            received, shown = 0, 0
            while chunk := response.read(1 << 20):
                received += len(chunk)
                if received > mdx.MODEL_BYTES:
                    raise ValueError('Model dosyası beklenenden büyük.')
                output.write(chunk)
                if time.monotonic() - shown > 2:
                    shown = time.monotonic()
                    print(f'  %{100 * received // mdx.MODEL_BYTES}', flush=True)
        if not mdx.verify(pending):
            raise ValueError('Model dosyası doğrulanamadı.')
        pending.replace(path)
        return True
    finally:
        pending.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        ensure(Path(sys.argv[1]))
    except Exception as error:
        print('Hızlı vokal modeli indirilemedi:', error)
        sys.exit(1)
