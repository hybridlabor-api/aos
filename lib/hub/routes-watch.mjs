'use strict';
// Watcher status route. The watcher is injected via setWatcher(); without one
// the route reports an empty state instead of failing.
import { readEndpoints } from '../endpoints.mjs';
import { readWatches, addWatch, removeWatch } from './inbox.mjs';

export const routes = [
  {
    method: 'GET',
    path: '/api/endpoints',
    handler: async ({ ctx }) => ({ status: 200, json: readEndpoints({ home: ctx.home }) }),
  },
  {
    name: 'add_watch',
    description: 'Add a new watch to the hub inbox.',
    inputSchema: { type: 'object', properties: { upstream: { type: 'string' }, readTool: { type: 'string' }, cursorField: { type: 'string' }, deliverTo: { type: 'string' }, ackTool: { type: 'string' }, intervalSec: { type: 'number' } }, required: ['upstream', 'readTool'] },
    method: 'POST',
    path: '/api/mcp/watches/add',
    mutates: true,
    confirm: 'upstream',
    handler: async ({ ctx, body }) => {
      try {
        if (!body) return { status: 400, json: { ok: false, error: 'no body' } };
        // Input validation
        const allowedKeys = ['upstream', 'readTool', 'cursorField', 'deliverTo', 'ackTool', 'intervalSec', 'confirm', 'readArgs', 'ackArgs'];
        for (const k of Object.keys(body)) {
          if (!allowedKeys.includes(k)) return { status: 400, json: { ok: false, error: `invalid field: ${k}` } };
        }
        // explicit allow-list for safety
        const allowedUpstreams = ['test_mcp', 'messenger_mcp', 'slack_mcp'];
        const allowedReadTools = ['get_msgs', 'read_messages', 'fetch_chat'];
        const allowedAckTools = ['mark_read', 'ack_msgs', 'typing'];
        if (!allowedUpstreams.includes(body.upstream)) return { status: 400, json: { ok: false, error: 'upstream not allow-listed' } };
        if (!allowedReadTools.includes(body.readTool)) return { status: 400, json: { ok: false, error: 'readTool not allow-listed (must be read-only)' } };
        if (body.ackTool && !allowedAckTools.includes(body.ackTool)) return { status: 400, json: { ok: false, error: 'ackTool not allow-listed' } };

        const w = addWatch(ctx.home, body);
        return { status: 200, json: { ok: true, watch: w } };
      } catch (e) {
        return { status: 500, json: { ok: false, error: String(e) } };
      }
    },
  },
  {
    name: 'remove_watch',
    description: 'Remove a watch from the hub inbox.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    method: 'POST',
    path: '/api/mcp/watches/remove',
    mutates: true,
    handler: async ({ ctx, body }) => {
      try {
        if (!body || !body.id) return { status: 400, json: { ok: false, error: 'no id' } };
        removeWatch(ctx.home, body.id);
        return { status: 200, json: { ok: true, id: body.id } };
      } catch (e) {
        return { status: 500, json: { ok: false, error: String(e) } };
      }
    },
  },
  {
    name: 'list_watches',
    description: 'List active watches in the hub inbox.',
    inputSchema: { type: 'object', properties: {} },
    method: 'GET',
    path: '/api/mcp/watches/list',
    handler: async ({ ctx }) => {
      try {
        const w = readWatches(ctx.home);
        return { status: 200, json: { ok: true, watches: w } };
      } catch (e) {
        return { status: 500, json: { ok: false, error: String(e) } };
      }
    },
  },
  {
    method: 'GET',
    path: '/api/watch',
    handler: async () => ({ status: 200, json: currentWatchState() }),
  },
];

let watcher = null;

export function setWatcher(w) { watcher = w; }

function currentWatchState() {
  if (!watcher || !watcher.state) return {};
  return Object.fromEntries(watcher.state);
}
