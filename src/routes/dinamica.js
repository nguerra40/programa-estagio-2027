// ============================================================
// API da dinâmica de estágio (avaliação de candidatos pelos gestores).
// Duas frentes nesta mesma rota:
//
// 1) ADMIN (autenticado + isAdmin):
//    GET/POST/PUT/DELETE /api/dinamica/candidatos
//    POST                /api/dinamica/candidatos/bulk  (import em lote de CVs)
//    GET                 /api/dinamica/resultados        (nota média por candidato)
//
// 2) QUALQUER COLABORADOR LOGADO (autenticado, sem exigir admin):
//    GET  /api/dinamica/liberados?email=...   -> candidatos liberados pra avaliação
//    POST /api/dinamica/notas                 -> grava/atualiza a nota do avaliador logado
//
// Não existe mais link pessoal por token/gestor: quem avalia é qualquer
// colaborador que já está logado no site (mesmo login usado no resto do
// app), e o que controla quem aparece pra avaliação é o campo `liberado`
// que o admin liga por candidato — não mais um turno amarrado a um token.
// ============================================================
const express = require('express');
const router = express.Router();
const db = require('../database/dinamica');
const { isAuthenticated, isAdmin } = require('../auth/middleware');
const { analisarCurriculo } = require('../services/resumoIA');

// ============================================================
// EXPORTAÇÃO TEMPORÁRIA — só pra migração pro Supabase/Netlify (ver
// conversa com a Natasha). Remover depois que a migração terminar.
// ============================================================
router.get('/admin-export/resumo', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.adminExportResumo());
  } catch (error) {
    console.error('[API] Erro no resumo de exportação:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/admin-export/dados', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.adminExportDados());
  } catch (error) {
    console.error('[API] Erro ao exportar dados:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/admin-export/arquivos', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const offset = Number(req.query.offset || 0);
    const limit = Math.min(Number(req.query.limit || 5), 20);
    res.json({ rows: await db.adminExportArquivos(offset, limit) });
  } catch (error) {
    console.error('[API] Erro ao exportar arquivos:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ADMIN — candidatos
// ============================================================
router.get('/candidatos', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.findCandidatos());
  } catch (error) {
    console.error('[API] Erro ao listar candidatos:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/candidatos', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const candidato = await db.insertCandidato(req.body, req.body.admin_email);
    res.status(201).json(candidato);
  } catch (error) {
    console.error('[API] Erro ao criar candidato:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Libera/remove vários candidatos de uma vez.
router.patch('/candidatos/liberar-lote', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const liberado = !!req.body.liberado;
    if (!ids.length) return res.status(400).json({ error: 'Nenhum candidato selecionado.' });
    const atualizados = await db.liberarEmLote(ids, liberado, req.body.admin_email);
    res.json({ atualizados: atualizados.length, candidatos: atualizados });
  } catch (error) {
    console.error('[API] Erro ao liberar em lote:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Define o status (Pendente/Aprovado/Reprovado/Ausente) de vários candidatos
// de uma vez — mesmo espírito do liberar-lote acima.
router.patch('/candidatos/status-lote', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const status = String(req.body.status || '');
    if (!ids.length) return res.status(400).json({ error: 'Nenhum candidato selecionado.' });
    const atualizados = await db.statusEmLote(ids, status, req.body.admin_email);
    res.json({ atualizados: atualizados.length, candidatos: atualizados });
  } catch (error) {
    console.error('[API] Erro ao definir status em lote:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Import em lote: um candidato por CV enviado (nome inicial = nome do arquivo).
router.post('/candidatos/bulk', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { turno, arquivos, admin_email } = req.body;
    if (!Array.isArray(arquivos) || !arquivos.length) {
      return res.status(400).json({ error: 'Nenhum currículo enviado.' });
    }

    const criados = [];
    const avisosDuplicata = [];
    for (const arq of arquivos) {
      let dados = arq.dados;
      const comma = typeof dados === 'string' ? dados.indexOf(',') : -1;
      if (typeof dados === 'string' && dados.startsWith('data:') && comma >= 0) {
        dados = dados.slice(comma + 1);
      }
      // Força sempre application/pdf (esse endpoint só existe pra CV em PDF)
      // em vez de confiar no mime que o cliente mandou — o arquivo é servido
      // de volta com esse Content-Type, então aceitar qualquer valor aqui
      // abriria a mesma brecha de XSS corrigida em routes/arquivos.js.
      const mime = 'application/pdf';
      const arquivo = await db.insertArquivo({ tipo: 'cv', nome: arq.nome, mime, dados });

      // Extrai curso/faculdade/formação via IA (best-effort, ver services/resumoIA.js).
      const analise = await analisarCurriculo(dados);

      const nomeCandidato = (arq.nome || 'Candidato').replace(/\.pdf$/i, '');

      const duplicatas = await db.encontrarPossiveisDuplicatas(nomeCandidato, null, null);
      if (duplicatas.length) {
        avisosDuplicata.push({ nome: nomeCandidato, parecidoCom: duplicatas.map((d) => d.nome) });
      }

      const candidato = await db.insertCandidato({
        nome: nomeCandidato,
        turno: turno || '09h-11h',
        cv_arquivo_id: arquivo.id,
        curso: analise.curso || '',
        faculdade: analise.faculdade || '',
        formacao: analise.formacao || '',
      }, admin_email);
      criados.push(candidato);
    }

    res.status(201).json({ criados: criados.length, candidatos: criados, avisos_duplicata: avisosDuplicata });
  } catch (error) {
    console.error('[API] Erro no import em lote:', error.message);
    res.status(500).json({ error: 'Erro interno no import em lote.' });
  }
});

function normalizarNomeArquivo(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Anexa currículos em lote a candidatos JÁ CADASTRADOS — casando pelo nome
// do arquivo com o nome do candidato (ex.: "Maria Silva.pdf" vai pro
// candidato "Maria Silva"). Diferente de /candidatos/bulk, que sempre cria
// um candidato novo por arquivo: isso aqui serve pra quando o candidato já
// existe (ex.: importado via planilha, sem CV) e só falta o currículo.
router.post('/candidatos/anexar-cvs-lote', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { arquivos, admin_email } = req.body;
    if (!Array.isArray(arquivos) || !arquivos.length) {
      return res.status(400).json({ error: 'Nenhum currículo enviado.' });
    }

    const candidatos = await db.findCandidatos();
    const porNome = new Map();
    for (const c of candidatos) {
      const chave = normalizarNomeArquivo(c.nome);
      if (!porNome.has(chave)) porNome.set(chave, []);
      porNome.get(chave).push(c);
    }

    const anexados = [];
    const avisos = [];
    for (const arq of arquivos) {
      const nomeArquivo = (arq.nome || '').replace(/\.pdf$/i, '');
      const encontrados = porNome.get(normalizarNomeArquivo(nomeArquivo)) || [];
      if (encontrados.length !== 1) {
        avisos.push({
          arquivo: arq.nome,
          motivo: encontrados.length === 0
            ? 'Nenhum candidato cadastrado com esse nome.'
            : 'Mais de um candidato com esse nome — anexe manualmente pelo formulário de edição.',
        });
        continue;
      }
      const candidato = encontrados[0];

      let dados = arq.dados;
      const comma = typeof dados === 'string' ? dados.indexOf(',') : -1;
      if (typeof dados === 'string' && dados.startsWith('data:') && comma >= 0) {
        dados = dados.slice(comma + 1);
      }
      // Mesma defesa do /candidatos/bulk: força application/pdf em vez de
      // confiar no mime que o cliente mandou.
      const arquivoSalvo = await db.insertArquivo({ tipo: 'cv', nome: arq.nome, mime: 'application/pdf', dados });

      // Preenche curso/faculdade/formação via IA só se o candidato ainda não
      // tiver esses campos (ex.: veio da planilha sem isso) — nunca sobrescreve
      // dado que já existe.
      const campos = { cv_arquivo_id: arquivoSalvo.id };
      if (!candidato.curso || !candidato.faculdade || !candidato.formacao) {
        const analise = await analisarCurriculo(dados);
        if (!candidato.curso && analise.curso) campos.curso = analise.curso;
        if (!candidato.faculdade && analise.faculdade) campos.faculdade = analise.faculdade;
        if (!candidato.formacao && analise.formacao) campos.formacao = analise.formacao;
      }
      await db.updateCandidato(candidato.id, campos, admin_email);
      anexados.push({ id: candidato.id, nome: candidato.nome });
    }

    res.json({ anexados: anexados.length, avisos });
  } catch (error) {
    console.error('[API] Erro ao anexar currículos em lote:', error.message);
    res.status(500).json({ error: 'Erro interno ao anexar currículos.' });
  }
});

// Import de planilha (ex.: lista de aprovados do RH, já com gênero/curso/
// faculdade/dinâmica). O parse do arquivo acontece no navegador (SheetJS via
// CDN, ver public/index.html) — aqui só chega um array já mapeado pros
// campos do candidato, então essa rota nunca lida com o arquivo bruto.
router.post('/candidatos/importar-planilha', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const linhas = Array.isArray(req.body.linhas) ? req.body.linhas : [];
    if (!linhas.length) return res.status(400).json({ error: 'Nenhuma linha para importar.' });
    const resultado = await db.importarPlanilha(linhas, req.body.admin_email);
    res.json(resultado);
  } catch (error) {
    console.error('[API] Erro ao importar planilha:', error.message);
    res.status(500).json({ error: 'Erro interno ao importar planilha.' });
  }
});

router.put('/candidatos/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const updated = await db.updateCandidato(req.params.id, req.body, req.body.admin_email);
    if (!updated) return res.status(404).json({ error: 'Candidato não encontrado.' });
    res.json(updated);
  } catch (error) {
    console.error('[API] Erro ao editar candidato:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/candidatos/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const removed = await db.deleteCandidato(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Candidato não encontrado.' });
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Erro ao excluir candidato:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ============================================================
// ADMIN — resultados (nota média por candidato, calculada no banco)
// ============================================================
function filtrosResultados(query) {
  const filtros = {};
  for (const campo of ['turno', 'genero', 'curso', 'faculdade', 'nome', 'area', 'area_final', 'tipo_programa', 'nota_comite', 'media', 'indicado_por']) {
    const valor = (query[campo] || '').trim();
    if (valor) filtros[campo] = valor;
  }
  return filtros;
}

router.get('/resultados', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.resultados(filtrosResultados(req.query)));
  } catch (error) {
    console.error('[API] Erro ao calcular resultados:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.get('/resultados/export', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const filtros = filtrosResultados(req.query);
    const dados = await db.resultados(filtros);

    const BOM = '﻿';
    const separator = ';';
    const headers = ['Nome', 'Indicação', 'Status', 'Gênero', 'Curso', 'Faculdade', 'Banca', 'Área', 'Média', 'Nota Comitê', 'Área Final', 'Tipo de Programa', 'Qtd. Avaliações', 'Avaliações'];

    const rows = dados.map((c) => {
      const areas = [...new Set((c.avaliacoes || []).flatMap((a) => a.areas_interesse || []))].join(' / ');
      const avaliacoes = (c.avaliacoes || [])
        .map((a) => `${a.avaliador || a.email || '?'} (${a.nota}${(a.areas_interesse && a.areas_interesse.length) ? ', interesse: ' + a.areas_interesse.join(' / ') : ''}): ${a.comentario || ''}`)
        .join(' | ');
      return [c.nome, c.indicado_por || '', c.status || '', c.genero || '', c.curso || '', c.faculdade || '', c.turno, areas, c.media != null ? c.media : '', c.nota_comite != null ? c.nota_comite : '', c.area_final || '', c.tipo_programa || '', c.qtd_avaliacoes, avaliacoes]
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(separator);
    });

    const csv = BOM + headers.join(separator) + '\n' + rows.join('\n');

    const sufixoFiltros = Object.values(filtros).map((v) => `_${v.replace(/[^a-z0-9]+/gi, '-')}`).join('');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=resultados_dinamica${sufixoFiltros}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('[API] Erro ao exportar resultados:', error.message);
    res.status(500).json({ error: 'Erro interno ao exportar.' });
  }
});

// Corrigir ou remover a nota de um avaliador específico — pra quando uma
// nota foi lançada errada (ex.: clique errado durante um teste) e fica
// poluindo o ranking da banca.
router.put('/candidatos/:id/notas/:avaliadorEmail', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const candidatoId = Number(req.params.id);
    const avaliadorEmail = String(req.params.avaliadorEmail || '').toLowerCase().trim();
    const nota = Number(req.body.nota);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ error: 'Nota deve ser um número inteiro de 1 a 5.' });
    }
    const registro = await db.atualizarNotaAdmin(candidatoId, avaliadorEmail, nota);
    if (!registro) return res.status(404).json({ error: 'Nota não encontrada.' });
    res.json(registro);
  } catch (error) {
    console.error('[API] Erro ao atualizar nota:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.delete('/candidatos/:id/notas/:avaliadorEmail', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const candidatoId = Number(req.params.id);
    const avaliadorEmail = String(req.params.avaliadorEmail || '').toLowerCase().trim();
    await db.deleteNota(candidatoId, avaliadorEmail);
    res.json({ ok: true });
  } catch (error) {
    console.error('[API] Erro ao remover nota:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Gestores por banca — qual gestor pode ver os liberados de qual turno
// (dia/horário). Sem isso, qualquer gestor logado via os liberados de
// TODAS as bancas ao mesmo tempo, não só a dele.
router.get('/avaliadores-banca', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.listarAvaliadoresBanca());
  } catch (error) {
    console.error('[API] Erro ao listar gestores por banca:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/avaliadores-banca', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const avaliadorEmail = String(req.body.avaliador_email || '').toLowerCase().trim();
    const turno = String(req.body.turno || '').trim();
    if (!avaliadorEmail) return res.status(400).json({ error: 'E-mail do gestor é obrigatório.' });
    if (!turno) return res.status(400).json({ error: 'Banca (turno) é obrigatória.' });
    const registro = await db.atribuirAvaliadorBanca(avaliadorEmail, turno);
    res.json(registro || { avaliador_email: avaliadorEmail, turno, jaExistia: true });
  } catch (error) {
    console.error('[API] Erro ao associar gestor à banca:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.delete('/avaliadores-banca/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await db.removerAvaliadorBanca(Number(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    console.error('[API] Erro ao remover gestor da banca:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ============================================================
// QUALQUER COLABORADOR LOGADO — avaliação dos candidatos liberados
// ============================================================
router.get('/liberados', isAuthenticated, async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase().trim() || null;
    res.json(await db.findLiberados(email));
  } catch (error) {
    console.error('[API] Erro ao listar candidatos liberados:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/notas', isAuthenticated, async (req, res) => {
  try {
    const candidatoId = Number(req.body.candidato_id);
    const nota = Number(req.body.nota);
    const avaliadorEmail = String(req.body.avaliador_email || '').toLowerCase().trim();
    const avaliadorNome = String(req.body.avaliador_nome || '').slice(0, 255);
    const comentario = req.body.comentario == null ? '' : String(req.body.comentario).slice(0, 4000);
    const areasInteresse = Array.isArray(req.body.areas_interesse)
      ? req.body.areas_interesse.map((a) => String(a).trim()).filter(Boolean).slice(0, 10)
      : [];

    if (!candidatoId) return res.status(400).json({ error: 'candidato_id é obrigatório.' });
    if (!avaliadorEmail) return res.status(400).json({ error: 'avaliador_email é obrigatório.' });
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ error: 'Nota deve ser um número inteiro de 1 a 5.' });
    }

    const liberado = await db.candidatoEstaLiberado(candidatoId);
    if (!liberado) {
      return res.status(403).json({ error: 'Este candidato não está liberado para avaliação.' });
    }

    const registro = await db.upsertNota({
      candidato_id: candidatoId,
      avaliador_email: avaliadorEmail,
      avaliador_nome: avaliadorNome,
      nota,
      comentario,
      areas_interesse: areasInteresse,
    });
    res.json(registro);
  } catch (error) {
    console.error('[API] Erro ao salvar nota:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
