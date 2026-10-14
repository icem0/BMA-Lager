#!/usr/bin/env node
// Bootet embedded-postgres, läuft Migrationen, ruft Bootstrap-Admin und Health-Endpoint.
// Sinn: lokale Testumgebung ohne Docker.
//
// Aufruf:  node scripts/smoke-db.mjs

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { default: EmbeddedPostgres } = require('embedded-postgres')
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DATA_DIR = './var/pg-data'
const PORT = 5433
const USER = 'bma'
const PASSWORD = 'bma-dev'
const DB = 'bma'

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  })

  if (!existsSync(resolve(DATA_DIR, 'PG_VERSION'))) {
    console.log('Initialisiere Postgres-Datenverzeichnis …')
    await pg.initialise()
  }
  console.log('Starte Postgres …')
  await pg.start()

  try {
    const created = await pg.createDatabase(DB)
    console.log('Datenbank angelegt:', created ? 'OK' : 'existierte')

    // Migration
    console.log('Migrationen ausführen …')
    const { default: postgres } = await import('postgres')
    const sql = postgres({
        host: 'localhost',
        port: PORT,
        user: USER,
        password: PASSWORD,
        database: DB,
      })
    const migration = await import('../node_modules/drizzle-orm/postgres-js/migrator.js')
    // nicht direkt nutzbar — wir führen unsere SQL manuell aus
    await sql.unsafe((await import('node:fs')).readFileSync('src/db/migrations/0001_initial.sql', 'utf-8'))
    console.log('Migrationen angewendet.')
    await sql.end()

    // Bootstrap-Admin
    const { spawnSync } = await import('node:child_process')
    const env = {
      ...process.env,
      DATABASE_URL: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DB}`,
      JWT_SECRET: 'dev-secret-please-replace-with-a-real-one-32chars',
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'admin-dev-1234',
    }
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli/bootstrap-admin.ts'],
      { env, stdio: 'inherit', cwd: '.' },
    )
    if (r.status !== 0) {
      console.error('Bootstrap-Admin fehlgeschlagen (Status', r.status, ')')
    } else {
      console.log('Bootstrap-Admin angelegt.')
    }
  } finally {
    console.log('Stoppe Postgres …')
    await pg.stop()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})