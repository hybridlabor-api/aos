const { run } = require('./lib/cli-spawn.js');
const res = run('uv', ['venv', '--clear', '--seed', '.venv'], { platform: 'win32', cwd: __dirname });
console.log(res);
