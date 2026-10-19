/**
 * Middlewares de autenticação e autorização.
 *
 * Enquanto o SSO (Microsoft Entra ID, ver src/auth/entra.js) não está
 * configurado — ou enquanto AUTH_DISABLED=true — a aplicação roda em modo
 * aberto, exatamente como sempre funcionou (login por e-mail/código no
 * front-end, sem sessão real no servidor). No momento em que as 3
 * variáveis AZURE_* forem preenchidas em produção, essa trava liga
 * sozinha, sem precisar mexer em mais nada além disso.
 */
const entra = require('./entra');

// "Desligado" cobre os dois jeitos de não ter SSO: nunca configurado (hoje,
// sem as variáveis AZURE_*) ou forçado via AUTH_DISABLED=true. Em nenhum dos
// dois casos depende de sessão (req.session pode nem existir — ver
// src/server.js, que só liga o express-session quando o SSO está de fato
// configurado).
function authDisabled() {
  return process.env.AUTH_DISABLED === 'true' || !entra.isConfigured;
}

// Só o flag explícito — usado pelo /auth/me pra saber quando deve "logar
// sozinho" com um usuário fictício (só faz sentido em teste local, nunca
// numa URL publicada de verdade, mesmo sem SSO configurado — ver
// src/routes/auth.js).
function devBypassActive() {
  return process.env.AUTH_DISABLED === 'true';
}

function isAdminEmail(email) {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes((email || '').toLowerCase());
}

// Verifica se o usuário está autenticado. Fica aberto sem SSO (qualquer
// colaborador pode avaliar candidatos, só se identificando pelo e-mail —
// nunca foi pensado como barreira real, só pra registrar quem avaliou).
function isAuthenticated(req, res, next) {
  if (authDisabled()) return next();

  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Não autenticado. Faça login via Microsoft.' });
}

// Verifica se o usuário é admin — essa, ao contrário de isAuthenticated,
// SEMPRE exige uma sessão real (login via Microsoft OU a senha de admin em
// POST /auth/admin-login), mesmo sem SSO configurado. Antes disso só
// existia como convenção no front-end (esconder o botão "Candidatos"), o
// que não impedia ninguém de chamar a API direto — ver o incidente em que
// todo mundo enxergava a aba de admin.
function isAdmin(req, res, next) {
  if (devBypassActive()) return next();

  const emailSso = req.session && req.session.user && req.session.user.email;
  const emailSenha = req.session && req.session.adminEmail;
  const email = emailSso || emailSenha;
  if (!email) return res.status(401).json({ error: 'Não autenticado.' });
  if (isAdminEmail(email)) return next();
  res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
}

module.exports = { isAuthenticated, isAdmin, isAdminEmail, authDisabled, devBypassActive };
