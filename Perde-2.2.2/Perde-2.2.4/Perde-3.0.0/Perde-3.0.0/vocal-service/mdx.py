"""UVR MDX-Net vocal model (ONNX) on the GPU through DirectML, or on the CPU.

The model sees stereo complex spectrograms [batch, 4, 3072, 256]; this module
does the STFT/ISTFT and the windowed overlap-add exactly like Ultimate Vocal
Remover, so results match the reference implementation.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import numpy as np

MODEL_NAME = 'UVR-MDX-NET-Voc_FT.onnx'
MODEL_URL = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/' + MODEL_NAME
MODEL_SHA256 = '534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111'
MODEL_BYTES = 66762490
# UVR model data for this file: compensate 1.021, dim_f 3072, dim_t 2**8, n_fft 7680.
N_FFT, HOP, DIM_F, DIM_T = 7680, 1024, 3072, 256
COMPENSATE = 1.021
SAMPLE_RATE, CHANNELS = 44100, 2
CHUNK = HOP * (DIM_T - 1)
TRIM = N_FFT // 2
N_BINS = N_FFT // 2 + 1
WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)  # periodic Hann


def model_path(models_root):
    return Path(models_root) / 'mdx' / MODEL_NAME


def verify(path):
    """True only for the exact published model file."""
    path = Path(path)
    try:
        if path.stat().st_size != MODEL_BYTES:
            return False
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest() == MODEL_SHA256
    except OSError:
        return False


def stft(x):
    """x: [channels, CHUNK] -> model input [1, channels*2, DIM_F, DIM_T] (torch.stft, center=True)."""
    pad = N_FFT // 2
    padded = np.pad(x.astype(np.float32), ((0, 0), (pad, pad)), mode='reflect')
    frames = 1 + (padded.shape[1] - N_FFT) // HOP
    index = HOP * np.arange(frames)[:, None] + np.arange(N_FFT)[None, :]
    spectrum = np.fft.rfft(padded[:, index] * WINDOW, axis=-1)[..., :DIM_F].transpose(0, 2, 1)
    out = np.empty((1, x.shape[0] * 2, DIM_F, frames), np.float32)
    out[0, 0::2], out[0, 1::2] = spectrum.real, spectrum.imag
    out[:, :, :3, :] = 0  # UVR removes the lowest bins before inference.
    return out


_ENVELOPE = None


def istft(prediction):
    """Model output [1, channels*2, DIM_F, frames] -> [channels, CHUNK] (torch.istft, center=True)."""
    global _ENVELOPE
    channels, frames = prediction.shape[1] // 2, prediction.shape[3]
    spectrum = np.zeros((channels, frames, N_BINS), np.complex64)
    spectrum[..., :DIM_F] = (prediction[0, 0::2] + 1j * prediction[0, 1::2]).transpose(0, 2, 1)
    segments = np.fft.irfft(spectrum, n=N_FFT, axis=-1) * WINDOW
    total = N_FFT + HOP * (frames - 1)
    out = np.zeros((channels, total), np.float32)
    for t in range(frames):
        out[:, t * HOP:t * HOP + N_FFT] += segments[:, t]
    if _ENVELOPE is None or _ENVELOPE.shape[0] != total:
        envelope = np.zeros(total, np.float32)
        for t in range(frames):
            envelope[t * HOP:t * HOP + N_FFT] += WINDOW ** 2
        _ENVELOPE = envelope
    out /= np.where(_ENVELOPE > 1e-11, _ENVELOPE, 1)
    return out[:, N_FFT // 2:N_FFT // 2 + HOP * (frames - 1)]


def create_session(path, threads, prefer_gpu=True):
    """DirectML first (any DirectX 12 GPU on Windows); the CPU if it is unavailable."""
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    if prefer_gpu and 'DmlExecutionProvider' in ort.get_available_providers():
        try:
            gpu = ort.SessionOptions()
            gpu.graph_optimization_level = options.graph_optimization_level
            gpu.execution_mode = options.execution_mode
            gpu.enable_mem_pattern = False  # Required by DirectML.
            gpu.log_severity_level = 3
            session = ort.InferenceSession(str(path), gpu, providers=['DmlExecutionProvider', 'CPUExecutionProvider'])
            session.run(None, {'input': np.zeros((1, 4, DIM_F, DIM_T), np.float32)})
            return session, 'gpu'
        except Exception:
            pass  # Old drivers or a missing DirectX 12 device: use the processor.
    return ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider']), 'cpu'


class MDXVocals:
    def __init__(self, path, threads, overlap=.25, prefer_gpu=True):
        self.path, self.threads, self.overlap = path, threads, overlap
        self.session, self.device = create_session(path, threads, prefer_gpu)

    def run(self, spectrum):
        try:
            return self.session.run(None, {'input': spectrum})[0]
        except Exception:
            if self.device != 'gpu':
                raise
            # A GPU driver reset must not end the job: continue on the processor.
            self.session, self.device = create_session(self.path, self.threads, prefer_gpu=False)
            return self.session.run(None, {'input': spectrum})[0]

    def vocals(self, mix):
        """mix: float32 [frames, channels] -> vocals with the same shape."""
        if mix.ndim != 2 or mix.shape[1] != CHANNELS:
            raise ValueError('Ses biçimi modelle uyuşmuyor.')
        wave = mix.T.astype(np.float32)
        length = wave.shape[1]
        generated = CHUNK - 2 * TRIM
        pad = generated + TRIM - length % generated
        mixture = np.concatenate((np.zeros((CHANNELS, TRIM), np.float32), wave, np.zeros((CHANNELS, pad), np.float32)), 1)
        step = int((1 - self.overlap) * CHUNK)
        result = np.zeros((CHANNELS, mixture.shape[1]), np.float64)
        divider = np.zeros(mixture.shape[1], np.float64)
        starts = list(range(0, mixture.shape[1], step))

        def spectrum(start):
            part = mixture[:, start:start + CHUNK]
            if part.shape[1] < CHUNK:
                part = np.concatenate((part, np.zeros((CHANNELS, CHUNK - part.shape[1]), np.float32)), 1)
            return stft(part)
        # The model runs on the GPU while this thread prepares the next chunk and
        # reconstructs the previous one, so neither side waits for the other.
        with ThreadPoolExecutor(1) as pool:
            pending = pool.submit(self.run, spectrum(starts[0]))
            for index, start in enumerate(starts):
                upcoming = spectrum(starts[index + 1]) if index + 1 < len(starts) else None
                prediction = pending.result()
                if upcoming is not None:
                    pending = pool.submit(self.run, upcoming)
                end = min(start + CHUNK, mixture.shape[1])
                window = np.hanning(end - start) if self.overlap else np.ones(end - start)
                result[:, start:end] += istft(prediction)[:, :end - start] * window
                divider[start:end] += window
        result /= np.where(divider > 1e-8, divider, 1)
        return (result[:, TRIM:TRIM + length] * COMPENSATE).T.astype(np.float32)

    def prepare(self, sr, channels, mean, std):
        """Block transform for audio_stream.process_wav; MDX needs no normalization."""
        if sr != SAMPLE_RATE or channels != CHANNELS:
            raise ValueError('Ses biçimi modelle uyuşmuyor.')
        return self.vocals
