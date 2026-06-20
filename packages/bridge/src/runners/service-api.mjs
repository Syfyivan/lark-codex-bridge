import {
  extractTextFromJson,
  getServiceJwt,
  requireConfigValue,
  tryParseJson,
} from './service-auth.mjs';

export function createServiceApiRunner(config, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  return {
    id: 'api',
    label: 'Service API',
    async run(prompt) {
      requireConfigValue('SERVICE_API_URL or BYTECLOUD_API_URL', config.bytecloudApiUrl);
      const jwt = await getServiceJwt(config, { fetch: fetchFn });
      const method = config.bytecloudApiMethod.toUpperCase();
      const headers = {
        'Content-Type': 'application/json',
        'X-JWT-TOKEN': jwt,
        'x-bridge-user-prompt': prompt.slice(0, 512),
      };
      const response = await fetchFn(config.bytecloudApiUrl, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : config.bytecloudApiBody || '{}',
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`service API call failed: HTTP ${response.status} ${text.slice(0, 500)}`);
      }
      const raw = tryParseJson(text);
      const answer = extractTextFromJson(raw) || text;
      return {
        text: answer.length > 3500 ? `${answer.slice(0, 3500)}\n...` : answer,
        raw: raw || text,
        sessionId: '',
        taskId: '',
      };
    },
  };
}

export function createJwtCheckRunner(config, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  return {
    id: 'jwt-check',
    label: 'JWT check',
    async run() {
      await getServiceJwt(config, { fetch: fetchFn });
      return {
        text: '服务账号 JWT 获取成功，飞书机器人到服务账号这条链路是通的。',
        raw: {},
        sessionId: '',
        taskId: '',
      };
    },
  };
}
