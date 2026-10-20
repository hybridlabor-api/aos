// Pure data, no side effects on import. Add a CLI by adding its spec to core.mjs or agents.mjs.
import core from './core.mjs';
import agents from './agents.mjs';

export default [...core, ...agents];
