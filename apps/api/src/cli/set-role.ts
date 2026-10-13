/** Asigna un rol a un usuario: `pnpm --filter @trazo/api set-role correo@ejemplo.com moderator` */
import { createDb } from '../db/db.js';

const [email, role] = process.argv.slice(2);
if (!email || !['user', 'moderator', 'admin'].includes(role ?? '')) {
  console.error('Uso: set-role <email> <user|moderator|admin>');
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL!, 1);
try {
  const r = await db.updateTable('users').set({ role: role as 'user' }).where('email', '=', email.toLowerCase()).executeTakeFirst();
  console.log(Number(r.numUpdatedRows) ? `Rol de ${email}: ${role}` : 'Usuario no encontrado');
} finally {
  await db.destroy();
}
