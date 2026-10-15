"""Bounded-memory WAV processing with sample-exact overlap/add output."""
import math


def reference_stats(source):
    """Statistics of the mono reference, without loading the complete recording."""
    import numpy as np
    count = 0
    total = square = 0.0
    source.seek(0)
    for block in source.blocks(blocksize=65536, dtype='float32', always_2d=True):
        mono = block.mean(axis=1, dtype=np.float64)
        count += len(mono)
        total += float(mono.sum())
        square += float(np.dot(mono, mono))
    if not count:
        raise ValueError('Ses dosyası boş.')
    mean = total / count
    variance = max(0.0, (square - total * mean) / max(1, count - 1))
    if not math.isfinite(mean) or not math.isfinite(variance):
        raise ValueError('Ses geçersiz örnekler içeriyor.')
    source.seek(0)
    return mean, math.sqrt(variance)


def process_wav(input_path, output_path, prepare, on_progress=None, block_seconds=30, overlap_seconds=2):
    """prepare(sr, channels, mean, std) -> block transform (frames x channels).

    Only one block and its short pending overlap survive each iteration. The
    overlap consumes no extra output samples, so duration never accumulates drift.
    """
    import numpy as np
    import soundfile as sf
    if block_seconds <= 2 * overlap_seconds or overlap_seconds <= 0:
        raise ValueError('Geçersiz ses blok boyutu.')
    with sf.SoundFile(str(input_path)) as source:
        sr, channels, total = source.samplerate, source.channels, len(source)
        mean, std = reference_stats(source)
        transform = prepare(sr, channels, mean, std)
        block_size, overlap = round(block_seconds * sr), round(overlap_seconds * sr)
        stride = block_size - overlap
        pending = None
        written = 0
        with sf.SoundFile(str(output_path), 'w', samplerate=sr, channels=channels, subtype='PCM_16') as output:
            for offset in range(0, max(1, total-overlap), stride):
                source.seek(offset)
                block = source.read(block_size, dtype='float32', always_2d=True)
                result = np.asarray(transform(block), dtype=np.float32)
                if result.shape != block.shape or not np.isfinite(result).all():
                    raise ValueError('Ayrılan sesin biçimi veya örnek sayısı geçersiz.')
                result = result.copy()
                if pending is not None:
                    n = len(pending)
                    if len(result) < n:
                        raise ValueError('Ses birleştirme uzunluğu uyuşmuyor.')
                    # Complementary cosine weights preserve constant signals and
                    # the exact sample positions, without a gain bump at seams.
                    weight = ((1-np.cos(np.linspace(0, np.pi, n)))*.5).astype(np.float32)[:, None]
                    result[:n] = pending*(1-weight) + result[:n]*weight
                final = offset + len(block) >= total
                emit = len(result) if final else len(result)-overlap
                output.write(result[:emit])
                written += emit
                pending = None if final else result[emit:].copy()
                if on_progress:
                    on_progress(written, total, sr)
                if final:
                    break
            if written != total:
                raise ValueError('Vokal süresi kaynakla uyuşmuyor.')
    if sf.info(str(output_path)).frames != total:
        raise ValueError('Yazılan vokal süresi doğrulanamadı.')
    return total, sr
