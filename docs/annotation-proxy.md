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
  CLI). The upstream host may be `127.0.0.1`, `localhost` or `[::1]` plus
  port. The request path never changes the upstream. Redirects to any other
  origin are blocked with typed JSON (`E_REDIRECT_OFF_ALLOWLIST`); proxy-origin
  redirects are blocked too. `Set-Cookie` loses its `Domain` attribute.
- Cookie/token isolation: the guard's own `aos_ann` cookie is stripped from the
  forwarded `Cookie` header (HTTP and the hand-built upgrade request; the
  header is dropped when nothing remains) and from every upstream `Set-Cookie`
   line, so the app can never read, set or overwrite it. `Authorization` is
  dropped on requests only. `accept-encoding` is pinned to
  `identity` toward upstream, so upstreams send unencoded bodies.
- HTML responses (`text/html`, <= 8 MB by default): exactly one
  `<script src="/__aos_annot/overlay.js?v=0.1.0" nonce="...">` before
  `</body>`, gzip/deflate/brotli decoded with a hard `maxOutputLength` cap
  (`maxHtmlBytes`) before injection — a compressed bomb fails closed —
  `content-length` fixed, `X-AOS-Annot: rewritten`. If the decode fails or the
  decoded size exceeds the cap, the buffered raw bytes are passed through
  unchanged with the original headers and `X-AOS-Annot: skipped`; the response
  always ends, the upstream stream is never re-piped and nothing leaks
  (`res.on('close')` destroys upstream request/response). Oversize HTML passes
  through untouched with `X-AOS-Annot: skipped`.
- Concurrency: a slot is held until the response finishes or the client
  disconnects (`res` `finish`/`close`/upstream error), released exactly once.
- Proxy-owned routes (`/__aos_annot/*`) carry a strict CSP: nonce'd script-src,
  no inline/eval, `connect-src 'self'`, `frame-ancestors 'none'`. Upstream app
  CSP is never deleted; the overlay is added to every script-capable directive
  (`script-src`, `script-src-elem`):
  - Directive present with a nonce or hash, or without `'unsafe-inline'`: the
    per-response nonce is appended.
  - Only `script-src` missing but `default-src` present: `script-src` is created
    from a copy of `default-src` (`'none'` dropped), then the nonce is added.
  - Neither present: nothing is added (no CSP in, no CSP out).
  - Only `'unsafe-inline'` (no nonce or hash): **trade-off**: no nonce is added,
    because a nonce makes browsers ignore `'unsafe-inline'` and would break the
    app's own inline scripts. `'self'` is added instead so the same-origin
    overlay loads. The app keeps its existing policy, and `'self'` also allows
    every other same-origin script.
  `X-Frame-Options` is kept unless `embedOrigin` is set.
- Login and sessions: `/__aos/annotate/login?t=<token>` accepts a one-shot login
  token (10 min) only for `Sec-Fetch-Site` `none`, `same-origin` or absent; a
  cross-site page cannot spend it. A successful login sets `aos_ann` to a random
  session id. The server keeps only its SHA-256 with an 8 h expiry, so the
  process never sets the raw token as a cookie.
- Overlay key: the overlay posts through `/__aos_annot/api/<session>` with an
  annotation token minted for the proxy origin (`http://127.0.0.1:<port>`) with a
  30 min lifetime. It is scoped to the canvas session and cannot read the canvas.
- WebSocket upgrades to `/_vite*`, `/ws*` (Vite HMR uses `/`) tunnel raw bytes
  to the same fixed upstream with a 120 s idle timeout.
- Caps: 8 MB HTML rewrite, 30 s upstream timeout, WS idle timeout,
  256 concurrent, 16 KB request headers (`E_HEADERS`). Errors are typed JSON
  (`{ error: '<CODE>' }`, e.g. `E_TOKEN`, `E_HOST`, `E_REDIRECT_OFF_ALLOWLIST`,
  `E_UPSTREAM`) with no internals. Chunked bodies on GET/HEAD/DELETE/OPTIONS
  are refused with 400 `E_CHUNKED_BODY`. Placeholder overlay
  (`window.__AOS_ANNOT = {version}`) is WP4, not this task.
- Tests: `tests/annotation-proxy.test.mjs` (node:test, upstream + proxy on
  port 0, loopback only). Docs: this file.
- Known limits: (a) the aos_ann cookie is not port-scoped, so the browser also
  sends it to other localhost ports including the dev app; the claim "never
  reaches upstream" holds for the proxy's forwarded requests only; (b) HTML
  buffering can hold up to 8 MB raw + 8 MB decoded per concurrent HTML response.

## Decision: loopback proxy, not iframe

Recorded for Annotation v2 (open decision 1 of the recovery plan, AOS 5.1 line).

- Chosen: same-origin loopback reverse proxy (this file). The overlay shares
  the app's origin, so DOM geometry for connector lines and element picking
  is synchronous, no postMessage bridge is needed, and the app's cookies stay
  first-party.
- Rejected for v1: iframe of the dev URL with a cross-origin overlay. Reasons:
  the overlay cannot be injected into a cross-origin child, node positions
  cannot be read synchronously, and many dev apps block framing via
  `frame-ancestors` or `X-Frame-Options`.
- Iframe stays a documented non-goal, reconsidered only if an app cannot be
  proxied (for example binary or preview harnesses).
- Status: wired. `aos-plan-canvas annotate <app-url> --proxy [--proxy-port <n>]`
  runs the proxy in the foreground on `127.0.0.1`, prints the one-time login
  URL (`http://127.0.0.1:<port>/__aos/annotate/login?t=<token>`) and stops on
  Ctrl+C. Without `--proxy` the CLI keeps the scriptTag path.
