require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./routes/api');
const dinamicaRoutes = require('./routes/dinamica');
const arquivosRoutes = require('./routes/arquivos');
const authRoutes = require('./routes/auth');
const entra = require('./auth/entra');
const { isAuthenticated } = require('./auth/middleware');
const { pool } = require('./database/connection');

const app = express();
const PORT = process.env.PORT || 8000;

// Atrás do ingress/load balancer do Kubernetes — necessário pro cookie de
// sessão "secure: auto" detectar corretamente que a conexão é HTTPS.
app.set('trust proxy', 1);

// Segurança
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
// Limite alto pra caber o import em lote de currículos (vários PDFs em
// base64 num único corpo JSON — ex.: 88 CVs reais já passaram de ~2.8MB).
// Configurável porque hospedagem serverless (ex.: Netlify Functions) tem um
// teto bem menor de tamanho de corpo do que um servidor normal.
const BODY_LIMIT = process.env.JSON_BODY_LIMIT || '50mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ----- Sessão — usada pelo login via Microsoft Entra ID (quando
// configurado) E pelo login de senha do admin (ver routes/auth.js), então
// fica sempre ligada, independente do SSO.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[Session] SESSION_SECRET não configurado em produção — usando um valor fraco e público (o deste código-fonte). Configure essa variável o quanto antes.');
}
const sessionOpts = {
  name: 'estagio2027.sid',
  secret: process.env.SESSION_SECRET || 'troque-isto-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // 'auto': grava o cookie sempre, com Secure quando a conexão é HTTPS
    // (detectado via X-Forwarded-Proto atrás do ingress) e sem Secure
    // caso contrário — evita o cookie ser recusado silenciosamente.
    secure: process.env.COOKIE_SECURE === 'true' ? true : process.env.COOKIE_SECURE === 'false' ? false : 'auto',
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
  },
};
try {
  const PgSession = require('connect-pg-simple')(session);
  const store = new PgSession({ pool, createTableIfMissing: true });
  // connect-pg-simple emite 'error' num problema de conexão em segundo
  // plano (ex.: checagem da tabela) — sem um listener, um EventEmitter
  // relança isso como exceção não tratada e derruba o processo inteiro.
  store.on('error', (e) => console.error('[Session] Erro no store de sessão (Postgres):', e.message));
  sessionOpts.store = store;
} catch (e) {
  console.warn('[Session] Não foi possível usar o store no Postgres, caindo pra memória:', e.message);
}
app.use(session(sessionOpts));

// Arquivos estáticos (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Login via Microsoft (Entra ID) — ver src/routes/auth.js e src/auth/entra.js
app.use('/auth', authRoutes);

// Rotas da API
app.use('/api', apiRoutes);
// Arquivos (CVs/fotos) — leitura exige só login; upload exige admin (checado
// dentro do próprio router, ver src/routes/arquivos.js).
app.use('/api/arquivos', isAuthenticated, arquivosRoutes);
// Dinâmica de estágio — rotas admin (candidatos/resultados) e rotas de
// qualquer colaborador logado (liberados/notas) convivem no mesmo router,
// cada uma com seu próprio isAuthenticated/isAdmin (ver src/routes/dinamica.js).
app.use('/api/dinamica', dinamicaRoutes);

// Rota principal — serve o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Só sobe um servidor "de verdade" fora de uma função serverless (AWS
// Lambda/Netlify Functions sempre define AWS_LAMBDA_FUNCTION_NAME em tempo
// de execução — um jeito confiável de saber onde está rodando, que não
// depende de COMO este arquivo foi chamado). Dentro da função, quem invoca
// é o serverless-http (ver netlify/functions/server.js), sem abrir porta.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Programa de Estágio 2027] Servidor rodando em 0.0.0.0:${PORT}`);
  });
}

module.exports = app;
