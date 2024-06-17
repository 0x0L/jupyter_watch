import sys

import jupyter_client
from jupyter_client.blocking.client import BlockingKernelClient

kernel_id = sys.argv[1]
cf = jupyter_client.find_connection_file(kernel_id)
km = BlockingKernelClient(connection_file=cf)
km.load_connection_file()
km.start_channels()
km.wait_for_ready()

while True:
    stmt = input("> ")
    km.execute(stmt, store_history=False, allow_stdin=False)
