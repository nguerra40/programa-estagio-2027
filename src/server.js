require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./routes/api');
const dinamicaRoutes = require('./routes/dinamica');
const arquivosRoutes = require('./routes/arquivos');
const { isAuthenticated, isAdmin } = require('./auth/middleware');

const app = express();
const PORT = process.env.PORT || 8000;

// Segurança
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Arquivos estáticos (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas da API
app.use('/api', apiRoutes);
// Arquivos (CVs) — só admin lê/escreve por aqui.
app.use('/api/arquivos', isAuthenticated, isAdmin, arquivosRoutes);
// Dinâmica de estágio — o router mistura rotas admin (autenticadas, exigidas
// dentro do próprio arquivo) com rotas públicas (/publico/:token, sem login,
// pois o gestor avaliador acessa só com o link pessoal). Por isso NÃO leva
// isAuthenticated/isAdmin aqui.
app.use('/api/dinamica', dinamicaRoutes);

// Página que o gestor abre pelo link pessoal (token na URL) — sem login,
// igual ao link de dinâmica do controle-vagas. O token é validado pela API
// ao carregar os dados. Precisa vir antes do catch-all abaixo.
app.get('/dinamica/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dinamica-gestor.html'));
});

// Rota principal — serve o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Programa de Estágio 2027] Servidor rodando em 0.0.0.0:${PORT}`);
});
