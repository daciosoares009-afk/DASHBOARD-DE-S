import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';

export function PasswordRecovery({ onBack }: { onBack: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (form.get('password') !== form.get('confirm')) { setError('As senhas devem ser iguais'); return; }
        setBusy(true); setError('');
        try {
            await api('/auth/recover', 'POST', Object.fromEntries(form));
            setSuccess(true);
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <section className="recovery-page">
        <h2>Recuperar senha</h2>
        <p>Use um código que você guardou em Configurações. Um administrador da sua organização também pode emitir um código temporário para você.</p>
        {error && <div className="error" role="alert">{error}</div>}
        {success ? <p role="status">Senha atualizada. Entre com a nova senha e gere novos códigos em Configurações.</p> :
            <form onSubmit={submit}>
                <label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={200}/></label>
                <label>Código de recuperação<input name="code" required minLength={20} maxLength={128} autoComplete="off"/></label>
                <label>Nova senha<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required/></label>
                <label>Confirmar nova senha<input name="confirm" type="password" minLength={10} maxLength={128} autoComplete="new-password" required/></label>
                <button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
            </form>}
        <button className="auth-switch" onClick={onBack}>Voltar ao login</button>
    </section>;
}

export function SecuritySettings({ users, admin, onPasswordChanged }: {
    users: { id: string; name: string }[]; admin: boolean; onPasswordChanged: () => void;
}) {
    const [error, setError] = useState('');
    const [codes, setCodes] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [target, setTarget] = useState('');
    const [backups, setBackups] = useState<any>(null);
    useEffect(() => {
        if (admin) api('/operations').then(result => setBackups(result.backups)).catch(error => setError(error.message));
    }, [admin]);
    async function submit(event: FormEvent<HTMLFormElement>, action: 'password' | 'codes') {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        if (action === 'password' && form.get('password') !== form.get('confirm')) { setError('As senhas devem ser iguais'); return; }
        setBusy(true); setError(''); setCodes([]);
        try {
            const path = action === 'password' ? '/account/password' : target ? '/users/' + target + '/recovery-code' : '/account/recovery-codes';
            const result = await api(path, 'POST', Object.fromEntries(form));
            if (action === 'password') onPasswordChanged();
            else { setCodes(result.codes || [result.code]); element.reset(); }
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    return <div className="settings-grid security-settings">
        <section className="panel settings">
            <h2>Trocar senha</h2>
            <p>A troca encerra as sessões abertas. Entre novamente com a nova senha.</p>
            {error && <div className="error" role="alert">{error}</div>}
            <form onSubmit={event => submit(event, 'password')}>
                <label>Senha atual<input name="currentPassword" type="password" required autoComplete="current-password" minLength={10} maxLength={128}/></label>
                <label>Nova senha<input name="password" type="password" required autoComplete="new-password" minLength={10} maxLength={128}/></label>
                <label>Confirmar nova senha<input name="confirm" type="password" required autoComplete="new-password" minLength={10} maxLength={128}/></label>
                <button className="primary" disabled={busy}>Salvar nova senha</button>
            </form>
        </section>
        <section className="panel settings">
            <h2>Códigos de recuperação</h2>
            <p>Guarde seus códigos em local privado. Válidos por um ano, eles substituem sua senha na recuperação. Ao recuperar a conta, todos os códigos anteriores são invalidados.</p>
            <form onSubmit={event => submit(event, 'codes')}>
                {admin && <label>Conta<select value={target} onChange={event => { setTarget(event.target.value); setCodes([]); }}>
                    <option value="">Minha conta — gerar cinco códigos</option>
                    {users.map(user => <option key={user.id} value={user.id}>{user.name} — código temporário de 30 minutos</option>)}
                </select></label>}
                <label>Sua senha atual<input name="currentPassword" type="password" autoComplete="current-password" minLength={10} maxLength={128} required/></label>
                <button className="subtle" disabled={busy}>Gerar códigos</button>
            </form>
            {!!codes.length && <div className="recovery-codes" role="status"><p>Copie agora. Ao gerar novos códigos, os anteriores são invalidados.</p>{codes.map(code => <code key={code}>{code}</code>)}</div>}
        </section>
        {admin && <section className="panel settings"><h2>Backups automáticos</h2>
            <p>Cópia diária no volume persistente, com retenção das últimas sete cópias. Uma perda do volume também afeta essas cópias.</p>
            <p>Última cópia {backups?.latest ? new Date(backups.latest).toLocaleString('pt-BR') : 'ainda não registrada'}</p>
            {backups?.lastError && <div className="error">{backups.lastError}</div>}
            <button className="subtle" disabled={busy} onClick={async () => {
                setBusy(true); setError('');
                try { setBackups(await api('/operations/backup', 'POST')); }
                catch (error) { setError((error as Error).message); }
                finally { setBusy(false); }
            }}>Conferir backup de hoje</button>
        </section>}
    </div>;
}
