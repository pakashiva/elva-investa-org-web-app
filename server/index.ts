import { config } from './config';
import { app } from './app';

async function start() {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`ELVA Investa API on http://0.0.0.0:${config.port}`);
  });
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
