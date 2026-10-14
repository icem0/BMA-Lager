-- bma-lager: Artikel-Archivierung wandert vom `archiviert`-Flag in den Status.
-- Migration 0003. Idempotent (IF EXISTS / DROP IF EXISTS).
--
-- 1) Bestehende `archiviert=true`-Datensätze bekommen `status='archiviert'`,
--    damit beim späteren Drop der Spalte keine Information verloren geht.
-- 2) CHECK-Constraint auf `status` wird um 'archiviert' erweitert
--    (anonymen Inline-Constraint suchen, droppen, neu anlegen).
-- 3) Index `artikel_archiviert_idx` und Spalte `archiviert` werden entfernt.

UPDATE artikel SET status = 'archiviert' WHERE archiviert = TRUE;

DO $$
DECLARE
    c_name text;
BEGIN
    SELECT con.conname INTO c_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'artikel'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE 'CHECK (status IN (%';
    IF c_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE artikel DROP CONSTRAINT %I', c_name);
    END IF;
END
$$;

ALTER TABLE artikel
    ADD CONSTRAINT artikel_status_check
    CHECK (status IN ('verfuegbar', 'reserviert', 'gesperrt', 'ausgesondert', 'archiviert'));

DROP INDEX IF EXISTS artikel_archiviert_idx;
ALTER TABLE artikel DROP COLUMN IF EXISTS archiviert;