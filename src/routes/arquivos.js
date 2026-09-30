/**
 * API de arquivos (CVs/fotos dos candidatos), guardados no banco em base64.
 * Persiste entre deploys — o disco do container é efêmero no Kubernetes.
 *   POST /api/arquivos       -> { tipo, nome, mime, dados(base64) } => { id }
 *   GET  /api/arquivos/:id   -> devolve o arquivo (Content-Type = mime)
 * Leitura: qualquer colaborador logado (isAuthenticated, aplicado em
 * src/server.js). Upload: só admin (isAdmin aplicado aqui, não no
 * server.js, porque a leitura não deve exigir admin).
 */
const express = require('express');
const router = express.Router();
const db = require('../database/dinamica');
const { isAdmin } = require('../auth/middleware');
const { resumirCurriculo } = require('../services/resumoIA');

// Limite de segurança do tamanho do arquivo (base64), ~12MB de payload.
const MAX_B64 = 12 * 1024 * 1024;

router.post('/', isAdmin, async (req, res) => {
  try {
    const { tipo, nome, mime } = req.body;
    let dados = req.body.dados;
    if (typeof dados !== 'string' || !dados) {
      return res.status(400).json({ error: 'Conteúdo do arquivo ausente.' });
    }
    // Aceita tanto "data:...;base64,XXXX" quanto só o base64.
    const comma = dados.indexOf(',');
    if (dados.startsWith('data:') && comma >= 0) dados = dados.slice(comma + 1);
    if (dados.length > MAX_B64) {
      return res.status(413).json({ error: 'Arquivo muito grande (máx. ~9MB).' });
    }
    const arquivo = await db.insertArquivo({ tipo, nome, mime, dados });

    // CV em PDF: gera um resumo automático do histórico via IA (best-effort —
    // se não houver ANTHROPIC_API_KEY configurada, resumirCurriculo já
    // retorna '' sem quebrar o upload).
    let resumo = '';
    if (tipo === 'cv' && mime === 'application/pdf') {
      resumo = await resumirCurriculo(dados);
    }

    res.status(201).json({ id: arquivo.id, nome, mime, resumo });
  } catch (error) {
    console.error('[API] Erro ao salvar arquivo:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar arquivo.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const arquivo = await db.findArquivo(req.params.id);
    if (!arquivo) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    const buf = Buffer.from(arquivo.dados || '', 'base64');
    res.setHeader('Content-Type', arquivo.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(arquivo.nome || 'arquivo').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch (error) {
    console.error('[API] Erro ao ler arquivo:', error.message);
    res.status(500).json({ error: 'Erro interno ao ler arquivo.' });
  }
});

module.exports = router;
