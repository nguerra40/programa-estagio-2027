// Função serverless que embrulha o app Express inteiro (src/server.js) com
// serverless-http. As rotas continuam exatamente as mesmas — a diferença é
// que, em vez de "app.listen()", cada requisição vira uma invocação dessa
// função (ver os redirects de /api/* e /auth/* em netlify.toml).
const serverless = require('serverless-http');
const app = require('../../src/server');

// binary: true — sem isso, respostas binárias (foto/CV) passam pelo
// pipeline de string da função e corrompem (ex.: foto do candidato não
// abre, mesmo a chamada retornando 200 com o content-type certo).
exports.handler = serverless(app, { binary: true });
