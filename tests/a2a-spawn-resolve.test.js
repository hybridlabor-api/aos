import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Bare A2A/express imports only resolve from a checkout; the installed ~/.agents/lib copies need a2aImport.
test("no lib/*.mjs bare-imports @a2a-js or express except the resolver itself", () => {
  const lib = join(fileURLToPath(new URL(".", import.meta.url)), "..", "lib");
  const bare = /(?:import\(\s*|from\s+)["'](?:@a2a-js|express)/;
  const offenders = readdirSync(lib)
    .filter((f) => f.endsWith(".mjs") && f !== "a2a-sdk-resolve.mjs")
    .filter((f) => bare.test(readFileSync(join(lib, f), "utf8")));
  assert.deepEqual(offenders, []);
});
