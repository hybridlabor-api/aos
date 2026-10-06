# /// script
# dependencies = [
#   "mcp>=1.0.0,<2.0.0",
# ]
# ///

import socket
import argparse
from typing import Optional
from mcp.server.fastmcp import FastMCP

from grandma3_cmds import (
    cmd_clear,
    cmd_executor_back,
    cmd_executor_go,
    cmd_executor_off,
    cmd_executor_pause,
    cmd_goto_cue,
    cmd_label,
    cmd_macro,
    cmd_patch_fixture,
    cmd_select,
    cmd_store_cue,
)

mcp = FastMCP("BDB grandMA3 MCP")

parser = argparse.ArgumentParser()
parser.add_argument("--ip", default="127.0.0.1", help="Target IP")
parser.add_argument("--port", default="8080", help="WebAPI Port")
parser.add_argument("--mode", default="webapi_only", help="Operation Mode")
args, _ = parser.parse_known_args()

OSC_IP = args.ip
OSC_PORT = 8001  # Use 8001 for grandMA3 callbacks to avoid conflict with TouchDesigner/Resolume (8000)

def send_osc_message(address: str, argument: Optional[str] = None) -> str:
    """Send a simple OSC string message."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        
        # Build basic OSC message
        addr_bytes = address.encode('utf-8') + b'\x00'
        while len(addr_bytes) % 4 != 0:
            addr_bytes += b'\x00'
            
        if argument is not None:
            tags = b',s\x00\x00'
            arg_bytes = argument.encode('utf-8') + b'\x00'
            while len(arg_bytes) % 4 != 0:
                arg_bytes += b'\x00'
            msg = addr_bytes + tags + arg_bytes
        else:
            tags = b',\x00\x00\x00'
            msg = addr_bytes + tags
            
        sock.sendto(msg, (OSC_IP, OSC_PORT))
        return f"Successfully sent OSC message {address} {argument or ''}"
    except Exception as e:
        return f"Failed to send OSC message: {e}"

@mcp.tool()
def grandma3_ping() -> str:
    """Check if grandMA3 MCP is ready."""
    return "grandMA3 MCP is active. Sending commands via OSC."

@mcp.tool()
def execute_command(command: str) -> str:
    """UNVALIDATED raw console command: it can run anything on the console and bypasses every check of the ma3_* tools. Prefer the ma3_* tools. Needs grandMA3 listening for OSC /cmd."""
    return send_osc_message("/cmd", command)

@mcp.tool()
def execute_macro(macro_number: int) -> str:
    """Execute a specific macro in grandMA3."""
    return send_osc_message("/cmd", cmd_macro(macro_number))

@mcp.tool()
def patch_fixture(fixture_id: int, name: str, fixture_type: str, address: str) -> str:
    """Label and patch fixture <fixture_id> at <universe>.<address> (e.g. 1.101). fixture_type is not settable from the command line and is ignored."""
    patch_cmd = cmd_patch_fixture(fixture_id, address)
    label_cmd = cmd_label("Fixture", fixture_id, name)
    return f"{send_osc_message('/cmd', patch_cmd)}\n{send_osc_message('/cmd', label_cmd)}"

@mcp.tool()
def ma3_select(kind: str, number: int) -> str:
    """Select a Page/Sequence/Executor/World by number."""
    return send_osc_message("/cmd", cmd_select(kind, number))

@mcp.tool()
def ma3_executor_go(executor: int) -> str:
    """Fire the next cue on an executor (Go+)."""
    return send_osc_message("/cmd", cmd_executor_go(executor))

@mcp.tool()
def ma3_executor_back(executor: int) -> str:
    """Fire the previous cue on an executor (Go-)."""
    return send_osc_message("/cmd", cmd_executor_back(executor))

@mcp.tool()
def ma3_executor_pause(executor: int) -> str:
    """Toggle pause on an executor."""
    return send_osc_message("/cmd", cmd_executor_pause(executor))

@mcp.tool()
def ma3_executor_off(executor: int) -> str:
    """Stop (Off) an executor."""
    return send_osc_message("/cmd", cmd_executor_off(executor))

@mcp.tool()
def ma3_goto_cue(cue: int, executor: int = None) -> str:
    """Goto a cue number, optionally on an executor."""
    return send_osc_message("/cmd", cmd_goto_cue(cue, executor))

@mcp.tool()
def ma3_store_cue(cue: int, sequence: int = None, executor: int = None) -> str:
    """Store a cue, optionally into a sequence or executor's sequence."""
    return send_osc_message("/cmd", cmd_store_cue(cue, sequence, executor))

@mcp.tool()
def ma3_set_label(kind: str, number: int, name: str) -> str:
    """Label an object (e.g. Sequence/Cue/Executor) with a new name."""
    return send_osc_message("/cmd", cmd_label(kind, number, name))

@mcp.tool()
def ma3_clear() -> str:
    """Clear the programmer (successively selection/values/all)."""
    return send_osc_message("/cmd", cmd_clear())

if __name__ == "__main__":
    mcp.run()
