// Dexie-Singleton für bma-lager.
// Schema-Versionierung explizit: jede Schema-Änderung legt eine neue .version() an.
// Die Domänen-Schicht liest und schreibt über dieses Singleton.

import Dexie, { type Table } from 'dexie'
import type { Artikel, AuditLogEintrag, Buchung, Einstellung, Projekt, Standort } from './types'

export class BmaLagerDb extends Dexie {
  artikel!: Table<Artikel, string>
  standorte!: Table<Standort, string>
  buchungen!: Table<Buchung, string>
  projekte!: Table<Projekt, string>
  einstellungen!: Table<Einstellung, string>
  auditLog!: Table<AuditLogEintrag, string>

  constructor(name = 'bma-lager') {
    super(name)
    this.version(1).stores({
      // Primärschlüssel = id, danach Indizes
      artikel: 'id, sharePointId, typ, status, archiviert, titel',
      standorte: 'id, name, typ, archiviert',
      buchungen:
        'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId',
      projekte: 'id, nummer, archiviert',
      einstellungen: 'key',
      auditLog: 'id, aktion, entitaet, entitaetId, zeit',
    })
  }
}

// Singleton, ersetzbar in Tests (z. B. in-memory pro Test).
let _db: BmaLagerDb | null = null

export function getDb(): BmaLagerDb {
  if (_db) return _db
  _db = new BmaLagerDb()
  return _db
}

export function setDb(db: BmaLagerDb): void {
  _db = db
}

export function resetDbForTests(): void {
  _db = null
}
