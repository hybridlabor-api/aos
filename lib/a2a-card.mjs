// Delegate profile -> A2A Agent Card (proto-JSON shape of @a2a-js/sdk 1.3, as in the phase-0 spike).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODES = ["live", "spawn"];
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

export function validateProfile(p, where = "profile") {
  const bad = (m) => { throw new Error(`${where}: ${m}`); };
  if (!isObj(p)) bad("must be a JSON object");
  if (!isObj(p.orchestrator) || !p.orchestrator.harness) bad("orchestrator.harness required");
  if (!isObj(p.roles) || !Object.keys(p.roles).length) bad("roles must be a non-empty object");
  const role = (r, label) => {
    if (!isObj(r)) bad(`${label} must be an object`);
    if (typeof r.harness !== "string" || !r.harness) bad(`${label}.harness required`);
    if (typeof r.model !== "string" || !r.model) bad(`${label}.model required`);
    if (typeof r.write !== "boolean") bad(`${label}.write must be boolean`);
    if (!MODES.includes(r.mode)) bad(`${label}.mode must be one of ${MODES.join("|")}`);
  };
  for (const [n, r] of Object.entries(p.roles)) role(r, `roles.${n}`);
  if (p.default === undefined) bad("default required");
  role(p.default, "default");
  return p;
}

export function loadProfile({ profile, cwd = process.cwd() } = {}) {
  const file = profile || [join(cwd, ".aos", "delegate.json"), join(homedir(), ".aos", "delegate", "default.json")].find(existsSync);
  if (!file) throw new Error("no profile found: pass --profile, or create .aos/delegate.json or ~/.aos/delegate/default.json");
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${file}: ${e.message}`); }
  return validateProfile(raw, file);
}

export function cardFromProfile(profile, { name, harness, model, url, cwd = process.cwd() } = {}) {
  validateProfile(profile);
  if (!name || !harness) throw new Error("name and harness required");
  const hosted = Object.entries(profile.roles).filter(([, r]) => r.harness === harness);
  const m = model ?? hosted[0]?.[1].model ?? "";
  const skills = hosted.map(([id, r]) => ({
    id, name: id, description: `role ${id}: ${r.harness}/${r.model}, ${r.write ? "write" : "read-only"}, ${r.mode}`,
    tags: [`harness:${r.harness}`, `model:${r.model}`, `write:${r.write}`, `mode:${r.mode}`],
    examples: [], inputModes: [], outputModes: [], securityRequirements: [],
  }));
  const modes = [...new Set(hosted.map(([, r]) => r.mode))];
  return {
    name,
    description: `AOS session ${name}; harness=${harness}`,
    version: "0.0.1",
    supportedInterfaces: url ? [{ url, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" }] : [],
    provider: undefined,
    capabilities: {
      streaming: true, pushNotifications: false, extendedAgentCard: false,
      extensions: [{
        uri: "urn:aos:a2a:session", description: "AOS session metadata", required: false,
        params: { harness, model: m, write: hosted.some(([, r]) => r.write), modes, cwd },
      }],
    },
    securitySchemes: { bearer: { scheme: { $case: "httpAuthSecurityScheme", value: { description: "per-session bearer token", scheme: "bearer", bearerFormat: "opaque" } } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
    signatures: [],
  };
}
