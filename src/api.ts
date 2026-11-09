export async function api(path: string, method = 'GET', body?: any) {
    const unavailable = 'Não foi possível conectar ao sistema. Verifique a conexão e tente novamente.';
    const res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    }).catch(() => { throw new Error(unavailable); });
    if (!res.headers.get('Content-Type')?.includes('application/json')) throw new Error(unavailable);
    const data = await res.json().catch(() => { throw new Error(unavailable); });
    if (!res.ok) throw new Error(data?.error || 'Não foi possível concluir a solicitação.');
    return data;
}
