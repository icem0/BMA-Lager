// Dexie-Singleton für bma-lager.
// Schema-Versionierung explizit: jede Schema-Änderung legt eine neue .version() an.
// Die Domänen-Schicht liest und schreibt über dieses Singleton.
//
// Aktuelles Schema: v3 (Outbox + serverId-Index).
// Frühere Versionen (v1, v2) sind nur noch für Migration existierender
// Browser-DBs. Wenn du eine frische DB anlegst, wird direkt v3 verwendet.

import Dexie, { type Table } from 'dexie'
import type {
  Artikel,
  AuditLogEintrag,
  Buchung,
  Einstellung,
  OutboxEintrag,
  Projekt,
  Standort,
} from './types'

export class BmaLagerDb extends Dexie {
  artikel!: Table<Artikel, string>
  standorte!: Table<Standort, string>
  buchungen!: Table<Buchung, string>
  projekte!: Table<Projekt, string>
  einstellungen!: Table<Einstellung, string>
  auditLog!: Table<AuditLogEintrag, string>
  /** Sync-Que: jede Schreiboperation landet hier, bis sie zum Server gepusht ist. */
  outbox!: Table<OutboxEintrag, string>

  constructor(name = 'bma-lager') {
    super(name)

    // v1: Originalschema (vor PWA-Multi-User)
    this.version(1).stores({
      artikel: 'id, sharePointId, typ, status, archiviert, titel',
      standorte: 'id, name, typ, archiviert',
      buchungen:
        'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId',
      projekte: 'id, nummer, archiviert',
      einstellungen: 'key',
      auditLog: 'id, aktion, entitaet, entitaetId, zeit',
    })

    // v2: war mal "users"-Tabelle für lokales Auth. Diese Version bleibt leer
    // (Schema unverändert) — die alte users-Tabelle wird in v3 entfernt.
    this.version(2).stores({
      artikel: 'id, sharePointId, typ, status, archiviert, titel',
      standorte: 'id, name, typ, archiviert',
      buchungen:
        'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId',
      projekte: 'id, nummer, archiviert',
      einstellungen: 'key',
      auditLog: 'id, aktion, entitaet, entitaetId, zeit',
    })

    // v3: Sync-fähig — Outbox + serverId-Index
    this.version(3).stores({
      artikel: 'id, sharePointId, typ, status, archiviert, titel',
      standorte: 'id, name, typ, archiviert',
      buchungen:
        'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId, serverId',
      projekte: 'id, nummer, archiviert',
      einstellungen: 'key',
      auditLog: 'id, aktion, entitaet, entitaetId, zeit',
      outbox: 'id, entity, syncedAt, createdAt',
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
