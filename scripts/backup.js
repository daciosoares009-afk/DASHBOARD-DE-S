import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = process.argv[2];
if (!destination || existsSync(destination)) {
    throw new Error('Informe um caminho novo para o arquivo de backup.');
}
const source = resolve(process.env.DB_PATH || 'data/prumo.sqlite');
if (!existsSync(source)) throw new Error('Banco de origem não encontrado.');
const db = new DatabaseSync(source, { readOnly: true });
try {
    await backup(db, resolve(destination));
    console.log('Backup concluído.');
} finally {
    db.close();
}
