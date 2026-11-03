# Adobe UXP MCP

## Security
The WebSocket bridge is bound to `127.0.0.1` only.

To use the bridge, you must define a per-install token in your environment:
```bash
export AOS_UXP_TOKEN="your_secure_token_here"
```

You must also configure your UXP plugins (e.g. `plugins/photoshop/index.js` and `plugins/premiere/index.js`) to pass this token when connecting. Replace `YOUR_TOKEN_HERE` in those files with your chosen token.
