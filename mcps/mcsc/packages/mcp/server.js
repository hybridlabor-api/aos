#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runInventory } from "../core/src/detect/inventory.js";
import { getCached, setCached } from "../core/src/detect/cache.js";
import { delegate as agyDelegate } from "../core/src/adapters/agy.js";
import { delegate as opencodeDelegate } from "../core/src/adapters/opencode.js";
import { delegate as codexDelegate } from "../core/src/adapters/codex.js";
import { depthExceeded } from "../core/src/depth.js";
import { decide } from "../core/src/rulebook/resolve.js";
import { loadRulebook } from "../core/src/rulebook/load.js";
import { buildOfferTable } from "../core/src/capabilities/buildOfferTable.js";
import * as path from 'node:path';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Global State ---
let inventory = new Map();
let rules = [];
let offerTable = {};

const caller = process.env.MCSC_CALLER || 'none';
const CLI_IDS = ['agy', 'opencode', 'codex'];
const TTL_MS = 24 * 60 * 60 * 1000;

const PROBE_LOCK = path.join(homedir(), '.config', 'mcsc', 'probe.lock');
const PROBE_LOCK_STALE_MS = 2 * 60 * 1000;

function acquireProbeLock() {
  fs.mkdirSync(path.dirname(PROBE_LOCK), { recursive: true });
  try {
    fs.writeFileSync(PROBE_LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(PROBE_LOCK).mtimeMs < PROBE_LOCK_STALE_MS) return false;
      fs.writeFileSync(PROBE_LOCK, String(process.pid));
      return true;
    } catch {
      return false;
    }
  }
}

async function getInventory(mayProbe) {
  const cliHealthMap = new Map();
  const missingCliIds = [];

  for (const cliId of CLI_IDS) {
    const cached = await getCached(cliId);
    if (cached) {
      cliHealthMap.set(cliId, cached);
    } else {
      missingCliIds.push(cliId);
    }
  }

  if (missingCliIds.length > 0 && mayProbe) {
    try {
      const newHealthMap = await runInventory({ cliIds: missingCliIds, maxAgeMs: TTL_MS });
      for (const [cliId, health] of newHealthMap.entries()) {
        cliHealthMap.set(cliId, health);
        await setCached(cliId, health, TTL_MS);
      }
    } catch (e) {
      console.error(`[mcsc-mcp] Warning: inventory run failed: ${e.message}`);
    }
  }

  return cliHealthMap;
}

// --- Initialization ---
async function init() {
  // Every CLI started here (agy, opencode, codex) loads its own MCP servers, mcsc included, and that
  // mcsc would repeat these startup calls: agy -> mcsc -> agy without bound (machine froze 2026-10-06).
  // MCSC_PROBE marks those children through inherited env; the lock covers harnesses that drop env.
  // ponytail: a session that starts while another holds the lock gets no live probe or offer table.
  const mayProbe = !process.env.MCSC_PROBE && acquireProbeLock();
  process.env.MCSC_PROBE = '1';
  try {
    await initState(mayProbe);
  } finally {
    delete process.env.MCSC_PROBE;
    if (mayProbe) { try { fs.unlinkSync(PROBE_LOCK); } catch {} }
  }
}

async function initState(mayProbe) {
  inventory = await getInventory(mayProbe);

  const customRulebook = path.resolve(process.cwd(), 'rulebook.yaml');
  const defaultRulebook = path.resolve(__dirname, '../core/rulebook.default.yaml');

  try {
    rules = await loadRulebook({
      defaultsPath: defaultRulebook,
      overridePath: fs.existsSync(customRulebook) ? customRulebook : undefined,
    });
    if (mayProbe) offerTable = await buildOfferTable(rules, inventory, Date.now());
  } catch (e) {
    console.error(`[mcsc-mcp] Warning: could not load rulebook from ${defaultRulebook}: ${e.message}`);
  }
}

// --- MCP Server Definition ---
const server = new Server(
  {
    name: "mcsc-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Registration ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];
  if (depthExceeded()) return { tools };

  // delegate_agy
  const agyHealth = inventory.get('agy');
  if (agyHealth && agyHealth.status === 'ready' && caller !== 'agy') {
    tools.push({
      name: "delegate_agy",
      description: "Delegate a READ-ONLY task to Antigravity CLI (Gemini 3.8 Flash or Claude 3.7 Sonnet). Write tasks are untested: do not rely on it for edits.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The complete task description or objective for the subagent to accomplish."
          },
          model: {
            type: "string",
            description: "Optional model hint for the subagent (e.g., 'flash', 'pro'). Default varies by tool.",
            default: "flash"
          },
          write: {
            type: "boolean",
            description: "UNTESTED. Adds --mode accept-edits for a write task. Leave unset: delegate_agy is documented read-only."
          }
        },
        required: ["prompt"]
      }
    });
  }

  // delegate_opencode
  const opencodeHealth = inventory.get('opencode');
  if (opencodeHealth && opencodeHealth.status === 'ready' && caller !== 'opencode') {
    tools.push({
      name: "delegate_opencode",
      description: "Delegate a task to OpenCode CLI.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The complete task description."
          },
          model: {
            type: "string",
            description: "Optional model override."
          },
          variant: {
            type: "string",
            description: "Optional model variant (reasoning effort, e.g. high/max/minimal)."
          }
        },
        required: ["prompt"]
      }
    });
  }

  // delegate_codex
  const codexHealth = inventory.get('codex');
  if (codexHealth && codexHealth.status === 'ready' && caller !== 'codex') {
    tools.push({
      name: "delegate_codex",
      description: "Delegate a task to Codex CLI.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The complete task description."
          },
          model: {
            type: "string",
            description: "Optional model override."
          }
        },
        required: ["prompt"]
      }
    });
  }

  // delegate_smart (Routing Engine)
  if (rules && rules.length > 0) {
    tools.push({
      name: "delegate_smart",
      description: "Smart task delegation. Reads the rulebook to find the best CLI for the task type and delegates automatically.",
      inputSchema: {
        type: "object",
        properties: {
          task_type: {
            type: "string",
            description: "The type of task (e.g. 'review', 'architecture', 'media')."
          },
          prompt: {
            type: "string",
            description: "The exact prompt for the delegated CLI."
          }
        },
        required: ["task_type", "prompt"]
      }
    });
  }

  return { tools };
});

// --- Tool Execution ---
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  if (depthExceeded()) {
    return {
      content: [{ type: "text", text: "Delegation refused: MCSC_DEPTH limit reached (one level of delegation, like a fork). Do the task yourself." }],
      isError: true,
    };
  }
  const signal = extra.signal;

  const req = {
    cwd: process.cwd(),
    prompt: args.prompt,
    model: args.model,
    variant: args.variant,
    write: args.write === true,
    signal
  };

  try {
    let result;

    switch (name) {
      case "delegate_agy":
        result = await agyDelegate(req);
        break;

      case "delegate_opencode":
        result = await opencodeDelegate(req);
        break;

      case "delegate_codex":
        result = await codexDelegate(req);
        break;

      case "delegate_smart": {
        const taskDescriptor = { task_type: args.task_type };
        const snapshot = { cliHealth: Object.fromEntries(inventory) };
        const decision = decide(taskDescriptor, rules, snapshot, offerTable, Date.now());

        if (decision.kind === 'refuse') {
          return {
            content: [{ type: "text", text: `Smart Delegation refused: ${decision.reason}` }],
            isError: true,
          };
        }

        if (decision.offer && decision.offer.modelId) {
          req.model = decision.offer.modelId;
        }

        switch (decision.cliId) {
          case 'agy':
            result = await agyDelegate(req);
            break;
          case 'opencode':
            result = await opencodeDelegate(req);
            break;
          case 'codex':
            result = await codexDelegate(req);
            break;
          case 'native':
            throw new Error("Task requires native handling by the current orchestrator. Do not use delegate tools for this.");
          default:
            throw new Error(`Unknown CLI: ${decision.cliId}`);
        }
        break;
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    if (result.exit !== 0) {
      return {
        content: [{ type: "text", text: `Delegation failed (Exit ${result.exit}):\n${result.output}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: result.output }],
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        content: [{ type: "text", text: "Tool execution was cancelled by the orchestrator." }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }],
      isError: true,
    };
  }
});

// --- Startup ---
async function main() {
  await init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Without this an mcsc whose harness died lives on as an orphan.
  process.stdin.on('close', () => process.exit(0));
  console.error("MCSC MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
