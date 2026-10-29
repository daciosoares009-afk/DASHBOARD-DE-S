import express from 'express';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import XLSX from './excel.js';
import PDFDocument from 'pdfkit';
import { all, one, run, transaction } from './store.js';
import { progress, aggregate, status, floorCopy } from './domain.js';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    return res.status(403).json({ error: 'Origem não permitida' }); next(); });
const fail = (message, code = 400) => Object.assign(new Error(message), { code });
const hash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, stored) => { const [salt, key] = stored.split(':'); return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64)); };
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, org: u.org });
function session(res, user) { const token = randomBytes(32).toString('hex'); run('INSERT INTO sessions VALUES(?,?,?)', token, user.id, Date.now() + 86400000 * 7); res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 * 7 }); return publicUser(user); }
const attempts = new Map();
app.use('/api/auth', (req, res, next) => { const key = req.ip; const a = attempts.get(key) || { n: 0, time: Date.now() }; if (Date.now() - a.time > 900000) {
    a.n = 0;
    a.time = Date.now();
} a.n++; attempts.set(key, a); if (attempts.size > 10000)
    attempts.clear(); if (a.n > 40)
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }); next(); });
app.get('/api/setup', (req, res) => res.json({ required: !one('SELECT id FROM users LIMIT 1') }));
const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(10).max(128) });
app.post('/api/auth/register', (req, res, next) => { try {
    const b = credentials.extend({ name: z.string().min(2).max(120), organization: z.string().min(2).max(150) }).parse(req.body);
    const user = transaction(() => { if (one('SELECT id FROM users WHERE email=?', b.email.toLowerCase()))
        throw fail('E-mail já cadastrado'); const org = randomUUID(); run('INSERT INTO organizations VALUES(?,?)', org, b.organization); const u = { id: randomUUID(), org, name: b.name, email: b.email.toLowerCase(), password: hash(b.password), role: 'admin' }; run('INSERT INTO users VALUES(?,?,?,?,?,?)', u.id, u.org, u.name, u.email, u.password, u.role); return u; });
    res.json(session(res, user));
}
catch (e) {
    next(e);
} });
app.post('/api/auth/login', (req, res, next) => { try {
    const b = credentials.parse(req.body);
    const u = one('SELECT * FROM users WHERE email=?', b.email.toLowerCase());
    if (!u || !verify(b.password, u.password))
        throw fail('E-mail ou senha incorretos', 401);
    res.json(session(res, u));
}
catch (e) {
    next(e);
} });
app.use('/api', (req, res, next) => { const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('session='))?.slice(8); const u = one('SELECT users.* FROM users JOIN sessions ON sessions.user=users.id WHERE token=? AND expires>?', token || '', Date.now()); if (!u)
    return res.status(401).json({ error: 'Entre para continuar' }); req.user = u; next(); });
app.get('/api/me', (req, res) => res.json(publicUser(req.user)));
app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE user=?', req.user.id); res.clearCookie('session'); res.json({ ok: true }); });
const text = z.string().max(2000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)), 'Data inválida').or(z.literal(''));
const schemas = {
    work: z.object({ name: text.min(2), code: text.min(1), address: text, description: text, owner: text, start: date, end: date, status: z.enum(['Planejada', 'Em andamento', 'Concluída', 'Pausada']) }),
    group: z.object({ name: text.min(2), end: date }),
    task: z.object({ name: text.min(2), location: text, owner: text, start: date, end: date, mode: z.enum(['quantity', 'manual']), planned: z.number().nonnegative(), executed: z.number().nonnegative(), unit: text, percent: z.number().min(0).max(100), weight: z.number().nonnegative() }),
    team: z.object({ name: text.min(2), function: text, contact: text, team: text })
};
function record(id, u) { const r = one('SELECT * FROM records WHERE id=? AND org=? AND archived=0', id, u.org); if (!r)
    throw fail('Registro não encontrado', 404); return { ...JSON.parse(r.data), id: r.id, parent: r.parent, kind: r.kind }; }
function writable(req) { if (!['admin', 'manager'].includes(req.user.role))
    throw fail('Você não tem permissão para esta ação', 403); }
function insert(kind, parent, data, u) { const id = randomUUID(); run('INSERT INTO records(id,org,kind,parent,data) VALUES(?,?,?,?,?)', id, u.org, kind, parent, JSON.stringify(data)); return id; }
function validate(kind, body) { if (!schemas[kind])
    throw fail('Tipo inválido'); const d = schemas[kind].parse(body); if (d.start && d.end && d.end < d.start)
    throw fail('O prazo deve ser posterior ao início'); if (kind === 'task' && d.mode === 'quantity' && (d.planned <= 0 || !d.unit.trim() || d.executed > d.planned))
    throw fail('Informe unidade, quantidade prevista positiva e execução até o total previsto'); return d; }
app.get('/api/data', (req, res) => { const records = all('SELECT * FROM records WHERE org=? AND archived=0', req.user.org).map(r => ({ ...JSON.parse(r.data), id: r.id, kind: r.kind, parent: r.parent })); const history = all('SELECT h.*,u.name AS author FROM history h JOIN users u ON u.id=h.user WHERE h.org=? ORDER BY h.created DESC', req.user.org); const attachments = all('SELECT a.id,a.history,a.name FROM attachments a JOIN history h ON h.id=a.history WHERE h.org=?', req.user.org); res.json({ records, history, attachments, users: all('SELECT id,name,email,role FROM users WHERE org=?', req.user.org), organization: one('SELECT name FROM organizations WHERE id=?', req.user.org).name }); });
app.post('/api/records/:kind', (req, res, next) => { try {
    writable(req);
    const kind = req.params.kind, d = validate(kind, req.body);
    const parent = req.body.parent || null;
    if (['group', 'task'].includes(kind)) {
        const p = record(parent, req.user);
        if (p.kind !== (kind === 'group' ? 'work' : 'group'))
            throw fail('Vínculo inválido');
    }
    else if (parent)
        throw fail('Vínculo inválido');
    if (kind === 'task') {
        d.executed = 0;
        d.percent = 0;
    }
    res.json({ id: insert(kind, parent, d, req.user) });
}
catch (e) {
    next(e);
} });
app.put('/api/records/:id', (req, res, next) => { try {
    writable(req);
    const r = record(req.params.id, req.user), d = validate(r.kind, req.body);
    if (r.kind === 'task') {
        d.executed = r.executed;
        d.percent = r.percent;
        if (d.mode !== r.mode)
            throw fail('O modo de medição não pode ser alterado após o cadastro');
        if (d.mode === 'quantity' && d.planned < d.executed)
            throw fail('A previsão não pode ser menor que a execução registrada');
    }
    run('UPDATE records SET data=? WHERE id=? AND org=?', JSON.stringify(d), r.id, req.user.org);
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.delete('/api/records/:id', (req, res, next) => { try {
    writable(req);
    const r = record(req.params.id, req.user);
    transaction(() => { const archive = id => { all('SELECT id FROM records WHERE parent=? AND org=?', id, req.user.org).forEach(c => archive(c.id)); run('UPDATE records SET archived=1 WHERE id=? AND org=?', id, req.user.org); }; archive(r.id); });
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.post('/api/tasks/:id/measure', (req, res, next) => { try {
    const r = record(req.params.id, req.user);
    if (r.kind !== 'task')
        throw fail('Serviço inválido');
    if (req.user.role === 'collaborator' && r.owner !== req.user.id)
        throw fail('Atualize apenas serviços atribuídos a você', 403);
    const b = z.object({ value: z.number().nonnegative(), note: text, photos: z.array(z.object({ name: z.string().max(150), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), content: z.string().max(2000000).regex(/^[A-Za-z0-9+/=]+$/) })).max(3).default([]) }).parse(req.body);
    if (b.value > (r.mode === 'quantity' ? r.planned : 100))
        throw fail('Medição acima do limite');
    const before = progress(r);
    if (r.mode === 'quantity')
        r.executed = b.value;
    else
        r.percent = b.value;
    const id = randomUUID();
    transaction(() => { run('UPDATE records SET data=? WHERE id=? AND org=?', JSON.stringify(r), r.id, req.user.org); run('INSERT INTO history VALUES(?,?,?,?,?,?,?,?,?)', id, req.user.org, r.id, req.user.id, new Date().toISOString(), before, progress(r), r.executed, b.note); b.photos.forEach(p => run('INSERT INTO attachments VALUES(?,?,?,?,?)', randomUUID(), id, p.name, p.mime, p.content)); });
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.get('/api/attachments/:id', (req, res, next) => { try {
    const a = one('SELECT a.* FROM attachments a JOIN history h ON h.id=a.history WHERE a.id=? AND h.org=?', req.params.id, req.user.org);
    if (!a)
        throw fail('Anexo não encontrado', 404);
    res.setHeader('Content-Type', a.mime);
    res.send(Buffer.from(a.content, 'base64'));
}
catch (e) {
    next(e);
} });
app.post('/api/records/:id/duplicate', (req, res, next) => { try {
    writable(req);
    const r = record(req.params.id, req.user);
    if (!['group', 'task'].includes(r.kind))
        throw fail('Selecione um serviço');
    const b = z.object({ floors: z.array(z.number().int().min(1).max(200)).min(1).max(50), sourceFloor: z.number().int().min(1).max(200).optional() }).parse(req.body);
    transaction(() => { for (const floor of new Set(b.floors)) {
        if (r.kind === 'task')
            insert('task', r.parent, floorCopy(r, floor), req.user);
        else {
            const group = insert('group', r.parent, { name: r.name + ' — ' + String(floor).padStart(2, '0') + 'º pavimento', end: r.end }, req.user);
            all('SELECT id FROM records WHERE parent=? AND org=? AND archived=0', r.id, req.user.org).map(t => record(t.id, req.user)).filter(t => !b.sourceFloor || new RegExp('^0?' + b.sourceFloor + 'º?\\s*(pavimento|pav\\.?)', 'i').test(t.location) || new RegExp('^0?' + b.sourceFloor + 'º?\\s*(pavimento|pav\\.?)', 'i').test(t.name)).forEach(t => insert('task', group, floorCopy(t, floor), req.user));
        }
    } });
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.post('/api/users', (req, res, next) => { try {
    if (req.user.role !== 'admin')
        throw fail('Somente administradores podem cadastrar usuários', 403);
    const b = credentials.extend({ name: text.min(2), role: z.enum(['admin', 'manager', 'collaborator']) }).parse(req.body);
    if (one('SELECT id FROM users WHERE email=?', b.email.toLowerCase()))
        throw fail('E-mail já cadastrado');
    run('INSERT INTO users VALUES(?,?,?,?,?,?)', randomUUID(), req.user.org, b.name, b.email.toLowerCase(), hash(b.password), b.role);
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
function report(req) { const records = all('SELECT * FROM records WHERE org=? AND archived=0', req.user.org).map(r => ({ ...JSON.parse(r.data), id: r.id, kind: r.kind, parent: r.parent })); return records.filter(t => t.kind === 'task').map(t => { const group = records.find(g => g.id === t.parent); const work = records.find(w => w.id === group?.parent); return { ...t, group: group?.name, work: work?.name, workId: work?.id, state: status(t), progress: progress(t) }; }).filter(t => (!req.query.work || t.workId === req.query.work) && (!req.query.status || t.state === req.query.status) && (!req.query.from || t.end >= req.query.from) && (!req.query.to || t.end <= req.query.to) && (!req.query.q || (t.name + ' ' + t.location + ' ' + (one('SELECT name FROM users WHERE id=? AND org=?', t.owner, req.user.org)?.name || records.find(r => r.id === t.owner)?.name || 'Não atribuído')).toLowerCase().includes(String(req.query.q).toLowerCase()))).sort((a,b) => req.query.sort === 'end' ? (a.end || '9999').localeCompare(b.end || '9999') : req.query.sort === 'progress' ? b.progress - a.progress : a.name.localeCompare(b.name)); }
app.get('/api/reports/:format', (req, res, next) => { try {
    const tasks = report(req);
    const rows = tasks.map(t => ({ 'Obra': t.work, 'Serviço': t.group, 'Atividade': t.name, 'Local': t.location, 'Responsável': one('SELECT name FROM users WHERE id=? AND org=?', t.owner, req.user.org)?.name || all('SELECT data FROM records WHERE id=? AND org=?', t.owner, req.user.org).map(r => JSON.parse(r.data).name)[0] || 'Não atribuído', 'Prazo': t.end, 'Status': t.state, 'Progresso (%)': Math.round(t.progress), 'Previsto': t.planned, 'Executado': t.executed, 'Unidade': t.unit }));
    if (req.params.format === 'xlsx') {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Serviços');
        const ids = new Set(tasks.map(t => t.id));
        const logs = all('SELECT h.*,u.name AS author FROM history h JOIN users u ON u.id=h.user WHERE h.org=? ORDER BY created', req.user.org).filter(h => ids.has(h.task) && (!req.query.from || h.created.slice(0, 10) >= req.query.from) && (!req.query.to || h.created.slice(0, 10) <= req.query.to)).map(h => ({ 'Atividade': tasks.find(t => t.id === h.task)?.name, 'Data': h.created, 'Usuário': h.author, 'Anterior (%)': h.previous, 'Atual (%)': h.current, 'Quantidade': h.executed, 'Observação': h.note }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logs), 'Histórico');
        res.attachment('evolucao-servicos-torre-relatorio.xlsx');
        res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }
    else if (req.params.format === 'pdf') {
        res.attachment('evolucao-servicos-torre-relatorio.pdf');
        res.type('pdf');
        const doc = new PDFDocument({ margin: 40 });
        doc.pipe(res);
        doc.fontSize(24).text('Evolução Serviços - Torre | Relatório de execução');
        doc.fontSize(10).text(`Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} • ${rows.length} atividades`);
        doc.moveDown();
        rows.forEach(r => { if (doc.y > 680)
            doc.addPage(); doc.fontSize(12).text(`${r.Obra} / ${r.Serviço}`); doc.fontSize(10).text(`${r.Atividade} — ${r.Local}\n${r.Status} | ${r['Progresso (%)']}% | Prazo: ${r.Prazo || 'Sem prazo'}\nResponsável: ${r['Responsável']} | ${r.Executado}/${r.Previsto} ${r.Unidade}`).moveDown(); });
        doc.end();
    }
    else
        throw fail('Formato inválido');
}
catch (e) {
    next(e);
} });
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint não encontrado' }));
if (existsSync('dist/index.html')) {
    app.use(express.static('dist'));
    app.get('*', (req, res) => res.sendFile(resolve('dist/index.html')));
}
else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
}
app.use((error, req, res, next) => { if (res.headersSent)
    return next(error); res.status(error instanceof z.ZodError ? 400 : error.code || 500).json({ error: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : error.code ? error.message : 'Erro interno ao processar a solicitação' }); if (!error.code && !(error instanceof z.ZodError))
    console.error(error); });
app.listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => console.log('Evolução Serviços - Torre disponível em http://localhost:3000'));



