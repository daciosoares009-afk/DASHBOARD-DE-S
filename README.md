# Evolução Serviços - Torre

Aplicação React + TypeScript com API Node.js e SQLite. Requer Node.js 24.15 ou superior.

## Executar localmente

```powershell
npm ci
npm run migrate
npm run build
npm start
```

Abra http://localhost:3000. O sistema usa a base existente por padrão. Para uma base nova, crie a primeira conta e organização pela tela de acesso local. Em produção, novos usuários são cadastrados pelo administrador em **Configurações**.

O servidor aplica as migrações pendentes na inicialização. O comando `npm run migrate` também pode ser usado separadamente. `npm run dev` usa Vite quando a pasta `dist` ainda não existe.

## Operação

- Em **Obras**, cadastre ou edite o projeto, abra seus serviços ou arquive o cadastro. Arquivamento retira a obra e seus descendentes das telas operacionais e preserva o histórico.
- Em **Serviços**, crie o serviço principal, adicione o subserviço e use **Etapa** se precisar de uma divisão adicional. Os subserviços existentes aceitam medição direta. Ao incluir etapas, registre a execução nelas. Para preservar medições anteriores, o sistema só permite adicionar etapas a subserviços sem histórico de execução.
- Progresso usa quantidades previstas quando as unidades são comparáveis. Para itens de unidades diferentes ou medição manual, configure pesos positivos para cada item. Um item isolado usa seu próprio percentual. Nos demais casos sem base de ponderação, a interface indica que o cálculo está indisponível.
- Relatórios PDF e Excel e indicadores usam os registros do banco. Os filtros incluem obra, serviço, responsável, status, busca e, no cronograma e relatórios, intervalo de prazo.
- Em **Configurações → Permissões**, o administrador define o perfil e as obras autorizadas para cada gestor. O gestor começa sem acesso a obras até receber autorização. Colaboradores veem atividades atribuídas a seu usuário e sua hierarquia. O vínculo a um profissional de equipe é informativo e não concede acesso.

## Banco e segurança

O SQLite usa chaves estrangeiras, transações e WAL. `server/migrations` contém o esquema inicial e as alterações incrementais, registradas em `schema_migrations`. O modelo usa `organizations`, `users`, `sessions`, `records` com vínculo de pai, `history`, `attachments`, `work_access` e `audit_events`. Fotos ficam no banco e seguem o acesso da atividade vinculada. Eventos administrativos registram operação, autor e horário.

A API valida dados, origem e permissão. Senhas usam scrypt com salt. Cookies de sessão são HttpOnly, SameSite Strict e, em produção, Secure. HTTPS, cabeçalhos de segurança e ausência de cache nas respostas privadas são aplicados em produção. O limite de tentativas de login fica em memória por processo. Erros internos são registrados sem corpos de requisição, e-mails ou senhas.

## Variáveis e backup

O arquivo `.env.example` lista a configuração. `DB_PATH` aponta para o SQLite e tem padrão `data/prumo.sqlite`. `PORT` e `HOST` definem onde o servidor escuta. `NODE_ENV=production` exige `APP_ORIGIN` com a origem HTTPS pública. Use `TRUST_PROXY=1` apenas atrás de um único proxy confiável, com a porta da aplicação inacessível externamente.

```powershell
npm run backup -- ./torre-backup.sqlite
```

O comando cria uma cópia consistente, inclusive com a aplicação em execução. Use um novo destino a cada backup. Agende cópias fora do servidor e verifique restauração antes do uso em equipe. Para restaurar, pare a aplicação e use um diretório de dados limpo com a cópia como `prumo.sqlite`, sem misturá-la com arquivos WAL de outra base.

## Deploy preparado para servidor com disco persistente

1. Prepare um servidor com Docker Compose, domínio apontado para ele e portas 80 e 443 abertas. Use um único processo de aplicação.
2. Crie uma cópia consistente da base pelo comando acima. Transfira a cópia por canal privado para `./data/prumo.sqlite` no servidor. Para uma instalação vazia, crie a organização inicial localmente e transfira essa base.
3. Garanta que o usuário do contêiner (UID 1000) pode gravar em `./data`. Defina `DOMAIN` no arquivo `.env` do servidor com o domínio, sem protocolo.
4. Execute `docker compose up -d --build`. O Caddy emite o certificado e encaminha para a aplicação. A migração ocorre na inicialização e o contêiner verifica `/api/health`.
5. Confira `docker compose ps`, `docker compose logs app proxy` e a rota HTTPS `/api/health`. Valide login, obra Torre, permissões e exportação antes de liberar usuários.

O Dockerfile, Compose e Caddyfile preparam o deploy. A aplicação depende de um disco gravável durável e, por isso, o procedimento usa servidor persistente em vez de Vercel serverless. PostgreSQL/Supabase, recuperação de senha, backup agendado e monitoramento externo ficam para etapas futuras.

## Verificações

```powershell
npm run lint
npm run build
npm test
```

O comando `lint` faz a checagem estática TypeScript. Os testes de integração usam um SQLite temporário e um servidor em loopback, sem acessar a base de uso.
