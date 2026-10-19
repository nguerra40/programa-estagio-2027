// ============================================================
// Login via Microsoft Entra ID (Azure AD) — fluxo OpenID Connect com
// @azure/msal-node (ver src/auth/entra.js). Enquanto o SSO não está
// configurado, essas rotas respondem 503 e o front-end continua usando o
// login por e-mail/código normalmente.
// ============================================================
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const entra = require('../auth/entra');
const { isAdminEmail, authDisabled } = require('../auth/middleware');

// GET /auth/login — inicia o fluxo de login com a Microsoft.
router.get('/login', async (req, res) => {
  if (!entra.isConfigured) {
    return res.status(503).send('SSO ainda não configurado. Aguardando os dados do Entra ID (TI).');
  }
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.authState = state;
    const url = await entra.getLoginUrl(state);
    // Garante que o "state" foi gravado no store da sessão ANTES de mandar
    // o usuário pra Microsoft — senão o retorno vê a sessão vazia (state
    // ausente) e rejeita um login legítimo.
    req.session.save((err) => {
      if (err) {
        console.error('[Auth] Falha ao gravar a sessão antes do login:', err.message);
        return res.status(500).send('Erro ao iniciar o login. Tente novamente.');
      }
      res.redirect(url);
    });
  } catch (error) {
    res.status(500).send('Erro ao iniciar o login: ' + error.message);
  }
});

// GET /auth/callback — retorno da Microsoft após o login (redirect URI
// registrada no Entra ID aponta pra cá).
router.get('/callback', async (req, res) => {
  if (!entra.isConfigured) return res.status(503).send('SSO não configurado.');
  try {
    if (!req.query.code) return res.status(400).send('Código de autenticação ausente.');

    const esperado = req.session && req.session.authState;
    if (!esperado || req.query.state !== esperado) {
      console.warn('[Auth] "state" não bate no retorno do SSO — sessão pode ter se perdido no caminho.');
      return res.status(400).send('Parâmetro "state" inválido ou sessão expirada. Tente fazer login de novo.');
    }

    const user = await entra.handleCallback(req.query.code);

    if (!user.email.endsWith('@galapagoscapital.com')) {
      return req.session.destroy(() =>
        res.status(403).send('Acesso permitido apenas para e-mails @galapagoscapital.com.')
      );
    }

    req.session.user = user;
    delete req.session.authState;
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Erro no retorno do login: ' + error.message);
  }
});

// GET /auth/me — usuário autenticado na sessão atual (ou null).
router.get('/me', (req, res) => {
  // AUTH_DISABLED=true (só pra dev local) — o front-end loga sozinho com um
  // usuário fictício, igual o antigo "modo dev", em vez de ficar preso na
  // tela de login sem conseguir completar um redirecionamento real pra
  // Microsoft (ex.: localhost não bate com o Redirect URI cadastrado no Azure).
  if (authDisabled()) {
    return res.json({
      user: { email: 'dev@galapagoscapital.com', nome: 'Usuário Desenvolvimento', isAdmin: true },
      ssoConfigurado: true,
    });
  }

  const user = (req.session && req.session.user) || null;
  res.json({
    user: user ? { ...user, isAdmin: isAdminEmail(user.email) } : null,
    ssoConfigurado: entra.isConfigured,
  });
});

// GET /auth/logout — encerra a sessão (e, se o SSO estiver ativo, também
// a sessão na Microsoft).
router.get('/logout', (req, res) => {
  const useEntraLogout = entra.isConfigured;
  const postLogout = process.env.AZURE_POST_LOGOUT_REDIRECT_URI || '';
  req.session.destroy(() => {
    res.redirect(useEntraLogout ? (entra.logoutUrl(postLogout) || '/') : '/');
  });
});

module.exports = router;
