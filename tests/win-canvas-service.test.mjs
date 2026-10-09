import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlanCanvasTaskXml, parsePlanCanvasTaskXml, schtasksArgs, parseSchtasksStatus, xmlEscape,
} from '../lib/hub/services-win.mjs';

const ok = { nodePath: 'C:\\Program Files\\nodejs\\node.exe', scriptPath: 'C:\\Users\\Tim\\aos\\bin\\plan-canvas.js', workingDir: 'C:\\Users\\Tim' };

test('xml has logon trigger, restart, exec fields', () => {
  const xml = buildPlanCanvasTaskXml(ok);
  assert.match(xml, /<LogonTrigger>/);
  assert.match(xml, /<RestartOnFailure>/);
  assert.match(xml, /<Command>C:\\Program Files\\nodejs\\node.exe<\/Command>/);
  assert.match(xml, /<WorkingDirectory>C:\\Users\\Tim<\/WorkingDirectory>/);
});

test('round trip', () => {
  assert.deepEqual(parsePlanCanvasTaskXml(buildPlanCanvasTaskXml(ok)), {
    taskName: 'BDB_PlanCanvas', ...ok, atLogon: true, restartOnFailure: true,
  });
});

test('escapes xml specials in paths', () => {
  const p = { ...ok, workingDir: "C:\\Users\\O'Brien's" };
  const xml = buildPlanCanvasTaskXml(p);
  assert.ok(xml.includes('O&apos;Brien&apos;s'));
  assert.equal(parsePlanCanvasTaskXml(xml).workingDir, p.workingDir);
  assert.equal(xmlEscape('<a&"b">'), '&lt;a&amp;&quot;b&quot;&gt;');
});

test('rejects bad input', () => {
  for (const bad of ['C:\\a"b', 'C:\\a\nb', 'C:\\a\0b', 'C:\\a<b', 'C:\\a&b', 'rel\\path', '', null]) {
    assert.throws(() => buildPlanCanvasTaskXml({ ...ok, nodePath: bad }));
    assert.throws(() => buildPlanCanvasTaskXml({ ...ok, scriptPath: bad }));
    assert.throws(() => buildPlanCanvasTaskXml({ ...ok, workingDir: bad }));
  }
  assert.throws(() => buildPlanCanvasTaskXml({ ...ok, taskName: 'a b;calc' }));
});

test('parse returns null on junk', () => {
  assert.equal(parsePlanCanvasTaskXml('nope'), null);
  assert.equal(parsePlanCanvasTaskXml(null), null);
});

test('schtasks args', () => {
  assert.deepEqual(schtasksArgs('start'), ['/Run', '/TN', 'BDB_PlanCanvas']);
  assert.deepEqual(schtasksArgs('create', { xmlPath: 'C:\\t\\pc.xml' }), ['/Create', '/TN', 'BDB_PlanCanvas', '/XML', 'C:\\t\\pc.xml', '/F']);
  assert.throws(() => schtasksArgs('create', { xmlPath: 'C:\\t"x' }));
  assert.throws(() => schtasksArgs('create'));
  assert.throws(() => schtasksArgs('format'));
  assert.throws(() => schtasksArgs('stop', { taskName: 'x /F' }));
});

test('status parse', () => {
  assert.deepEqual(parseSchtasksStatus('TaskName: \\BDB_PlanCanvas\nStatus:       Running\n'), { installed: true, running: true, status: 'Running' });
  assert.equal(parseSchtasksStatus('Status: Ready').running, false);
  assert.equal(parseSchtasksStatus('ERROR: The system cannot find the file specified.').installed, false);
  assert.equal(parseSchtasksStatus(undefined).installed, false);
});
