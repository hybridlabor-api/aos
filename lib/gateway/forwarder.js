'use strict';
// Front door of the gateway: static token, loopback Host only, no browser Origin. Everything else is
// piped to 1mcp on loopback. The token stops browsers (DNS rebinding, CSRF), not local processes.
const http = require('http');
const { createHash, timingSafeEqual } = require('crypto');

const sha = (s) => createHash('sha256').update(String(s)).digest();

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'];
// transfer-encoding is dropped too: Node re-frames piped bodies itself (chunked when no content-length).
function stripHop(h) {
    const out = { ...h };
    String(h.connection || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((n) => delete out[n]);
    HOP.forEach((n) => delete out[n]);
    return out;
}

function createForwarder({ port, upstreamPort, token, host = '127.0.0.1' }) {
    if (!token) throw new Error('token required');
    const want = sha(token);
    const agent = new http.Agent({ keepAlive: false });
    let boundPort = null;
    // Hashing first makes the comparison constant-time regardless of the supplied length.
    const tokenOk = (req) => {
        const raw = req.headers['x-aos-token'] ?? String(req.headers.authorization || '').replace(/^Bearer /i, '');
        return timingSafeEqual(sha(raw), want);
    };

    const server = http.createServer((req, res) => {
        if (req.url === '/healthcheck') {
            res.writeHead(200, { 'content-type': 'application/json', 'x-aos-gateway': '1' });
            return res.end('{"status":"ok"}');
        }
        if (![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
        if (req.headers.origin !== undefined) { res.writeHead(403); return res.end('forbidden'); }
        if (!tokenOk(req)) { res.writeHead(401); return res.end('unauthorized'); }

        const headers = stripHop(req.headers);
        headers.host = `127.0.0.1:${upstreamPort}`;
        delete headers['x-aos-token'];
        delete headers.authorization;
        const bad = () => {
            if (res.headersSent) return res.destroy();
            res.writeHead(502, { 'content-type': 'text/plain' });
            res.end('bad gateway');
        };
        let up;
        try {
            up = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers, agent }, (ur) => {
                res.writeHead(ur.statusCode || 502, stripHop(ur.headers));
                ur.on('error', () => res.destroy());
                ur.pipe(res);
            });
        } catch { return bad(); }
        up.on('error', bad);
        res.on('close', () => up.destroy());
        req.on('error', () => up.destroy());
        req.pipe(up);
    });

    return {
        server,
        listen: () => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => { boundPort = server.address().port; server.removeListener('error', reject); resolve(); });
        }),
        close: () => new Promise((resolve) => {
            if (!server.listening) return resolve();
            server.close(() => resolve());
            server.closeAllConnections();
        }),
    };
}

module.exports = { createForwarder };
