#!/usr/bin/env node
// UserPromptSubmit hook: when the human types exactly `GO <session-name>` in a
// master session, record a single-use token that go-gate.mjs in <session-name>
// accepts. Writes nothing else and never blocks the prompt.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

function sessionName(transcriptPath) {
  let name = "";
  try {
    for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
      if (!line.includes('"agent-name"') && !line.includes('"custom-title"')) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === "agent-name" && e.agentName) name = e.agentName;
        else if (e.type === "custom-title" && e.customTitle && !name) name = e.customTitle;
      } catch { /* partial line */ }
    }
  } catch { /* unreadable transcript */ }
  return name || process.env.AOS_SESSION_NAME || "";
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const m = /^GO\s+(\S(?:.*\S)?)$/i.exec(String(input.prompt ?? "").trim());
  const target = m && slug(m[1]);
  if (target && input.transcript_path) {
    const dir = join(homedir(), ".aos", "go");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${target}.token`), JSON.stringify({
      target: m[1].trim(),
      issued_at: new Date().toISOString(),
      master_transcript: input.transcript_path,
      master_session: sessionName(input.transcript_path),
    }));
  }
} catch { /* a failing hook must never block the prompt */ }
process.exit(0);
