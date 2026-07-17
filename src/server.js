require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { configurePassport } = require('./auth/passport-config');

const app = express();
const PORT = process.env.PORT || 3000;

// Segurança
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessão
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-trocar-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Passport (Microsoft Entra ID)
app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// Arquivos estáticos (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Rota principal — serve o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Programa de Estágio 2027] Servidor rodando na porta ${PORT}`);
  console.log(`[Ambiente] ${process.env.NODE_ENV || 'development'}`);
});
