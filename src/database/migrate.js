/**
 * Script de migração — cria as tabelas no banco de dados.
 * Execute com: npm run db:migrate
 * Funciona tanto com PostgreSQL quanto com SQLite.
 */
require('dotenv').config();
const db = require('./connection');

const createTableSQL_PG = `
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
`;

const createTableSQL_SQLITE = `
  CREATE TABLE IF NOT EXISTS solicitacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestor TEXT NOT NULL,
    email TEXT NOT NULL,
    vagas INTEGER NOT NULL CHECK (vagas BETWEEN 1 AND 5),
    area TEXT NOT NULL,
    subarea TEXT NOT NULL,
    comentario TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );
`;

async function migrate() {
  try {
    console.log('[Migrate] Criando tabelas...');
    if (db.type === 'postgres') {
      await db.query(createTableSQL_PG);
    } else {
      // SQLite não suporta múltiplos statements em um query, executa individualmente
      const Database = require('better-sqlite3');
      const path = require('path');
      const fs = require('fs');
      const dataDir = path.join(__dirname, '..', '..', 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const dbPath = path.join(dataDir, 'estagio.db');
      const sqlite = new Database(dbPath);
      sqlite.exec(createTableSQL_SQLITE);
      sqlite.close();
    }
    console.log('[Migrate] Tabelas criadas com sucesso.');
  } catch (error) {
    console.error('[Migrate] Erro:', error.message);
    process.exit(1);
  }
}

migrate();
