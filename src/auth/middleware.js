/**
 * Middlewares de autenticação e autorização.
 */

// Verifica se o usuário está autenticado
function isAuthenticated(req, res, next) {
  // Em modo de desenvolvimento (sem Entra ID configurado), permite acesso
  if (!process.env.AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID === 'SEU_CLIENT_ID_AQUI') {
    // Modo dev: simula usuário autenticado
    if (!req.user) {
      req.user = {
        id: 'dev-user',
        email: 'dev@galapagoscapital.com',
        name: 'Usuário Desenvolvimento',
        isAdmin: true
      };
    }
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }

  res.status(401).json({ error: 'Não autenticado. Faça login via Microsoft.' });
}

// Verifica se o usuário é admin
function isAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  
  if (req.user.isAdmin || adminEmails.includes((req.user.email || '').toLowerCase())) {
    return next();
  }

  res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
}

module.exports = { isAuthenticated, isAdmin };
