import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['server/vercelHandler.ts'],
  outfile: 'dist-api/handler.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

console.log('bundled dist-api/handler.js');
