/**
 * Conexão com banco de dados.
 * Se DB_HOST estiver configurado, usa PostgreSQL.
 * Caso contrário, usa SQLite local (para dev e deploys sem banco externo).
 */

let db;

if (process.env.DB_HOST && process.env.DB_HOST !== 'localhost_desativado') {
  // PostgreSQL
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'programa_estagio',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('connect', () => console.log('[DB] Conectado ao PostgreSQL.'));
  pool.on('error', (err) => console.error('[DB] Erro no pool:', err.message));

  db = {
    type: 'postgres',
    query: (text, params) => pool.query(text, params),
    end: () => pool.end()
  };
} else {
  // SQLite (arquivo local — funciona sem infra externa)
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = path.join(__dirname, '..', '..', 'data', 'estagio.db');

  // Cria pasta data se não existir
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');

  console.log('[DB] Usando SQLite local:', dbPath);

  // Adapter para manter a mesma interface que pg
  db = {
    type: 'sqlite',
    query: (text, params) => {
      // Converte $1, $2... para ? (SQLite usa ?)
      const sqliteText = text.replace(/\$(\d+)/g, '?');
      
      if (sqliteText.trim().toUpperCase().startsWith('SELECT') || 
          sqliteText.trim().toUpperCase().startsWith('WITH')) {
        const rows = sqlite.prepare(sqliteText).all(...(params || []));
        return Promise.resolve({ rows });
      } else if (sqliteText.toUpperCase().includes('RETURNING')) {
        const cleanSql = sqliteText.replace(/RETURNING \*/i, '');
        const info = sqlite.prepare(cleanSql).run(...(params || []));
        // Busca o registro inserido
        const row = sqlite.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(info.lastInsertRowid);
        return Promise.resolve({ rows: [row] });
      } else {
        sqlite.prepare(sqliteText).run(...(params || []));
        return Promise.resolve({ rows: [] });
      }
    },
    end: () => sqlite.close()
  };
}

module.exports = db;
