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

// Verifica se o usuário está autenticado.
function isAuthenticated(req, res, next) {
  if (authDisabled()) return next();

  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Não autenticado. Faça login via Microsoft.' });
}

// Verifica se o usuário é admin.
function isAdmin(req, res, next) {
  if (authDisabled()) return next();

  const email = req.session && req.session.user && req.session.user.email;
  if (!email) return res.status(401).json({ error: 'Não autenticado.' });
  if (isAdminEmail(email)) return next();
  res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
}

module.exports = { isAuthenticated, isAdmin, isAdminEmail, authDisabled, devBypassActive };
