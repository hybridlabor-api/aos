'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const profile = require('../lib/v5/profile.js');
const selection = require('../lib/gateway/selection.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-choices-'));

test('update question: only asked on missing setting; existing setting is untouched', async () => {
    let selectCalls = 0;
    const mockSelect = async () => {
        selectCalls++;
        return 'auto';
    };

    // Existing 'auto' setting: returns immediately, does not prompt
    const keepAuto = await profile.resolveUpdateMode({
        currentSetting: 'auto',
        interactive: true,
        selectFn: mockSelect,
    });
    assert.strictEqual(keepAuto, 'auto');
    assert.strictEqual(selectCalls, 0, 'must not prompt when updates is already auto');

    // Existing 'off' setting: returns immediately, does not prompt
    const keepOff = await profile.resolveUpdateMode({
        currentSetting: 'off',
        interactive: true,
        selectFn: mockSelect,
    });
    assert.strictEqual(keepOff, 'off');
    assert.strictEqual(selectCalls, 0, 'must not prompt when updates is already off');

    // Existing 'notify' setting: returns immediately, does not prompt
    const keepNotify = await profile.resolveUpdateMode({
        currentSetting: 'notify',
        interactive: true,
        selectFn: mockSelect,
    });
    assert.strictEqual(keepNotify, 'notify');
    assert.strictEqual(selectCalls, 0, 'must not prompt when updates is already notify');

    // Missing setting: prompts and accepts the interactive choice
    const chosen = await profile.resolveUpdateMode({
        currentSetting: undefined,
        interactive: true,
        selectFn: mockSelect,
    });
    assert.strictEqual(chosen, 'auto');
    assert.strictEqual(selectCalls, 1, 'must prompt when setting is missing');
});

test('update question: non-interactive defaults to notify without prompting', async () => {
    let selectCalls = 0;
    const mockSelect = async () => {
        selectCalls++;
        return 'auto';
    };

    const res = await profile.resolveUpdateMode({
        currentSetting: undefined,
        interactive: false,
        selectFn: mockSelect,
    });
    assert.strictEqual(res, 'notify');
    assert.strictEqual(selectCalls, 0, 'must not prompt in non-interactive mode');
});

test('hasConfiguredUpdates: checks disk settings file', () => {
    const home = tmp();
    assert.strictEqual(profile.hasConfiguredUpdates(home), false, 'missing file means unconfigured');

    const settingsDir = path.join(home, '.aos');
    fs.mkdirSync(settingsDir, { recursive: true });

    // File exists but no updates key
    fs.writeFileSync(path.join(settingsDir, 'v5-settings.json'), JSON.stringify({ disabled: [] }));
    assert.strictEqual(profile.hasConfiguredUpdates(home), false, 'no updates key means unconfigured');

    // File exists with valid updates key
    fs.writeFileSync(path.join(settingsDir, 'v5-settings.json'), JSON.stringify({ updates: 'auto' }));
    assert.strictEqual(profile.hasConfiguredUpdates(home), true, 'configured updates key recognized');

    fs.writeFileSync(path.join(settingsDir, 'v5-settings.json'), JSON.stringify({ updates: 'notify' }));
    assert.strictEqual(profile.hasConfiguredUpdates(home), true, 'notify recognized');

    fs.writeFileSync(path.join(settingsDir, 'v5-settings.json'), JSON.stringify({ updates: 'off' }));
    assert.strictEqual(profile.hasConfiguredUpdates(home), true, 'off recognized');
});

test('media server selection: forced list and non-interactive detection defaults', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.agents'), { recursive: true });

    // Manifest with tier 1 (Pro MEDIA)
    fs.writeFileSync(path.join(home, '.agents', '.bdb-manifest.json'), JSON.stringify({ tier: '1' }));

    // Non-interactive default with no apps detected -> empty list
    const fsNoApps = {
        readdirSync: () => (() => { throw new Error('ENOENT'); })(),
        readFileSync: (p) => fs.readFileSync(p),
    };
    assert.deepEqual(selection.mediaServersFor(home, { platform: 'darwin', fsImpl: fsNoApps }), []);

    // Non-interactive with apps detected -> detected list
    const fsApps = {
        readdirSync: (d) => (d === '/Applications' ? ['TouchDesigner', 'Resolume Arena'] : []),
        readFileSync: (p) => fs.readFileSync(p),
    };
    assert.deepEqual(
        selection.mediaServersFor(home, { platform: 'darwin', fsImpl: fsApps }),
        ['bdb_resolume_mcp', 'bdb_td_backup']
    );

    // Forced list via options forces servers regardless of app detection
    assert.deepEqual(
        selection.mediaServersFor(home, { platform: 'darwin', fsImpl: fsNoApps, forced: 'grandma3,unreal' }),
        ['bdb_grandma3_mcp', 'bdb_unreal_mcp']
    );

    // Forced list via --media-servers=all
    assert.deepEqual(
        selection.mediaServersFor(home, { platform: 'darwin', fsImpl: fsNoApps, forced: 'all' }),
        selection.SERVER_GROUPS.media
    );
});
