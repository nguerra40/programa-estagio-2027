# Guia de Configuração

Este documento detalha como configurar e manter a aplicação do Programa de Estágio 2027.

---

## 1. Variáveis de Ambiente

Todas as configurações sensíveis ficam no arquivo `.env` (nunca commitar esse arquivo).

```env
# Servidor
PORT=3000
NODE_ENV=development          # ou "production" em produção

# Banco de Dados
DB_HOST=localhost              # Host do PostgreSQL
DB_PORT=5432                   # Porta do PostgreSQL
DB_NAME=programa_estagio      # Nome do banco
DB_USER=postgres               # Usuário
DB_PASSWORD=sua_senha          # Senha

# Microsoft Entra ID
AZURE_CLIENT_ID=xxx            # Fornecido pelo TI
AZURE_CLIENT_SECRET=xxx        # Fornecido pelo TI
AZURE_TENANT_ID=xxx            # Fornecido pelo TI
AZURE_REDIRECT_URI=https://formulario-programaestagio2027.glpg.io/auth/callback

# Sessão
SESSION_SECRET=string_longa_e_aleatoria

# Força o modo sem SSO mesmo com as variáveis AZURE_* preenchidas (opcional,
# só pra testes locais — em produção não precisa existir)
AUTH_DISABLED=false

# Admins
ADMIN_EMAILS=admin1@suaempresa.com,admin2@suaempresa.com

# Senha de admin — único jeito de virar admin quando o SSO não está
# configurado (POST /auth/admin-login, exige e-mail em ADMIN_EMAILS acima).
# Sem essa variável, o login de admin fica indisponível (nunca aberto).
ADMIN_PASSWORD=escolha-uma-senha-forte-aqui
```

---

## 2. Banco de Dados (PostgreSQL)

### Criação do banco

```bash
createdb programa_estagio
```

### Migração (criação das tabelas)

```bash
npm run db:migrate
```

### Tabela criada

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | SERIAL | ID auto-incremental |
| gestor | VARCHAR(255) | Nome do gestor solicitante |
| email | VARCHAR(255) | E-mail do gestor |
| vagas | INTEGER (1-5) | Quantidade de vagas solicitadas |
| area | VARCHAR(255) | Área da empresa |
| subarea | VARCHAR(255) | Subárea específica |
| comentario | TEXT | Comentários adicionais (opcional) |
| created_at | TIMESTAMP | Data e hora da solicitação |

---

## 3. Microsoft Entra ID (SSO)

### Status atual: AGUARDANDO configuração do TI

O back-end já está pronto (usa `@azure/msal-node`, a biblioteca oficial da
Microsoft — ver `src/auth/entra.js`, `src/routes/auth.js` e
`src/auth/middleware.js`). O que falta é só o TI (ou a própria Natasha, se
tiver permissão de registrar apps no Entra ID — ver instruções que ela já
tem) fornecer os 3 valores abaixo:

1. Peça o registro do app no Azure Portal (Entra ID → App registrations),
   tipo **Web**, single-tenant, com Redirect URI
   `https://formulario-programaestagio2027.glpg.io/auth/callback`
2. Preencha `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` e `AZURE_TENANT_ID` nas
   variáveis de ambiente de produção (Kubernetes)
3. Atualize `AZURE_REDIRECT_URI` se o domínio final for diferente
4. Reinicie a aplicação

Assim que essas 3 variáveis existirem, a trava liga **sozinha** — não
precisa mexer em mais nada no código nem setar `AUTH_DISABLED`.

### O front-end ainda usa o login atual (e-mail + código)

Essa troca foi feita só no back-end por enquanto. O front-end
(`public/index.html`) continua com o login simples (e-mail + código
`%adm2027`) que já estava em produção, porque não dá pra testar o
redirecionamento real com a Microsoft sem as credenciais de verdade. A
troca da tela de login pelo botão "Entrar com Microsoft" é o último passo,
feito junto com o teste de ponta a ponta assim que o TI responder.

### Fluxo de autenticação (quando ativo)

```
Usuário acessa /auth/login
    → Redirecionado para login da Microsoft
    → Microsoft valida credenciais
    → Redireciona de volta para /auth/callback
    → Sessão criada no servidor (guardada no Postgres)
    → Usuário vê a Avaliação (ou o painel, se for admin)
```

### Modo atual (sem SSO configurado, ou com AUTH_DISABLED=true)

Enquanto as credenciais não estão configuradas:
- As rotas `/auth/login` e `/auth/callback` respondem 503 (SSO não configurado)
- A API trata toda requisição como autenticada (o mesmo comportamento de
  sempre, usado pelo login atual por e-mail/código do front-end)
- Nenhuma chamada é feita ao Azure

---

## 4. Controle de Acesso

| Perfil | Acesso | Como definir |
|--------|--------|-------------|
| Gestor | Formulário de solicitação | Qualquer usuário autenticado via SSO |
| Admin | Formulário + Painel administrativo | E-mail listado em `ADMIN_EMAILS` |

---

## 5. API Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | /auth/login | Público | Inicia fluxo de login SSO |
| GET | /auth/callback | Microsoft | Callback do Entra ID |
| GET | /auth/me | Público | Retorna usuário logado na sessão atual |
| GET | /auth/logout | Autenticado | Encerra sessão |
| POST | /api/solicitacoes | Autenticado | Cria nova solicitação |
| GET | /api/solicitacoes | Admin | Lista todas as solicitações |
| GET | /api/stats | Admin | Estatísticas do painel |
| GET | /api/export | Admin | Exporta CSV |

---

## 6. Docker

### Build local

```bash
docker build -t programa-estagio-2027 .
```

### Executar local com Docker

```bash
docker run -p 3000:3000 --env-file .env programa-estagio-2027
```

---

## 6.5. Hospedagem na Netlify (sem Kubernetes, sem SSO)

Alternativa à hospedagem no Kubernetes — usada quando o celular não
conseguia abrir o site pela infra da Galapagos. O mesmo código roda dos
dois jeitos; a diferença é só a infraestrutura:

- **Banco de dados**: Supabase (Postgres), usando a connection string de
  **"Connection pooling" (Transaction mode, porta 6543)** — essencial pra
  funcionar bem com funções serverless, que abrem e fecham conexão a cada
  chamada. Vai na variável `SUPABASE_DATABASE_URL` (nome próprio, de
  propósito — nunca `DATABASE_URL`: esse nome genérico já apareceu
  auto-configurado por outras plataformas de hospedagem sem relação
  nenhuma com este app, e um dia isso já fez o app ler o banco errado em
  produção. `DATABASE_HOST`/`DATABASE_PORT`/etc. continuam sendo o que o
  Kubernetes usa).
- **Backend**: `netlify/functions/server.js` embrulha o mesmo `src/server.js`
  com `serverless-http` — nenhuma rota precisou ser reescrita.
- **Deploy**: Netlify não conecta direto no Azure DevOps (só
  GitHub/GitLab/Bitbucket) — o repositório é espelhado num GitHub pra isso.
- **Sem SSO**: sem as variáveis `AZURE_*`, o login de avaliador volta a ser
  o de e-mail de sempre. O login de admin continua precisando de
  `ADMIN_PASSWORD` + `ADMIN_EMAILS` (ver seção 1) — sem isso, ninguém
  consegue entrar como admin.
- **Limite conhecido**: funções da Netlify aceitam até ~6MB por
  requisição/resposta (bem menor que os 50MB do Kubernetes). O "Importar
  currículos em lote" tende a ficar bem abaixo disso (88 CVs reais somaram
  ~2.8MB), mas um lote muito grande de uma vez pode esbarrar nesse teto.

Variáveis de ambiente na Netlify (Site settings → Environment variables):

```env
SUPABASE_DATABASE_URL=postgresql://...supabase.com:6543/postgres   # connection pooling do Supabase
ADMIN_EMAILS=admin1@suaempresa.com,admin2@suaempresa.com
ADMIN_PASSWORD=mesma-senha-ja-usada-no-kubernetes
```

---

## 7. Checklist para Produção

- [ ] Variáveis de ambiente configuradas (especialmente `NODE_ENV=production`)
- [ ] Credenciais do Microsoft Entra ID preenchidas
- [ ] `SESSION_SECRET` com valor forte e aleatório
- [ ] `AZURE_REDIRECT_URI` apontando para o domínio de produção
- [ ] PostgreSQL acessível pelo container
- [ ] Cookie `secure: true` (automático quando `NODE_ENV=production`)
- [ ] HTTPS configurado no Ingress do Kubernetes
