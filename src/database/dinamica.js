const { query } = require('./connection');

// Auto-cria/ajusta as tabelas da dinâmica de estágio (candidatos, notas e
// arquivos). Segue o mesmo padrão de connection.js: idempotente, roda ao
// carregar o módulo.
//
// Não cria mais dinamica_gestores nem usa gestor_id/token — o acesso do
// gestor avaliador agora é pelo login normal do site (avaliador_email),
// não por link pessoal. Se a tabela dinamica_gestores já existir de uma
// versão anterior, fica órfã e inofensiva (não é apagada).
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
    liberado BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS foto_arquivo_id BIGINT REFERENCES arquivos(id) ON DELETE SET NULL;
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS liberado BOOLEAN NOT NULL DEFAULT false;
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS criado_por TEXT;
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS atualizado_por TEXT;
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP WITH TIME ZONE;
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS liberado_por TEXT;
`)).then(() => query(`
  ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS liberado_em TIMESTAMP WITH TIME ZONE;
`)).then(() => query(`
  CREATE TABLE IF NOT EXISTS dinamica_notas (
    id BIGSERIAL PRIMARY KEY,
    candidato_id BIGINT NOT NULL REFERENCES dinamica_candidatos(id) ON DELETE CASCADE,
    avaliador_email TEXT NOT NULL,
    avaliador_nome TEXT,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (candidato_id, avaliador_email)
  );
`)).then(() => query(`
  ALTER TABLE dinamica_notas ADD COLUMN IF NOT EXISTS avaliador_email TEXT;
`)).then(() => query(`
  ALTER TABLE dinamica_notas ADD COLUMN IF NOT EXISTS avaliador_nome TEXT;
`)).then(() => query(`
  ALTER TABLE dinamica_notas ADD COLUMN IF NOT EXISTS area_interesse TEXT[];
`)).then(() => query(`
  -- area_interesse começou como TEXT (um valor só); agora é TEXT[] (vários
  -- valores). Converte só se ainda estiver no formato antigo — idempotente,
  -- não faz nada em bancos que já tenham a coluna como array.
  DO $$
  BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'dinamica_notas' AND column_name = 'area_interesse') = 'text' THEN
      ALTER TABLE dinamica_notas ALTER COLUMN area_interesse TYPE TEXT[] USING
        CASE WHEN area_interesse IS NULL OR area_interesse = '' THEN ARRAY[]::text[] ELSE ARRAY[area_interesse] END;
    END IF;
  END $$;
`)).then(() => query(`
  ALTER TABLE dinamica_notas DROP CONSTRAINT IF EXISTS dinamica_notas_candidato_id_gestor_id_key;
`)).then(() => query(`
  ALTER TABLE dinamica_notas DROP COLUMN IF EXISTS gestor_id;
`)).then(() => query(`
  CREATE UNIQUE INDEX IF NOT EXISTS dinamica_notas_candidato_avaliador_key ON dinamica_notas(candidato_id, avaliador_email);
`)).then(() => {
  console.log('[DB] Tabelas da dinâmica de estágio OK.');
}).catch(err => {
  console.error('[DB] Erro ao criar tabelas da dinâmica:', err.message);
});

// ---------- Candidatos ----------

// historico saiu do produto (não faz mais parte do cadastro) — a coluna
// continua existindo no banco com os dados antigos (inofensivo, mesmo
// padrão já usado aqui pra outras colunas descontinuadas), só não é mais
// lida nem gravada daqui pra frente. turno/data_dinamica continuam — são
// como o admin organiza quem participa de qual turno/dia da dinâmica.
const CAND_COLS = [
  'nome', 'curso', 'faculdade', 'formacao', 'telefone', 'email', 'linkedin_url',
  'turno', 'data_dinamica', 'cv_arquivo_id', 'foto_arquivo_id', 'liberado',
];
const CAND_NULLABLE_EMPTY = ['data_dinamica', 'cv_arquivo_id', 'foto_arquivo_id'];

// Só aceita LinkedIn com esquema http(s) — o campo é renderizado como link
// clicável pra qualquer avaliador, então um "javascript:" ou "data:" aqui
// vira execução de código na sessão de quem clicar. Ver também a checagem
// espelhada no front-end (isHttpUrl em public/index.html), já que um
// registro gravado antes dessa validação não pode virar link mesmo assim.
function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

function cleanCandidato(body) {
  const out = {};
  for (const c of CAND_COLS) {
    if (c in body) {
      let v = body[c];
      if (v === '' && CAND_NULLABLE_EMPTY.includes(c)) v = null;
      out[c] = v;
    }
  }
  if (out.linkedin_url && !isHttpUrl(out.linkedin_url)) {
    throw new Error('LinkedIn deve ser um link http(s) válido.');
  }
  return out;
}

async function findCandidatos() {
  const result = await query('SELECT * FROM dinamica_candidatos ORDER BY turno, nome');
  return result.rows;
}

function normalizarNome(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Heurística de duplicata — por nome (normalizado) ou e-mail igual, exceto o
// próprio candidato (em edição). Não bloqueia nada, só avisa: nomes iguais
// podem ser coincidência, e o admin decide.
async function encontrarPossiveisDuplicatas(nome, email, excludeId) {
  const nomeNorm = normalizarNome(nome);
  if (!nomeNorm && !email) return [];
  const { rows } = await query('SELECT id, nome, email FROM dinamica_candidatos');
  return rows.filter((c) => {
    if (excludeId && String(c.id) === String(excludeId)) return false;
    const mesmoNome = nomeNorm && normalizarNome(c.nome) === nomeNorm;
    const mesmoEmail = email && c.email && c.email.toLowerCase() === String(email).toLowerCase();
    return mesmoNome || mesmoEmail;
  });
}

async function insertCandidato(body, adminEmail) {
  const data = cleanCandidato(body);
  if (!data.nome) throw new Error('nome é obrigatório');
  data.criado_por = adminEmail || null;
  data.atualizado_por = adminEmail || null;
  data.atualizado_em = new Date();
  if (data.liberado) {
    data.liberado_por = adminEmail || null;
    data.liberado_em = new Date();
  }
  const cols = Object.keys(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const result = await query(
    `INSERT INTO dinamica_candidatos (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
    cols.map((c) => data[c])
  );
  return result.rows[0];
}

async function updateCandidato(id, body, adminEmail) {
  const data = cleanCandidato(body);
  if (!Object.keys(data).length) throw new Error('payload vazio');
  data.atualizado_por = adminEmail || null;
  data.atualizado_em = new Date();
  if ('liberado' in data) {
    data.liberado_por = adminEmail || null;
    data.liberado_em = new Date();
  }
  const cols = Object.keys(data);
  const set = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const result = await query(
    `UPDATE dinamica_candidatos SET ${set} WHERE id=$${cols.length + 1} RETURNING *`,
    [...cols.map((c) => data[c]), id]
  );
  return result.rows[0];
}

async function liberarEmLote(ids, liberado, adminEmail) {
  const result = await query(
    `UPDATE dinamica_candidatos
     SET liberado=$1, liberado_por=$2, liberado_em=NOW(), atualizado_por=$2, atualizado_em=NOW()
     WHERE id = ANY($3::bigint[])
     RETURNING *`,
    [liberado, adminEmail || null, ids]
  );
  return result.rows;
}

async function deleteCandidato(id) {
  const result = await query('DELETE FROM dinamica_candidatos WHERE id=$1 RETURNING *', [id]);
  return result.rows[0];
}

// ---------- Liberados (visão do avaliador logado) ----------

async function findLiberados(avaliadorEmail) {
  const { rows: candidatos } = await query(
    `SELECT id, nome, curso, faculdade, formacao, telefone, email, linkedin_url, cv_arquivo_id, foto_arquivo_id
     FROM dinamica_candidatos WHERE liberado = true ORDER BY nome`
  );

  let notaPorCandidato = {};
  if (avaliadorEmail) {
    const { rows: notas } = await query(
      'SELECT candidato_id, nota, comentario, area_interesse FROM dinamica_notas WHERE avaliador_email = $1',
      [avaliadorEmail]
    );
    for (const n of notas) notaPorCandidato[n.candidato_id] = n;
  }

  return candidatos.map((c) => ({
    ...c,
    minha_nota: notaPorCandidato[c.id] ? notaPorCandidato[c.id].nota : null,
    meu_comentario: notaPorCandidato[c.id] ? notaPorCandidato[c.id].comentario : '',
    minhas_areas_interesse: notaPorCandidato[c.id] ? notaPorCandidato[c.id].area_interesse || [] : [],
  }));
}

async function candidatoEstaLiberado(candidatoId) {
  const { rows } = await query('SELECT id FROM dinamica_candidatos WHERE id=$1 AND liberado=true', [candidatoId]);
  return rows.length > 0;
}

async function upsertNota({ candidato_id, avaliador_email, avaliador_nome, nota, comentario, areas_interesse }) {
  const result = await query(
    `INSERT INTO dinamica_notas (candidato_id, avaliador_email, avaliador_nome, nota, comentario, area_interesse)
     VALUES ($1,$2,$3,$4,$5,$6::text[])
     ON CONFLICT (candidato_id, avaliador_email)
     DO UPDATE SET nota=$4, comentario=$5, area_interesse=$6::text[], avaliador_nome=$3, updated_at=NOW()
     RETURNING *`,
    [candidato_id, avaliador_email, avaliador_nome || '', nota, comentario || '', areas_interesse || []]
  );
  return result.rows[0];
}

// Sem `turno`: todos os candidatos, ranqueados pela média geral — visão da
// reunião final de comitê, com todas as bancas juntas. Com `turno`: só os
// candidatos daquela banca — visão do encontro logo após cada dinâmica.
async function resultados(turno) {
  const where = turno ? 'WHERE c.turno = $1' : '';
  const params = turno ? [turno] : [];
  const result = await query(`
    SELECT
      c.*,
      COUNT(n.id)::int AS qtd_avaliacoes,
      ROUND(AVG(n.nota)::numeric, 2) AS media,
      COALESCE(
        json_agg(
          json_build_object('avaliador', n.avaliador_nome, 'email', n.avaliador_email, 'nota', n.nota, 'comentario', n.comentario, 'areas_interesse', n.area_interesse)
          ORDER BY n.avaliador_nome
        ) FILTER (WHERE n.id IS NOT NULL),
        '[]'
      ) AS avaliacoes
    FROM dinamica_candidatos c
    LEFT JOIN dinamica_notas n ON n.candidato_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY media DESC NULLS LAST, c.nome
  `, params);
  return result.rows;
}

// ---------- Arquivos (CV/foto) ----------

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
  liberarEmLote, encontrarPossiveisDuplicatas,
  findLiberados, candidatoEstaLiberado, upsertNota, resultados,
  insertArquivo, findArquivo,
};
