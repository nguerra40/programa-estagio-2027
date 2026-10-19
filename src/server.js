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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ----- Sessão (usada pelo login via Microsoft Entra ID, ver routes/auth.js) -----
// Guardada no PostgreSQL pra funcionar em qualquer réplica, em produção com
// mais de um pod. Sem isso, cada pod teria sua própria sessão em memória e
// o usuário seria deslogado aleatoriamente ao trocar de réplica.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[Session] SESSION_SECRET não configurado em produção — usando um valor fraco e público (o deste código-fonte). Configure essa variável antes de ativar o SSO de verdade.');
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
  sessionOpts.store = new PgSession({ pool, createTableIfMissing: true });
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

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Programa de Estágio 2027] Servidor rodando em 0.0.0.0:${PORT}`);
});
