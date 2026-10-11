// Codex UserPromptSubmit hooks must print nothing or the documented JSON
// (https://learn.chatgpt.com/docs/codex/hooks): {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
// "additionalContext":...}} or {"decision":"block","reason":...}, plus continue/stopReason/systemMessage/suppressOutput.
// agy payloads (no hook_event_name) keep the injectSteps shape.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CONTAINER = process.env.AOS_TEST_SANDBOX === 'container';
const ALLOWED = new Set(['hookSpecificOutput', 'decision', 'reason', 'continue', 'stopReason', 'systemMessage', 'suppressOutput']);

const run = (script, payload) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-codex-hook-'));
    return spawnSync(process.execPath, [path.join(REPO, script)], {
        input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000, cwd: home,
        env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, AOS_NONINTERACTIVE: '1' },
    });
};
const validCodexOutput = (stdout) => {
    const text = stdout.trim();
    if (!text) return true;
    const o = JSON.parse(text);
    for (const k of Object.keys(o)) assert.ok(ALLOWED.has(k), `key not allowed for Codex: ${k}`);
    if (o.hookSpecificOutput) assert.strictEqual(o.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    return true;
};

const codexPayload = (prompt) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 't1', cwd: os.tmpdir(), prompt });

describe('Codex-shaped UserPromptSubmit payload', { skip: !CONTAINER && 'container-only (spawns hook processes)' }, () => {
    for (const script of ['.claude/workflows/startcycle-dispatch.mjs', '.claude/hooks/rules-inject.mjs', '.claude/hooks/memb-inject.mjs']) {
        test(`${script} prints nothing or valid Codex JSON for an ordinary prompt`, () => {
            const r = run(script, codexPayload('How do I implement binary search in Rust?'));
            assert.strictEqual(r.status, 0, r.stderr);
            assert.ok(validCodexOutput(r.stdout), r.stdout);
        });
    }

    test('startcycle-dispatch prints nothing for a Codex payload on a non-command prompt', () => {
        const r = run('.claude/workflows/startcycle-dispatch.mjs', codexPayload('hello'));
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout.trim(), '');
    });

    test('startcycle-dispatch keeps the agy shape for a payload without hook_event_name', () => {
        const r = run('.claude/workflows/startcycle-dispatch.mjs', { prompt: 'hello' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.deepStrictEqual(JSON.parse(r.stdout.trim()), { injectSteps: [] });
    });

    test('a Claude-shaped payload also gets no injectSteps from startcycle-dispatch', () => {
        const r = run('.claude/workflows/startcycle-dispatch.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'hello' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(!/injectSteps/.test(r.stdout));
    });
});
