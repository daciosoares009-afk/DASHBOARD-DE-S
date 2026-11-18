import { backup, DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, stat, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db } from './store.js';

export const backupDirectory = process.env.BACKUP_DIR || join(dirname(process.env.DB_PATH || 'data/prumo.sqlite'), 'backups');
let running = false;
let lastError = null;
const pattern = /^torre-\d{4}-\d{2}-\d{2}\.sqlite$/;

export async function backupStatus() {
    const files = await readdir(backupDirectory).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    const names = files.filter(name => pattern.test(name)).sort().reverse();
    const latest = names[0] ? (await stat(join(backupDirectory, names[0]))).mtime.toISOString() : null;
    return { enabled: process.env.BACKUP_ENABLED !== 'false', running, latest, count: names.length, lastError };
}

export async function dailyBackup() {
    if (running) return backupStatus();
    running = true;
    const name = 'torre-' + new Date().toISOString().slice(0, 10) + '.sqlite';
    const temporary = join(backupDirectory, name + '.partial');
    try {
        await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
        const names = await readdir(backupDirectory);
        if (names.includes(name)) return await backupStatus();
        await backup(db, temporary);
        const copy = new DatabaseSync(temporary);
        try {
            // A cópia final deve poder ser restaurada como um arquivo único.
            copy.exec('PRAGMA journal_mode=DELETE');
            if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
                copy.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup inconsistente');
        } finally { copy.close(); }
        await rename(temporary, join(backupDirectory, name));
        const retained = [...names.filter(file => pattern.test(file)), name].sort().reverse();
        for (const old of retained.slice(7)) await unlink(join(backupDirectory, old));
        lastError = null;
        console.log('Backup diário concluído');
    } catch (error) {
        lastError = 'Falha ao gerar backup. Verifique os logs e o espaço do volume.';
        console.error('Falha no backup', { code: error.code || error.name });
        await unlink(temporary).catch(() => {});
        throw error;
    } finally { running = false; }
    return backupStatus();
}

export function scheduleBackups() {
    if (process.env.BACKUP_ENABLED === 'false' || process.env.NODE_ENV !== 'production') return;
    void dailyBackup().catch(() => {});
    // Verifica a mudança de dia a cada hora e recupera execuções perdidas.
    setInterval(() => { void dailyBackup().catch(() => {}); }, 3600000).unref();
}
