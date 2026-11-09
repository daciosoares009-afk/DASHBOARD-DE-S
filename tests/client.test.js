import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../src/api.ts';

test('cliente distingue falha de conexão, resposta inválida e erro de login', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
    await assert.rejects(api('/auth/login', 'POST', {}), /Verifique a conexão/);
    fetch.mock.mockImplementation(async () => new Response('The page could not be loaded', { status: 502 }));
    await assert.rejects(api('/auth/login', 'POST', {}), /Verifique a conexão/);
    fetch.mock.mockImplementation(async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(api('/auth/login', 'POST', {}), /Verifique a conexão/);
    fetch.mock.mockImplementation(async () => Response.json({ error: 'E-mail ou senha incorretos' }, { status: 401 }));
    await assert.rejects(api('/auth/login', 'POST', {}), /E-mail ou senha incorretos/);
});
