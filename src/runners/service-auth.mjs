export function requireConfigValue(name, value) {
  if (!value) throw new Error(`Missing required configuration: ${name}`);
}

export async function getServiceJwt(config, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  requireConfigValue('SERVICE_ACCOUNT_SECRET or BYTECLOUD_SA_SECRET', config.serviceAccountSecret);
  const response = await fetchFn(config.jwtEndpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.serviceAccountSecret}`,
    },
  });
  const token = response.headers.get('x-jwt-token');
  if (!response.ok || !token) {
    const body = await response.text().catch(() => '');
    throw new Error(`failed to get service JWT: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  return token;
}

export function tryParseJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

export function extractTextFromJson(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    return value.map(extractTextFromJson).filter(Boolean).join('\n');
  }

  const direct = [
    value.text,
    value.result,
    value.answer,
    value.output,
    value.content,
    value.message,
    value.summary,
  ].find(item => typeof item === 'string' && item.trim());
  if (direct) return direct;

  const choice = value.choices?.[0];
  if (choice) {
    return (
      extractTextFromJson(choice.message?.content) ||
      extractTextFromJson(choice.delta?.content) ||
      extractTextFromJson(choice.text)
    );
  }

  if (value.data) return extractTextFromJson(value.data);
  return '';
}
