// Migration-Runner. Wird per `npm run db:migrate` aufgerufen.
// Liest alle .sql-Dateien aus src/db/migrations/ in alphabetischer Reihenfolge
// und führt sie gegen die konfigurierte DATABASE_URL aus.

import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { getDb, closeDb } from './client.js'

async function main() {
  const db = getDb()
  try {
    // eslint-disable-next-line no-console
    console.log('Migrationen werden ausgeführt …')
    await migrate(db, { migrationsFolder: './src/db/migrations' })
    // eslint-disable-next-line no-console
    console.log('Fertig.')
  } finally {
    await closeDb()
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Migration fehlgeschlagen:', err)
  process.exit(1)
})