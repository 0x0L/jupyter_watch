import signal
import sys
import time

from jupyter_client import KernelManager

manager = KernelManager(connection_file=sys.argv[1])
manager.start_kernel()
client = manager.client()
client.start_channels()
client.wait_for_ready(timeout=20)
print("ready", flush=True)


def stop(*_):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    client.stop_channels()
    manager.shutdown_kernel(now=True)
