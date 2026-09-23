import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['server/vercelHandler.ts'],
  outfile: 'api/express.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

console.log('bundled api/express.js');
