/**
 * Resume o histórico acadêmico/profissional de um candidato a partir do PDF
 * do currículo, usando a API da Anthropic (Claude).
 *
 * Requer ANTHROPIC_API_KEY no .env. Sem a chave configurada (ou se qualquer
 * etapa falhar — PDF corrompido, texto vazio, API fora do ar, ou até o
 * próprio require('pdf-parse') falhando no ambiente de produção), retorna
 * '' silenciosamente: gerar o resumo é um extra, nunca deve impedir o
 * upload do currículo, o cadastro do candidato, nem o boot do servidor.
 * O require é feito aqui dentro (lazy) e não no topo do arquivo, exatamente
 * para que uma falha nele não derrube o app inteiro ao subir.
 */
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CHARS_CURRICULO = 12000;

async function resumirCurriculo(dadosBase64) {
  if (!process.env.ANTHROPIC_API_KEY) return '';

  try {
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(dadosBase64, 'base64');
    const { text } = await pdfParse(buffer);
    const texto = (text || '').trim().slice(0, MAX_CHARS_CURRICULO);
    if (!texto) return '';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: 'Leia o currículo abaixo e escreva, em português, um resumo breve (3 a 4 frases corridas, sem tópicos) das experiências acadêmicas e profissionais mais relevantes do candidato. Não use introduções como "o candidato possui" — vá direto ao conteúdo.\n\n' + texto,
        }],
      }),
    });

    if (!response.ok) {
      console.error('[IA] Erro ao resumir currículo:', response.status, await response.text());
      return '';
    }

    const data = await response.json();
    const resumo = data.content && data.content[0] && data.content[0].text;
    return (resumo || '').trim();
  } catch (error) {
    console.error('[IA] Erro ao processar currículo:', error.message);
    return '';
  }
}

module.exports = { resumirCurriculo };
