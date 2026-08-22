import importlib.metadata

try:
    __version__ = importlib.metadata.version("memb")
except importlib.metadata.PackageNotFoundError:
    __version__ = "1.0.0"

try:
    from memb.client.main import AsyncMemoryClient, MemoryClient  # noqa
except ImportError:
    pass
from memb.memory.main import AsyncMemory, Memory  # noqa
