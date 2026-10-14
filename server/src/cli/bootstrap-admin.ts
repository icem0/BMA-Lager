// Bootstrap-Admin: legt den ersten User mit ADMIN_EMAIL/ADMIN_PASSWORD an,
// falls noch keiner existiert. Idempotent: bestehende Email wird nicht überschrieben.

import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../db/client.js'
import { users } from '../db/schema.js'
import { config } from '../config/config.js'

async function main() {
  const db = getDb()
  const email = config.ADMIN_EMAIL.toLowerCase()
  const password = config.ADMIN_PASSWORD

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`User ${email} existiert bereits (Rolle: ${existing[0]!.rolle}). Nichts zu tun.`)
    return
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email,
    passwordHash,
    rolle: 'admin',
    aktiv: true,
    erstelltAm: new Date(),
    letzterLoginAm: null,
    mustChangePassword: true,
  })

  // eslint-disable-next-line no-console
  console.log(`Admin angelegt: ${email} (id=${id}).`)
  console.log('Bitte beim ersten Login das Passwort ändern (mustChangePassword=true).')
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Bootstrap-Admin fehlgeschlagen:', err)
    process.exit(1)
  })
  .finally(() => {
    void closeDb()
  })