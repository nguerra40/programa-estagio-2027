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
AZURE_REDIRECT_URI=https://estagio.galapagoscapital.com/auth/callback

# Sessão
SESSION_SECRET=string_longa_e_aleatoria

# Admins
ADMIN_EMAILS=eduarda.dreux@galapagoscapital.com,felipe.regis@galapagoscapital.com,natasha.guerra@galapagoscapital.com
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

O código já está preparado para receber as credenciais. Quando o TI fornecer os dados:

1. Preencha `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` e `AZURE_TENANT_ID` no `.env`
2. Atualize `AZURE_REDIRECT_URI` com o domínio final da aplicação
3. Reinicie a aplicação

### Fluxo de autenticação

```
Usuário acessa a aplicação
    → Redirecionado para login da Microsoft
    → Microsoft valida credenciais
    → Redireciona de volta para /auth/callback
    → Sessão criada no servidor
    → Usuário vê o formulário (gestor) ou painel (admin)
```

### Modo de desenvolvimento

Enquanto as credenciais não estão configuradas, a aplicação roda em **modo dev**:
- Login é automático
- Todas as funcionalidades ficam disponíveis
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
| POST | /auth/callback | Microsoft | Callback do Entra ID |
| GET | /auth/me | Público | Retorna usuário logado |
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

## 7. Checklist para Produção

- [ ] Variáveis de ambiente configuradas (especialmente `NODE_ENV=production`)
- [ ] Credenciais do Microsoft Entra ID preenchidas
- [ ] `SESSION_SECRET` com valor forte e aleatório
- [ ] `AZURE_REDIRECT_URI` apontando para o domínio de produção
- [ ] PostgreSQL acessível pelo container
- [ ] Cookie `secure: true` (automático quando `NODE_ENV=production`)
- [ ] HTTPS configurado no Ingress do Kubernetes
