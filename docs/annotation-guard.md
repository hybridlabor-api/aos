# Annotation guard (WP2)

`lib/annotation/guard.mjs` — guard-shaped request gate for the annotation
server (spec S6/S7). Follows `lib/hub/guard.mjs` and imports its token helpers
(`newToken`, `tokenOk`, `shaToken`, `hostOk`) instead of copying them.

## Model
- Per-process token: 32 crypto-random bytes, hex; sha256-hashed compare; never logged.
- Exact binding: Host must be exactly `127.0.0.1:PORT` or `localhost:PORT` (server's own port; no wildcard/suffix — DNS-rebinding Hosts fail); Origin, when present, must be exactly the same loopback scheme/host:port AND agree with the Host header (no 127-vs-localhost mismatch).
- Cookie: `aos_ann=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`; no `Domain`, no `Secure` (plain-http loopback). `Path=/` because the proxy origin serves both the app and the annotation overlay — the cookie must reach every proxied path.
- `Sec-Fetch-Site`: reads allow `same-origin`/`none`/absent; writes require `same-origin`/absent. A missing Origin is filled from Host by the proxy.
- Writes: POST only with `application/json`; body cap `MAX_BODY` (32 KB, declared + streamed).
- `checkRequest(req, { port, tokenSha })` throws typed `GuardError`: `E_HOST`, `E_ORIGIN`, `E_FETCH_SITE`, `E_QUERY_TOKEN` (token in the query refused on `/__aos_annot` and `/aos-api`, exact path and everything below it, after case and percent-encoding normalization; allowed elsewhere so Vite HMR (`?t=`, `/?token=`) works), `E_TOKEN`, `E_METHOD`, `E_BODY`. Missing Origin is refused (annotation API is same-origin browser traffic; agents use the S4 file/API path).

## Tests
`tests/annotation-guard.test.mjs` (node:test, run via npm test / Docker): real loopback fixture server (127.0.0.1:48161) covers every reject path (wrong/rebinding Host, wrong/missing/mismatched Origin, bad/missing cookie, query token, oversized body, wrong content type, non-GET/POST, cross-site/same-site metadata) plus gold-path GET/POST and unit tests of the pure helpers (Readable-based readBody caps, no fake-req hang).

Not covered here: proxy SSRF allowlist (WP3), callers of `checkRequest` (WP7).
