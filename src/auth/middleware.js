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

function authDisabled() {
  return process.env.AUTH_DISABLED === 'true' || !entra.isConfigured;
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
  if (authDisabled()) {
    if (!req.session.user) {
      req.session.user = { email: 'dev@galapagoscapital.com', nome: 'Usuário Desenvolvimento' };
    }
    return next();
  }

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

module.exports = { isAuthenticated, isAdmin, isAdminEmail, authDisabled };
