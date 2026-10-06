// grandMA3 typed command builders: exact command strings (syntax from the official help, see the URLs in
// mcps/grandma3_cmds.py) and the validation that stops an LLM-supplied argument from changing the command.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const MCPS_DIR = path.resolve(__dirname, '..', 'mcps');
const havePython = spawnSync('python3', ['--version'], { shell: false }).status === 0;

// Runs each python expression against grandma3_cmds; returns [{ok, value}|{ok:false, err}] in order.
function py(exprs) {
  const script = [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'from grandma3_cmds import *',
    'out = []',
    'for e in json.loads(sys.argv[2]):',
    '    try:',
    '        out.append({"ok": True, "value": eval(e)})',
    '    except Exception as x:',
    '        out.append({"ok": False, "err": type(x).__name__})',
    'print(json.dumps(out))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', script, MCPS_DIR, JSON.stringify(exprs)], { shell: false, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const valid = [
  ["cmd_select('Page', 2)", 'Select Page 2'],
  ["cmd_select('Executor', 101)", 'Select Executor 101'],
  ['cmd_executor_go(101)', 'Go+ Executor 101'],
  ['cmd_executor_back(101)', 'Go- Executor 101'],
  ['cmd_executor_pause(101)', 'Pause Executor 101'],
  ['cmd_executor_off(101)', 'Off Executor 101'],
  ['cmd_goto_cue(5)', 'Goto Cue 5'],
  ['cmd_goto_cue(5, 101)', 'Goto Cue 5 Executor 101'],
  ['cmd_store_cue(2, sequence=4)', 'Store Cue 2 Sequence 4'],
  ['cmd_store_cue(2, executor=101)', 'Store Cue 2 Executor 101'],
  ["cmd_label('Group', 3, 'Front Wash')", 'Label Group 3 "Front Wash"'],
  ['cmd_clear()', 'Clear'],
  ['cmd_macro(3)', 'Go+ Macro 3'],
  ["cmd_patch_fixture(101, '1.101')", 'Patch Fixture 101 1.101'],
];

const rejected = [
  'cmd_executor_go(-1)', 'cmd_executor_go(0)', 'cmd_executor_go(100000)', 'cmd_executor_go(True)', 'cmd_executor_go(1.5)', "cmd_executor_go('1')",
  "cmd_select('Sequence 1 Delete Sequence', 2)", "cmd_select('Page; Delete', 2)", "cmd_select('World', 1)",
  "cmd_label('Group', 1, 'x\\n')", "cmd_label('Group', 1, 'x\\ny')", "cmd_label('Group', 1, 'a;b')", "cmd_label('Group', 1, 'a\"b')",
  "cmd_label('Group', 1, 'a.b')", "cmd_label('Group', 1, 'a-b')", "cmd_label('Group', 1, '')", "cmd_label('Group', 1, 'x' * 33)",
  "cmd_label('Executor', 1, 'x')", "cmd_label('Group', 1, 5)",
  "cmd_patch_fixture(101, '1.101; Delete Fixture 1')", "cmd_patch_fixture(101, '1.101\\n')", "cmd_patch_fixture(101, '1')", 'cmd_patch_fixture(0, "1.1")',
  'cmd_macro(0)', 'cmd_macro(-5)', 'cmd_macro(True)', 'cmd_goto_cue(5, 0)', 'cmd_store_cue(0)',
];

test('builders return the exact console command strings', { skip: !havePython && 'python3 is not on PATH' }, () => {
  const res = py(valid.map(([e]) => e));
  valid.forEach(([e, want], i) => assert.deepEqual(res[i], { ok: true, value: want }, e));
});

test('every malformed or injecting argument is rejected', { skip: !havePython && 'python3 is not on PATH' }, () => {
  const res = py(rejected);
  rejected.forEach((e, i) => assert.equal(res[i].ok, false, `${e} was accepted: ${JSON.stringify(res[i])}`));
});

test('the server routes patch_fixture and execute_macro through the validated builders', () => {
  const src = require('fs').readFileSync(path.join(MCPS_DIR, 'grandma3_mcp.py'), 'utf8');
  assert.ok(src.includes('cmd_patch_fixture(fixture_id, address)'));
  assert.ok(src.includes('cmd_macro(macro_number)'));
  assert.ok(!/Assign Fixture/.test(src), 'the invented Assign Fixture command is gone');
  assert.ok(/UNVALIDATED raw console command/.test(src), 'execute_command documents that it is raw');
});
