# Annotation agent protocol (WP7)

`lib/annotation/protocol.mjs` — node:http handler, no framework.

## Routes (`/aos-api`, negative allowlist)

- `GET /aos-api/collect?pageId=` — redacted `collectPayload` + ETag;
  `If-None-Match` match returns 304. Includes `await: 'passthrough'`.
- `POST /aos-api/reply` (JSON) — `appendReply`; same `idempotencyKey`
  twice stores exactly one reply line (second returns `duplicate: true`).
- Anything else returns 404. No side-effect or execution endpoints.

## Guards

- Guard token check per `ref/guard.mjs`: exact Host/Origin binding,
  Sec-Fetch-Site same-origin, query-token refused, constant-time
  cookie compare. Same-origin only; no CORS headers emitted.
- Rate limit 60 req/min per IP (429 `E_RATE`); body cap 32 KB (413).
- `copyForAi(threads)` — Markdown exporter, redacted, labelled
  `text_source: app-page (unverified)`; data only, never executes.
- Logs emit method + pathname only (query strings omitted).
