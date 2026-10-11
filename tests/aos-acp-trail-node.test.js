const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const BIN = path.resolve(__dirname, '..', 'bin', 'aos-acp.mjs');
const load = () => import(pathToFileURL(BIN).href);

describe('aos-acp --trail-node / --trail-plan', () => {
  test('the flags are parsed', async () => {
    const { parseArgs } = await load();
    const o = parseArgs(['claude', '--name', 'w', '--prompt', 'x', '--trail-node', 'cart-wire', '--trail-plan', PLAN_REL()]);
    assert.equal(o.trailNode, 'cart-wire');
    assert.equal(o.trailPlan, PLAN_REL());
  });

  test('the flags set AOS_TRAIL_NODE and AOS_TRAIL_PLAN for the worker', async () => {
    const { trailEnv } = await load();
    assert.deepStrictEqual(trailEnv({ trailNode: 'cart-wire', trailPlan: PLAN_REL() }, {}), {
      AOS_TRAIL_NODE: 'cart-wire',
      AOS_TRAIL_PLAN: PLAN_REL(),
    });
  });

  test('a parent env value is forwarded when no flag is given', async () => {
    const { trailEnv } = await load();
    assert.deepStrictEqual(trailEnv({}, { AOS_TRAIL_NODE: 'a', AOS_TRAIL_PLAN: 'p.md' }), { AOS_TRAIL_NODE: 'a', AOS_TRAIL_PLAN: 'p.md' });
  });

  test('a flag wins over the parent env', async () => {
    const { trailEnv } = await load();
    assert.deepStrictEqual(trailEnv({ trailNode: 'b' }, { AOS_TRAIL_NODE: 'a' }), { AOS_TRAIL_NODE: 'b' });
  });

  test('without a node nothing is set and no task is posted', async () => {
    const { trailEnv, trailTask } = await load();
    assert.deepStrictEqual(trailEnv({}, {}), {});
    assert.deepStrictEqual(trailTask({}, {}), {});
  });

  test('the trail events name the node as a task on the plan', async () => {
    const { trailTask } = await load();
    assert.deepStrictEqual(trailTask({ trailNode: 'cart-wire', trailPlan: PLAN_REL() }, {}), {
      task: { id: 'cart-wire', status: 'doing', plan: PLAN_REL() },
    });
  });
});

function PLAN_REL() {
  return 'production_artifacts/00_execution_plan.md';
}
