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


def process_wav(input_path, output, prepare, on_progress=None, block_seconds=30, overlap_seconds=2, first_block_seconds=None):
    """prepare(sr, channels, mean, std) -> block transform (frames x channels).

    output is a WAV path or a sink with write(frames x channels float32); a sink
    receives each finished part at once, so playback can start before the end.
    Only one block and its short pending overlap survive each iteration. The
    overlap consumes no extra output samples, so duration never accumulates drift.
    A shorter first block gives the listener audio sooner.
    """
    import numpy as np
    import soundfile as sf
    first_block_seconds = first_block_seconds or block_seconds
    if min(block_seconds, first_block_seconds) <= 2 * overlap_seconds or overlap_seconds <= 0:
        raise ValueError('Geçersiz ses blok boyutu.')
    with sf.SoundFile(str(input_path)) as source:
        sr, channels, total = source.samplerate, source.channels, len(source)
        mean, std = reference_stats(source)
        transform = prepare(sr, channels, mean, std)
        overlap = round(overlap_seconds * sr)
        sink = output if hasattr(output, 'write') else sf.SoundFile(str(output), 'w', samplerate=sr, channels=channels, subtype='PCM_16')
        pending = None
        written = 0
        offset = 0
        try:
            while True:
                size = round((first_block_seconds if offset == 0 else block_seconds) * sr)
                source.seek(offset)
                block = source.read(size, dtype='float32', always_2d=True)
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
                sink.write(result[:emit])
                written += emit
                pending = None if final else result[emit:].copy()
                if on_progress:
                    on_progress(written, total, sr)
                if final:
                    break
                offset += size - overlap
            if written != total:
                raise ValueError('Vokal süresi kaynakla uyuşmuyor.')
        finally:
            if sink is not output:
                sink.close()
    if not hasattr(output, 'write') and sf.info(str(output)).frames != total:
        raise ValueError('Yazılan vokal süresi doğrulanamadı.')
    return total, sr
