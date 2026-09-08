const fs = require('fs');
const path = require('path');
const os = require('os');
const framesData = require('../assets/bdb-ascii-frames.js');

// BDB Master Branding Design Tokens (00_MASTER_BRANDING_SPEC.md)
const BRAND = {
    lila: "\x1b[38;2;155;48;196m",     // #9b30c4 Vibrant Orchid
    lilaDark: "\x1b[38;2;81;17;111m",   // #51116F Deep Plum
    white: "\x1b[38;2;255;255;255m",   // #FFFFFF Base White
    dim: "\x1b[38;2;115;115;125m",     // #73737D Muted / Telemetry Dim
    emerald: "\x1b[38;2;16;185;129m",  // Status Success
    amber: "\x1b[38;2;245;158;11m",    // Status Warning
    reset: "\x1b[0m",
    bold: "\x1b[1m"
};

/**
 * Plays the 3D rotating BDB medallion kinetic intro in terminal.
 * Automatically clears frame buffer upon completion for smooth handoff to Clack.
 */
async function renderKineticIntro({ rotations = 1, fps = 12.5, skip = false } = {}) {
    if (skip || !process.stdout.isTTY) return;

    const frames = framesData.ansi;
    const tickMs = Math.round(1000 / fps);
    const totalFrames = Math.round(rotations * frames.length);

    // Clear terminal screen and hide cursor for a clean viewport
    process.stdout.write('\x1b]0;BDB Agent OS · AOS Installer v4.0.0\x07');
    process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');

    return new Promise((resolve) => {
        let currentFrame = 0;

        const timer = setInterval(() => {
            const frame = frames[currentFrame % frames.length];
            const lines = frame.split('\n');

            const buffer = [
                '\x1b[H',
                ...lines.map(line => '\x1b[2K' + line),
                '\x1b[2K',
                `\x1b[2K  ${BRAND.lila}${BRAND.bold}━━━ BDB AGENT OS ━━━${BRAND.reset}  ${BRAND.white}${BRAND.bold}AOS Kernel v4.0.0${BRAND.reset}  ${BRAND.dim}· Initializing runtime...${BRAND.reset}`
            ].join('\n');

            process.stdout.write(buffer);
            currentFrame++;

            if (currentFrame >= totalFrames) {
                clearInterval(timer);

                // Cleanly clear the animation lines so Clack has a fresh, tidy viewport
                process.stdout.write('\x1b[2J\x1b[H\x1b[?25h\x1b[0m');
                resolve();
            }
        }, tickMs);
    });
}

/**
 * Builds the executive, studio-grade hero header for Clack intro.
 */
function buildHeroHeader(pkgVersion = '4.0.0') {
    const title = `${BRAND.lila}${BRAND.bold}BDB AGENT OS${BRAND.reset} ${BRAND.dim}·${BRAND.reset} ${BRAND.white}${BRAND.bold}CORE KERNEL${BRAND.reset} ${BRAND.dim}·${BRAND.reset} ${BRAND.lila}${BRAND.bold}AOS${BRAND.reset} ${BRAND.dim}-  v${pkgVersion}${BRAND.reset}`;
    const subtitle = `${BRAND.dim}Multi-Agent Skill & Power-Up Ecosystem · Claude, Antigravity, Codex, Cursor & more${BRAND.reset}`;
    const sysInfo = `${BRAND.dim}Host: ${os.type()} ${os.arch()} · Node ${process.version} · PID ${process.pid}${BRAND.reset}`;

    return `${title}\n│  ${subtitle}\n│  ${sysInfo}`;
}

/**
 * Formats a clean pre-flight telemetry card to display before user choices.
 */
function buildTelemetryCard({ installState, detections, daemonStatus = [] }) {
    const lines = [];
    const G = BRAND.dim + '│' + BRAND.reset;
    lines.push(`${G}`);
    lines.push(`${G}  ${BRAND.bold}${BRAND.white}System Pre-Flight Telemetry${BRAND.reset}`);

    // 1. Agent Platforms
    const SHORT_NAMES = {
        'Google Antigravity': 'Antigravity',
        'ChatGPT Codex CLI': 'Codex CLI',
        'Claude Code CLI': 'Claude Code',
        'Roo Code / Cline / VS Code': 'Roo / Cline',
        'Aider CLI': 'Aider',
        'OpenCode CLI': 'OpenCode',
        'Cursor / Generic IDE': 'Cursor',
        'Windsurf IDE': 'Windsurf'
    };

    if (detections && detections.length > 0) {
        const platformBadges = detections.map(d => `${BRAND.emerald}✔${BRAND.reset} ${BRAND.white}${SHORT_NAMES[d.name] || d.name}${BRAND.reset}`);
        const maxPerRow = 4;
        const rows = [];
        for (let i = 0; i < platformBadges.length; i += maxPerRow) {
            rows.push(platformBadges.slice(i, i + maxPerRow).join('   '));
        }
        lines.push(`${G}  ${BRAND.lila}├─${BRAND.reset} ${BRAND.dim}Agent Platforms:${BRAND.reset}  ${rows[0]}`);
        for (let i = 1; i < rows.length; i++) {
            lines.push(`${G}                    ${rows[i]}`);
        }
    } else {
        lines.push(`${G}  ${BRAND.lila}├─${BRAND.reset} ${BRAND.dim}Agent Platforms:${BRAND.reset}  ${BRAND.dim}None auto-detected (universal harness mode available)${BRAND.reset}`);
    }

    // 2. Local Fleet Daemons
    if (daemonStatus && daemonStatus.length > 0) {
        const daemonBadges = daemonStatus
            .map(d => `${d.online ? BRAND.emerald + '✔' : BRAND.dim + '○'} ${BRAND.white}${d.name}${BRAND.reset} ${BRAND.dim}(:${d.port})${BRAND.reset}`)
            .join('   ');
        lines.push(`${G}  ${BRAND.lila}├─${BRAND.reset} ${BRAND.dim}Fleet Daemons:${BRAND.reset}    ${daemonBadges}`);
    }

    // 3. Installation State
    if (installState) {
        if (installState.isInstalled) {
            const versionStatus = installState.updateAvailable
                ? `${BRAND.amber}v${installState.localVersion}${BRAND.reset} ➔ ${BRAND.emerald}${BRAND.bold}v${installState.currentVersion}${BRAND.reset} ${BRAND.amber}(Update Available)${BRAND.reset}`
                : `${BRAND.emerald}✔${BRAND.reset} ${BRAND.white}v${installState.currentVersion}${BRAND.reset} ${BRAND.dim}(Current & Up-to-date)${BRAND.reset}`;
            lines.push(`${G}  ${BRAND.lila}└─${BRAND.reset} ${BRAND.dim}Kernel State:${BRAND.reset}     ${versionStatus}`);
        } else {
            lines.push(`${G}  ${BRAND.lila}└─${BRAND.reset} ${BRAND.dim}Kernel State:${BRAND.reset}     ${BRAND.lila}Fresh Installation${BRAND.reset} ${BRAND.dim}(v${installState.currentVersion || '4.0.0'})${BRAND.reset}`);
        }
    }
    lines.push(`${G}`);

    return lines.join('\n');
}

module.exports = {
    BRAND,
    renderKineticIntro,
    buildHeroHeader,
    buildTelemetryCard
};
