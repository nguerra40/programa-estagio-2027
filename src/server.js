require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 8000;

// Segurança
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas da API
app.use('/api', apiRoutes);

// Rota principal — serve o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Programa de Estágio 2027] Servidor rodando em 0.0.0.0:${PORT}`);
});
