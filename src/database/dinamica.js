const { query } = require('./connection');

// Auto-cria as tabelas da dinâmica de estágio (candidatos, gestores, notas e
// arquivos). Segue o mesmo padrão de connection.js: idempotente, roda ao
// carregar o módulo.
query(`
  CREATE TABLE IF NOT EXISTS arquivos (
    id BIGSERIAL PRIMARY KEY,
    tipo VARCHAR(20),
    nome VARCHAR(300),
    mime VARCHAR(100),
    dados TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`).then(() => query(`
  CREATE TABLE IF NOT EXISTS dinamica_candidatos (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    curso TEXT,
    faculdade TEXT,
    formacao TEXT,
    telefone TEXT,
    email TEXT,
    linkedin_url TEXT,
    turno TEXT NOT NULL DEFAULT '09h-11h',
    data_dinamica DATE,
    historico TEXT,
    cv_arquivo_id BIGINT REFERENCES arquivos(id) ON DELETE SET NULL,
    foto_arquivo_id BIGINT REFERENCES arquivos(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS foto_arquivo_id BIGINT REFERENCES arquivos(id) ON DELETE SET NULL;
`)).then(() => query(`
  CREATE TABLE IF NOT EXISTS dinamica_gestores (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT,
    turno TEXT NOT NULL DEFAULT '09h-11h',
    data_dinamica DATE,
    token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`)).then(() => query(`
  CREATE TABLE IF NOT EXISTS dinamica_notas (
    id BIGSERIAL PRIMARY KEY,
    candidato_id BIGINT NOT NULL REFERENCES dinamica_candidatos(id) ON DELETE CASCADE,
    gestor_id BIGINT NOT NULL REFERENCES dinamica_gestores(id) ON DELETE CASCADE,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (candidato_id, gestor_id)
  );
`)).then(() => {
  console.log('[DB] Tabelas da dinâmica de estágio OK.');
}).catch(err => {
  console.error('[DB] Erro ao criar tabelas da dinâmica:', err.message);
});

// ---------- Candidatos ----------

const CAND_COLS = [
  'nome', 'curso', 'faculdade', 'formacao', 'telefone', 'email', 'linkedin_url',
  'turno', 'data_dinamica', 'historico', 'cv_arquivo_id', 'foto_arquivo_id',
];
const CAND_NULLABLE_EMPTY = ['data_dinamica', 'cv_arquivo_id', 'foto_arquivo_id'];

function cleanCandidato(body) {
  const out = {};
  for (const c of CAND_COLS) {
    if (c in body) {
      let v = body[c];
      if (v === '' && CAND_NULLABLE_EMPTY.includes(c)) v = null;
      out[c] = v;
    }
  }
  return out;
}

async function findCandidatos() {
  const result = await query('SELECT * FROM dinamica_candidatos ORDER BY turno, nome');
  return result.rows;
}

async function insertCandidato(body) {
  const data = cleanCandidato(body);
  if (!data.nome) throw new Error('nome é obrigatório');
  const cols = Object.keys(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const result = await query(
    `INSERT INTO dinamica_candidatos (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
    cols.map((c) => data[c])
  );
  return result.rows[0];
}

async function updateCandidato(id, body) {
  const data = cleanCandidato(body);
  const cols = Object.keys(data);
  if (!cols.length) throw new Error('payload vazio');
  const set = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const result = await query(
    `UPDATE dinamica_candidatos SET ${set} WHERE id=$${cols.length + 1} RETURNING *`,
    [...cols.map((c) => data[c]), id]
  );
  return result.rows[0];
}

async function deleteCandidato(id) {
  const result = await query('DELETE FROM dinamica_candidatos WHERE id=$1 RETURNING *', [id]);
  return result.rows[0];
}

// ---------- Gestores ----------

async function findGestores() {
  const result = await query('SELECT * FROM dinamica_gestores ORDER BY turno, nome');
  return result.rows;
}

async function insertGestor({ nome, email, turno, data_dinamica, token }) {
  const result = await query(
    `INSERT INTO dinamica_gestores (nome, email, turno, data_dinamica, token)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [nome, email || null, turno || '09h-11h', data_dinamica || null, token]
  );
  return result.rows[0];
}

async function deleteGestor(id) {
  const result = await query('DELETE FROM dinamica_gestores WHERE id=$1 RETURNING *', [id]);
  return result.rows[0];
}

async function gestorPorToken(token) {
  const result = await query('SELECT * FROM dinamica_gestores WHERE token=$1', [token]);
  return result.rows[0] || null;
}

// ---------- Notas ----------

async function candidatosDoGestor(gestor) {
  const params = [gestor.turno];
  let sql = `SELECT id, nome, curso, faculdade, formacao, telefone, email, linkedin_url, historico, cv_arquivo_id, foto_arquivo_id
             FROM dinamica_candidatos WHERE turno=$1`;
  if (gestor.data_dinamica) {
    params.push(gestor.data_dinamica);
    sql += ' AND data_dinamica=$2';
  }
  sql += ' ORDER BY nome';
  const { rows: candidatos } = await query(sql, params);

  const { rows: notas } = await query(
    'SELECT candidato_id, nota, comentario FROM dinamica_notas WHERE gestor_id=$1',
    [gestor.id]
  );
  const notaPorCandidato = {};
  for (const n of notas) notaPorCandidato[n.candidato_id] = n;

  return candidatos.map((c) => ({
    ...c,
    minha_nota: notaPorCandidato[c.id] ? notaPorCandidato[c.id].nota : null,
    meu_comentario: notaPorCandidato[c.id] ? notaPorCandidato[c.id].comentario : '',
  }));
}

async function candidatoPertenceAoTurno(candidatoId, turno) {
  const { rows } = await query('SELECT id, turno FROM dinamica_candidatos WHERE id=$1', [candidatoId]);
  return rows.length > 0 && rows[0].turno === turno;
}

async function upsertNota({ candidato_id, gestor_id, nota, comentario }) {
  const result = await query(
    `INSERT INTO dinamica_notas (candidato_id, gestor_id, nota, comentario)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (candidato_id, gestor_id)
     DO UPDATE SET nota=$3, comentario=$4, updated_at=NOW()
     RETURNING *`,
    [candidato_id, gestor_id, nota, comentario || '']
  );
  return result.rows[0];
}

async function resultados() {
  const result = await query(`
    SELECT
      c.*,
      COUNT(n.id)::int AS qtd_avaliacoes,
      ROUND(AVG(n.nota)::numeric, 2) AS media,
      COALESCE(
        json_agg(
          json_build_object('gestor', g.nome, 'nota', n.nota, 'comentario', n.comentario)
          ORDER BY g.nome
        ) FILTER (WHERE n.id IS NOT NULL),
        '[]'
      ) AS avaliacoes
    FROM dinamica_candidatos c
    LEFT JOIN dinamica_notas n ON n.candidato_id = c.id
    LEFT JOIN dinamica_gestores g ON g.id = n.gestor_id
    GROUP BY c.id
    ORDER BY media DESC NULLS LAST, c.nome
  `);
  return result.rows;
}

// ---------- Arquivos (CV) ----------

async function insertArquivo({ tipo, nome, mime, dados }) {
  const result = await query(
    'INSERT INTO arquivos (tipo, nome, mime, dados) VALUES ($1,$2,$3,$4) RETURNING id',
    [(tipo || '').slice(0, 20), (nome || '').slice(0, 300), mime || 'application/octet-stream', dados]
  );
  return result.rows[0];
}

async function findArquivo(id) {
  const result = await query('SELECT nome, mime, dados FROM arquivos WHERE id=$1', [id]);
  return result.rows[0] || null;
}

module.exports = {
  findCandidatos, insertCandidato, updateCandidato, deleteCandidato,
  findGestores, insertGestor, deleteGestor, gestorPorToken,
  candidatosDoGestor, candidatoPertenceAoTurno, upsertNota, resultados,
  insertArquivo, findArquivo,
};
