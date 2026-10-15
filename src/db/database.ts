// Dexie-Singleton für bma-lager.
// Schema-Versionierung explizit: jede Schema-Änderung legt eine neue .version() an.
// Die Domänen-Schicht liest und schreibt über dieses Singleton.
//
// Aktuelles Schema: v5 (Einstellungen Cross-Device-synchronisiert mit
// userId-Scope). Frühere Versionen (v1–v4) sind nur noch für Migration
// existierender Browser-DBs. Wenn du eine frische DB anlegst, wird direkt
// v5 verwendet.

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
  einstellungen!: Table<Einstellung, [string, string]>
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

    // v4: Artikel-Archivierung wandert vom `archiviert`-Flag in den Status.
    //      - `archiviert`-Index auf `artikel` entfällt
    //      - vorhandene `archiviert=true`-Artikel bekommen `status='archiviert'`
    //      - `archiviert`-Feld wird aus dem Datensatz entfernt
    this.version(4)
      .stores({
        artikel: 'id, sharePointId, typ, status, titel',
        standorte: 'id, name, typ, archiviert',
        buchungen:
          'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId, serverId',
        projekte: 'id, nummer, archiviert',
        einstellungen: 'key',
        auditLog: 'id, aktion, entitaet, entitaetId, zeit',
        outbox: 'id, entity, syncedAt, createdAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('artikel')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row['archiviert'] === true) {
              row['status'] = 'archiviert'
            }
            delete row['archiviert']
          })
      })

    // v5: Einstellungen werden Cross-Device synchronisiert.
    //      - Primary Key wird zum Compound [key+userId]
    //      - userId (null = global) und geaendertAm kommen dazu
    //      - Alte Zeilen (v1–v4) bekommen userId=null und geaendertAm=now
    //      - Hinweis: Dexie erlaubt kein echtes `null` in Primary-Key-
    //        Komponenten. Wir nutzen die Konvention `userId = ''` (leerer
    //        String) für "global" im Index, behalten aber `null` im
    //        TypeScript-Type. Die Domain-Schicht normalisiert beim Lesen/
    //        Schreiben (siehe src/stores/settings.ts).
    this.version(5)
      .stores({
        artikel: 'id, sharePointId, typ, status, titel',
        standorte: 'id, name, typ, archiviert',
        buchungen:
          'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId, serverId',
        projekte: 'id, nummer, archiviert',
        einstellungen: '[key+userId], key, userId',
        auditLog: 'id, aktion, entitaet, entitaetId, zeit',
        outbox: 'id, entity, syncedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // Bestehende v4-Zeilen bekommen userId='' (Index-konformer globaler
        // Marker) und geaendertAm=now. Die TypeScript-Domain behandelt ''
        // wie null.
        const now = new Date().toISOString()
        await tx
          .table('einstellungen')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row['userId'] === undefined || row['userId'] === null) row['userId'] = ''
            if (typeof row['geaendertAm'] !== 'string') row['geaendertAm'] = now
          })
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
