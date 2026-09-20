const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(repo, 'bin', 'aos-dashboard.mjs'), 'utf8');
const installer = fs.readFileSync(path.join(repo, 'installer.js'), 'utf8');

describe('Windows daemon support', () => {
    test('dashboard reports and controls the OpenWiki Scheduled Task', () => {
        assert.match(dashboard, /Get-ScheduledTask -TaskName 'BDB_OpenWiki_Daemon'/);
        assert.match(dashboard, /Start-ScheduledTask -TaskName/);
        assert.match(dashboard, /Stop-ScheduledTask -TaskName/);
        assert.match(dashboard, /process\.platform === 'win32' && id === 'openwiki'/);
    });

    test('dashboard controls the installed Windows wrappers for memB and Synapse', () => {
        assert.match(dashboard, /com\.bdb\.memb\.webui\.vbs/);
        assert.match(dashboard, /com\.bdb\.synapse\.vbs/);
        assert.match(dashboard, /Get-CimInstance Win32_Process/);
        assert.match(dashboard, /wscript\.exe/);
    });

    test('Synapse wrapper persists Go discovery and a useful missing-Go error', () => {
        assert.match(installer, /function findWindowsGoBin\(\)/);
        assert.match(installer, /set "PATH=\$\{goBin\.replace/);
        assert.match(installer, /where\.exe go >nul/);
        assert.match(installer, /https:\/\/go\.dev\/dl\//);
    });

    test('memB validates and repairs pydantic-core before daemon registration', () => {
        assert.match(installer, /function verifyPythonImports\(/);
        assert.match(installer, /import pydantic, pydantic_core/);
        assert.match(installer, /--force-reinstall "pydantic>=2\.7\.3" "pydantic-core>=2\.18\.4"/);
    });
});
