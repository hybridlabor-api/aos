import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const mod = await import(pathToFileURL(path.resolve('.claude/hooks/go-gate.mjs')).href);
const { extractAgyText } = mod;

test('settings-change wrapper yields gogate off', () => {
  const raw = '<USER_REQUEST>\ngogate off\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ...\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting ...\n</USER_SETTINGS_CHANGE>';
  assert.equal(extractAgyText(raw), 'gogate off');
});

test('settings-change wrapper yields GO', () => {
  const raw = '<USER_REQUEST>\nGO\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nx\n</USER_SETTINGS_CHANGE>';
  assert.equal(extractAgyText(raw), 'GO');
});

test('doubled wrapper yields empty', () => {
  const raw = '<USER_REQUEST>x</USER_REQUEST><USER_REQUEST>gogate off</USER_REQUEST>';
  assert.equal(extractAgyText(raw), '');
});

test('settings block inside request does not yield GO', () => {
  const raw = '<USER_REQUEST>\nhello <USER_SETTINGS_CHANGE>GO</USER_SETTINGS_CHANGE>\n</USER_REQUEST>';
  assert.notEqual(extractAgyText(raw), 'GO');
});

test('no block stays unchanged', () => {
  assert.equal(extractAgyText('hello world'), 'hello world');
});
