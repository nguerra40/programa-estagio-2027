const express = require('express');
const router = express.Router();

// Tenta conectar ao PostgreSQL; se não tiver, usa armazenamento em memória
let pool = null;
let useMemory = false;
let memoryStore = [];

try {
  pool = require('../database/connection');
  // Testa a conexão
  pool.query('SELECT 1').catch(() => {
    console.warn('[API] PostgreSQL indisponível — usando armazenamento em memória.');
    useMemory = true;
  });
} catch (e) {
  console.warn('[API] PostgreSQL não configurado — usando armazenamento em memória.');
  useMemory = true;
}

/**
 * POST /api/solicitacoes
 * Cria uma nova solicitação de vaga de estágio.
 */
router.post('/solicitacoes', async (req, res) => {
  try {
    const { gestor, email, vagas, area, subarea, comentario } = req.body;

    // Validação
    if (!gestor || !email || !vagas || !area || !subarea) {
      return res.status(400).json({ error: 'Campos obrigatórios: gestor, email, vagas, area, subarea.' });
    }

    if (vagas < 1 || vagas > 5) {
      return res.status(400).json({ error: 'Quantidade de vagas deve ser entre 1 e 5.' });
    }

    const solicitacao = {
      id: Date.now(),
      gestor,
      email,
      vagas: parseInt(vagas),
      area,
      subarea,
      comentario: comentario || null,
      created_at: new Date().toISOString()
    };

    if (!useMemory && pool) {
      try {
        const result = await pool.query(
          `INSERT INTO solicitacoes (gestor, email, vagas, area, subarea, comentario)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [gestor, email, parseInt(vagas), area, subarea, comentario || null]
        );
        return res.status(201).json({ success: true, data: result.rows[0] });
      } catch (dbErr) {
        console.warn('[API] Erro no PostgreSQL, salvando em memória:', dbErr.message);
        useMemory = true;
      }
    }

    // Fallback: memória
    memoryStore.push(solicitacao);
    res.status(201).json({ success: true, data: solicitacao });
  } catch (error) {
    console.error('[API] Erro ao criar solicitação:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar solicitação.' });
  }
});

/**
 * GET /api/solicitacoes
 * Lista todas as solicitações.
 */
router.get('/solicitacoes', async (req, res) => {
  try {
    if (!useMemory && pool) {
      try {
        const result = await pool.query(
          'SELECT * FROM solicitacoes ORDER BY created_at DESC'
        );
        return res.json({ data: result.rows });
      } catch (dbErr) {
        console.warn('[API] Erro no PostgreSQL, usando memória:', dbErr.message);
        useMemory = true;
      }
    }

    // Fallback: memória
    const sorted = [...memoryStore].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ data: sorted });
  } catch (error) {
    console.error('[API] Erro ao listar solicitações:', error.message);
    res.status(500).json({ error: 'Erro interno ao buscar solicitações.' });
  }
});

/**
 * GET /api/stats
 * Retorna estatísticas.
 */
router.get('/stats', async (req, res) => {
  try {
    if (!useMemory && pool) {
      try {
        const vagasResult = await pool.query('SELECT COALESCE(SUM(vagas), 0) as total_vagas FROM solicitacoes');
        const areasResult = await pool.query('SELECT COUNT(DISTINCT area) as total_areas FROM solicitacoes');
        return res.json({
          totalVagas: parseInt(vagasResult.rows[0].total_vagas),
          totalAreas: parseInt(areasResult.rows[0].total_areas)
        });
      } catch (dbErr) {
        useMemory = true;
      }
    }

    // Fallback: memória
    const totalVagas = memoryStore.reduce((sum, item) => sum + item.vagas, 0);
    const totalAreas = new Set(memoryStore.map(d => d.area)).size;
    res.json({ totalVagas, totalAreas });
  } catch (error) {
    console.error('[API] Erro ao buscar stats:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/**
 * GET /api/export
 * Exporta solicitações em formato CSV.
 */
router.get('/export', async (req, res) => {
  try {
    let rows;

    if (!useMemory && pool) {
      try {
        const result = await pool.query(
          'SELECT created_at, gestor, email, vagas, area, subarea, comentario FROM solicitacoes ORDER BY created_at DESC'
        );
        rows = result.rows;
      } catch (dbErr) {
        useMemory = true;
      }
    }

    if (!rows) {
      rows = [...memoryStore].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum dado para exportar.' });
    }

    const BOM = '\uFEFF';
    const separator = ';';
    const headers = ['Data', 'Gestor', 'E-mail', 'Vagas', 'Área', 'Subárea', 'Comentário'];

    const csvRows = rows.map(item => {
      const data = new Date(item.created_at).toLocaleDateString('pt-BR');
      return [data, item.gestor, item.email, item.vagas, item.area, item.subarea, item.comentario || '']
        .map(val => `"${String(val).replace(/"/g, '""')}"`)
        .join(separator);
    });

    const csv = BOM + headers.join(separator) + '\n' + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=solicitacoes_estagio_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('[API] Erro ao exportar:', error.message);
    res.status(500).json({ error: 'Erro interno ao exportar.' });
  }
});

module.exports = router;
