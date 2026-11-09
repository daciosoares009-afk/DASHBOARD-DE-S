import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
const databasePath = process.env.DB_PATH || 'data/prumo.sqlite';
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL');
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const one = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
export function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try {
    const result = fn();
    db.exec('COMMIT');
    return result;
}
catch (e) {
    db.exec('ROLLBACK');
    throw e;
} }

const migrations = new URL('./migrations/', import.meta.url);
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
for (const version of readdirSync(migrations).filter(name => /^\d+-.+\.sql$/.test(name)).sort()) {
    transaction(() => {
        if (one('SELECT version FROM schema_migrations WHERE version=?', version)) return;
        db.exec(readFileSync(new URL(version, migrations), 'utf8'));
        run('INSERT INTO schema_migrations VALUES(?,?)', version, new Date().toISOString());
    });
}
