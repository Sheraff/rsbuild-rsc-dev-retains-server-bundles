// Edits a server component 30 times under `rsbuild dev` (JS API) and, every
// 5 edits, prints memory after GC, how many server bundles (one per rebuild,
// from `loadBundle('index')`) are still alive, and how many async hooks
// react-server-dom-rspack/server.node left enabled.
//
//   npm run repro                      as is
//   npm run repro -- --disable-hooks   disable the previous async hook on each evaluation
//   npm run repro -- --dispose         also restore console's methods on each evaluation
//
// Run with --no-compilation-cache (see package.json) so that V8's compilation
// cache does not keep old bundles around between the GCs.
import asyncHooks from 'node:async_hooks';
import fs from 'node:fs';
import { createRsbuild, loadConfig } from '@rsbuild/core';

const EDITS = 30;
const DISABLE_HOOKS = process.argv.some((a) => a === '--disable-hooks' || a === '--dispose');
const RESTORE_CONSOLE = process.argv.includes('--dispose');
const file = new URL('./src/Todos.tsx', import.meta.url);
const original = fs.readFileSync(file, 'utf8');
const log = console.log.bind(console);

// Count the server bundles still alive after GC.
let bundles = 0;
let collected = 0;
const registry = new FinalizationRegistry(() => collected++);

// Flight's server module calls async_hooks.createHook().enable() once per
// evaluation. Count the hooks left enabled.
const enabled = new Set();
const createHook = asyncHooks.createHook;
const originalConsole = { ...console };
asyncHooks.createHook = (callbacks) => {
  if (DISABLE_HOOKS) {
    for (const previous of enabled) previous.disable();
  }
  if (RESTORE_CONSOLE) {
    Object.assign(console, originalConsole);
  }
  const hook = createHook(callbacks);
  const { enable, disable } = hook;
  hook.enable = () => (enabled.add(hook), enable.call(hook));
  hook.disable = () => (enabled.delete(hook), disable.call(hook));
  return hook;
};

let compiled;
let done = new Promise((r) => (compiled = r));
const { content } = await loadConfig();
const rsbuild = await createRsbuild({ config: { ...content, logLevel: 'warn' } });
rsbuild.onAfterDevCompile(() => compiled());
const server = await rsbuild.createDevServer();
const { urls } = await server.listen();
await done;

async function report(i) {
  for (let n = 0; n < 3; n++) {
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 10));
  }
  const { heapUsed, external } = process.memoryUsage();
  const mb = (n) => (n / 1e6).toFixed(0).padStart(3);
  log(
    `edit ${String(i).padStart(2)}: heap ${mb(heapUsed)} MB, external ${mb(external)} MB, ` +
      `server bundles alive ${bundles - collected}/${bundles}, async hooks enabled ${enabled.size}`,
  );
}

let alive;
try {
  for (let i = 0; i <= EDITS; i++) {
    done = new Promise((r) => (compiled = r));
    fs.writeFileSync(file, original.replace('<h1>Todos</h1>', `<h1>Todos ${i}</h1>`));
    await done;
    const res = await fetch(urls[0], { headers: { accept: 'text/html' } });
    if (!(await res.text()).includes(`Todos ${i}`)) {
      throw new Error(`edit ${i} not rendered`);
    }
    // The same object the middleware in rsbuild.config.ts rendered with.
    registry.register(await server.environments.server.loadBundle('index'), null);
    bundles++;
    if (i % 5 === 0) {
      await report(i);
    }
  }
  alive = bundles - collected;
} finally {
  fs.writeFileSync(file, original);
  await server.close();
}
if (alive > 5) {
  log(`FAIL: ${alive} server bundles are still alive`);
  process.exit(1);
}
log('OK');
