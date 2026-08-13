# /// script
# dependencies = [
#   "mcp>=1.0.0,<2.0.0",
# ]
# ///

import socket
import argparse
from typing import Optional
from mcp.server.fastmcp import FastMCP

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
    """Execute an arbitrary grandMA3 command via OSC. Requires grandMA3 to be listening for OSC /cmd on port 8000."""
    return send_osc_message("/cmd", command)

@mcp.tool()
def execute_macro(macro_number: int) -> str:
    """Execute a specific macro in grandMA3."""
    return send_osc_message("/cmd", f"Go Macro {macro_number}")

@mcp.tool()
def patch_fixture(fixture_id: int, name: str, fixture_type: str, address: str) -> str:
    """Patch a fixture via grandMA3 command line."""
    cmd = f'Assign Fixture {fixture_id} Name "{name}" /Type="{fixture_type}" /Patch="{address}"'
    return send_osc_message("/cmd", cmd)

if __name__ == "__main__":
    mcp.run()
