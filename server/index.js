import express from 'express';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import XLSX from './excel.js';
import PDFDocument from 'pdfkit';
import { all, one, run, transaction } from './store.js';
import { progress, status, floorCopy } from './domain.js';
import { recordsFor } from './access.js';
const app = express();
app.disable('x-powered-by');
const production = process.env.NODE_ENV === 'production';
if (production && !/^https:\/\/[^/]+$/.test(process.env.APP_ORIGIN || '')) {
    throw new Error('Defina APP_ORIGIN como a origem HTTPS pública, sem barra final.');
}
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (production) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        if (!req.secure) return res.status(400).json({ error: 'Acesse o sistema por HTTPS' });
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    const origin = process.env.APP_ORIGIN || req.protocol + '://' + req.get('host');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== origin)
        return res.status(403).json({ error: 'Origem não permitida' });
    next();
});
app.use(express.json({ limit: '8mb' }));
class RequestError extends Error {
    constructor(message, status) { super(message); this.status = status; }
}
const fail = (message, status = 400) => new RequestError(message, status);
const hash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, stored) => { const [salt, key] = stored.split(':'); return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64)); };
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, org: u.org });
function session(res, user) { const token = randomBytes(32).toString('hex'); run('DELETE FROM sessions WHERE expires<=?', Date.now()); run('INSERT INTO sessions VALUES(?,?,?)', token, user.id, Date.now() + 86400000 * 7); res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 * 7 }); return publicUser(user); }
const attempts = new Map();
app.use('/api/auth', (req, res, next) => { const key = req.ip; const a = attempts.get(key) || { n: 0, time: Date.now() }; if (Date.now() - a.time > 900000) {
    a.n = 0;
    a.time = Date.now();
} a.n++; attempts.set(key, a); if (attempts.size > 10000)
    attempts.clear(); if (a.n > 40)
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }); next(); });
app.get('/api/setup', (req, res) => res.json({ required: !one('SELECT id FROM users LIMIT 1'), registration: !production }));
app.get('/api/health', (req, res) => { one('SELECT 1'); res.json({ ok: true }); });
const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(10).max(128) });
app.post('/api/auth/register', (req, res, next) => { try {
    if (production) throw fail('Cadastro público desativado', 403);
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
    return res.status(401).json({ error: 'Entre para continuar' }); req.user = u; req.sessionToken = token; next(); });
app.get('/api/me', (req, res) => res.json(publicUser(req.user)));
app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE token=? AND user=?', req.sessionToken, req.user.id); res.clearCookie('session'); res.json({ ok: true }); });
const text = z.string().max(2000);
const date = z.iso.date().or(z.literal(''));
const schemas = {
    work: z.object({ name: text.min(2), code: text.min(1), address: text, description: text, owner: text, start: date, end: date, status: z.enum(['Planejada', 'Em andamento', 'Concluída', 'Pausada']) }),
    group: z.object({ name: text.min(2), end: date }),
    task: z.object({ name: text.min(2), location: text, owner: text, start: date, end: date, mode: z.enum(['quantity', 'manual']), planned: z.number().nonnegative(), executed: z.number().nonnegative(), unit: text, percent: z.number().min(0).max(100), weight: z.number().nonnegative(), paused: z.boolean().default(false) }),
    team: z.object({ name: text.min(2), function: text, contact: text, team: text })
};
schemas.stage = schemas.task;
const parentKind = { group: 'work', task: 'group', stage: 'task' };
const activity = kind => kind === 'task' || kind === 'stage';
function record(id, user) {
    if (typeof id !== 'string' || !one('SELECT id FROM records WHERE id=? AND org=? AND archived=0', id, user.org))
        throw fail('Registro não encontrado', 404);
    const row = recordsFor(user).find(item => item.id === id);
    if (!row) throw fail('Você não tem acesso a este registro', 403);
    return row;
}
function audit(user, action, id = null) {
    run('INSERT INTO audit_events VALUES(?,?,?,?,?,?)', randomUUID(), user.org, user.id, id, action, new Date().toISOString());
}
function validateOwner(data, user) {
    if (!data.owner) return;
    if (!one('SELECT id FROM users WHERE id=? AND org=?', data.owner, user.org) &&
        !one("SELECT id FROM records WHERE id=? AND org=? AND kind='team' AND archived=0", data.owner, user.org))
        throw fail('Responsável inválido');
}
function writable(req) { if (!['admin', 'manager'].includes(req.user.role))
    throw fail('Você não tem permissão para esta ação', 403); }
function insert(kind, parent, data, u) { const id = randomUUID(); run('INSERT INTO records(id,org,kind,parent,data) VALUES(?,?,?,?,?)', id, u.org, kind, parent, JSON.stringify(data)); return id; }
function validate(kind, body) { if (!Object.hasOwn(schemas, kind))
    throw fail('Tipo inválido'); const d = schemas[kind].parse(body); if (d.start && d.end && d.end < d.start)
    throw fail('O prazo deve ser posterior ao início'); if (activity(kind) && d.mode === 'quantity' && (d.planned <= 0 || !d.unit.trim() || d.executed > d.planned))
    throw fail('Informe unidade, quantidade prevista positiva e execução até o total previsto'); return d; }
app.get('/api/data', (req, res) => {
    const records = recordsFor(req.user);
    const stageParents = new Set(all("SELECT DISTINCT parent FROM records WHERE org=? AND kind='stage' AND archived=0", req.user.org).map(row => row.parent));
    for (const row of records) if (row.kind === 'task') row.hasStages = stageParents.has(row.id);
    const ids = new Set(recordsFor(req.user, true).map(row => row.id));
    const history = all('SELECT h.*,u.name AS author FROM history h JOIN users u ON u.id=h.user WHERE h.org=? ORDER BY h.created DESC', req.user.org)
        .filter(row => ids.has(row.task));
    const historyIds = new Set(history.map(row => row.id));
    const attachments = all('SELECT a.id,a.history,a.name FROM attachments a JOIN history h ON h.id=a.history WHERE h.org=?', req.user.org)
        .filter(row => historyIds.has(row.history));
    const audit = all('SELECT a.*,u.name AS author FROM audit_events a JOIN users u ON u.id=a.actor WHERE a.org=? ORDER BY a.created DESC LIMIT 200', req.user.org)
        .filter(row => req.user.role === 'admin' || ids.has(row.record));
    const users = req.user.role === 'admin'
        ? all('SELECT id,name,email,role FROM users WHERE org=?', req.user.org)
        : all('SELECT id,name FROM users WHERE org=?', req.user.org);
    if (req.user.role === 'admin') {
        for (const user of users) user.works = all('SELECT work FROM work_access WHERE user=?', user.id).map(row => row.work);
    }
    res.json({ records, history, attachments, audit, users, organization: one('SELECT name FROM organizations WHERE id=?', req.user.org).name });
});
app.post('/api/records/:kind', (req, res, next) => { try {
    writable(req);
    const kind = req.params.kind, d = validate(kind, req.body);
    const parent = req.body.parent || null;
    if (Object.hasOwn(parentKind, kind)) {
        const p = record(parent, req.user);
        if (p.kind !== parentKind[kind])
            throw fail('Vínculo inválido');
        if (kind === 'stage' && (progress(p) > 0 || one('SELECT id FROM history WHERE task=?', p.id)))
            throw fail('O subserviço já possui medições. Cadastre etapas em um subserviço sem medições.');
    }
    else if (parent)
        throw fail('Vínculo inválido');
    if (kind === 'work' && req.user.role !== 'admin') throw fail('Somente administradores podem cadastrar obras', 403);
    if (activity(kind)) {
        validateOwner(d, req.user);
        d.executed = 0;
        d.percent = 0;
    }
    res.json({ id: transaction(() => { const id = insert(kind, parent, d, req.user); audit(req.user, 'Cadastro', id); return id; }) });
}
catch (e) {
    next(e);
} });
app.put('/api/records/:id', (req, res, next) => { try {
    writable(req);
    const r = record(req.params.id, req.user), d = validate(r.kind, req.body);
    if (activity(r.kind)) {
        validateOwner(d, req.user);
        d.executed = r.executed;
        d.percent = r.percent;
        if (d.mode !== r.mode)
            throw fail('O modo de medição não pode ser alterado após o cadastro');
        if (d.mode === 'quantity' && d.planned < d.executed)
            throw fail('A previsão não pode ser menor que a execução registrada');
    }
    transaction(() => { run('UPDATE records SET data=? WHERE id=? AND org=?', JSON.stringify(d), r.id, req.user.org); audit(req.user, 'Edição', r.id); });
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.delete('/api/records/:id', (req, res, next) => { try {
    writable(req);
    const r = record(req.params.id, req.user);
    transaction(() => { const archive = id => { all('SELECT id FROM records WHERE parent=? AND org=?', id, req.user.org).forEach(c => archive(c.id)); run('UPDATE records SET archived=1 WHERE id=? AND org=?', id, req.user.org); }; archive(r.id); audit(req.user, 'Arquivamento', r.id); });
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.post('/api/tasks/:id/measure', (req, res, next) => { try {
    const r = record(req.params.id, req.user);
    if (!activity(r.kind))
        throw fail('Serviço inválido');
    if (req.user.role === 'collaborator' && r.owner !== req.user.id)
        throw fail('Atualize apenas serviços atribuídos a você', 403);
    if (one("SELECT id FROM records WHERE parent=? AND kind='stage' AND archived=0", r.id)) throw fail('Registre a execução nas etapas vinculadas');
    const b = z.object({ value: z.number().nonnegative(), note: text, photos: z.array(z.object({ name: z.string().max(150), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), content: z.string().max(2000000).regex(/^[A-Za-z0-9+/=]+$/) })).max(3).default([]) }).parse(req.body);
    if (b.value > (r.mode === 'quantity' ? r.planned : 100))
        throw fail('Medição acima do limite');
    const before = progress(r);
    if (r.paused) throw fail('Retome a atividade antes de registrar a execução');
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
    const a = one('SELECT a.*, h.task FROM attachments a JOIN history h ON h.id=a.history WHERE a.id=? AND h.org=?', req.params.id, req.user.org);
    if (!a)
        throw fail('Anexo não encontrado', 404);
    if (!recordsFor(req.user, true).some(row => row.id === a.task)) throw fail('Anexo não encontrado', 404);
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
    function copyTask(task, parent, floor) {
        const id = insert('task', parent, floorCopy(task, floor), req.user);
        const stages = all("SELECT id FROM records WHERE parent=? AND org=? AND kind='stage' AND archived=0", task.id, req.user.org);
        for (const stage of stages) insert('stage', id, floorCopy(record(stage.id, req.user), floor), req.user);
    }
    transaction(() => { for (const floor of new Set(b.floors)) {
        if (r.kind === 'task')
            copyTask(r, r.parent, floor);
        else {
            const group = insert('group', r.parent, { name: r.name + ' — ' + String(floor).padStart(2, '0') + 'º pavimento', end: r.end }, req.user);
            all('SELECT id FROM records WHERE parent=? AND org=? AND archived=0', r.id, req.user.org).map(t => record(t.id, req.user)).filter(t => !b.sourceFloor || new RegExp('^0?' + b.sourceFloor + 'º?\\s*(pavimento|pav\\.?)', 'i').test(t.location) || new RegExp('^0?' + b.sourceFloor + 'º?\\s*(pavimento|pav\\.?)', 'i').test(t.name)).forEach(t => copyTask(t, group, floor));
        }
    } audit(req.user, 'Duplicação', r.id); });
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
    audit(req.user, 'Cadastro de usuário');
    res.json({ ok: true });
}
catch (e) {
    next(e);
} });
app.put('/api/users/:id/access', (req, res, next) => {
    try {
        if (req.user.role !== 'admin') throw fail('Somente administradores podem alterar acessos', 403);
        if (req.params.id === req.user.id) throw fail('Seu próprio perfil não pode ser alterado');
        const target = one('SELECT id FROM users WHERE id=? AND org=?', req.params.id, req.user.org);
        if (!target) throw fail('Usuário não encontrado', 404);
        const { role, works } = z.object({
            role: z.enum(['admin', 'manager', 'collaborator']),
            works: z.array(z.string().uuid()).max(1000)
        }).parse(req.body);
        const workIds = role === 'manager' ? new Set(works) : new Set();
        for (const id of workIds) {
            if (record(id, req.user).kind !== 'work') throw fail('Selecione uma obra válida');
        }
        transaction(() => {
            run('UPDATE users SET role=? WHERE id=? AND org=?', role, target.id, req.user.org);
            run('DELETE FROM work_access WHERE user=?', target.id);
            for (const id of workIds) run('INSERT INTO work_access VALUES(?,?)', id, target.id);
            audit(req.user, 'Alteração de permissões');
        });
        res.json({ ok: true });
    } catch (error) {
        next(error);
    }
});
function report(req) { const records = recordsFor(req.user);
    const stageParents = new Set(all("SELECT DISTINCT parent FROM records WHERE org=? AND kind='stage' AND archived=0", req.user.org).map(row => row.parent));
    return records.filter(t => activity(t.kind) && !stageParents.has(t.id)).map(t => {
        const sub = t.kind === 'stage' ? records.find(row => row.id === t.parent) : null;
        const group = records.find(row => row.id === (sub || t).parent);
        const work = records.find(row => row.id === group?.parent);
        return { ...t, name: sub ? sub.name + ' / ' + t.name : t.name, group: group?.name, work: work?.name, workId: work?.id, groupId: group?.id, state: status(t), progress: progress(t) };
    }).filter(t => (!req.query.work || t.workId === req.query.work) && (!req.query.status || t.state === req.query.status) && (!req.query.group || t.groupId === req.query.group) && (!req.query.owner || t.owner === req.query.owner) && (!req.query.from || t.end >= req.query.from) && (!req.query.to || t.end <= req.query.to) && (!req.query.q || (t.name + ' ' + t.location + ' ' + (one('SELECT name FROM users WHERE id=? AND org=?', t.owner, req.user.org)?.name || records.find(r => r.id === t.owner)?.name || 'Não atribuído')).toLowerCase().includes(String(req.query.q).toLowerCase()))).sort((a,b) => req.query.sort === 'end' ? (a.end || '9999').localeCompare(b.end || '9999') : req.query.sort === 'progress' ? b.progress - a.progress : a.name.localeCompare(b.name)); }
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
    if (production) throw new Error('Build de produção não encontrado. Execute npm run build.');
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
}
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join('. ') });
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Solicitação muito grande' });
    console.error('Falha interna', { method: req.method, code: error.code || error.name });
    res.status(500).json({ error: 'Erro interno ao processar a solicitação' });
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log('Evolução Serviços - Torre disponível na porta ' + port));
