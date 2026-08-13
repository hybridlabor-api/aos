"""
mcp_server/server.py
=====================
FastMCP entry point for GOLEM-3DMCP.

This module creates the single shared ``mcp`` instance and registers all tool
modules when ``main()`` is called.  Tool modules are imported inside ``main``
(not at module scope) to avoid circular imports: tool modules reference the
``mcp`` instance via ``from mcp_server.server import mcp``, so they must not
be imported until after ``mcp`` is constructed.

Running the server
------------------
Via the module entry point (preferred, matches ``.mcp.json`` convention)::

    python -m mcp_server.server

Via the package shorthand::

    python -m mcp_server

Both forms call :func:`main` which registers all tools and starts the MCP
stdio transport.
"""

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Shared FastMCP instance
# ---------------------------------------------------------------------------
# Tool modules import this object and call ``@mcp.tool()`` on their handlers.
# It must be constructed at import time so that decorator-based registration
# works correctly.

mcp = FastMCP(
    "GOLEM-3DMCP",
    instructions=(
        "Full-access MCP server for Rhinoceros 3D — geometry creation, "
        "boolean operations, NURBS surfaces, SubD, Grasshopper scripting, "
        "viewport capture, file I/O, and arbitrary Python/RhinoScript execution."
    ),
)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Import all tool modules (triggering ``@mcp.tool()`` registration) and
    start the MCP server over stdio.

    The deferred import pattern here prevents the following circular
    dependency chain:

        server.py  →  tools/scene.py  →  (imports mcp from server.py)
                                         ↑ OK only after mcp is defined
    """
    # Each sub-module registers its tools via ``@mcp.tool()`` decorators at
    # import time.  Importing here ensures that:
    # 1. ``mcp`` is already defined (no circular import).
    # 2. Tools are only registered when the server actually starts, not when
    #    any other code imports ``mcp_server.server`` to grab the ``mcp``
    #    object.
    from mcp_server.tools import (  # noqa: F401  (imported for side effects)
        scene,
        creation,
        operations,
        surfaces,
        manipulation,
        grasshopper,
        viewport,
        files,
        scripting,
    )

    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
