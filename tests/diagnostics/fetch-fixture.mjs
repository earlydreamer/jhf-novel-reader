// Child-process fixture: no real source or model networking is allowed.
const html =
  '<html><h1 class="p-novel__title">fixture</h1><div id="novel_honbun"><p>薬草を集めた。</p><p></p><p>毒キノコを避けた。</p><p>魔力を調べた。</p></div></html>';
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/api/v1/models'))
    return new Response(
      JSON.stringify({
        models: [
          {
            key: 'fixture',
            architecture: 'hunyuan-dense',
            quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
            loaded_instances: [
              {
                id: 'actual',
                config: {
                  context_length: 16384,
                  parallel: 4,
                  flash_attention: true,
                  reasoning_budget_message: 'DO_NOT_LOG_CONFIG_BODY',
                },
              },
            ],
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  if (target === 'https://ncode.syosetu.com/n6517bw/3/')
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  if (target.endsWith('/v1/chat/completions')) {
    if (process.env.PROBE_FORBID_POST === '1') throw new Error('Unexpected generation');
    const body = JSON.parse(options.body);
    if (
      body.max_tokens !== undefined ||
      body.messages.length !== 1 ||
      body.temperature !== 0 ||
      !body.messages[0].content.endsWith(
        '薬草を集めた。\n\n\n\n毒キノコを避けた。\n\n魔力を調べた。',
      )
    )
      throw new Error('Unexpected generation contract');
    return new Response(
      JSON.stringify({
        model: 'DO_NOT_LOG_RETURNED_MODEL',
        choices: [
          { finish_reason: 'stop', message: { content: '약초와 독버섯. DO_NOT_LOG_OUTPUT_BODY' } },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
          unexpected: 'DO_NOT_LOG_USAGE_BODY',
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
  throw new Error('Unexpected network access');
};
