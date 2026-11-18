import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, run, transaction } from './store.js';

const digest = value => createHash('sha256').update(value.trim()).digest('hex');
const password = z.string().min(10).max(128);

function issue(user, count, lifetime) {
    const codes = Array.from({ length: count }, () => randomBytes(24).toString('base64url'));
    transaction(() => {
        run('DELETE FROM recovery_codes WHERE user=? OR expires<=?', user.id, Date.now());
        for (const code of codes) run('INSERT INTO recovery_codes VALUES(?,?,?)', digest(code), user.id, Date.now() + lifetime);
    });
    return codes;
}

export function publicRecovery(app, { hash, fail }) {
    app.post('/api/auth/recover', (req, res, next) => {
        try {
            const input = z.object({ email: z.string().email().max(200), code: z.string().min(20).max(128), password }).parse(req.body);
            transaction(() => {
                const user = one('SELECT * FROM users WHERE email=?', input.email.toLowerCase());
                const valid = user && one('SELECT hash FROM recovery_codes WHERE hash=? AND user=? AND expires>?', digest(input.code), user.id, Date.now());
                if (!valid) throw fail('E-mail ou código inválido ou expirado');
                run('UPDATE users SET password=? WHERE id=?', hash(input.password), user.id);
                run('DELETE FROM sessions WHERE user=?', user.id);
                run('DELETE FROM recovery_codes WHERE user=?', user.id);
            });
            res.json({ ok: true });
        } catch (error) { next(error); }
    });
}

export function privateRecovery(app, { hash, verify, fail, audit }) {
    app.post('/api/account/password', (req, res, next) => {
        try {
            const input = z.object({ currentPassword: password, password }).parse(req.body);
            if (!verify(input.currentPassword, req.user.password)) throw fail('Senha atual incorreta');
            transaction(() => {
                run('UPDATE users SET password=? WHERE id=?', hash(input.password), req.user.id);
                run('DELETE FROM sessions WHERE user=?', req.user.id);
                run('DELETE FROM recovery_codes WHERE user=?', req.user.id);
                audit(req.user, 'Troca de senha');
            });
            res.clearCookie('session');
            res.json({ ok: true });
        } catch (error) { next(error); }
    });
    app.post('/api/account/recovery-codes', (req, res, next) => {
        try {
            const input = z.object({ currentPassword: password }).parse(req.body);
            if (!verify(input.currentPassword, req.user.password)) throw fail('Senha atual incorreta');
            const codes = issue(req.user, 5, 365 * 86400000);
            res.json({ codes });
        } catch (error) { next(error); }
    });
    app.post('/api/users/:id/recovery-code', (req, res, next) => {
        try {
            if (req.user.role !== 'admin') throw fail('Somente administradores podem emitir códigos', 403);
            const input = z.object({ currentPassword: password }).parse(req.body);
            if (!verify(input.currentPassword, req.user.password)) throw fail('Senha atual incorreta');
            const target = one('SELECT id FROM users WHERE id=? AND org=?', req.params.id, req.user.org);
            if (!target) throw fail('Usuário não encontrado', 404);
            const [code] = issue(target, 1, 30 * 60000);
            audit(req.user, 'Emissão de código temporário de recuperação');
            res.json({ code });
        } catch (error) { next(error); }
    });
}
