import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/install-plugin-cli.ts'],
  format: ['esm'],
  target: 'node18',
  bundle: true,
  splitting: false,
  clean: true,
  noExternal: ['@robloxstudio-mcp/core'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
