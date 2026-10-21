import os from 'node:os';

// Patterns matching secrets, tokens, API keys, credentials, and private keys
const SECRET_PREFIX_PATTERNS = [
  // OpenAI/Anthropic keys: sk-..., sk_live_..., sk_test_..., sk-proj-...
  /\bsk[-_](?:live|test|proj)?[A-Za-z0-9_-]{10,}\b/gi,
  // Google API keys: AIza...
  /\bAIza[0-9A-Za-z-_]{35}\b/g,
  // GitHub tokens
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{10,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9_-]{10,}\b/g,
  // AWS Access Key ID
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Bearer tokens in headers
  /\bBearer\s+[A-Za-z0-9_.-]{16,}\b/gi,
  // Basic Auth credentials
  /\bBasic\s+[A-Za-z0-9+/=]{16,}\b/gi,
];

// Matches URL credentials e.g. https://user:pass@example.com or postgres://user:secret@localhost:5432
const URL_CREDENTIAL_PATTERN = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@:]+):([^/\s@:]+)@/g;

// Matches JSON-quoted and unquoted key-value assignments
// e.g. {"apiKey": "abcdefgh12"}, apiKey: "...", "secret": "...", API_KEY=xyz
const ASSIGNMENT_PATTERNS = [
  // JSON quoted key and value: "apiKey": "xyz" or 'apiKey': 'xyz'
  /(["'])(?<key>[a-zA-Z0-9_.-]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL|PRIVATE[_-]?KEY)[a-zA-Z0-9_.-]*)\1\s*:\s*(["'])(?<val>[^"'\r\n]+)\3/gi,
  // Unquoted key in JSON/YAML/JS object: apiKey: "xyz"
  /(?:^|[\s,;{])(?<key>[a-zA-Z0-9_.-]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL)[a-zA-Z0-9_.-]*)\s*:\s*(["'])(?<val>[^"'\r\n]+)\2/gi,
  // Env file or CLI assignments: KEY=xyz or --token=xyz
  /(?:^|[\s,;])(?<key>[A-Za-z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL)[A-Za-z0-9_-]*)\s*=\s*(["']?)(?<val>[^\s'"`,;]+)\2/gi,
];

export function redact(input) {
  if (typeof input !== 'string') {
    return String(input ?? '');
  }

  let text = input;

  // 1. Redact PEM private key blocks
  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');

  // 2. Redact URL credentials: scheme://user:pass@ -> scheme://[REDACTED_AUTH]@
  text = text.replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED_AUTH]@');

  // 3. Redact user home paths and common profile directories to '~'
  const home = os.homedir();
  if (home && home.length > 2) {
    text = text.replaceAll(home, '~');
    const winHome = home.replace(/\//g, '\\');
    text = text.replaceAll(winHome, '~');
  }

  // Generic macOS /Users/<username> and Linux /home/<username>
  text = text.replace(/\/(?:Users|home)\/[a-zA-Z0-9._-]+(?=[/\\]|$)/g, '~');
  text = text.replace(/[a-zA-Z]:\\Users\\[a-zA-Z0-9._-]+(?=[/\\]|$)/g, '~');

  // 4. Redact known token/key prefixes
  for (const pattern of SECRET_PREFIX_PATTERNS) {
    text = text.replace(pattern, (match) => {
      if (/^Bearer\s+/i.test(match)) return 'Bearer ***REDACTED***';
      if (/^Basic\s+/i.test(match)) return 'Basic ***REDACTED***';
      return '***REDACTED***';
    });
  }

  // 5. Redact key-value credential assignments (JSON quotes, YAML, env format)
  // First JSON-quoted: {"apiKey": "value"} -> {"apiKey": "***REDACTED***"}
  text = text.replace(ASSIGNMENT_PATTERNS[0], (match, quoteChar, key, valQuote, val) => {
    return `${quoteChar}${key}${quoteChar}: ${valQuote}***REDACTED***${valQuote}`;
  });

  // Second unquoted key in JS/YAML: apiKey: "value" -> apiKey: "***REDACTED***"
  text = text.replace(ASSIGNMENT_PATTERNS[1], (match, key, valQuote, val) => {
    const prefix = match.match(/^[\s,;{]/)?.[0] || '';
    return `${prefix}${key}: ${valQuote}***REDACTED***${valQuote}`;
  });

  // Third env assignment: KEY=value -> KEY=***REDACTED***
  text = text.replace(ASSIGNMENT_PATTERNS[2], (match, key, valQuote, val) => {
    const prefix = match.match(/^[\s,;]/)?.[0] || '';
    return `${prefix}${key}=***REDACTED***`;
  });

  return text;
}

export default { redact };
