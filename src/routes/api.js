const express = require('express');
const router = express.Router();
const db = require('../database/connection');

/**
 * POST /api/solicitacoes
 * Cria uma nova solicitação de vaga de estágio.
 */
router.post('/solicitacoes', (req, res) => {
  try {
    const { gestor, email, vagas, area, subarea, comentario } = req.body;

    if (!gestor || !email || !vagas || !area || !subarea) {
      return res.status(400).json({ error: 'Campos obrigatórios: gestor, email, vagas, area, subarea.' });
    }

    if (vagas < 1 || vagas > 5) {
      return res.status(400).json({ error: 'Quantidade de vagas deve ser entre 1 e 5.' });
    }

    const record = db.insert({
      gestor,
      email,
      vagas: parseInt(vagas),
      area,
      subarea,
      comentario: comentario || ''
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    console.error('[API] Erro ao criar solicitação:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar solicitação.' });
  }
});

/**
 * GET /api/solicitacoes
 * Lista todas as solicitações.
 */
router.get('/solicitacoes', (req, res) => {
  try {
    const data = db.findAll();
    res.json({ data });
  } catch (error) {
    console.error('[API] Erro ao listar:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/minhas-solicitacoes?email=xxx
 * Lista solicitações de um gestor específico.
 */
router.get('/minhas-solicitacoes', (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Email obrigatório.' });
    const data = db.findByEmail(email);
    res.json({ data });
  } catch (error) {
    console.error('[API] Erro:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/stats
 * Retorna estatísticas.
 */
router.get('/stats', (req, res) => {
  try {
    res.json(db.stats());
  } catch (error) {
    console.error('[API] Erro stats:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/export
 * Exporta solicitações em formato CSV.
 */
router.get('/export', (req, res) => {
  try {
    const data = db.findAll();

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

/**
 * PUT /api/solicitacoes/:id
 * Edita uma solicitação existente.
 */
router.put('/solicitacoes/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { gestor, email, vagas, area, subarea, comentario } = req.body;

    const data = db.findAll();
    const index = data.findIndex(item => item.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    // Atualiza
    const updated = db.update(id, { gestor, email, vagas: parseInt(vagas), area, subarea, comentario: comentario || '' });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[API] Erro ao editar:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
