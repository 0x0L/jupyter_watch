import sys

from jupyter_client import BlockingKernelClient

client = BlockingKernelClient(connection_file=sys.argv[1])
client.load_connection_file()
client.start_channels()
try:
    client.wait_for_ready(timeout=10)
    request = client.execute(sys.argv[2])
    while True:
        reply = client.get_shell_msg(timeout=20)
        if reply["parent_header"].get("msg_id") == request:
            if reply["content"]["status"] == "error":
                raise RuntimeError(reply["content"])
            break
finally:
    client.stop_channels()
