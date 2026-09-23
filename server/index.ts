import { config } from './config.ts';
import { app } from './app.ts';
import { ensureReady } from './ready.ts';

async function start() {
  await ensureReady();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`ELVA Investa API on http://0.0.0.0:${config.port}`);
  });
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
