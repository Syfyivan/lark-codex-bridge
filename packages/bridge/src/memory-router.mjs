import { join } from 'node:path';

import {
  memoryPaths,
  readJsonl,
  readTextFile,
} from './memory-store.mjs';
import { primaryProjectId } from './project-resolver.mjs';

export function resolveMemoryRoute(config, event = {}, text = '') {
  const chatId = event.chatId || event.chat_id || '';
  const threadId =
    event.threadId ||
    event.thread_id ||
    event.rootId ||
    event.root_id ||
    event.parentId ||
    event.parent_id ||
    event.messageId ||
    event.message_id ||
    chatId;
  const projectId = primaryProjectId(text, {
    defaultProjectId: config.memoryDefaultProjectId,
  });
  return {
    chatId,
    threadId,
    projectId,
  };
}

export function readVisibleMemoryBundle(config, route) {
  const paths = memoryPaths(config.memoryRootDir, route);
  const baseSoul = readTextFile(config.baseSoulFile, '');
  const globalSummary = readTextFile(join(paths.globalDir, 'business-summary.md'), '');
  const globalPreferences = readTextFile(join(paths.globalDir, 'preferences.md'), '');
  const chatSummary = readTextFile(join(paths.chatDir, 'summary.md'), '');
  const threadSummary = readTextFile(paths.threadFile, '');
  const projectSummary = route.projectId
    ? readTextFile(join(paths.projectDir, 'shared-summary.md'), '')
    : '';
  const decisions = [
    ...readJsonl(join(paths.chatDir, 'decisions.jsonl'), config.memoryJsonlItemLimit),
    ...(route.projectId ? readJsonl(join(paths.projectDir, 'decisions.jsonl'), config.memoryJsonlItemLimit) : []),
  ];
  const risks = route.projectId
    ? readJsonl(join(paths.projectDir, 'risks.jsonl'), config.memoryJsonlItemLimit)
    : [];
  const pending = readJsonl(join(paths.chatDir, 'pending.jsonl'), config.memoryJsonlItemLimit);
  const openQuestions = route.projectId
    ? readJsonl(join(paths.projectDir, 'open-questions.jsonl'), config.memoryJsonlItemLimit)
    : [];

  return {
    route,
    entries: [
      { id: 'base_soul', label: 'Base Soul', priority: 100, text: baseSoul },
      { id: 'global_preferences', label: 'Global Preferences', priority: 90, text: globalPreferences },
      { id: 'global_summary', label: 'Global Summary', priority: 80, text: globalSummary },
      { id: 'chat_summary', label: 'Current Chat Summary', priority: 70, text: chatSummary },
      { id: 'thread_summary', label: 'Current Thread Summary', priority: 60, text: threadSummary },
      { id: 'project_summary', label: 'Current Project Summary', priority: 50, text: projectSummary },
      { id: 'decisions', label: 'Relevant Decisions', priority: 40, text: renderJsonlItems(decisions) },
      { id: 'risks', label: 'Relevant Risks', priority: 30, text: renderJsonlItems(risks) },
      { id: 'pending', label: 'Current Chat Pending Items', priority: 25, text: renderJsonlItems(pending) },
      { id: 'open_questions', label: 'Current Project Open Questions', priority: 20, text: renderJsonlItems(openQuestions) },
    ].filter(entry => String(entry.text || '').trim()),
  };
}

function renderJsonlItems(items) {
  return items
    .map(item => {
      const text = item.text || item.summary || item.decision || item.risk || item.question || item.content || '';
      if (!text) return '';
      const source = item.source ? ` (${item.source})` : '';
      return `- ${text}${source}`;
    })
    .filter(Boolean)
    .join('\n');
}
