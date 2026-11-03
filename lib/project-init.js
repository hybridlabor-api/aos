const fs = require('fs');
const path = require('path');

function runProjectInit({ args = [], currentDir, srcDir, log, platform = process.platform }) {
    const force = args.includes('--force');

    const pAgents = path.join(currentDir, 'AGENTS.md');
    const pClaude = path.join(currentDir, 'CLAUDE.md');
    const pGemini = path.join(currentDir, 'GEMINI.md');
    const aosDir = path.join(currentDir, '.aos');
    const evalsDir = path.join(aosDir, 'evals');
    const pProjectJson = path.join(aosDir, 'project.json');
    const pOpenwikiIgnore = path.join(currentDir, '.openwikiignore');

    const tmplPath = path.join(srcDir, 'skills', 'global_config', 'aos-project-init', 'assets', 'AGENTS.template.md');
    const tmplOpenwikiIgnore = path.join(srcDir, 'skills', 'global_config', 'aos-project-init', 'assets', 'openwikiignore.template');
    const projectName = path.basename(currentDir);

    const plan = [];

    if (!fs.existsSync(pAgents) || force) {
        plan.push(`Wrote ${pAgents}`);
    } else {
        plan.push(`Skipped ${pAgents} (already exists)`);
    }

    for (const pt of [pClaude, pGemini]) {
        if (!fs.existsSync(pt) || force) {
            plan.push(`Wrote ${pt} pointer to AGENTS.md`);
        } else {
            plan.push(`Skipped ${pt} (already exists)`);
        }
    }

    if (!fs.existsSync(aosDir)) {
        plan.push(`Created directory ${aosDir}`);
    }

    if (!fs.existsSync(evalsDir)) {
        plan.push(`Created directory ${evalsDir}`);
    }

    if (!fs.existsSync(pProjectJson) || force) {
        plan.push(`Wrote ${pProjectJson}`);
    } else {
        plan.push(`Skipped ${pProjectJson} (already exists)`);
    }

    if (!fs.existsSync(pOpenwikiIgnore) || force) {
        plan.push(`Wrote ${pOpenwikiIgnore}`);
    } else {
        plan.push(`Skipped ${pOpenwikiIgnore} (already exists)`);
    }

    log.step('Project init plan:');
    for (const item of plan) {
        log.step(`  - ${item}`);
    }

    if (!fs.existsSync(pAgents) || force) {
        const template = fs.existsSync(tmplPath) ? fs.readFileSync(tmplPath, 'utf8') : '# Agents\n';
        fs.writeFileSync(pAgents, template.replace(/<PROJECT NAME>/g, projectName));
    }

    for (const pt of [pClaude, pGemini]) {
        if (!fs.existsSync(pt) || force) {
            if (fs.existsSync(pt)) fs.rmSync(pt, { force: true });

            if (platform === 'win32') {
                fs.writeFileSync(pt, '**See [AGENTS.md](AGENTS.md) for the definitive rules — they apply to all harnesses.**\n');
            } else {
                try {
                    fs.symlinkSync('AGENTS.md', pt);
                } catch (e) {
                    fs.writeFileSync(pt, '**See [AGENTS.md](AGENTS.md) for the definitive rules — they apply to all harnesses.**\n');
                }
            }
        }
    }

    if (!fs.existsSync(aosDir)) fs.mkdirSync(aosDir, { recursive: true });
    if (!fs.existsSync(evalsDir)) fs.mkdirSync(evalsDir, { recursive: true });

    if (!fs.existsSync(pProjectJson) || force) {
        fs.writeFileSync(pProjectJson, '{}\n');
    }

    if (!fs.existsSync(pOpenwikiIgnore) || force) {
        const ignoreTemplate = fs.existsSync(tmplOpenwikiIgnore) ? fs.readFileSync(tmplOpenwikiIgnore, 'utf8') : '';
        fs.writeFileSync(pOpenwikiIgnore, ignoreTemplate);
    }
}

module.exports = {
    runProjectInit
};
