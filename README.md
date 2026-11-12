# Rsbuild RSC dev: every rebuild keeps the previous server bundle alive

Issue: (link added once filed)

This is `examples/server` from [rsbuild-plugin-rsc](https://github.com/rstackjs/rsbuild-plugin-rsc)
(commit 71f66e7) unchanged, plus `repro.mjs` and a `package.json` with published versions.

`repro.mjs` starts the dev server through Rsbuild's JS API, edits `<h1>` in `src/Todos.tsx` 30 times,
renders `/` after each rebuild, and every 5 edits prints memory after GC, how many of the server
bundles (`loadBundle('index')`, one per rebuild) are still alive, and how many async hooks are enabled.

```sh
npm install
npm run repro                     # exits 1: every server bundle stays alive
npm run repro -- --disable-hooks  # still exits 1: console's wrappers keep them too
npm run repro -- --dispose        # exits 0: also restore console's methods
```

`--disable-hooks` and `--dispose` only change what happens when `async_hooks.createHook()` is
called (once per evaluation of `react-server-dom-rspack/server.node`): disable the earlier
hooks, and put back console's original methods.

Run with `--no-compilation-cache` (in the `repro` script) so that V8's compilation cache does not
keep recent bundles between the GCs and blur the heap numbers.
