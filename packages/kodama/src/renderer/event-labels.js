function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export function shortLabel(text, max = 32) {
  const normalized = compact(text)
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function pathBaseName(value) {
  return normalizePath(value).split('/').pop() || ''
}

export function isOpaqueInternalName(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^[0-9a-f]{16,}$/i.test(text)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true
  return /^[a-z0-9]{20,}$/i.test(text) && !/[._-]/.test(text)
}

function eventPath(event) {
  return firstString(
    event?.cwd,
    event?.projectDir,
    event?.project_dir,
    event?.workspacePath,
    event?.workspace_path,
  )
}

export function isTraeInternalPath(value) {
  const normalized = normalizePath(value)
  return /(^|\/)\.trae(?:-cn)?\/work\/[^/]+$/i.test(normalized)
    || /(^|\/)TRAE SOLO(?: CN)?\/work\/[^/]+$/i.test(normalized)
}

export function eventWorkId(event) {
  const path = eventPath(event)
  if (!isTraeInternalPath(path)) return ''
  const base = pathBaseName(path)
  return isOpaqueInternalName(base) ? base : ''
}

export function normalizeAgentLabel(value) {
  const raw = compact(value)
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower.includes('trae')) {
    if (lower.includes('cli')) return 'Trae CLI'
    if (lower.includes('cn')) return 'Trae CN'
    return 'Trae Work'
  }
  if (lower.includes('coco')) return 'CoCo'
  if (lower.includes('claude')) return 'Claude Code'
  if (lower.includes('codex')) return 'Codex'
  if (lower === 'memories' || lower === 'memory') return 'Memory'
  return shortLabel(raw, 24)
}

export function eventAppLabel(event) {
  const explicit = normalizeAgentLabel(firstString(
    event?.appName,
    event?.app_name,
    event?.app,
    event?.sourceApp,
    event?.source_app,
    event?.client,
    event?.originator,
  ))
  if (explicit) return explicit
  const agent = normalizeAgentLabel(event?.agent)
  if (agent) return agent
  if (isTraeInternalPath(eventPath(event))) return 'Trae Work'
  return ''
}

export function eventAgentLabel(event) {
  return normalizeAgentLabel(firstString(
    event?.agent,
    event?.agentName,
    event?.agent_name,
    event?.role,
  ))
}

export function eventProjectLabel(event) {
  const explicit = firstString(
    event?.projectName,
    event?.project_name,
    event?.repoName,
    event?.repo_name,
    event?.workspaceName,
    event?.workspace_name,
  )
  if (explicit && !isOpaqueInternalName(explicit)) return shortLabel(explicit, 28)

  const path = eventPath(event)
  const base = pathBaseName(path)
  if (!base || isTraeInternalPath(path) || isOpaqueInternalName(base)) return ''
  return shortLabel(base, 28)
}

export function eventTaskLabel(event) {
  const project = eventProjectLabel(event)
  if (project) return project

  const prompt = firstString(event?.prompt, event?.title)
  if (prompt && !isOpaqueInternalName(prompt)) return shortLabel(prompt, 28)

  return ''
}

export function eventBubbleContext(event, max = 34) {
  const app = eventAppLabel(event)
  const task = eventTaskLabel(event)
  if (app && task && app !== task) return shortLabel(`${app} / ${task}`, max)
  return shortLabel(task || app, max)
}
