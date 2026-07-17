const express = require('express');
const router = express.Router();
const pool = require('../database/connection');
const { isAuthenticated, isAdmin } = require('../auth/middleware');

/**
 * POST /api/solicitacoes
 * Cria uma nova solicitação de vaga de estágio.
 */
router.post('/solicitacoes', isAuthenticated, async (req, res) => {
  try {
    const { gestor, email, vagas, area, subarea, comentario } = req.body;

    // Validação
    if (!gestor || !email || !vagas || !area || !subarea) {
      return res.status(400).json({ error: 'Campos obrigatórios: gestor, email, vagas, area, subarea.' });
    }

    if (vagas < 1 || vagas > 5) {
      return res.status(400).json({ error: 'Quantidade de vagas deve ser entre 1 e 5.' });
    }

    const result = await pool.query(
      `INSERT INTO solicitacoes (gestor, email, vagas, area, subarea, comentario)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [gestor, email, parseInt(vagas), area, subarea, comentario || null]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Erro ao criar solicitação:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar solicitação.' });
  }
});

/**
 * GET /api/solicitacoes
 * Lista todas as solicitações (apenas admin).
 */
router.get('/solicitacoes', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM solicitacoes ORDER BY created_at DESC'
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('[API] Erro ao listar solicitações:', error.message);
    res.status(500).json({ error: 'Erro interno ao buscar solicitações.' });
  }
});

/**
 * GET /api/stats
 * Retorna estatísticas (apenas admin).
 */
router.get('/stats', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const vagasResult = await pool.query('SELECT COALESCE(SUM(vagas), 0) as total_vagas FROM solicitacoes');
    const areasResult = await pool.query('SELECT COUNT(DISTINCT area) as total_areas FROM solicitacoes');

    res.json({
      totalVagas: parseInt(vagasResult.rows[0].total_vagas),
      totalAreas: parseInt(areasResult.rows[0].total_areas)
    });
  } catch (error) {
    console.error('[API] Erro ao buscar stats:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/export
 * Exporta solicitações em formato CSV (apenas admin).
 */
router.get('/export', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT created_at, gestor, email, vagas, area, subarea, comentario FROM solicitacoes ORDER BY created_at DESC'
    );

    const BOM = '\uFEFF';
    const separator = ';';
    const headers = ['Data', 'Gestor', 'E-mail', 'Vagas', 'Área', 'Subárea', 'Comentário'];

    const rows = result.rows.map(item => {
      const data = new Date(item.created_at).toLocaleDateString('pt-BR');
      return [data, item.gestor, item.email, item.vagas, item.area, item.subarea, item.comentario || '']
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
