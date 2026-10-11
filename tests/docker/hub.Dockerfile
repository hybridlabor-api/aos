# Docker harness for the AOS Hub tests (WP5).
# Note on pinning: the base image is the plain node:20-slim tag. A digest pin
# would break on every library rebuild; the installed packages are checked by
# `npm ci --ignore-scripts` against the committed package-lock.json.
FROM node:20-slim

# procps provides `ps` (used and deliberately excluded in the fail-closed check
# below); curl is used for the §4 negative probes. Nothing else is needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root: the hub writes ~/.aos/hub/hub.json (dir 0700, file 0600), so it
# must not run as root.
RUN useradd --create-home --shell /bin/bash aos
USER aos
WORKDIR /home/aos/repo
ENV HOME=/home/aos

# Copy of the repo — build context is the repository root.
COPY --chown=aos:aos . /home/aos/repo

# No install scripts, network only for the registry metadata in the lock file.
RUN npm ci --ignore-scripts

# The hub test files (same six files the npm test script registers).
RUN node --test \
    tests/hub-guard.test.mjs \
    tests/hub-server.test.mjs \
    tests/hub-services.test.mjs \
    tests/hub-catalog.test.mjs \
    tests/hub-store.test.mjs \
    tests/hub-wiring.test.mjs

# Security negatives against a live hub (section 4 of the plan):
#  1) GET /api/health with the correct Host -> 200
#  2) GET /api/health with a foreign Host: header -> 403 (exact-Host rule)
#  3) POST with a bad Origin -> 403 (same-site rule)
# The hub runs in the background of this one step; it is on demand and does not
# need to survive the step. A fresh random token is generated per run.
RUN set -e; \
    TOKEN=$(node -p 'require("node:crypto").randomBytes(32).toString("hex")'); \
    export AOS_HUB_TOKEN="$TOKEN"; \
    AOS_HUB_SERVE=1 node bin/aos-hub.mjs --serve --port 7900 >/dev/null 2>&1 & \
    for i in $(seq 1 40); do \
        code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7900/api/health || true); \
        [ "$code" = "200" ] && break; \
        sleep 0.25; \
    done; \
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7900/api/health); \
    [ "$code" = "200" ] || { echo "expected 200 with correct Host, got $code"; exit 1; }; \
    code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: x.test' http://127.0.0.1:7900/api/health); \
    [ "$code" = "403" ] || { echo "expected 403 for foreign Host, got $code"; exit 1; }; \
    code=$(curl -s -o /dev/null -w '%{http_code}' \
        -X POST http://127.0.0.1:7900/api/shutdown \
        -H 'Host: 127.0.0.1:7900' \
        -H "Origin: http://evil.example" \
        -H 'Content-Type: application/json' \
        -d '{"confirm":"hub"}'); \
    [ "$code" = "403" ] || { echo "expected 403 for cross-site POST, got $code"; exit 1; }; \
    echo "$0: negative probes passed"; \
    node bin/aos-hub.mjs stop | grep -q "AOS Hub stopped"

# Fail-closed stop: with `ps` removed from PATH, `aos hub stop` must kill
# nothing and exit 1 (never fall back to a blind kill). hub.json is recreated
# with a stale pid; stop has no live hub to talk to, then cannot verify via ps.
RUN set -e; \
    mkdir -p "$HOME/.aos/hub"; \
    node -e 'const fs=require("fs");const h=process.env.HOME;fs.mkdirSync(h+"/.aos/hub",{recursive:true,mode:0o700});fs.writeFileSync(h+"/.aos/hub/hub.json",JSON.stringify({pid:999999,port:7900,version:"0.0.0",token:"a".repeat(64)}),{mode:0o600})'; \
    out=$(PATH="/usr/local/bin:/usr/sbin:/sbin" node bin/aos-hub.mjs stop 2>&1); \
    case "$out" in *"Could not verify"*) ;; *) echo "stop did not fail closed: $out"; exit 1;; esac
