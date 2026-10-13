// Empaqueta el servidor (incluido @trazo/core) en dist/server.js. Las dependencias de npm quedan externas.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@trazo/core');

await build({
  entryPoints: { server: 'src/server.ts', migrate: 'src/db/migrate-cli.ts', 'set-role': 'src/cli/set-role.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, 'pino', '@trazo/core/node_modules/*'],
  packages: 'bundle',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log('API compilada en dist/');
