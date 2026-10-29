import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const folder = mkdtempSync(join(tmpdir(), 'prumo-test-'));
let processHandle;
const port = 3150 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}/api`;
async function launch() { processHandle = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DB_PATH: join(folder, 'test.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] }); await new Promise((resolve, reject) => { let out = ''; const timeout = setTimeout(() => reject(new Error('Servidor não iniciou: ' + out)), 20000); processHandle.stdout.on('data', b => { out += b; if (out.includes('disponível')) {
    clearTimeout(timeout);
    resolve();
} }); processHandle.stderr.on('data', b => out += b); processHandle.on('exit', () => { clearTimeout(timeout); reject(new Error(out)); }); }); }
async function stop() { if (!processHandle || processHandle.exitCode !== null)
    return; await new Promise(resolve => { processHandle.once('exit', resolve); processHandle.kill(); }); }
async function request(path, method = 'GET', body, cookie) { const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const value = res.headers.get('content-type')?.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()); return { status: res.status, value, cookie: res.headers.get('set-cookie')?.split(';')[0] }; }
test('API: persistência, isolamento, medições, duplicação, permissões e exportação', async (t) => {
    try {
        await launch();
        assert.equal((await request('/data')).status, 401);
        let a = await request('/auth/register', 'POST', { name: 'Administrador teste', organization: 'Organização de teste', email: 'admin@example.test', password: 'Teste-seguro-123' });
        assert.equal(a.status, 200);
        const cookie = a.cookie;
        const w = await request('/records/work', 'POST', { name: 'Obra teste', code: 'T-01', address: 'Endereço teste', description: '', owner: 'Engenheiro teste', start: '2026-01-01', end: '2027-01-01', status: 'Em andamento' }, cookie);
        assert.equal(w.status, 200);
        const g = await request('/records/group', 'POST', { name: 'Pintura', end: '2027-01-01', parent: w.value.id }, cookie);
        assert.equal(g.status, 200);
        const body = { name: '01º pavimento — Hall', location: '01º pavimento — Hall', owner: '', start: '2026-01-01', end: '2027-01-01', mode: 'quantity', planned: 500, executed: 0, unit: 'm²', percent: 0, weight: 1, parent: g.value.id };
        const s = await request('/records/task', 'POST', body, cookie);
        assert.equal(s.status, 200);
        assert.equal((await request('/tasks/' + s.value.id + '/measure', 'POST', { value: 600, note: '' }, cookie)).status, 400);
        assert.equal((await request('/tasks/' + s.value.id + '/measure', 'POST', { value: 350, note: 'Paredes concluídas' }, cookie)).status, 200);
        assert.equal((await request('/records/' + g.value.id + '/duplicate', 'POST', { floors: [2, 3] }, cookie)).status, 200);
        let data = (await request('/data', 'GET', undefined, cookie)).value;
        assert.equal(data.records.filter(r => r.kind === 'task').length, 3);
        assert.equal(data.history.length, 1);
        assert.equal(data.history[0].current, 70);
        assert.equal(data.records.find(r => r.name === '02º pavimento — Hall').executed, 0);
        assert.equal((await request('/users', 'POST', { name: 'Colaborador teste', email: 'worker@example.test', password: 'Teste-seguro-123', role: 'collaborator' }, cookie)).status, 200);
        const c = await request('/auth/login', 'POST', { email: 'worker@example.test', password: 'Teste-seguro-123' });
        assert.equal((await request('/records/work', 'POST', {}, c.cookie)).status, 403);
        assert.equal((await request('/tasks/' + s.value.id + '/measure', 'POST', { value: 20, note: '' }, c.cookie)).status, 403);
        const other = await request('/auth/register', 'POST', { name: 'Outra pessoa', organization: 'Outra organização', email: 'other@example.test', password: 'Teste-seguro-123' });
        assert.equal((await request('/data', 'GET', undefined, other.cookie)).value.records.length, 0);
        assert.equal((await request('/records/' + s.value.id, 'PUT', body, other.cookie)).status, 404);
        const xlsx = await request('/reports/xlsx?work=' + w.value.id, 'GET', undefined, cookie);
        assert.equal(xlsx.status, 200);
        assert.equal(String.fromCharCode(...xlsx.value.slice(0, 2)), 'PK');
        const pdf = await request('/reports/pdf', 'GET', undefined, cookie);
        assert.equal(pdf.status, 200);
        assert.equal(String.fromCharCode(...pdf.value.slice(0, 4)), '%PDF');
        await stop();
        await launch();
        data = (await request('/data', 'GET', undefined, cookie)).value;
        assert.equal(data.history.length, 1);
        assert.equal(data.records.find(r => r.id === s.value.id).executed, 350);
        assert.equal((await request('/records/' + w.value.id, 'DELETE', undefined, cookie)).status, 200);
        data = (await request('/data', 'GET', undefined, cookie)).value;
        assert.equal(data.records.filter(r => r.kind === 'task').length, 0);
        assert.equal(data.history.length, 1);
    }
    finally {
        await stop();
        rmSync(folder, { recursive: true, force: true });
    }
});
