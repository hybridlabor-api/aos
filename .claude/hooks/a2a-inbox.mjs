#!/usr/bin/env node
// A2A inbox hook for Claude Code. `drain` = UserPromptSubmit, `stop` = Stop.
// Messages from other agents are injected as context only; they never count as a GO.
import { readFileSync } from "node:fs";

const mode = process.argv[2];

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const input = readInput();
  const session =
    process.env.AOS_A2A_NAME || `claude-${String(input.session_id || "").slice(0, 8)}`;
  const { pending, claim, formatInjection } = await import(
    new URL("../../lib/a2a-inbox.mjs", import.meta.url)
  );
  const waiting = pending(session);
  if (!waiting.length) return 0;

  if (mode === "drain") {
    const texts = [];
    for (const m of waiting) {
      const msg = claim(m.file);
      if (!msg) continue;
      texts.push(
        `${formatInjection(msg)}\nAnswer by running: aos-a2a reply ${msg.taskId} "<your answer>"`,
      );
    }
    if (texts.length) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: texts.join("\n\n"),
          },
        }) + "\n",
      );
    }
    return 0;
  }

  if (mode === "stop" && input.stop_hook_active !== true) {
    process.stderr.write(
      'Undelivered A2A message(s) waiting: answer them (aos-a2a reply <taskId> "<answer>").\n',
    );
    return 2;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  () => process.exit(0),
);
