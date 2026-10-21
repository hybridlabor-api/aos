import os from 'node:os';

/**
 * Patterns matching API keys and tokens.
 */
const SECRET_PATTERNS = [
  // Anthropic / OpenAI style keys
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  // GitHub tokens
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9_-]{10,}\b/g,
  // AWS Access Key ID
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Bearer tokens in headers
  /\bBearer\s+[A-Za-z0-9_.-]{16,}\b/gi,
  // Basic Auth credentials
  /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/gi,
  // Generic hex/alphanumeric secret assignments (API_KEY=..., TOKEN=...)
  /(?:^|[\s,;])(?<key>[A-Za-z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL)[A-Za-z0-9_-]*)\s*[:=]\s*['"]?(?<val>[^\s'"`,;]{8,})['"]?/gi,
];

/**
 * Returns patterns for user home directories and user paths.
 */
function getHomePatterns() {
  const patterns = [];
  const home = os.homedir();
  if (home && home.length > 2) {
    // Exact home directory
    patterns.push(new RegExp(escapeRegExp(home), 'g'));
    // Windows backslash normalized
    const winHome = home.replace(/\//g, '\\\\');
    patterns.push(new RegExp(escapeRegExp(winHome), 'g'));
  }

  // Generic /Users/<username> (macOS)
  patterns.push(/\/(?:Users|home)\/[a-zA-Z0-9._-]+(?=\/|\b)/g);
  // Generic Windows C:\Users\<username>
  patterns.push(/[a-zA-Z]:\\Users\\[a-zA-Z0-9._-]+(?=\\|\b)/g);

  return patterns;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitizes input string by stripping user home paths, usernames, and secret credentials.
 * @param {string} input - Text to sanitize
 * @returns {string} Redacted text
 */
export function redact(input) {
  if (typeof input !== 'string') {
    return String(input ?? '');
  }

  let text = input;

  // 1. Redact PEM private key blocks
  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');

  // 2. Redact home directories and user paths to '~'
  const home = os.homedir();
  if (home) {
    text = text.replaceAll(home, '~');
    const winHome = home.replace(/\//g, '\\');
    text = text.replaceAll(winHome, '~');
  }

  // Generic /Users/<user> and /home/<user>
  text = text.replace(/\/(?:Users|home)\/[a-zA-Z0-9._-]+(?=[/\\]|$)/g, '~');
  text = text.replace(/[a-zA-Z]:\\Users\\[a-zA-Z0-9._-]+(?=[/\\]|$)/g, '~');

  // 3. Redact secret tokens
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, ...args) => {
      // Check if named capture groups from key-value assignment match
      const groups = args.at(-1);
      if (groups && typeof groups === 'object' && groups.key && groups.val) {
        return ` ${groups.key}=***REDACTED***`;
      }
      if (/^Bearer\s+/i.test(match)) {
        return 'Bearer ***REDACTED***';
      }
      if (/^Basic\s+/i.test(match)) {
        return 'Basic ***REDACTED***';
      }
      return '***REDACTED***';
    });
  }

  return text;
}

export default {
  redact,
};
