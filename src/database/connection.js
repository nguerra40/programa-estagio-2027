const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DATABASE_HOST || '10.135.7.227',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'formsestagiodb',
  user: process.env.DATABASE_USER || 'appuser',
  password: process.env.DATABASE_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Sem isso, uma consulta travada (ex.: lock no banco) prende a conexão
  // pra sempre — com só 10 conexões no pool, bastam poucas consultas assim
  // pra deixar TODO MUNDO (celular incluso) sem resposta nenhuma.
  statement_timeout: 10000,
  query_timeout: 10000,
  ssl: false
});

// Auto-criar tabela ao conectar
pool.query(`
  CREATE TABLE IF NOT EXISTS solicitacoes (
    id SERIAL PRIMARY KEY,
    gestor VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    vagas INTEGER NOT NULL CHECK (vagas BETWEEN 1 AND 5),
    area VARCHAR(255) NOT NULL,
    subarea VARCHAR(255) NOT NULL,
    comentario TEXT,
    status VARCHAR(20) DEFAULT 'pendente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`).then(() => {
  // Adiciona coluna status se não existir (para bancos já criados)
  return pool.query(`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente';`);
}).then(() => {
  console.log('[DB] Conectado ao PostgreSQL. Tabela OK.');
}).catch(err => {
  console.error('[DB] Erro ao criar tabela:', err.message);
});

// Funções
async function insert(record) {
  const result = await pool.query(
    `INSERT INTO solicitacoes (gestor, email, vagas, area, subarea, comentario)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [record.gestor, record.email, record.vagas, record.area, record.subarea, record.comentario || '']
  );
  return result.rows[0];
}

async function findAll() {
  const result = await pool.query('SELECT * FROM solicitacoes ORDER BY created_at DESC');
  return result.rows;
}

async function findByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM solicitacoes WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC',
    [email]
  );
  return result.rows;
}

async function update(id, updates) {
  const result = await pool.query(
    `UPDATE solicitacoes SET gestor=$1, email=$2, vagas=$3, area=$4, subarea=$5, comentario=$6, status=$7
     WHERE id=$8 RETURNING *`,
    [updates.gestor, updates.email, updates.vagas, updates.area, updates.subarea, updates.comentario || '', updates.status || 'pendente', id]
  );
  return result.rows[0];
}

async function updateField(id, field, value) {
  const allowed = ['vagas', 'area', 'status'];
  if (!allowed.includes(field)) return null;
  const result = await pool.query(
    `UPDATE solicitacoes SET ${field}=$1 WHERE id=$2 RETURNING *`,
    [value, id]
  );
  return result.rows[0];
}

async function stats() {
  const vagasResult = await pool.query('SELECT COALESCE(SUM(vagas), 0) as total_vagas FROM solicitacoes');
  const areasResult = await pool.query('SELECT COUNT(DISTINCT area) as total_areas FROM solicitacoes');
  return {
    totalVagas: parseInt(vagasResult.rows[0].total_vagas),
    totalAreas: parseInt(areasResult.rows[0].total_areas)
  };
}

async function remove(id) {
  const result = await pool.query('DELETE FROM solicitacoes WHERE id=$1 RETURNING *', [id]);
  return result.rows[0];
}

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { insert, findAll, findByEmail, update, updateField, stats, remove, query };
