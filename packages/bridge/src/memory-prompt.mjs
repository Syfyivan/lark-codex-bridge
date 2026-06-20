export function buildMemoryPromptContext(bundle, maxChars = 12_000) {
  const entries = [...(bundle?.entries || [])].sort((left, right) => right.priority - left.priority);
  const blocks = [];
  let remaining = Math.max(0, Number(maxChars || 0));
  if (!remaining || !entries.length) return '';

  for (const entry of entries) {
    const raw = String(entry.text || '').trim();
    if (!raw || remaining <= 0) continue;
    const header = `## ${entry.label}`;
    const overhead = header.length + 2;
    if (remaining <= overhead) break;
    const body = raw.length > remaining - overhead
      ? `${raw.slice(0, Math.max(0, remaining - overhead - 24)).trim()}\n<memory_entry_truncated>`
      : raw;
    const block = `${header}\n${body}`;
    blocks.push(block);
    remaining -= block.length + 2;
  }

  if (!blocks.length) return '';
  const route = bundle.route || {};
  return [
    '可见记忆上下文：',
    `chat_id=${route.chatId || 'unknown'}`,
    `thread_id=${route.threadId || 'unknown'}`,
    route.projectId ? `project_id=${route.projectId}` : '',
    '',
    ...blocks,
  ].filter(Boolean).join('\n');
}
