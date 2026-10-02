// One level of delegation, like a fork: every adapter raises MCSC_DEPTH for its child,
// and a server that starts with depth >= MAX_DEPTH refuses to delegate.
export const MAX_DEPTH = 1;

export const currentDepth = (env = process.env) => {
  const n = Number.parseInt(env.MCSC_DEPTH ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

export const childEnv = (caller, env = process.env) => ({
  ...env,
  MCSC_CALLER: caller,
  MCSC_DEPTH: String(currentDepth(env) + 1),
});

export const depthExceeded = (env = process.env) => currentDepth(env) >= MAX_DEPTH;
