/**
 * Script de migração — cria as tabelas no banco de dados.
 * Execute com: npm run db:migrate
 */
require('dotenv').config();
const pool = require('./connection');

const createTableSQL = `
  CREATE TABLE IF NOT EXISTS solicitacoes (
    id SERIAL PRIMARY KEY,
    gestor VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    vagas INTEGER NOT NULL CHECK (vagas BETWEEN 1 AND 5),
    area VARCHAR(255) NOT NULL,
    subarea VARCHAR(255) NOT NULL,
    comentario TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_solicitacoes_area ON solicitacoes(area);
  CREATE INDEX IF NOT EXISTS idx_solicitacoes_gestor ON solicitacoes(gestor);
  CREATE INDEX IF NOT EXISTS idx_solicitacoes_created_at ON solicitacoes(created_at);
`;

async function migrate() {
  try {
    console.log('[Migrate] Criando tabelas...');
    await pool.query(createTableSQL);
    console.log('[Migrate] Tabelas criadas com sucesso.');
  } catch (error) {
    console.error('[Migrate] Erro:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
