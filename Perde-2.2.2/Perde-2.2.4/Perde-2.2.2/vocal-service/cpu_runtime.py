"""A bounded CPU profile for the disposable separation worker."""
import os
import subprocess


def cpu_threads(logical_cpus=None):
    """Leave room for playback/browser work; avoid oversized inference pools."""
    logical_cpus = os.cpu_count() if logical_cpus is None else logical_cpus
    return max(1, min(4, (logical_cpus or 1) // 2))


def worker_environment(base=None):
    """Configure native libraries before the child imports NumPy or PyTorch."""
    env = dict(os.environ if base is None else base)
    count = str(cpu_threads())
    for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
        env[name] = count
    return env


def configure_torch(torch):
    # Must run before model construction/inference. Inter-op is process-global
    # and can only be set once; the already-configured case also permits smoke
    # tests or other callers to separate two files sequentially in one process.
    torch.set_num_threads(cpu_threads())
    if torch.get_num_interop_threads() != 1:
        torch.set_num_interop_threads(1)


def background_creation_flags():
    # Windows schedules interactive playback ahead of the expensive worker.
    # This is a scheduling preference, not a hard CPU/RAM quota.
    return (subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS) if os.name == 'nt' else 0
