import { migrate, waitForDatabase } from './db';
import { seedSuperAdmin } from './seed';

let ready: Promise<void> | null = null;

export function ensureReady() {
  if (!ready) {
    ready = (async () => {
      await waitForDatabase();
      await migrate();
      await seedSuperAdmin();
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
