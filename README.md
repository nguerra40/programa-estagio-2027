# Programa de Estágio 2027 — Galapagos Capital

Aplicação interna para gestores solicitarem vagas de estágio e para o time de People & ESG administrar essas solicitações.

## O que essa aplicação faz

- **Gestores** acessam um formulário simples para solicitar vagas de estágio, informando área, subárea, quantidade de vagas e comentários.
- **Administradores** (People & ESG) têm acesso a um painel com todas as solicitações, filtros, ordenação e exportação para Excel.
- **Autenticação** via Microsoft Entra ID (SSO corporativo) — apenas colaboradores com e-mail @galapagoscapital.com têm acesso.

## Tecnologias

| Componente | Tecnologia |
|------------|-----------|
| Backend | Node.js + Express |
| Banco de dados | PostgreSQL |
| Autenticação | Microsoft Entra ID (passport-azure-ad) |
| Frontend | HTML/CSS/JS (Design System Galapagos) |
| Container | Docker |
| Orquestração | Kubernetes (AWS) |

## Estrutura do Projeto

```
├── public/                  # Frontend (arquivos estáticos servidos pelo Express)
│   ├── index.html           # Página principal (formulário + painel admin)
│   ├── logo_galapagos.png
│   ├── logo_programadeestagio.png
│   └── logo_programadeestagiobranco.png
├── src/
│   ├── server.js            # Servidor Express (ponto de entrada)
│   ├── auth/
│   │   ├── passport-config.js   # Configuração do Microsoft Entra ID
│   │   └── middleware.js        # Middlewares de autenticação e autorização
│   ├── database/
│   │   ├── connection.js    # Pool de conexão PostgreSQL
│   │   └── migrate.js       # Script de criação de tabelas
│   └── routes/
│       ├── auth.js          # Rotas de login/logout/callback
│       └── api.js           # Rotas da API (CRUD solicitações)
├── .env.example             # Variáveis de ambiente (modelo)
├── .gitignore
├── Dockerfile               # Build para container
├── .dockerignore
├── package.json
└── README.md
```

## Como rodar localmente

### Pré-requisitos

- Node.js 18+
- PostgreSQL rodando localmente (ou via Docker)

### Passo a passo

1. Clone o repositório e instale dependências:
```bash
npm install
```

2. Copie o arquivo de ambiente e configure:
```bash
cp .env.example .env
```
Edite o `.env` com os dados do seu PostgreSQL local.

3. Crie o banco de dados:
```bash
createdb programa_estagio
```

4. Execute a migração (cria as tabelas):
```bash
npm run db:migrate
```

5. Inicie o servidor:
```bash
npm run dev
```

6. Acesse no navegador:
```
http://localhost:3000
```

> **Nota:** Sem as credenciais do Microsoft Entra ID configuradas, a aplicação roda em "modo de desenvolvimento" — login é automático e todas as funcionalidades ficam disponíveis para teste.

## Autenticação (Microsoft Entra ID)

A autenticação usa SSO via Microsoft Entra ID (antigo Azure AD). O time de TI precisa fornecer:

| Informação | Variável no .env | Onde encontrar |
|-----------|-----------------|---------------|
| Client ID | `AZURE_CLIENT_ID` | Azure Portal > App registrations > Overview |
| Client Secret | `AZURE_CLIENT_SECRET` | Azure Portal > App registrations > Certificates & secrets |
| Tenant ID | `AZURE_TENANT_ID` | Azure Portal > Microsoft Entra ID > Overview |
| Redirect URI | `AZURE_REDIRECT_URI` | URL da aplicação + `/auth/callback` |

### O que o TI precisa configurar no Azure Portal:

1. Registrar um novo App Registration
2. Definir a Redirect URI: `https://<dominio-da-aplicacao>/auth/callback`
3. Em "API permissions", adicionar: `openid`, `profile`, `email`
4. Gerar um Client Secret e compartilhar com a equipe

## Administradores

Quem tem acesso ao painel administrativo é controlado pela variável de ambiente
`ADMIN_EMAILS` (lista de e-mails separados por vírgula) — ver `.env` ou as
variáveis de ambiente configuradas na hospedagem (Kubernetes/Netlify).

## Deploy (Kubernetes na AWS)

A infraestrutura já está provisionada. Para deploy:

1. Build da imagem Docker:
```bash
docker build -t programa-estagio-2027 .
```

2. Tag e push para o registry:
```bash
docker tag programa-estagio-2027:latest <registry>/programa-estagio-2027:latest
docker push <registry>/programa-estagio-2027:latest
```

3. O Kubernetes faz o rollout automaticamente (ou via `kubectl apply`).

## Design System

A interface segue rigorosamente o Design System da Galapagos Capital:

- **Cores:** Deep Blue (#183C80), Bright Blue (#0071BB), Spacial Grey (#231F20), Snow White (#F7F7F8)
- **Tipografia:** Gadugi (títulos), Inter (corpo)
- **Grid:** Base de 8px
- **Ícones:** Material Design Outlined

---

*Desenvolvido para o time de People & ESG — Galapagos Capital, 2027.*
