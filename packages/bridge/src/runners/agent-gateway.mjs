import {
  extractTextFromJson,
  getServiceJwt,
  requireConfigValue,
  tryParseJson,
} from './service-auth.mjs';

export function createAgentGatewayRunner(config, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  return {
    id: config.mode === 'tae' ? 'tae' : 'agent',
    label: config.mode === 'tae' ? 'TAE agent gateway' : 'Agent Gateway',
    async run(prompt) {
      requireConfigValue('AGENT_GATEWAY_TARGET or TAE_TARGET_PSM', config.taeTargetPsm);
      const jwt = await getServiceJwt(config, { fetch: fetchFn });
      const response = await fetchFn(config.taeAgentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-JWT-TOKEN': jwt,
          'x-agent-target-psm': config.taeTargetPsm,
        },
        body: JSON.stringify({
          model: '',
          stream: false,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`agent gateway call failed: HTTP ${response.status} ${text.slice(0, 500)}`);
      }
      const raw = tryParseJson(text);
      return {
        text: extractTextFromJson(raw) || text,
        raw: raw || text,
        sessionId: '',
        taskId: '',
      };
    },
  };
}
