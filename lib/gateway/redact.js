'use strict';
// Secret-looking substrings out of one log/stderr line (gateway.log, hub errors and status).
function redactLine(text) {
    return String(text)
        .replace(/\b(gh[pousr]_|github_pat_|sk-|AIza)[\w-]{8,}/g, '***')
        .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ***')
        .replace(/\bBasic\s+[A-Za-z0-9+/=_-]{6,}/g, 'Basic ***')
        .replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, '//***@')
        .replace(/("(?:[\w-]*(?:token|api_?key|secret|passw(?:or)?d|credential)[\w-]*)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"***"')
        .replace(/([?&;]|\b)((?:[\w-]*(?:token|key|secret|passw(?:or)?d|pat|auth|credential)[\w-]*))=[^&\s"';]+/gi, '$1$2=***');
}

module.exports = { redactLine };
