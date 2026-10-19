'use strict';
// Watcher status route. The watcher is injected via setWatcher(); without one
// the route reports an empty state instead of failing.
import { readEndpoints } from '../endpoints.mjs';

export const routes = [
  {
    method: 'GET',
    path: '/api/endpoints',
    handler: async ({ ctx }) => ({ status: 200, json: readEndpoints({ home: ctx.home }) }),
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
