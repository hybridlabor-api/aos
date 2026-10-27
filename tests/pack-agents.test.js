/**
 * tests/pack-agents.test.js
 *
 * Tests for pack-specific agent compilation:
 * - pack agents can be loaded from .agents/packs/<pack>/AGENTS.md
 * - compiled agents include both main and pack agents
 * - pack agents are conditional (only loaded when pack is selected)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseAgentsMd, loadPackAgents } = require('../installer.js');

const ROOT = path.join(__dirname, '..');

test('main AGENTS.md does not contain domain-specific personas', () => {
    const agentsMd = fs.readFileSync(path.join(ROOT, '.agents', 'AGENTS.md'), 'utf8');
    const parsed = parseAgentsMd(agentsMd);
    const names = parsed.map(a => a.name.toLowerCase().replace(/_/g, '-'));

    const movedAgents = [
        'pcb-design-assistant',
        'event-manager-assistant',
        'video-motion-assistant',
        'live-media-operator',
        'godmode-media-eventtech'
    ];

    for (const agent of movedAgents) {
        assert.ok(
            !names.includes(agent),
            `${agent} should not be in main AGENTS.md (moved to pack)`
        );
    }
});

test('pack-specific AGENTS.md files exist', () => {
    const packsDir = path.join(ROOT, '.agents', 'packs');
    assert.ok(fs.existsSync(packsDir), '.agents/packs directory exists');

    const expectedPacks = ['media', 'eventtech', 'hardware'];
    for (const pack of expectedPacks) {
        const agentsMd = path.join(packsDir, pack, 'AGENTS.md');
        assert.ok(fs.existsSync(agentsMd), `.agents/packs/${pack}/AGENTS.md exists`);
    }
});

test('pack agents can be loaded and parsed', () => {
    const packAgents = loadPackAgents();
    assert.ok(Array.isArray(packAgents), 'loadPackAgents returns an array');
    assert.ok(packAgents.length > 0, 'loadPackAgents returns some agents');

    // Verify expected agents are loaded
    const names = packAgents.map(a => a.name.toLowerCase().replace(/_/g, '-'));
    const expectedInPacks = [
        'pcb-design-assistant',
        'event-manager-assistant',
        'video-motion-assistant',
        'live-media-operator',
        'godmode-media-eventtech'
    ];

    for (const agent of expectedInPacks) {
        assert.ok(
            names.includes(agent),
            `${agent} should be loaded from pack agents`
        );
    }
});

test('main agents + pack agents compiled together', () => {
    const agentsMd = fs.readFileSync(path.join(ROOT, '.agents', 'AGENTS.md'), 'utf8');
    const mainAgents = parseAgentsMd(agentsMd);
    const packAgents = loadPackAgents();

    const allAgents = [...mainAgents, ...packAgents];
    const names = allAgents.map(a => a.name.toLowerCase().replace(/_/g, '-'));

    // Generic personas should be in main
    assert.ok(names.includes('architect'), 'Architect in combined set');
    assert.ok(names.includes('techlead'), 'TechLead in combined set');
    assert.ok(names.includes('reviewer'), 'Reviewer in combined set');

    // Pack personas should be in combined set
    assert.ok(names.includes('pcb-design-assistant'), 'pcb-design-assistant in combined set');
    assert.ok(names.includes('event-manager-assistant'), 'event-manager-assistant in combined set');
    assert.ok(names.includes('video-motion-assistant'), 'video-motion-assistant in combined set');
});

test('all pack agents have valid role descriptions', () => {
    const packAgents = loadPackAgents();

    for (const agent of packAgents) {
        assert.ok(agent.role, `${agent.name}: has role description`);
        assert.ok(agent.role.length > 0, `${agent.name}: role is not empty`);
        assert.ok(agent.skills, `${agent.name}: has skills`);
        assert.ok(Array.isArray(agent.skills), `${agent.name}: skills is an array`);
    }
});

test('context boot sequence is conditional in main AGENTS.md', () => {
    const agentsMd = fs.readFileSync(path.join(ROOT, '.agents', 'AGENTS.md'), 'utf8');

    // Check for "if installed" markers in Context Boot Sequence
    assert.ok(agentsMd.includes('(if installed)'), 'Context Boot Sequence has conditional markers');

    // Should mention memB, OpenWiki, Synapse with conditional language
    assert.ok(agentsMd.match(/memB.*if installed/i), 'memB is marked as conditional');
    assert.ok(agentsMd.match(/OpenWiki.*if installed/i), 'OpenWiki is marked as conditional');
    assert.ok(agentsMd.match(/Synapse.*if installed/i), 'Synapse is marked as conditional');
});
