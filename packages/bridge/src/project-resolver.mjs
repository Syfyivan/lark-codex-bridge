export function resolveProjectAnchors(text, input = {}) {
  const raw = String(text || '');
  const anchors = [];
  for (const repo of extractRepoAnchors(raw)) anchors.push(repo);
  for (const mr of extractMrAnchors(raw)) anchors.push(mr);
  for (const activity of extractActivityAnchors(raw)) anchors.push(activity);
  if (input.defaultProjectId) {
    anchors.push({ type: 'configured', id: normalizeProjectId(input.defaultProjectId), label: input.defaultProjectId });
  }
  return dedupeAnchors(anchors);
}

export function primaryProjectId(text, input = {}) {
  return resolveProjectAnchors(text, input)[0]?.id || '';
}

function extractRepoAnchors(text) {
  const anchors = [];
  const patterns = [
    /https?:\/\/code\.byted\.org\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/giu,
    /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/giu,
    /\b(?:repo|仓库)\s*[:：=]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      anchors.push({
        type: 'repo',
        id: normalizeProjectId(`repo:${match[1]}`),
        label: match[1],
      });
    }
  }
  return anchors;
}

function extractMrAnchors(text) {
  const anchors = [];
  const patterns = [
    /https?:\/\/code\.byted\.org\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:merge_requests|merge_request|pulls?)\/(\d+)/giu,
    /\bMR\s*#?\s*(\d+)\b/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[2]) {
        anchors.push({
          type: 'mr',
          id: normalizeProjectId(`repo:${match[1]}`),
          label: `${match[1]}!${match[2]}`,
        });
      } else {
        anchors.push({
          type: 'mr',
          id: normalizeProjectId(`mr:${match[1]}`),
          label: `MR ${match[1]}`,
        });
      }
    }
  }
  return anchors;
}

function extractActivityAnchors(text) {
  const anchors = [];
  const pattern = /\b(?:activity|活动)[-_ ]?(?:id)?\s*[:：#=]?\s*(\d{4,})\b/giu;
  for (const match of text.matchAll(pattern)) {
    anchors.push({
      type: 'activity',
      id: normalizeProjectId(`activity:${match[1]}`),
      label: `activity ${match[1]}`,
    });
  }
  return anchors;
}

function dedupeAnchors(anchors) {
  const seen = new Set();
  return anchors.filter(anchor => {
    if (!anchor.id || seen.has(anchor.id)) return false;
    seen.add(anchor.id);
    return true;
  });
}

export function normalizeProjectId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .slice(0, 160);
}
