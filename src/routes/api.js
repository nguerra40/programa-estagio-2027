const express = require('express');
const router = express.Router();
const db = require('../database/connection');

/**
 * POST /api/solicitacoes
 */
router.post('/solicitacoes', async (req, res) => {
  try {
    const { gestor, email, vagas, area, subarea, comentario } = req.body;

    if (!gestor || !email || !vagas || !area || !subarea) {
      return res.status(400).json({ error: 'Campos obrigatórios: gestor, email, vagas, area, subarea.' });
    }

    if (vagas < 1 || vagas > 5) {
      return res.status(400).json({ error: 'Quantidade de vagas deve ser entre 1 e 5.' });
    }

    const record = await db.insert({ gestor, email, vagas: parseInt(vagas), area, subarea, comentario });
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    console.error('[API] Erro ao criar:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar solicitação.' });
  }
});

/**
 * GET /api/solicitacoes
 */
router.get('/solicitacoes', async (req, res) => {
  try {
    const data = await db.findAll();
    res.json({ data });
  } catch (error) {
    console.error('[API] Erro ao listar:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/minhas-solicitacoes?email=xxx
 */
router.get('/minhas-solicitacoes', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Email obrigatório.' });
    const data = await db.findByEmail(email);
    res.json({ data });
  } catch (error) {
    console.error('[API] Erro:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * PUT /api/solicitacoes/:id
 */
router.put('/solicitacoes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { gestor, email, vagas, area, subarea, comentario } = req.body;
    const updated = await db.update(id, { gestor, email, vagas: parseInt(vagas), area, subarea, comentario });
    if (!updated) return res.status(404).json({ error: 'Solicitação não encontrada.' });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[API] Erro ao editar:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const s = await db.stats();
    res.json(s);
  } catch (error) {
    console.error('[API] Erro stats:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/export
 */
router.get('/export', async (req, res) => {
  try {
    const data = await db.findAll();

    const BOM = '\uFEFF';
    const separator = ';';
    const headers = ['Data', 'Gestor', 'E-mail', 'Vagas', 'Área', 'Subárea', 'Comentário'];

    const rows = data.map(item => {
      const dataFormatada = new Date(item.created_at).toLocaleDateString('pt-BR');
      return [dataFormatada, item.gestor, item.email, item.vagas, item.area, item.subarea, item.comentario || '']
        .map(val => `"${String(val).replace(/"/g, '""')}"`)
        .join(separator);
    });

    const csv = BOM + headers.join(separator) + '\n' + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=solicitacoes_estagio_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('[API] Erro ao exportar:', error.message);
    res.status(500).json({ error: 'Erro interno ao exportar.' });
  }
});

module.exports = router;
