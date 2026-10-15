"""Opt-in local vocal library; only complete, verified outputs are reusable."""
import hashlib
import json
import math
from pathlib import Path
import re
import shutil

VERSION = 'htdemucs-tr-v1'
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')


class VocalCache:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def paths(self, video_id):
        if not VIDEO_ID.fullmatch(video_id):
            raise ValueError('Geçersiz video kimliği.')
        return self.root / (video_id + '.mp3'), self.root / (video_id + '.json')

    @staticmethod
    def digest(path):
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()

    def get(self, video_id, minutes):
        audio, manifest = self.paths(video_id)
        try:
            meta = json.loads(manifest.read_text(encoding='utf-8'))
            duration = meta.get('totalSeconds')
            if (meta.get('version') != VERSION or type(duration) not in (int, float)
                    or not math.isfinite(duration) or not 0 < duration <= minutes * 60
                    or not 0 < audio.stat().st_size <= 100_000_000
                    or audio.stat().st_size != meta.get('bytes')
                    or self.digest(audio) != meta.get('sha256')):
                return None
            return audio, {key: meta[key] for key in ('totalSeconds', 'audioLanguage', 'audioSelection') if key in meta}
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def save(self, video_id, source, metadata):
        duration = metadata.get('totalSeconds')
        if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
            raise ValueError('Vokal süresi doğrulanamadığı için kayıt yapılamadı.')
        self.root.mkdir(parents=True, exist_ok=True)
        audio, manifest = self.paths(video_id)
        pending = audio.with_suffix('.mp3.next')
        pending_meta = manifest.with_suffix('.json.next')
        try:
            shutil.copyfile(source, pending)
            size = pending.stat().st_size
            if not 0 < size <= 100_000_000:
                raise ValueError('Vokal dosyası kayıt sınırını aşıyor.')
            meta = {key: metadata[key] for key in ('totalSeconds', 'audioLanguage', 'audioSelection') if key in metadata}
            meta.update(version=VERSION, bytes=size, sha256=self.digest(pending))
            pending_meta.write_text(json.dumps(meta), encoding='utf-8')
            pending.replace(audio)
            pending_meta.replace(manifest)  # Manifest is the commit marker.
        finally:
            pending.unlink(missing_ok=True)
            pending_meta.unlink(missing_ok=True)

    def clear(self):
        if self.root.exists():
            for path in self.root.iterdir():
                if re.fullmatch(r'[A-Za-z0-9_-]{11}\.(mp3|json)(\.next)?', path.name) and path.is_file() and not path.is_symlink():
                    path.unlink()
