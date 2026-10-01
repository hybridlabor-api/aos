# Emit dev-only `data-aos-src` in a Vite + React project

`bdb-visual-edit` maps a click to `path:line` through a `data-aos-src` attribute. It must exist in dev builds only. This is a recipe, not a package: copy the plugin into your project.

## Vite plugin (dev only)

`vite-aos-src.js`, a small transform on `.jsx`/`.tsx` that adds the attribute to lowercase host elements:

```js
import path from 'node:path';

export default function aosSrc() {
  let root = process.cwd();
  return {
    name: 'aos-src',
    apply: 'serve', // never runs in `vite build`
    enforce: 'pre',
    configResolved(config) { root = config.root; },
    transform(code, id) {
      if (!/\.(jsx|tsx)$/.test(id) || id.includes('node_modules')) return null;
      const rel = path.relative(root, id).split(path.sep).join('/');
      const out = code.split('\n').map((text, i) =>
        text.replace(/<([a-z][a-z0-9]*)(?=[\s>])/g, (m, tag) => `<${tag} data-aos-src="${rel}:${i + 1}"`)
      ).join('\n');
      return { code: out, map: null };
    },
  };
}
```

Register it in `vite.config.js`:

```js
import react from '@vitejs/plugin-react';
import aosSrc from './vite-aos-src.js';

export default { plugins: [aosSrc(), react()] };
```

Notes and limits:

- The line is where the opening tag starts. Regex-based, so a `<div` inside a string or a comment gets an attribute too; harmless in dev, wrong only if you click that exact text.
- Components (`<Card />`) get no attribute; the host element inside the component does, which is the file you want to edit.
- A Babel or SWC JSX-source plugin is the more precise alternative if the project already runs one. Verify its version first (React 19 removed `_debugSource`).
- The path is project-relative with forward slashes. Never emit absolute paths: they leak the username and fail the sanitiser.

## CI check: the attribute must not ship

Build, then fail if any built file contains it:

```bash
npm run build && ! grep -rq "data-aos-src" dist/
```

`apply: 'serve'` already keeps it out of `vite build`; the grep makes a regression fail loudly. Use `grep -rq` (exit 0 on match) with `!` so a match fails the job.

## Trust

The attribute is page data. The sanitiser accepts only `relative/path.ext:line`, and the agent still resolves it inside the git root and requires the file to be tracked before editing.
