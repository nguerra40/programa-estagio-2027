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
const { resumirCurriculo } = require('../services/resumoIA');

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
    const candidato = await db.insertCandidato(req.body);
    res.status(201).json(candidato);
  } catch (error) {
    console.error('[API] Erro ao criar candidato:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Import em lote: um candidato por CV enviado (nome inicial = nome do arquivo).
router.post('/candidatos/bulk', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { turno, data_dinamica, arquivos } = req.body;
    if (!Array.isArray(arquivos) || !arquivos.length) {
      return res.status(400).json({ error: 'Nenhum currículo enviado.' });
    }

    const criados = [];
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

      // Resumo automático do histórico via IA (best-effort, ver services/resumoIA.js).
      const historico = await resumirCurriculo(dados);

      const nomeCandidato = (arq.nome || 'Candidato').replace(/\.pdf$/i, '');
      const candidato = await db.insertCandidato({
        nome: nomeCandidato,
        turno: turno || '09h-11h',
        data_dinamica: data_dinamica || null,
        cv_arquivo_id: arquivo.id,
        historico,
      });
      criados.push(candidato);
    }

    res.status(201).json({ criados: criados.length, candidatos: criados });
  } catch (error) {
    console.error('[API] Erro no import em lote:', error.message);
    res.status(500).json({ error: 'Erro interno no import em lote.' });
  }
});

router.put('/candidatos/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const updated = await db.updateCandidato(req.params.id, req.body);
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
router.get('/resultados', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.resultados());
  } catch (error) {
    console.error('[API] Erro ao calcular resultados:', error.message);
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
    });
    res.json(registro);
  } catch (error) {
    console.error('[API] Erro ao salvar nota:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
