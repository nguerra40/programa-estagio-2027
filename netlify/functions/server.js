// Função serverless que embrulha o app Express inteiro (src/server.js) com
// serverless-http. As rotas continuam exatamente as mesmas — a diferença é
// que, em vez de "app.listen()", cada requisição vira uma invocação dessa
// função (ver os redirects de /api/* e /auth/* em netlify.toml).
const serverless = require('serverless-http');
const app = require('../../src/server');

exports.handler = serverless(app);
