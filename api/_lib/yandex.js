export async function generateAgentResponse(messages) {
  const key = process.env.YANDEX_API_KEY;
  const folder = process.env.YANDEX_FOLDER_ID;
  if (!key || !folder) throw new Error('Yandex AI is not configured');
  const model = process.env.YANDEX_MODEL || 'aliceai-llm';
  const response = await fetch('https://ai.api.cloud.yandex.net/v1/responses', {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Api-Key ${key}`},
    body: JSON.stringify({model: `gpt://${folder}/${model}`, input: messages, store: false, temperature: 0.5, max_output_tokens: 3000})
  });
  if (!response.ok) { console.error('Yandex AI request failed', response.status); throw new Error(`Yandex AI ${response.status}`); }
  const data = await response.json();
  const text = (data.output || []).flatMap(x => x.content || []).map(x => x.text || '').join('\n').trim();
  if (!text) throw new Error('Empty Yandex AI response');
  return text;
}
