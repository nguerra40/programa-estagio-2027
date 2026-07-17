/**
 * Auto-migração: cria a tabela se não existir.
 * Executado automaticamente ao iniciar o servidor.
 */
const db = require('./connection');

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
`;

(async () => {
  try {
    if (db.type === 'sqlite') {
      const Database = require('better-sqlite3');
      const path = require('path');
      const fs = require('fs');
      const dataDir = path.join(__dirname, '..', '..', 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const dbPath = path.join(dataDir, 'estagio.db');
      const sqlite = new Database(dbPath);
      sqlite.exec(createTableSQL_SQLITE);
      sqlite.close();
    } else {
      await db.query(createTableSQL_PG);
    }
    console.log('[Migrate] Tabela solicitacoes OK.');
  } catch (e) {
    console.warn('[Migrate] Aviso:', e.message);
  }
})();
