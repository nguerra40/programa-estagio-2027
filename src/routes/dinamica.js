// ============================================================
// API da dinâmica de estágio (avaliação de candidatos pelos gestores).
// Duas frentes nesta mesma rota:
//
// 1) ADMIN (autenticado + isAdmin):
//    GET/POST/PUT/DELETE /api/dinamica/candidatos
//    POST                /api/dinamica/candidatos/bulk  (import em lote de CVs)
//    GET/POST/DELETE     /api/dinamica/gestores          (POST gera o link pessoal)
//    GET                 /api/dinamica/resultados        (nota média por candidato)
//
// 2) PÚBLICO (sem login — o gestor acessa pelo link pessoal com token):
//    GET  /api/dinamica/publico/:token
//    POST /api/dinamica/publico/:token/notas
//    GET  /api/dinamica/publico/:token/cv/:candId
//
// As rotas públicas ficam fora de isAuthenticated/isAdmin (mesmo router, sem
// exigir sessão) porque o gestor avaliador não tem conta no sistema — a
// "senha" dele é o próprio token, que só existe no link pessoal gerado pelo
// admin.
// ============================================================
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database/dinamica');
const { isAuthenticated, isAdmin } = require('../auth/middleware');

function genToken() {
  return crypto.randomBytes(20).toString('hex');
}

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
      if (typeof dados === 'string' && dados.slice(0, 5) === 'data:' && comma >= 0) {
        dados = dados.slice(comma + 1);
      }
      const arquivo = await db.insertArquivo({
        tipo: 'cv',
        nome: arq.nome,
        mime: arq.mime || 'application/pdf',
        dados,
      });
      const nomeCandidato = (arq.nome || 'Candidato').replace(/\.pdf$/i, '');
      const candidato = await db.insertCandidato({
        nome: nomeCandidato,
        turno: turno || '09h-11h',
        data_dinamica: data_dinamica || null,
        cv_arquivo_id: arquivo.id,
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
// ADMIN — gestores (geram o link pessoal com token)
// ============================================================
router.get('/gestores', isAuthenticated, isAdmin, async (req, res) => {
  try {
    res.json(await db.findGestores());
  } catch (error) {
    console.error('[API] Erro ao listar gestores:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/gestores', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const gestor = await db.insertGestor({
      nome,
      email: req.body.email,
      turno: req.body.turno,
      data_dinamica: req.body.data_dinamica,
      token: genToken(),
    });
    res.status(201).json(gestor);
  } catch (error) {
    console.error('[API] Erro ao criar gestor:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.delete('/gestores/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const removed = await db.deleteGestor(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Gestor não encontrado.' });
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Erro ao excluir gestor:', error.message);
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
// PÚBLICO — o gestor acessa pelo link pessoal (token), sem login
// ============================================================
router.get('/publico/:token', async (req, res) => {
  try {
    const gestor = await db.gestorPorToken(req.params.token);
    if (!gestor) return res.status(404).json({ error: 'Link inválido ou expirado.' });

    const candidatos = await db.candidatosDoGestor(gestor);
    res.json({
      gestor: { nome: gestor.nome, turno: gestor.turno, data_dinamica: gestor.data_dinamica },
      candidatos,
    });
  } catch (error) {
    console.error('[API] Erro ao carregar candidatos do gestor:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/publico/:token/notas', async (req, res) => {
  try {
    const gestor = await db.gestorPorToken(req.params.token);
    if (!gestor) return res.status(404).json({ error: 'Link inválido ou expirado.' });

    const candidatoId = Number(req.body.candidato_id);
    const nota = Number(req.body.nota);
    const comentario = req.body.comentario == null ? '' : String(req.body.comentario).slice(0, 4000);
    if (!candidatoId) return res.status(400).json({ error: 'candidato_id é obrigatório.' });
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ error: 'Nota deve ser um número inteiro de 1 a 5.' });
    }

    // Confere que o candidato realmente pertence ao turno deste gestor
    // (evita que alguém edite a URL e avalie candidatos de outro turno).
    const pertence = await db.candidatoPertenceAoTurno(candidatoId, gestor.turno);
    if (!pertence) {
      return res.status(403).json({ error: 'Este candidato não está na sua dinâmica.' });
    }

    const registro = await db.upsertNota({ candidato_id: candidatoId, gestor_id: gestor.id, nota, comentario });
    res.json(registro);
  } catch (error) {
    console.error('[API] Erro ao salvar nota:', error.message);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Arquivo (CV ou foto) do candidato, liberado só para o gestor do turno
// correto (mesma regra de acesso da nota) — sem exigir login, pois o gestor
// não tem conta.
async function enviarArquivoDoCandidato(req, res, campo, rotulo) {
  try {
    const gestor = await db.gestorPorToken(req.params.token);
    if (!gestor) return res.status(404).send('Link inválido ou expirado.');

    const pertence = await db.candidatoPertenceAoTurno(req.params.candId, gestor.turno);
    if (!pertence) return res.status(404).send(`${rotulo} não encontrado.`);

    const candidatos = await db.candidatosDoGestor(gestor);
    const candidato = candidatos.find((c) => String(c.id) === String(req.params.candId));
    if (!candidato || !candidato[campo]) return res.status(404).send(`${rotulo} não encontrado.`);

    const arquivo = await db.findArquivo(candidato[campo]);
    if (!arquivo) return res.status(404).send(`${rotulo} não encontrado.`);

    const buf = Buffer.from(arquivo.dados || '', 'base64');
    res.setHeader('Content-Type', arquivo.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(arquivo.nome || rotulo.toLowerCase()).replace(/"/g, '')}"`);
    res.send(buf);
  } catch (error) {
    console.error(`[API] Erro ao carregar ${rotulo.toLowerCase()}:`, error.message);
    res.status(500).send(`Erro ao carregar ${rotulo.toLowerCase()}.`);
  }
}

router.get('/publico/:token/cv/:candId', (req, res) => enviarArquivoDoCandidato(req, res, 'cv_arquivo_id', 'Currículo'));
router.get('/publico/:token/foto/:candId', (req, res) => enviarArquivoDoCandidato(req, res, 'foto_arquivo_id', 'Foto'));

module.exports = router;
