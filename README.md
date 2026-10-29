# Evolução Serviços - Torre

Aplicação local full-stack, em português, com React + TypeScript, API REST em Node.js e SQLite. Requer **Node.js 24.15 ou superior** (usa `node:sqlite`).

## Executar

```powershell
npm install
npm run dev
```

Abra http://localhost:3000 e clique em **Criar uma conta e organização**. Não existem usuários, senhas ou obras pré-cadastrados. O cadastro cria uma organização isolada e seu administrador.

```powershell
npm run build
npm start
npm test
```

Quando existe `dist/index.html`, o servidor entrega o build. Sem `dist`, integra o Vite para desenvolvimento. Após alterações, execute novamente `npm run build` para atualizar a versão servida.

## Fluxo principal

1. Cadastre uma obra com código, endereço, responsável, datas e status.
2. Em Serviços, selecione a obra e crie um serviço principal.
3. Adicione atividades pelo botão Atividade; informe local, responsável, datas e método de medição.
4. Expanda o serviço e use **Medir** para registrar o total executado, observações e até três fotos. Histórico mostra os registros anteriores.
5. Use Duplicar no serviço ou na atividade e informe os pavimentos de destino separados por vírgula. A execução inicia em zero. No grupo, o pavimento de origem opcional seleciona atividades cujos nomes ou locais começam com essa identificação.
6. Consulte calendário/lista e relatórios. Filtros de período consideram o prazo da atividade; o histórico no Excel e na tela também considera a data do registro.

## Funcionalidades

- Obras: cadastro, edição, pesquisa, arquivamento em cascata e serviços vinculados.
- Serviços-mãe e filhos: hierarquia expansível, busca, status, ordenação, edição, duplicação e arquivamento.
- Medições por quantidade ou percentual manual, histórico com autor e horário, observações e fotos PNG/JPEG/WebP (1,4 MB cada na interface).
- Progresso por quantidade quando todos os filhos têm mesma unidade; nos demais casos exige pesos positivos para todos. Sem base suficiente mostra “Sem ponderação”. O progresso da obra é calculado sobre seus filhos ativos.
- Indicadores reais, distribuição por status, progresso das obras, prazos, atualizações e comparação mensal de atividades previstas e concluídas.
- Cronograma em lista e calendário mensal por prazo final.
- Cadastro de profissionais e equipes, atribuição de responsáveis.
- Relatório PDF com atividades e Excel com atividades e histórico, respeitando obra, status e prazo; busca e ordenação também são aplicadas à exportação.
- Temas claro/escuro, layout adaptado a celular e cartões para linhas da tabela.

## Arquitetura e segurança

`server/store.js` cria o esquema e índices com chaves estrangeiras. `records` mantém obras, grupos, atividades e profissionais com payloads JSON validados por tipo; a API exige hierarquia válida. Usuários, organizações, sessões, histórico e anexos têm tabelas próprias. Toda consulta de dados é limitada à organização da sessão. Essa escolha reduz configuração para uso local; uma evolução para PostgreSQL deve converter os payloads em modelos relacionais tipados e adicionar migrações versionadas.

Senhas usam scrypt e salt aleatório. Sessões com token aleatório são persistidas com expiração de sete dias, cookie HttpOnly e SameSite Strict. O modo `NODE_ENV=production` exige HTTPS para o cookie seguro. A API verifica a origem nas mutações e limita tentativas de autenticação.

Administrador cadastra usuários; administrador e gestor alteram os cadastros; colaborador só registra execução em atividades atribuídas diretamente ao seu usuário. Vínculo a um profissional/equipe cadastrado é para gestão e não concede permissões a usuários. Arquivamento preserva dados e histórico no banco; restauração pela interface ainda não está disponível.

Variáveis opcionais: `PORT` (3000), `DB_PATH` (`data/prumo.sqlite`) e `NODE_ENV`. O servidor escuta somente em `127.0.0.1` por padrão.

## Dados e operação

Os dados ficam em `data/prumo.sqlite` e arquivos SQLite auxiliares. A pasta não deve ser publicada nem commitada. Para backup, pare o servidor e copie toda a pasta `data`; para restaurar, recoloque-a com o servidor parado. Fotos são armazenadas no banco com limites de tamanho. O tema é a única preferência armazenada em localStorage.

Antes de hospedar para uma equipe: configurar HTTPS e proxy reverso, backups automáticos, armazenamento externo de anexos, monitoramento, recuperação e alteração de senha, gestão do ciclo de vida dos usuários e política de cadastro de organizações. Esta entrega executa localmente; não houve publicação externa. Não inclui Gantt interativo, notificações por e-mail ou edição de fotografias.

## Verificações

`npm run build`: verificação estrita TypeScript e build Vite.

`npm test`: testes de cálculo, ponderação, atrasos e renomeação de pavimentos; teste de integração inicia um banco temporário, cria organização/obra/serviços, registra medição, duplica, verifica permissões e isolamento, exporta PDF/Excel, reinicia o servidor para conferir persistência e arquiva em cascata.

## Arquivos

- `src/main.tsx`: interface, formulários, navegação e integração com API.
- `src/style.css`: identidade visual, temas e responsividade.
- `server/index.js`: API, autenticação, validações, relatórios e servidor web.
- `server/store.js`: SQLite e transações.
- `server/domain.js`: cálculos e duplicação.
- `server/excel.js`: exportação Excel OOXML com textos escapados.
- `tests/`: testes de domínio e integração.
- `package.json`, `package-lock.json`, `tsconfig.json`, `index.html`, `.gitignore`: configuração.


