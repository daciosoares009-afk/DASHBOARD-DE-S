import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('backup consistente pode ser restaurado, é diário e retém sete cópias', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'torre-backup-test-'));
    process.env.DB_PATH = join(directory, 'source.sqlite');
    process.env.BACKUP_DIR = directory;
    const { db, run } = await import('../server/store.js');
    const { dailyBackup } = await import('../server/backups.js');
    try {
        run('INSERT INTO organizations VALUES(?,?)', 'test', 'Teste de restauração');
        for (let day = 1; day <= 9; day++) writeFileSync(join(directory, 'torre-2000-01-0' + day + '.sqlite'), '');
        await Promise.all([dailyBackup(), dailyBackup()]);
        const copies = readdirSync(directory).filter(name => /^torre-.*\.sqlite$/.test(name));
        assert.equal(copies.length, 7);
        const latest = copies.sort().at(-1);
        const restored = new DatabaseSync(join(directory, latest), { readOnly: true });
        try {
            assert.equal(restored.prepare('SELECT name FROM organizations WHERE id=?').get('test').name, 'Teste de restauração');
            assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        } finally { restored.close(); }
        await dailyBackup();
        assert.equal(readdirSync(directory).filter(name => /^torre-.*\.sqlite$/.test(name)).length, 7);
    } finally {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
