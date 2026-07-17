/**
 * Configuração do Passport com Microsoft Entra ID (Azure AD).
 * 
 * ATENÇÃO: As variáveis AZURE_CLIENT_ID, AZURE_CLIENT_SECRET e AZURE_TENANT_ID
 * devem ser fornecidas pelo time de TI após o registro do aplicativo no Azure Portal.
 * 
 * Passos que o TI precisa fazer:
 * 1. Registrar o aplicativo no Azure Portal (Microsoft Entra ID > App registrations)
 * 2. Configurar a Redirect URI (ex: https://estagio.galapagoscapital.com/auth/callback)
 * 3. Gerar um Client Secret
 * 4. Fornecer: Client ID, Client Secret e Tenant ID
 */

const { OIDCStrategy } = require('passport-azure-ad');

function configurePassport(passport) {
  const clientID = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantID = process.env.AZURE_TENANT_ID;
  const redirectUrl = process.env.AZURE_REDIRECT_URI || 'http://localhost:3000/auth/callback';

  // Se as credenciais não estiverem configuradas, usar modo de desenvolvimento
  if (!clientID || clientID === 'SEU_CLIENT_ID_AQUI') {
    console.warn('[Auth] Microsoft Entra ID NÃO configurado. Rodando em modo de desenvolvimento.');
    console.warn('[Auth] Para configurar, preencha as variáveis AZURE_* no arquivo .env');
    return;
  }

  const options = {
    identityMetadata: `https://login.microsoftonline.com/${tenantID}/v2.0/.well-known/openid-configuration`,
    clientID: clientID,
    clientSecret: clientSecret,
    responseType: 'code',
    responseMode: 'form_post',
    redirectUrl: redirectUrl,
    allowHttpForRedirectUrl: process.env.NODE_ENV !== 'production',
    scope: ['profile', 'email', 'openid'],
    passReqToCallback: false
  };

  passport.use('azure-ad', new OIDCStrategy(options, (profile, done) => {
    // O perfil vem com os dados do usuário autenticado
    const user = {
      id: profile.oid,
      email: profile._json.email || profile._json.preferred_username,
      name: profile.displayName,
      isAdmin: isAdminUser(profile._json.email || profile._json.preferred_username)
    };
    return done(null, user);
  }));

  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  console.log('[Auth] Microsoft Entra ID configurado com sucesso.');
}

function isAdminUser(email) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  return adminEmails.includes((email || '').toLowerCase());
}

module.exports = { configurePassport, isAdminUser };
