'use strict';
// WebSocket port resolution for adobe_uxp_mcp. Dependency-free so tests can require it directly.
// - unset / invalid  -> 8080 (the historical default)
// - 'auto'           -> one free port per session via listen(0) on 127.0.0.1
// - integer 1024..65535 (decimal string or number) -> used as-is
const net = require('net');

const DEFAULT_WS_PORT = 8080;

function resolveWsPort(envValue, cb) {
    if (envValue === 'auto') {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => cb(port));
        });
        srv.on('error', () => cb(DEFAULT_WS_PORT));
        return;
    }
    const n = Number(envValue);
    if (Number.isInteger(n) && n >= 1024 && n <= 65535) { cb(n); return; }
    cb(DEFAULT_WS_PORT);
}

module.exports = { resolveWsPort, DEFAULT_WS_PORT };
