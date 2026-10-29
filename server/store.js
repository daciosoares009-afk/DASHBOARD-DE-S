import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || 'data/prumo.sqlite');
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),kind TEXT NOT NULL,parent TEXT REFERENCES records(id),data TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS record_org ON records(org,kind);
CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),task TEXT NOT NULL REFERENCES records(id),user TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,previous REAL NOT NULL,current REAL NOT NULL,executed REAL NOT NULL,note TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,history TEXT NOT NULL REFERENCES history(id),name TEXT NOT NULL,mime TEXT NOT NULL,content TEXT NOT NULL);
`);
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
