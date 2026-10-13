import { migrate, pool, waitForDatabase } from './db';

async function runMigrations() {
  try {
    await waitForDatabase();
    await migrate();
    console.log('Database migrations are up to date.');
  } finally {
    await pool.end();
  }
}

void runMigrations().catch((error) => {
  console.error('Database migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
