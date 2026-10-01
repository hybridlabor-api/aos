'use strict';

/**
 * Minimal MDX-subset parser for Agent-Native-style plan folders.
 *
 * Understands: optional YAML-ish frontmatter, Markdown prose (handled by
 * lib/plan-canvas/markdown.js at render time) and JSX-like block tags at the
 * top level — self-closing (`<Code code={"x"} />`) or paired
 * (`<RichText>prose</RichText>`).
 *
 * Everything here is best-effort: a malformed document must degrade into an
 * error block, never throw. Nothing is evaluated — `{...}` attribute values are
 * JSON-parsed, and unparsable ones are kept verbatim as strings with a warning.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*```/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*/;

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0' };
const MAX_DEPTH = 100;

// Data-only JS literal parser (unquoted keys, single quotes, trailing commas,
// comments, `'a' + 'b'`). Nothing is evaluated; anything else throws.
function parseLiteral(src) {
  let i = 0;
  const fail = (message) => { throw new Error(`${message} at ${i}`); };
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src.startsWith('//', i)) {
        while (i < src.length && src[i] !== '\n') i += 1;
      } else if (src.startsWith('/*', i)) {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) fail('unterminated comment');
        i = end + 2;
      } else return;
    }
  };
  const string = () => {
    const quote = src[i++];
    let out = '';
    while (i < src.length && src[i] !== quote) {
      const ch = src[i++];
      if (ch === '\\') {
        const next = src[i++];
        if (next === 'u') { out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; }
        else if (next === 'x') { out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16)); i += 2; }
        else if (next !== '\n') out += Object.hasOwn(ESCAPES, next) ? ESCAPES[next] : next;
      } else {
        if (quote === '`' && ch === '$' && src[i] === '{') fail('template interpolation');
        out += ch;
      }
    }
    if (i >= src.length) fail('unterminated string');
    i += 1;
    return out;
  };
  const key = () => {
    ws();
    if ('"\'`'.includes(src[i])) return string();
    const m = /^[A-Za-z_$][\w$]*|^-?\d+/.exec(src.slice(i));
    if (!m) fail('bad key');
    i += m[0].length;
    return m[0];
  };
  const list = (close, depth, item) => {
    i += 1;
    for (;;) {
      ws();
      if (src[i] === close) { i += 1; return; }
      if (i >= src.length) fail('unterminated literal');
      item(depth);
      ws();
      if (src[i] === ',') i += 1;
      else if (src[i] !== close) fail('expected , or ' + close);
    }
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) fail('nested too deep');
    ws();
    const ch = src[i];
    if (ch === '[') {
      const out = [];
      list(']', depth, (d) => out.push(value(d + 1)));
      return out;
    }
    if (ch === '{') {
      const out = {};
      list('}', depth, (d) => {
        const name = key();
        ws();
        if (src[i++] !== ':') fail('expected :');
        Object.defineProperty(out, name, { value: value(d + 1), enumerable: true, writable: true, configurable: true });
      });
      return out;
    }
    if ('"\'`'.includes(ch)) {
      let out = string();
      ws();
      while (src[i] === '+') {
        i += 1;
        const more = value(depth + 1);
        if (typeof more !== 'string') fail('only strings can be concatenated');
        out += more;
        ws();
      }
      return out;
    }
    const num = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const word = /^[A-Za-z]+/.exec(src.slice(i));
    if (word && Object.hasOwn({ true: 1, false: 1, null: 1, undefined: 1 }, word[0])) {
      i += word[0].length;
      return { true: true, false: false, null: null, undefined: undefined }[word[0]];
    }
    return fail('unsupported value');
  };
  const result = value(0);
  ws();
  if (i < src.length) fail('trailing characters');
  return result;
}

function decodeExpression(body, warnings, tag, key) {
  const raw = body.trim();
  if (!raw) return '';
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return parseLiteral(raw);
    } catch {
      // fall through to the bare-string and raw-text handling below
    }
    // Bare strings are common in hand-written MDX (`{code='x'}`); keep them.
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    warnings.push(`could not parse {${key}} on <${tag}>; kept the raw text`);
    return raw;
  }
}

// Scan one JSX-like tag starting at `text[start] === '<'`. Quote- and
// brace-aware so `html='<div>'` and `data={"a": ">"}` do not end the tag early.
function scanTag(text, start) {
  const nameMatch = NAME_RE.exec(text.slice(start + 1));
  if (!nameMatch) return null;
  const name = nameMatch[0];
  let quote = null;
  let depth = 0;
  for (let i = start + 1 + name.length; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && depth > 0) i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}' && depth > 0) depth -= 1;
    else if (ch === '>' && depth === 0) {
      const selfClosing = text[i - 1] === '/';
      return {
        name,
        attrsText: text.slice(start + 1 + name.length, selfClosing ? i - 1 : i),
        selfClosing,
        end: i + 1
      };
    }
  }
  return null;
}

function closingIndex(text, from, name) {
  const open = new RegExp('<' + name + '(?=[\\s/>])', 'g');
  const close = new RegExp('</' + name + '\\s*>', 'g');
  let depth = 0;
  let cursor = from;
  while (cursor < text.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(text);
    const nextClose = close.exec(text);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      const scanned = scanTag(text, nextOpen.index);
      if (!scanned) {
        cursor = nextClose.index + nextClose[0].length;
        continue;
      }
      if (!scanned.selfClosing) depth += 1;
      cursor = scanned.end;
      continue;
    }
    if (depth === 0) return nextClose.index;
    depth -= 1;
    cursor = nextClose.index + nextClose[0].length;
  }
  return -1;
}

function parseAttributes(attrsText, warnings, tagName) {
  const props = {};
  // Keys whose {expression} could not be parsed; blocks that must not drop data read this.
  Object.defineProperty(props, '_unparsed', { value: [], enumerable: false });
  let i = 0;
  const text = attrsText;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  while (i < text.length) {
    skipSpace();
    if (i >= text.length) break;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_:.-]*/.exec(text.slice(i));
    if (!nameMatch) {
      i += 1;
      continue;
    }
    const key = nameMatch[0];
    i += key.length;
    skipSpace();
    if (text[i] !== '=') {
      props[key] = true;
      continue;
    }
    i += 1;
    skipSpace();
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = text.indexOf(ch, i + 1);
      const raw = end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
      i = end < 0 ? text.length : end + 1;
      if (ch === '`' && raw.includes('${')) {
        warnings.push(`template interpolation in ${tagName}.${key} is not supported; kept the literal text`);
      }
      props[key] = raw;
      continue;
    }
    if (ch === '{') {
      let depth = 0;
      let end = -1;
      let q = null;
      for (let j = i; j < text.length; j++) {
        if (q) {
          if (text[j] === '\\') j += 1;
          else if (text[j] === q) q = null;
        } else if (text[j] === '"' || text[j] === "'" || text[j] === '`') q = text[j];
        else if (text[j] === '{') depth += 1;
        else if (text[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      const body = end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
      i = end < 0 ? text.length : end + 1;
      const before = warnings.length;
      props[key] = decodeExpression(body, warnings, tagName, key);
      if (warnings.length > before) props._unparsed.push(key);
      continue;
    }
    props[key] = true;
  }
  return props;
}

function splitFrontmatter(text, warnings) {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) {
      if (line.trim() && !line.trim().startsWith('#')) warnings.push(`ignored frontmatter line: ${line.trim()}`);
      continue;
    }
    const value = kv[2].trim();
    if (!value) frontmatter[kv[1]] = '';
    else if (/^(true|false)$/i.test(value)) frontmatter[kv[1]] = value.toLowerCase() === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(value)) frontmatter[kv[1]] = Number(value);
    else frontmatter[kv[1]] = value.replace(/^["']|["']$/g, '');
  }
  return { frontmatter, body: text.slice(match[0].length) };
}

/**
 * Parse an MDX source string.
 *
 * Returns the block array (`.frontmatter` and `.warnings` hang off it), so
 * callers that only care about content can iterate it directly.
 */
function parseMdx(text, opts = {}) {
  const warnings = [];
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const { frontmatter, body } = splitFrontmatter(src, warnings);
  const blocks = [];
  let prose = [];
  let proseLine = 0;
  let fence = false;

  // 1-based line in the original source file; every block records where it starts.
  const base = (opts.firstLine || 1) + (src.length - body.length ? src.slice(0, src.length - body.length).split('\n').length - 1 : 0);
  let cur = 0;
  let curLine = base;
  const lineOf = (idx) => {
    if (idx < cur) { cur = 0; curLine = base; }
    for (let k = body.indexOf('\n', cur); k >= 0 && k < idx; k = body.indexOf('\n', cur)) { curLine += 1; cur = k + 1; }
    return curLine;
  };
  const pushProse = (line, at) => {
    if (!proseLine && line.trim()) proseLine = lineOf(at);
    prose.push(line);
  };

  const flush = () => {
    const chunk = prose.join('\n').trim();
    if (chunk) blocks.push({ type: 'prose', text: chunk, line: proseLine });
    prose = [];
    proseLine = 0;
  };

  let i = 0;
  while (i < body.length) {
    const lineEnd = body.indexOf('\n', i);
    const line = body.slice(i, lineEnd < 0 ? body.length : lineEnd);
    const next = lineEnd < 0 ? body.length : lineEnd + 1;

    if (FENCE_RE.test(line)) {
      fence = !fence;
      pushProse(line, i);
      i = next;
      continue;
    }
    if (!fence) {
      const heading = HEADING_RE.exec(line);
      if (heading) {
        flush();
        blocks.push({
          type: 'heading',
          level: heading[1].length,
          text: heading[2].trim(),
          line: lineOf(i)
        });
        i = next;
        continue;
      }
      // Only capitalized tags are block components; lowercase markup stays
      // prose so it renders as (escaped) markdown.
      if (line.trimStart().startsWith('<') && /<[A-Z]/.test(line.trimStart())) {
        const start = i + line.length - line.trimStart().length;
        const scanned = scanTag(body, start);
        if (scanned) {
          flush();
          if (scanned.selfClosing) {
            blocks.push({
              type: 'tag',
              name: scanned.name,
              props: parseAttributes(scanned.attrsText, warnings, scanned.name),
              children: [],
              line: lineOf(start),
              raw: body.slice(start, scanned.end)
            });
            i = scanned.end;
            continue;
          }
          const close = closingIndex(body, scanned.end, scanned.name);
          if (close < 0) {
            warnings.push(`unclosed <${scanned.name}>; the rest of the document was not parsed`);
            blocks.push({
              type: 'malformed',
              line: lineOf(start),
              raw: body.slice(start),
              message: `unclosed <${scanned.name}>`
            });
            i = body.length;
            continue;
          }
          const closeEnd = body.indexOf('>', close) + 1;
          blocks.push({
            type: 'tag',
            name: scanned.name,
            props: parseAttributes(scanned.attrsText, warnings, scanned.name),
            line: lineOf(start),
            children: parseMdx(body.slice(scanned.end, close), { firstLine: lineOf(scanned.end) }),
            childrenRaw: body.slice(scanned.end, close),
            raw: body.slice(start, closeEnd)
          });
          i = closeEnd;
          continue;
        }
      }
    }
    pushProse(line, i);
    i = next;
  }
  flush();

  blocks.frontmatter = frontmatter;
  blocks.warnings = warnings;
  return blocks;
}

module.exports = { parseMdx, scanTag, parseAttributes, parseLiteral };