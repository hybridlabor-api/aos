import { get as httpGet } from 'node:http';

// Identity: a port that answers is not proof that the AOS service answers.
// Only services with a health endpoint we can verify are checked; a foreign
// listener is reported (foreign: true) and never restarted or shown healthy.
// `service` set: the body must be JSON with that service name (the hub answers
// {service:'aos-hub'}); a bare 200 from a foreign process is not enough.
const IDENTITY = {
  'plan-canvas': { port: 4519, path: '/health', service: null },
  gateway: { port: 7791, path: '/health', service: null },
  hub: { port: 7900, path: '/api/health', service: 'aos-hub' },
};

export function defaultIdentify(id, timeoutMs = 800, portOverride = null) {
  const spec = IDENTITY[id];
  if (!spec) return Promise.resolve(null); // no endpoint to verify: nothing to say
  const port = portOverride || spec.port;
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: spec.path, timeout: timeoutMs, agent: false, headers: { connection: 'close' } }, (res) => {
      if (!spec.service) { res.resume(); resolve(res.statusCode === 200); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* not JSON: not ours */ }
        resolve(res.statusCode === 200 && json?.service === spec.service);
      });
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
