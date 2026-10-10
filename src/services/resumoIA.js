/**
 * Analisa o PDF do currículo de um candidato usando a API da Anthropic
 * (Claude) e devolve, numa só chamada: curso, faculdade, previsão de
 * formação e um resumo do histórico acadêmico/profissional.
 *
 * Requer ANTHROPIC_API_KEY no .env. Sem a chave configurada (ou se qualquer
 * etapa falhar — PDF corrompido, texto vazio, API fora do ar, resposta que
 * não é um JSON válido, ou até o próprio require('pdf-parse') falhando no
 * ambiente de produção), devolve um objeto vazio silenciosamente: essa
 * análise é um extra, nunca deve impedir o upload do currículo, o cadastro
 * do candidato, nem o boot do servidor. O require é feito aqui dentro
 * (lazy) e não no topo do arquivo, exatamente para que uma falha nele não
 * derrube o app inteiro ao subir (ver histórico do commit que corrigiu
 * isso com o pdf-parse v2).
 */
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CHARS_CURRICULO = 12000;

// O modelo às vezes embrulha o JSON em ```json ... ``` apesar da instrução
// de não fazer isso — tira o markdown antes de tentar o parse.
function extrairJson(texto) {
  const semMarkdown = texto.replace(/```json\s*|```/gi, '').trim();
  return JSON.parse(semMarkdown);
}

async function analisarCurriculo(dadosBase64) {
  if (!process.env.ANTHROPIC_API_KEY) return {};

  try {
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(dadosBase64, 'base64');
    const { text } = await pdfParse(buffer);
    const texto = (text || '').trim().slice(0, MAX_CHARS_CURRICULO);
    if (!texto) return {};

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: 'Leia o currículo abaixo e responda APENAS com um JSON válido (sem markdown, sem texto antes ou depois), exatamente neste formato:\n'
            + '{"curso": "", "faculdade": "", "formacao": "", "resumo": ""}\n\n'
            + '- curso: nome do curso de graduação do candidato (ex.: "Administração"). Vazio se não encontrar.\n'
            + '- faculdade: nome da instituição de ensino superior. Vazio se não encontrar.\n'
            + '- formacao: previsão ou data de formatura, no formato "Mês/Ano" (ex.: "Dez/2027"). Vazio se não encontrar.\n'
            + '- resumo: 3 a 4 frases corridas em português (sem tópicos, sem introduções como "o candidato possui") resumindo as experiências acadêmicas e profissionais mais relevantes.\n\n'
            + 'Currículo:\n\n' + texto,
        }],
      }),
    });

    if (!response.ok) {
      console.error('[IA] Erro ao analisar currículo:', response.status, await response.text());
      return {};
    }

    const data = await response.json();
    const textoResposta = data.content?.[0]?.text || '{}';
    const json = extrairJson(textoResposta);
    return {
      curso: String(json.curso || '').trim(),
      faculdade: String(json.faculdade || '').trim(),
      formacao: String(json.formacao || '').trim(),
      resumo: String(json.resumo || '').trim(),
    };
  } catch (error) {
    console.error('[IA] Erro ao processar currículo:', error.message);
    return {};
  }
}

module.exports = { analisarCurriculo };
