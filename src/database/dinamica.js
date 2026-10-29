const { query } = require('./connection');

// Auto-cria/ajusta as tabelas da dinâmica de estágio (candidatos, notas e
// arquivos). Segue o mesmo padrão de connection.js: idempotente, roda ao
// carregar o módulo.
//
// Não cria mais dinamica_gestores nem usa gestor_id/token — o acesso do
// gestor avaliador agora é pelo login normal do site (avaliador_email),
// não por link pessoal. Se a tabela dinamica_gestores já existir de uma
// versão anterior, fica órfã e inofensiva (não é apagada).
// Lista de passos (em vez de uma cadeia só de .then()) — um erro transiente
// de conexão num passo (já aconteceu contra o Supabase e contra o Postgres
// embarcado de teste local — ver conversa com a Natasha sobre as colunas
// area_final/tipo_programa/indicado_por sumindo) não pode travar TODOS os
// passos seguintes pra sempre; cada ALTER TABLE ADD COLUMN IF NOT EXISTS é
// idempotente, então rodar de novo no próximo cold start não tem custo.
const MIGRACOES_DINAMICA = [
  `
  CREATE TABLE IF NOT EXISTS arquivos (
    id BIGSERIAL PRIMARY KEY,
    tipo VARCHAR(20),
    nome VARCHAR(300),
    mime VARCHAR(100),
    dados TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  `,
  `
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
  `,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS foto_arquivo_id BIGINT REFERENCES arquivos(id) ON DELETE SET NULL;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS liberado BOOLEAN NOT NULL DEFAULT false;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS criado_por TEXT;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS atualizado_por TEXT;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP WITH TIME ZONE;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS liberado_por TEXT;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS liberado_em TIMESTAMP WITH TIME ZONE;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS genero TEXT;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pendente';`,
  // Nota do comitê (reunião final, após todas as bancas) — separada da
  // média dos gestores, não entra nesse cálculo. Editável direto na tela
  // de ranking.
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS nota_comite INTEGER;`,
  // Área final (definida pelo comitê, pode diferir da área de interesse que
  // o próprio candidato indicou na avaliação) e tipo de programa (regular
  // vs. férias) — editáveis direto na tela de ranking.
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS area_final TEXT;`,
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS tipo_programa TEXT;`,
  // Nome do sócio que indicou o candidato (se houver) — editável direto na
  // tela de ranking, ao lado do nome do candidato.
  `ALTER TABLE dinamica_candidatos ADD COLUMN IF NOT EXISTS indicado_por TEXT;`,
  `
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
  `,
  `ALTER TABLE dinamica_notas ADD COLUMN IF NOT EXISTS avaliador_email TEXT;`,
  `ALTER TABLE dinamica_notas ADD COLUMN IF NOT EXISTS avaliador_nome TEXT;`,
  `ALTER TABLE dinamica_notas ADD COLUMN IF NOT EXISTS area_interesse TEXT[];`,
  // area_interesse começou como TEXT (um valor só); agora é TEXT[] (vários
  // valores). Converte só se ainda estiver no formato antigo — idempotente,
  // não faz nada em bancos que já tenham a coluna como array.
  `
  DO $$
  BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'dinamica_notas' AND column_name = 'area_interesse') = 'text' THEN
      ALTER TABLE dinamica_notas ALTER COLUMN area_interesse TYPE TEXT[] USING
        CASE WHEN area_interesse IS NULL OR area_interesse = '' THEN ARRAY[]::text[] ELSE ARRAY[area_interesse] END;
    END IF;
  END $$;
  `,
  `ALTER TABLE dinamica_notas DROP CONSTRAINT IF EXISTS dinamica_notas_candidato_id_gestor_id_key;`,
  `ALTER TABLE dinamica_notas DROP COLUMN IF EXISTS gestor_id;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dinamica_notas_candidato_avaliador_key ON dinamica_notas(candidato_id, avaliador_email);`,
  // Qual gestor avalia qual banca (turno) — sem isso, todo gestor via os
  // candidatos liberados de QUALQUER banca, mesmo as que não eram dele.
  `
  CREATE TABLE IF NOT EXISTS dinamica_avaliadores_banca (
    id BIGSERIAL PRIMARY KEY,
    avaliador_email TEXT NOT NULL,
    turno TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (avaliador_email, turno)
  );
  `,
];

(async () => {
  let falhas = 0;
  for (const sql of MIGRACOES_DINAMICA) {
    try {
      await query(sql);
    } catch (err) {
      falhas++;
      console.error('[DB] Erro num passo da migração da dinâmica (seguindo pros próximos):', err.message);
    }
  }
  console.log(falhas ? `[DB] Migração da dinâmica concluída com ${falhas} passo(s) com erro — ver logs acima.` : '[DB] Tabelas da dinâmica de estágio OK.');
})();

// ---------- Candidatos ----------

// historico e data_dinamica saíram do produto (não fazem mais parte do
// cadastro) — as colunas continuam existindo no banco com os dados
// antigos (inofensivo, mesmo padrão já usado aqui pra outras colunas
// descontinuadas), só não são mais lidas nem gravadas daqui pra frente.
// "turno" sozinho virou o identificador único da banca (dia + horário,
// ex.: "02/10 às 09h00") — ter uma data separada também era redundante e
// confuso, já que o texto do turno já carrega essa informação.
const CAND_COLS = [
  'nome', 'curso', 'faculdade', 'formacao', 'telefone', 'email', 'linkedin_url',
  'turno', 'cv_arquivo_id', 'foto_arquivo_id', 'liberado', 'genero', 'status',
  'nota_comite', 'area_final', 'tipo_programa', 'indicado_por',
];

const STATUS_VALIDOS = ['Pendente', 'Aprovado', 'Reprovado', 'Ausente'];
const TIPO_PROGRAMA_VALIDOS = ['Programa de Estágio', 'Programa de Estágio de Férias'];
const CAND_NULLABLE_EMPTY = ['cv_arquivo_id', 'foto_arquivo_id', 'nota_comite'];

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
      // status é NOT NULL — vazio significa "não mexe" (mantém o atual no
      // update, ou cai no default 'Pendente' do banco na criação).
      if (c === 'status' && v === '') continue;
      out[c] = v;
    }
  }
  if (out.linkedin_url && !isHttpUrl(out.linkedin_url)) {
    throw new Error('LinkedIn deve ser um link http(s) válido.');
  }
  if (out.status && !STATUS_VALIDOS.includes(out.status)) {
    throw new Error('Status inválido.');
  }
  if (out.tipo_programa && !TIPO_PROGRAMA_VALIDOS.includes(out.tipo_programa)) {
    throw new Error('Tipo de programa inválido.');
  }
  if (out.nota_comite != null) {
    const n = Number(out.nota_comite);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new Error('Nota do comitê deve ser um número inteiro de 1 a 5.');
    }
    out.nota_comite = n;
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

async function statusEmLote(ids, status, adminEmail) {
  if (!STATUS_VALIDOS.includes(status)) throw new Error('Status inválido.');
  const result = await query(
    `UPDATE dinamica_candidatos
     SET status=$1, atualizado_por=$2, atualizado_em=NOW()
     WHERE id = ANY($3::bigint[])
     RETURNING *`,
    [status, adminEmail || null, ids]
  );
  return result.rows;
}

async function deleteCandidato(id) {
  const result = await query('DELETE FROM dinamica_candidatos WHERE id=$1 RETURNING *', [id]);
  return result.rows[0];
}

// Import de planilha (ex.: lista de aprovados vinda do RH) — casa cada linha
// com um candidato já existente por e-mail (prioridade) ou por nome exato
// (normalizado); sem match, cria um candidato novo. Nomes repetidos sem
// e-mail para desempatar viram aviso em vez de atualizar o errado.
async function importarPlanilha(linhas, adminEmail) {
  const { rows: existentes } = await query('SELECT id, nome, email FROM dinamica_candidatos');
  const porEmail = new Map(existentes.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
  const porNome = new Map();
  for (const c of existentes) {
    const chave = normalizarNome(c.nome);
    if (!porNome.has(chave)) porNome.set(chave, []);
    porNome.get(chave).push(c);
  }

  let criados = 0;
  let atualizados = 0;
  const avisos = [];

  for (const linha of linhas) {
    const nome = String(linha.nome || '').trim();
    if (!nome) {
      avisos.push({ nome: '(sem nome)', motivo: 'Linha sem nome — ignorada.' });
      continue;
    }
    const email = linha.email ? String(linha.email).trim().toLowerCase() : '';

    let match = email ? porEmail.get(email) : null;
    if (!match) {
      const comMesmoNome = porNome.get(normalizarNome(nome)) || [];
      if (comMesmoNome.length === 1) match = comMesmoNome[0];
      else if (comMesmoNome.length > 1) {
        avisos.push({ nome, motivo: 'Mais de um candidato já cadastrado com esse nome — confira manualmente, não atualizei automaticamente.' });
        continue;
      }
    }

    const campos = {};
    for (const [campo, valor] of Object.entries(linha)) {
      if (campo === 'nome' || valor === undefined || valor === null || valor === '') continue;
      campos[campo] = valor;
    }

    try {
      if (match) {
        await updateCandidato(match.id, campos, adminEmail);
        atualizados++;
      } else {
        const criado = await insertCandidato({ nome, ...campos }, adminEmail);
        porEmail.set(email, criado);
        criados++;
      }
    } catch (error) {
      avisos.push({ nome, motivo: error.message });
    }
  }

  return { criados, atualizados, avisos };
}

// ---------- Liberados (visão do avaliador logado) ----------

async function findLiberados(avaliadorEmail) {
  // Só mostra os liberados da(s) banca(s) que esse gestor está associado
  // (ver Gestores por banca no admin) — sem nenhuma associação, não vê
  // candidato nenhum, em vez de ver os de todas as bancas liberadas ao
  // mesmo tempo (era exatamente esse o problema relatado pela Natasha).
  let turnosDoAvaliador = [];
  if (avaliadorEmail) {
    const { rows } = await query(
      'SELECT turno FROM dinamica_avaliadores_banca WHERE avaliador_email = $1',
      [String(avaliadorEmail).toLowerCase().trim()]
    );
    turnosDoAvaliador = rows.map((r) => r.turno);
  }

  if (!turnosDoAvaliador.length) return [];

  const { rows: candidatos } = await query(
    `SELECT id, nome, curso, faculdade, formacao, telefone, email, linkedin_url, cv_arquivo_id, foto_arquivo_id, turno
     FROM dinamica_candidatos WHERE liberado = true AND turno = ANY($1::text[]) ORDER BY nome`,
    [turnosDoAvaliador]
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

// ---------- Gestores por banca (admin) ----------

async function listarAvaliadoresBanca() {
  const { rows } = await query(
    'SELECT id, avaliador_email, turno FROM dinamica_avaliadores_banca ORDER BY turno, avaliador_email'
  );
  return rows;
}

async function atribuirAvaliadorBanca(avaliadorEmail, turno) {
  const { rows } = await query(
    `INSERT INTO dinamica_avaliadores_banca (avaliador_email, turno) VALUES ($1, $2)
     ON CONFLICT (avaliador_email, turno) DO NOTHING RETURNING *`,
    [avaliadorEmail, turno]
  );
  return rows[0] || null;
}

async function removerAvaliadorBanca(id) {
  await query('DELETE FROM dinamica_avaliadores_banca WHERE id = $1', [id]);
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

// Admin corrigindo uma nota lançada errada (ex.: clique errado durante um
// teste) sem mexer no comentário/área de interesse que o avaliador escreveu.
async function atualizarNotaAdmin(candidato_id, avaliador_email, nota) {
  const result = await query(
    `UPDATE dinamica_notas SET nota=$1, updated_at=NOW() WHERE candidato_id=$2 AND avaliador_email=$3 RETURNING *`,
    [nota, candidato_id, avaliador_email]
  );
  return result.rows[0];
}

async function deleteNota(candidato_id, avaliador_email) {
  await query('DELETE FROM dinamica_notas WHERE candidato_id=$1 AND avaliador_email=$2', [candidato_id, avaliador_email]);
}

// Sem filtros: todos os candidatos, ranqueados pela média geral — visão da
// reunião final de comitê, com todas as bancas juntas. Com `turno`: só os
// candidatos daquela banca — visão do encontro logo após cada dinâmica.
// `genero`/`curso`/`faculdade`/`area` recortam o ranking pros mesmos
// filtros do painel (comparar como cada grupo se saiu, por exemplo).
// Campos de múltipla seleção chegam como string separada por "|" (um ou
// mais valores); `nome` é busca livre (substring, maiúsc./minúsc.).
async function resultados(filtros = {}) {
  const { turno, genero, curso, faculdade, nome, area, area_final, tipo_programa, nota_comite, media, indicado_por } = filtros;
  const condicoes = [];
  const params = [];
  for (const [coluna, valor] of [['c.turno', turno], ['c.genero', genero], ['c.curso', curso], ['c.faculdade', faculdade], ['c.area_final', area_final], ['c.tipo_programa', tipo_programa], ['c.indicado_por', indicado_por]]) {
    if (!valor) continue;
    const valores = String(valor).split('|').filter(Boolean);
    if (!valores.length) continue;
    params.push(valores);
    condicoes.push(`${coluna} = ANY($${params.length}::text[])`);
  }
  if (nome) {
    params.push(`%${nome}%`);
    condicoes.push(`c.nome ILIKE $${params.length}`);
  }
  if (area) {
    const valores = String(area).split('|').filter(Boolean);
    if (valores.length) {
      params.push(valores);
      condicoes.push(`EXISTS (
        SELECT 1 FROM dinamica_notas n2
        WHERE n2.candidato_id = c.id AND n2.area_interesse && $${params.length}::text[]
      )`);
    }
  }
  if (nota_comite) {
    const valores = String(nota_comite).split('|').filter(Boolean).map(Number).filter(Number.isInteger);
    if (valores.length) {
      params.push(valores);
      condicoes.push(`c.nota_comite = ANY($${params.length}::int[])`);
    }
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  // "média" é calculada na agregação (AVG das notas), então o filtro por
  // faixa arredondada (ex.: "4" cobre 3.5 a 4.49) só pode entrar como
  // HAVING, depois do GROUP BY.
  let having = '';
  if (media) {
    const valores = String(media).split('|').filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    if (valores.length) {
      params.push(valores);
      having = `HAVING ROUND(AVG(n.nota)::numeric, 0) = ANY($${params.length}::numeric[])`;
    }
  }

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
    ${having}
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

// ---------- Exportação temporária (migração pro Supabase) ----------
// Ver conversa com a Natasha — remover depois que a migração terminar.

async function adminExportResumo() {
  const [candidatos, notas, avaliadoresBanca, arquivos] = await Promise.all([
    query('SELECT count(*)::int AS n FROM dinamica_candidatos'),
    query('SELECT count(*)::int AS n FROM dinamica_notas'),
    query('SELECT count(*)::int AS n FROM dinamica_avaliadores_banca'),
    query('SELECT count(*)::int AS n, COALESCE(SUM(length(dados)),0)::bigint AS bytes FROM arquivos'),
  ]);
  return {
    candidatos: candidatos.rows[0].n,
    notas: notas.rows[0].n,
    avaliadoresBanca: avaliadoresBanca.rows[0].n,
    arquivos: arquivos.rows[0].n,
    arquivosBytes: Number(arquivos.rows[0].bytes),
  };
}

async function adminExportDados() {
  const [candidatos, notas, avaliadoresBanca] = await Promise.all([
    query('SELECT * FROM dinamica_candidatos ORDER BY id'),
    query('SELECT * FROM dinamica_notas ORDER BY id'),
    query('SELECT * FROM dinamica_avaliadores_banca ORDER BY id'),
  ]);
  return { candidatos: candidatos.rows, notas: notas.rows, avaliadoresBanca: avaliadoresBanca.rows };
}

async function adminExportArquivos(offset, limit) {
  const result = await query('SELECT * FROM arquivos ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]);
  return result.rows;
}

module.exports = {
  findCandidatos, insertCandidato, updateCandidato, deleteCandidato,
  liberarEmLote, statusEmLote, encontrarPossiveisDuplicatas, importarPlanilha,
  findLiberados, candidatoEstaLiberado, upsertNota, atualizarNotaAdmin, deleteNota, resultados,
  listarAvaliadoresBanca, atribuirAvaliadorBanca, removerAvaliadorBanca,
  insertArquivo, findArquivo,
  adminExportResumo, adminExportDados, adminExportArquivos,
};
