// Windows mirror of the plan-canvas launchd agent: Task Scheduler XML as text.
// Pure functions only; nothing here spawns, registers or writes.
export const WIN_PLAN_CANVAS_TASK = 'BDB_PlanCanvas';

const BAD = /["\r\n\0<>|&%^]|[\u0000-\u001f\u007f]/;
const NAME_OK = /^[A-Za-z0-9_.-]+$/;

function checkPath(name, v) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  if (BAD.test(v)) throw new Error(`${name} contains forbidden characters`);
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(v)) throw new Error(`${name} must be an absolute Windows path`);
  return v;
}

export const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const xmlUnescape = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Logon trigger, restart on failure (1 min, 999x), no time limit, current user.
export function buildPlanCanvasTaskXml({ nodePath, scriptPath, workingDir, taskName = WIN_PLAN_CANVAS_TASK }) {
  checkPath('nodePath', nodePath); checkPath('scriptPath', scriptPath); checkPath('workingDir', workingDir);
  if (!NAME_OK.test(taskName)) throw new Error('taskName contains forbidden characters');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\${xmlEscape(taskName)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(nodePath)}</Command>
      <Arguments>"${xmlEscape(scriptPath)}" server</Arguments>
      <WorkingDirectory>${xmlEscape(workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export function parsePlanCanvasTaskXml(xml) {
  if (typeof xml !== 'string') return null;
  const tag = (t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? xmlUnescape(m[1]) : null; };
  const command = tag('Command');
  const args = tag('Arguments');
  if (!command || args === null) return null;
  const sm = args.match(/^"([^"]*)"\s+server$/);
  return {
    taskName: (tag('URI') || '').replace(/^\\/, '') || null,
    nodePath: command,
    scriptPath: sm ? sm[1] : null,
    workingDir: tag('WorkingDirectory'),
    atLogon: /<LogonTrigger>/.test(xml),
    restartOnFailure: /<RestartOnFailure>/.test(xml),
  };
}

// schtasks argument lists; constant verbs, task name validated.
export function schtasksArgs(action, { taskName = WIN_PLAN_CANVAS_TASK, xmlPath } = {}) {
  if (!NAME_OK.test(taskName)) throw new Error('taskName contains forbidden characters');
  switch (action) {
    case 'create': return ['/Create', '/TN', taskName, '/XML', checkPath('xmlPath', xmlPath), '/F'];
    case 'start': return ['/Run', '/TN', taskName];
    case 'stop': return ['/End', '/TN', taskName];
    case 'delete': return ['/Delete', '/TN', taskName, '/F'];
    case 'query': return ['/Query', '/TN', taskName, '/FO', 'LIST', '/V'];
    default: throw new Error(`unknown action: ${action}`);
  }
}

// Parses `schtasks /Query /FO LIST /V` output (English locale keys).
export function parseSchtasksStatus(out) {
  if (typeof out !== 'string') return { installed: false, running: false, status: null };
  const m = out.match(/^\s*Status:\s*(.+?)\s*$/mi);
  const status = m ? m[1] : null;
  return { installed: status !== null, running: status === 'Running', status };
}
