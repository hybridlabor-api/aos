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
  // Bare JWT tokens (3 base64url segments starting with standard JSON header eyJ...)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

// Matches URL credentials e.g. https://user:pass@example.com or postgres://app:p@ss/word@db
const URL_CREDENTIAL_PATTERN = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(?:[^/\s@:'"`]*:[^\s'"`]+|[^/\s@'"`]+)@(?=[a-zA-Z0-9_.-]+(?::[0-9]+)?(?=[/?#\s'"`]|$))/g;

// Key pattern that targets credential keywords and supports dot notation (e.g. config.password)
// while explicitly excluding benign words like "author", "authority", "compass", "passenger"
const KEY_NAME_PATTERN = `(?:[a-zA-Z0-9_.-]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD)[a-zA-Z0-9_.-]*|[a-zA-Z0-9_.-]*(?:^|[._-])(?:AUTH|PASS)(?:[._-][a-zA-Z0-9_.-]*|$)|[a-zA-Z0-9_.-]*(?:AUTH(?:Token|Key|Secret)|AUTHORIZATION|AUTHENTICATION)[a-zA-Z0-9_.-]*|\\b(?:auth|pass)\\b)`;

// 1. Quoted key with colon: "apiKey": "xyz" or 'password': hunter2
const PATTERN_QUOTED_COLON = new RegExp(
  `(["'])(?<key>${KEY_NAME_PATTERN})\\1\\s*:\\s*(?:(["'])(?<valQuoted>[^"'\\r\\n]+)\\3|(?<valUnquoted>[^\\s,;}{]+))`,
  'gi'
);

// 2. Unquoted key with colon: apiKey: "xyz", password: hunter2, config.password: "xyz"
const PATTERN_UNQUOTED_COLON = new RegExp(
  `(?:^|[\\s,;{(])(?<key>${KEY_NAME_PATTERN})\\s*:\\s*(?:(["'])(?<valQuoted>[^"'\\r\\n]+)\\2|(?<valUnquoted>[^\\s,;}{]+))`,
  'gi'
);

// 3. Assignment with equals (=): config.password = "x", API_KEY=xyz, --token=xyz
const PATTERN_EQUALS = new RegExp(
  `(?:^|[\\s,;{(])(?<key>(?:--)?${KEY_NAME_PATTERN})\\s*=\\s*(?:(["'])(?<valQuoted>[^"'\\r\\n]+)\\2|(?<valUnquoted>[^\\s'"\\x60,;)]+))`,
  'gi'
);

// 4. Authorization headers (multi-word, e.g. "Authorization: token abc123", Bearer, Basic, etc.)
const PATTERN_AUTHORIZATION_HEADER = /(?<=(?:^|[\s,;{(]|["']))(?<header>(?:[A-Za-z0-9_.-]*[._-])?AUTHORIZATION)\s*:\s*(?:(["'])(?<valQuoted>[^"'\r\n]+)\2|(?<valUnquoted>[^\r\n,;}{]+))/gi;

// 5. CLI flag with space: --password hunter2, --passwd secret, --token xyz, --api-key key
const PATTERN_CLI_FLAG_SPACE = /(?:^|[\s])(?<flag>--(?:password|passwd|token|secret|api[_-]?key|auth[_-]?token))\s+(?:(["'])(?<valQuoted>[^"'\r\n]+)\2|(?<valUnquoted>[^\s\r\n,;)]+))/gi;

// 6. Compact -p password flag: -pSECRET, -phunter2, -p"secret" (excluding port mappings like -p8080 or -p8080:8080)
const PATTERN_COMPACT_P_FLAG = /(?<=(?:^|[\s]))-p(?:(["'])(?<valQuoted>[^"'\r\n]+)\1|(?<valUnquoted>[^\s\r\n]+))/g;

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

  // 5. Redact Authorization headers (multi-word, e.g. "Authorization: token abc123", Bearer, Basic)
  text = text.replace(PATTERN_AUTHORIZATION_HEADER, (match, header, qVal, valQuoted, valUnquoted) => {
    if (qVal) {
      return `${header}: ${qVal}***REDACTED***${qVal}`;
    }
    const trimmed = (valUnquoted || '').trim();
    if (trimmed.includes('***REDACTED***')) {
      return match;
    }
    const schemeMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s+(.+)$/);
    if (schemeMatch) {
      const scheme = schemeMatch[1];
      if (/^bearer$/i.test(scheme)) return `${header}: Bearer ***REDACTED***`;
      if (/^basic$/i.test(scheme)) return `${header}: Basic ***REDACTED***`;
      return `${header}: ${scheme} ***REDACTED***`;
    }
    return `${header}: ***REDACTED***`;
  });

  // 6. Redact CLI flags with space: --password hunter2, --token xyz
  text = text.replace(PATTERN_CLI_FLAG_SPACE, (match, flag, qVal, valQuoted, valUnquoted) => {
    const prefix = match.match(/^[\s]/)?.[0] || '';
    if (qVal) {
      return `${prefix}${flag} ${qVal}***REDACTED***${qVal}`;
    }
    return `${prefix}${flag} ***REDACTED***`;
  });

  // 7. Redact compact -p password flag: -pSECRET, -phunter2 (excluding port mappings like -p8080 or -p8080:8080)
  text = text.replace(PATTERN_COMPACT_P_FLAG, (match, qVal, valQuoted, valUnquoted) => {
    if (qVal) {
      return `-p${qVal}***REDACTED***${qVal}`;
    }
    if (/^\d+(?::\d+)?$/.test(valUnquoted)) {
      return match;
    }
    return '-p***REDACTED***';
  });

  // 8. Redact key-value credential assignments
  // Quoted key with colon
  text = text.replace(PATTERN_QUOTED_COLON, (match, qKey, key, qVal, valQuoted, valUnquoted) => {
    if (qVal) {
      return `${qKey}${key}${qKey}: ${qVal}***REDACTED***${qVal}`;
    }
    return `${qKey}${key}${qKey}: ***REDACTED***`;
  });

  // Unquoted key with colon (JSON/YAML/object)
  text = text.replace(PATTERN_UNQUOTED_COLON, (match, key, qVal, valQuoted, valUnquoted) => {
    const prefix = match.match(/^[\s,;{(]/)?.[0] || '';
    if (qVal) {
      return `${prefix}${key}: ${qVal}***REDACTED***${qVal}`;
    }
    if (valUnquoted) {
      if (valUnquoted.includes('***REDACTED***')) {
        return match;
      }
      return `${prefix}${key}: ***REDACTED***`;
    }
    return match;
  });

  // Equals assignment (env, config.password = "x", etc.)
  text = text.replace(PATTERN_EQUALS, (match, key, qVal, valQuoted, valUnquoted) => {
    const prefix = match.match(/^[\s,;{(]/)?.[0] || '';
    const hasSpaces = /=\s+/.test(match);
    const eq = hasSpaces ? ' = ' : '=';
    if (qVal) {
      return `${prefix}${key}${eq}${qVal}***REDACTED***${qVal}`;
    }
    return `${prefix}${key}${eq}***REDACTED***`;
  });

  return text;
}

export default { redact };
