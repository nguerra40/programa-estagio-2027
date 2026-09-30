require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./routes/api');
const dinamicaRoutes = require('./routes/dinamica');
const arquivosRoutes = require('./routes/arquivos');
const { isAuthenticated } = require('./auth/middleware');

const app = express();
const PORT = process.env.PORT || 8000;

// Segurança
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
// Limite alto pra caber o import em lote de currículos (vários PDFs em
// base64 num único corpo JSON — ex.: 88 CVs reais já passaram de ~2.8MB).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Arquivos estáticos (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas da API
app.use('/api', apiRoutes);
// Arquivos (CVs/fotos) — leitura exige só login; upload exige admin (checado
// dentro do próprio router, ver src/routes/arquivos.js).
app.use('/api/arquivos', isAuthenticated, arquivosRoutes);
// Dinâmica de estágio — rotas admin (candidatos/resultados) e rotas de
// qualquer colaborador logado (liberados/notas) convivem no mesmo router,
// cada uma com seu próprio isAuthenticated/isAdmin (ver src/routes/dinamica.js).
app.use('/api/dinamica', dinamicaRoutes);

// Rota principal — serve o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Programa de Estágio 2027] Servidor rodando em 0.0.0.0:${PORT}`);
});
