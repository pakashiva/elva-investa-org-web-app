import { config } from './config';
import { pool } from './db';
import { findUserByUsername, hashPassword } from './auth';

export async function seedSuperAdmin() {
  const existing = await findUserByUsername(config.superAdmin.username);
  if (existing) {
    return;
  }

  const passwordHash = await hashPassword(config.superAdmin.password);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, client_id, full_name, is_active)
     VALUES ($1, $2, 'super_admin', NULL, $3, TRUE)`,
    [config.superAdmin.username, passwordHash, config.superAdmin.fullName]
  );
  console.log(`Seeded Super Admin user "${config.superAdmin.username}"`);
}
