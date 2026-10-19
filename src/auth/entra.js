// ============================================================
// Autenticação via Microsoft Entra ID (Azure AD) — OpenID Connect.
// Usa a biblioteca oficial da Microsoft: @azure/msal-node (o pacote
// anterior, passport-azure-ad, está descontinuado pela própria Microsoft
// e trazia dependências com vulnerabilidade — por isso a troca).
//
// Variáveis de ambiente (fornecidas pelo TI):
//   AZURE_TENANT_ID     -> ID do diretório (tenant) da Galapagos
//   AZURE_CLIENT_ID     -> ID do aplicativo registrado no Entra ID
//   AZURE_CLIENT_SECRET -> segredo do aplicativo
//   AZURE_REDIRECT_URI  -> URL de retorno (ex.: https://SEU-DOMINIO/auth/callback)
//
// Enquanto a TI não entregar esses dados, o app sobe normalmente com o
// login atual (e-mail + código) — ver AUTH_DISABLED em src/auth/middleware.js.
// ============================================================
const { ConfidentialClientApplication } = require('@azure/msal-node');

const tenant = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
const redirectUri = process.env.AZURE_REDIRECT_URI;

// Client ID e Tenant ID do Entra ID são sempre um GUID — checar o formato
// evita "ativar" o SSO por engano com um valor de exemplo/placeholder
// esquecido no .env (ex.: "xxx"), o que travaria a API inteira sem aviso
// (toda rota passaria a exigir sessão real, que nunca existiria).
function pareceGuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
}

// Só consideramos o SSO "configurado" quando todos os dados existirem e
// parecerem valores reais do Azure.
const isConfigured = !!(tenant && clientId && clientSecret && redirectUri && pareceGuid(tenant) && pareceGuid(clientId));

const SCOPES = ['user.read'];

let cca = null;
if (isConfigured) {
  cca = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenant}`,
      clientSecret,
    },
  });
  console.log('[Auth] Microsoft Entra ID configurado.');
} else {
  console.warn('[Auth] Microsoft Entra ID NÃO configurado — login atual (e-mail/código) continua ativo.');
}

module.exports = {
  isConfigured,

  // Monta a URL para onde o usuário é enviado para fazer login na Microsoft.
  async getLoginUrl(state) {
    return cca.getAuthCodeUrl({ scopes: SCOPES, redirectUri, state });
  },

  // Troca o "code" devolvido pela Microsoft pelos dados do usuário.
  async handleCallback(code) {
    const r = await cca.acquireTokenByCode({ code, scopes: SCOPES, redirectUri });
    const email = (r.account && r.account.username) || '';
    return {
      nome: (r.account && r.account.name) || email || 'Usuário',
      email: email.toLowerCase(),
    };
  },

  // URL de logout do Entra ID (encerra a sessão também na Microsoft).
  logoutUrl(postLogoutRedirectUri) {
    if (!tenant) return '';
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout` +
      (postLogoutRedirectUri ? `?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}` : '');
  },
};
