'use strict';
// Which LLM memB uses for fact extraction (add_memory infer=True). One choice, many providers: it follows the
// provider the user already configured for OpenWiki (~/.openwiki/.env: OPENWIKI_PROVIDER, OPENWIKI_MODEL_ID, <PROVIDER>_API_KEY)
// unless ~/.aos/secrets.env or the environment pins MEMB_LLM_PROVIDER / MEMB_LLM_MODEL / MEMB_LLM_API_KEY / MEMB_LLM_BASE_URL.
// Returns env variables only; values are never logged. memb-mcp reads MEMB_LLM_* (see docs/memory.md for the memB side).
const fs = require('fs');
const path = require('path');
const { parseEnvText, readSecretsFile, secretsPath } = require('./mcp-secrets');

// OpenWiki provider name -> memB provider, key variable, fixed endpoint (memB reaches these through its openai provider).
const PROVIDERS = {
    gemini: { provider: 'gemini', key: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
    google: { provider: 'gemini', key: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
    openai: { provider: 'openai', key: ['OPENAI_API_KEY'] },
    openrouter: { provider: 'openai', key: ['OPENROUTER_API_KEY'], base: 'https://openrouter.ai/api/v1' },
    nvidia: { provider: 'openai', key: ['NVIDIA_API_KEY'], base: 'https://integrate.api.nvidia.com/v1' },
    anthropic: { provider: 'anthropic', key: ['ANTHROPIC_API_KEY'] },
    'openai-compatible': { provider: 'openai', key: ['OPENAI_COMPATIBLE_API_KEY'], baseVar: 'OPENAI_COMPATIBLE_BASE_URL' },
};

function resolveMembLlm({ home, env = process.env } = {}) {
    let secrets = {};
    let ow = {};
    try { const s = readSecretsFile(secretsPath(home)); if (s.state === 'ok') secrets = s.vars; } catch { /* none */ }
    try { ow = parseEnvText(fs.readFileSync(path.join(home, '.openwiki', '.env'), 'utf8')); } catch { /* none */ }
    const get = (k) => env[k] || secrets[k] || ow[k] || '';
    const first = (names) => names.map(get).find(Boolean) || '';
    const out = {};

    const pinned = get('MEMB_LLM_PROVIDER');
    const spec = PROVIDERS[get('OPENWIKI_PROVIDER')];
    const useSpec = !pinned && spec && (first(spec.key) || get('OPENWIKI_PROVIDER') === 'openai-compatible');
    if (pinned) out.MEMB_LLM_PROVIDER = pinned;
    else if (useSpec) out.MEMB_LLM_PROVIDER = spec.provider;
    const model = get('MEMB_LLM_MODEL') || (useSpec ? get('OPENWIKI_MODEL_ID') : '');
    if (model) out.MEMB_LLM_MODEL = model;
    const key = get('MEMB_LLM_API_KEY') || (useSpec ? first(spec.key) : '');
    if (key) out.MEMB_LLM_API_KEY = key;
    const base = get('MEMB_LLM_BASE_URL') || (useSpec ? (spec.base || (spec.baseVar && get(spec.baseVar)) || '') : '');
    if (base) out.MEMB_LLM_BASE_URL = base;

    // A Gemini key keeps the current memB (provider hard-wired to gemini) working, wherever the user stored it.
    const g = first(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
    if (g) out.GEMINI_API_KEY = g;
    return out;
}

module.exports = { PROVIDERS, resolveMembLlm };
