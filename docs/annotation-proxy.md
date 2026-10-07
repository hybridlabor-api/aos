# Annotation v2 — loopback reverse proxy (WP3)

`lib/annotation/proxy.mjs` serves the dev app through one loopback reverse
proxy so the annotation canvas and the app share an origin.

- Listens on `127.0.0.1` only (`port: 0` supported for tests). Every HTTP
  request and WebSocket upgrade passes the WP2 guard
  (`lib/annotation/guard.mjs` `checkRequest`: token cookie, exact Host/Origin).
  When a browser navigation omits `Origin`, it is pinned to the validated Host
  before the guard runs — same binding, one code path.
- Upstream: one fixed origin from `parseUpstream('<host>:<port>', allowPorts)`
  (loopback spellings only; default range 5173-5199, explicit port only via
  CLI). The request path never changes the upstream. Redirects to any other
  origin are blocked with typed JSON (`E_REDIRECT_OFF_ALLOWLIST`); upstream and
  proxy-origin redirects are rewritten to proxy-relative paths. `Set-Cookie`
  loses its `Domain` attribute.
- HTML responses (`text/html`, <= 8 MB by default): exactly one
  `<script src="/__aos_annot/overlay.js?v=0.1.0" nonce="...">` before
  `</body>`, `accept-encoding` stripped toward upstream, gzip/deflate/brotli
  decoded before injection, `content-length` fixed, `X-AOS-Annot: rewritten`.
  Oversize HTML passes through untouched with `X-AOS-Annot: skipped`.
- Proxy-owned routes (`/__aos_annot/*`) carry a strict CSP: nonce'd script-src,
  no inline/eval, `connect-src 'self'`, `frame-ancestors 'none'`. Upstream CSP
  and `X-Frame-Options` are stripped only on proxied app responses.
- WebSocket upgrades to `/_vite*`, `/ws*` (Vite HMR uses `/`) tunnel raw bytes
  to the same fixed upstream with a 120 s idle timeout.
- Caps: 8 MB HTML rewrite, 30 s upstream timeout, WS idle timeout,
  256 concurrent, 16 KB request headers (`E_HEADERS`). Errors are typed JSON
  (`{ error: '<CODE>' }`, e.g. `E_TOKEN`, `E_HOST`, `E_REDIRECT_OFF_ALLOWLIST`,
  `E_UPSTREAM`) with no internals. Placeholder overlay
  (`window.__AOS_ANNOT = {version}`) is WP4, not this task.
- Tests: `tests/annotation-proxy.test.mjs` (node:test, upstream + proxy on
  port 0, loopback only). Docs: this file.
