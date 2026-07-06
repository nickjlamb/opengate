// Build a self-contained server bundle for the MCPB (desktop extension) package.
// Bundles the MCP server + grounding check + SDK into mcpb/server.mjs so the
// .mcpb needs no node_modules. Then pack with:  npx @anthropic-ai/mcpb pack mcpb
import * as esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['server.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'mcpb/server.mjs',
  logLevel: 'info',
  // The SDK ships an optional native/eval dependency graph; keep the bundle
  // pure-JS and let node resolve nothing at runtime.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

copyFileSync('icon.png', 'mcpb/icon.png');
console.log('MCPB bundle ready: mcpb/server.mjs + mcpb/icon.png (manifest.json already present)');
