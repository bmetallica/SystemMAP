// ─── DB Seed ─────────────────────────────────────────────────────────────
// Erstellt einen initialen Admin-Benutzer

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Admin-Benutzer anlegen oder aktualisieren
  const adminPassword = await bcrypt.hash('admin1234', 12);

  // Erst per username suchen (robuster bei Re-Installation / Migration)
  const existing = await prisma.user.findFirst({ where: { username: 'admin' } });
  let admin;

  if (existing) {
    admin = await prisma.user.update({
      where: { id: existing.id },
      data: { email: 'admin@systemmap.local', password: adminPassword },
    });
    console.log(`✅ Admin-Benutzer aktualisiert: ${admin.email}`);
  } else {
    admin = await prisma.user.create({
      data: {
        email: 'admin@systemmap.local',
        username: 'admin',
        password: adminPassword,
        role: UserRole.ADMIN,
      },
    });
    console.log(`✅ Admin-Benutzer erstellt: ${admin.email} (Passwort: admin1234)`);
  }
  console.log('⚠️  Passwort unbedingt nach dem ersten Login ändern!');
}

main()
  .catch((e) => {
    console.error('❌ Seed fehlgeschlagen:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
