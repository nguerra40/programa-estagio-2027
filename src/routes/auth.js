const express = require('express');
const passport = require('passport');
const router = express.Router();

/**
 * Rota de login — redireciona para Microsoft Entra ID.
 * GET /auth/login
 */
router.get('/login', (req, res, next) => {
  // Se Entra ID não está configurado, modo dev
  if (!process.env.AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID === 'SEU_CLIENT_ID_AQUI') {
    req.session.user = {
      id: 'dev-user',
      email: 'dev@galapagoscapital.com',
      name: 'Usuário Desenvolvimento',
      isAdmin: true
    };
    return res.redirect('/');
  }

  passport.authenticate('azure-ad', {
    prompt: 'select_account'
  })(req, res, next);
});

/**
 * Callback do Microsoft Entra ID após autenticação.
 * POST /auth/callback
 */
router.post('/callback',
  passport.authenticate('azure-ad', { failureRedirect: '/auth/login-error' }),
  (req, res) => {
    res.redirect('/');
  }
);

/**
 * Retorna dados do usuário autenticado.
 * GET /auth/me
 */
router.get('/me', (req, res) => {
  if (!process.env.AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID === 'SEU_CLIENT_ID_AQUI') {
    // Modo dev
    return res.json({
      authenticated: true,
      user: {
        name: 'Usuário Desenvolvimento',
        email: 'dev@galapagoscapital.com',
        isAdmin: true
      }
    });
  }

  if (req.isAuthenticated()) {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    return res.json({
      authenticated: true,
      user: {
        name: req.user.name,
        email: req.user.email,
        isAdmin: adminEmails.includes((req.user.email || '').toLowerCase())
      }
    });
  }

  res.json({ authenticated: false });
});

/**
 * Logout — encerra sessão.
 * GET /auth/logout
 */
router.get('/logout', (req, res) => {
  req.logout((err) => {
    req.session.destroy();
    res.redirect('/');
  });
});

/**
 * Erro no login.
 * GET /auth/login-error
 */
router.get('/login-error', (req, res) => {
  res.status(401).json({ error: 'Falha na autenticação com Microsoft Entra ID.' });
});

module.exports = router;
