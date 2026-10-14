const path = require('path');

// GNU tar (Git Bash) reads `C:` in an argument as a remote host, so tar gets a
// cwd-relative file name and destination; no argument carries a drive letter.
function tarExtractArgs(file, dest) {
    const p = /^[A-Za-z]:|\\/.test(file) ? path.win32 : path;
    const dir = p.dirname(file);
    const rel = p.relative(dir, dest).split(p.sep).join('/') || '.';
    return {
        args: ['-xzf', p.basename(file), '--strip-components=1', '-C', rel],
        cwd: dir,
    };
}

module.exports = { tarExtractArgs };
