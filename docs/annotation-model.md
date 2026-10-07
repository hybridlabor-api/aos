# annotation-model.js (WP1, annotation v2 / AOS 5.1)

Data model + storage per spec S5 (`annotation/1`), redaction per S6, protocol
helpers per S4. Pure Node stdlib, CommonJS, no network.

## Storage
- `<stateDir>/annotations/<pageId>.jsonl`, one JSON event per line, append-only.
- Events: `annotation`, `reply`, `status` (resolve/reopen), `tombstone`.
- `schema_version: "annotation/1"` on every line; unknown kinds/fields tolerated.
- Per-file cap 5 MB; appends fail closed (never truncate or delete).
- `pageId` is a slug only; traversal-shaped keys are rejected (`normalizePageId`).

## Records
- Annotation: `a_<ULID>`, type pin/box/freehand/text/pick, pageId,
  scrollSnapshot, anchor {selector, fingerprint{text,class0,class1,tagName},
  coordinates}, markup {color, strokeWidth, points, text}, status open/resolved,
  authorKind human/agent, authorName (display only), createdAt/updatedAt.
- Reply: `r_<ULID>`, annotationId, body (2 KB cap), authorKind, authorName,
  idempotencyKey, createdAt. Replay with the same key writes nothing.
- Screenshot crops (pick only): cap 1280x800 px and 400 KB, fail closed with a
  warning flag on the note; identical crops dedupe to `dedupeOf: <sha256>`.

## Agent boundary
- `redactText`: bearer/api-key/token=, `sk-`, `ghp_`-family, AKIA, >=32-char hex,
  >=48-char base64, URLs with userinfo; input capped at 4 KB, all regexes
  bounded, so a 64 KB hostile line finishes in milliseconds.
- `collectPayload` returns threads with ETag (sha256 of JSONL bytes; changes
  only on append), `text_source: "app-page (unverified)"`, redacted text,
  crops stripped. `aiBlocks` renders "Copy for AI" Markdown.
- Annotation text is data, never a command; nothing here grants GO.

## Tests
`node --test tests/annotation-model.test.js` (in package.json test chain):
round-trip, corruption tolerance, forward-compat reads, idempotent reply,
crop caps/dedupe, 5 MB cap, redaction incl. 64 KB hostile line under 500 ms,
ETag-on-append-only, path traversal, whitelist normalisation, freehand bounds.
