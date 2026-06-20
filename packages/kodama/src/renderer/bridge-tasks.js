const statusEl = document.getElementById('bridge-task-status')
const limitInput = document.getElementById('task-limit')
const refreshButton = document.getElementById('refresh-tasks')
const shareButton = document.getElementById('share-viewer')
const taskSearch = document.getElementById('task-search')
const taskList = document.getElementById('task-list')
const taskDetail = document.getElementById('task-detail')
const summaryButtons = Array.from(document.querySelectorAll('[data-filter]'))
const counts = {
  all: document.getElementById('count-all'),
  running: document.getElementById('count-running'),
  waiting: document.getElementById('count-waiting'),
  done: document.getElementById('count-done'),
  failed: document.getElementById('count-failed'),
}

const state = {
  tasks: [],
  selectedId: '',
  filter: 'all',
  query: '',
  loading: false,
  error: '',
  updatedAt: '',
}
let bridgeRequest = {}

async function importLocal(path) {
  try {
    return await import(path)
  } catch (error) {
    const message = String(error?.message || error)
    if (/not found|failed to fetch|cannot find|err_module_not_found/i.test(message)) return null
    updateStatus(`${path} 配置读取失败：${message}`)
    return null
  }
}

async function loadBridgeConfig() {
  const agent = (await importLocal('./config/agent.local.js'))?.AGENT || {}
  bridgeRequest = {
    bridgeUrl: agent.bridgeUrl || '',
    token: agent.token || '',
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function compactText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function shortText(text, max = 120) {
  const value = compactText(text)
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function fmtDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function statusLabel(status) {
  return {
    running: '运行中',
    waiting: '待交互',
    done: '完成',
    failed: '失败',
    canceled: '取消',
  }[status] || status || '未知'
}

function eventTypeLabel(type) {
  return {
    task_started: '开始',
    task_progress: '进度',
    task_waiting: '待交互',
    task_done: '完成',
    task_failed: '失败',
    lark_message_received: '飞书消息',
    lark_reply_sent: '飞书回复',
  }[type] || type || '事件'
}

function statusClass(status) {
  if (['running', 'waiting', 'done', 'failed', 'canceled'].includes(status)) return status
  return 'unknown'
}

function taskTitle(task) {
  return task.title || task.prompt || task.finalText || task.errorText || task.id || '未命名任务'
}

function taskSearchBlob(task) {
  return [
    task.id,
    task.status,
    taskTitle(task),
    task.prompt,
    task.finalText,
    task.errorText,
    task.chatId,
    task.messageId,
    task.senderId,
    task.contextKey,
    task.cwd,
    task.backend,
    task.runtime,
    task.sandbox,
  ].map(compactText).join('\n').toLowerCase()
}

function visibleTasks() {
  const q = state.query.trim().toLowerCase()
  return state.tasks.filter((task) => {
    if (state.filter !== 'all' && task.status !== state.filter) return false
    if (q && !taskSearchBlob(task).includes(q)) return false
    return true
  })
}

function updateStatus(text) {
  if (statusEl) statusEl.textContent = text
}

function updateCounts() {
  const all = state.tasks.length
  const running = state.tasks.filter(task => task.status === 'running').length
  const waiting = state.tasks.filter(task => task.status === 'waiting').length
  const done = state.tasks.filter(task => task.status === 'done').length
  const failed = state.tasks.filter(task => task.status === 'failed').length
  counts.all.textContent = String(all)
  counts.running.textContent = String(running)
  counts.waiting.textContent = String(waiting)
  counts.done.textContent = String(done)
  counts.failed.textContent = String(failed)
  summaryButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === state.filter)
  })
}

function renderTaskList() {
  const tasks = visibleTasks()
  if (!tasks.length) {
    taskList.className = 'task-list empty'
    taskList.textContent = state.loading ? '正在加载...' : state.error || '没有匹配任务'
    return
  }
  taskList.className = 'task-list'
  taskList.innerHTML = tasks.map((task) => {
    const selected = task.id === state.selectedId ? ' selected' : ''
    const meta = [
      statusLabel(task.status),
      task.backend || '',
      task.runtime || '',
      task.tokens ? `${task.tokens} tok` : '',
      task.eventCount ? `${task.eventCount} 事件` : '',
    ].filter(Boolean).join(' · ')
    return [
      `<button class="task-row${selected}" type="button" data-task-id="${escapeHtml(task.id || '')}">`,
      '<span class="task-row-top">',
      `<strong>${escapeHtml(shortText(taskTitle(task), 86))}</strong>`,
      `<em class="status-pill ${escapeHtml(statusClass(task.status))}">${escapeHtml(statusLabel(task.status))}</em>`,
      '</span>',
      `<span class="task-row-meta">${escapeHtml(meta)}</span>`,
      `<span class="task-row-sub">${escapeHtml(shortText(task.cwd || task.contextKey || task.chatId || task.id, 96))}</span>`,
      `<time>${escapeHtml(fmtDate(task.updatedAt || task.finishedAt || task.startedAt))}</time>`,
      '</button>',
    ].join('')
  }).join('')
}

function renderMetaGrid(task) {
  const eventCount = Number.isFinite(Number(task.eventCount))
    ? Number(task.eventCount)
    : Array.isArray(task.events) ? task.events.length : 0
  const rows = [
    ['任务 ID', task.id],
    ['状态', statusLabel(task.status)],
    ['来源', task.source],
    ['后端', task.backend],
    ['运行时', task.runtime],
    ['cwd', task.cwd],
    ['沙箱', task.sandbox],
    ['上下文', task.contextKey],
    ['chatId', task.chatId],
    ['messageId', task.messageId],
    ['senderId', task.senderId],
    ['tokens', task.tokens ? String(task.tokens) : '0'],
    ['事件数', String(eventCount)],
    ['开始', fmtDate(task.startedAt)],
    ['更新', fmtDate(task.updatedAt)],
    ['结束', fmtDate(task.finishedAt)],
  ].filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
  return rows.map(([key, value]) => [
    `<dt>${escapeHtml(key)}</dt>`,
    `<dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd>`,
  ].join('')).join('')
}

function renderTextBlock(title, value, className = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  return [
    `<section class="detail-block ${escapeHtml(className)}">`,
    `<h3>${escapeHtml(title)}</h3>`,
    `<pre>${escapeHtml(text)}</pre>`,
    '</section>',
  ].join('')
}

function selectedTask() {
  return state.tasks.find(item => item.id === state.selectedId) || null
}

function renderTimeline(task) {
  const events = Array.isArray(task.events) ? task.events : []
  if (!events.length) {
    return '<section class="detail-block"><h3>任务过程</h3><div class="empty-inline">暂无过程事件</div></section>'
  }
  return [
    '<section class="detail-block timeline-block">',
    '<h3>任务过程</h3>',
    '<ol class="timeline">',
    events.map((event) => [
      `<li class="${escapeHtml(statusClass(event.type === 'task_failed' ? 'failed' : event.type === 'task_done' ? 'done' : 'running'))}">`,
      '<div class="timeline-meta">',
      `<span>${escapeHtml(eventTypeLabel(event.type))}</span>`,
      `<time>${escapeHtml(fmtDate(event.ts || event.updatedAt || event.createdAt))}</time>`,
      '</div>',
      `<p>${escapeHtml(event.text || event.message || event.type || '')}</p>`,
      renderEventExtras(event),
      '</li>',
    ].join('')).join(''),
    '</ol>',
    '</section>',
  ].join('')
}

function renderEventExtras(event) {
  const extras = [
    event.cwd ? `cwd: ${event.cwd}` : '',
    event.backend ? `backend: ${event.backend}` : '',
    event.runtime ? `runtime: ${event.runtime}` : '',
    event.tokens ? `tokens: ${event.tokens}` : '',
  ].filter(Boolean)
  if (!extras.length) return ''
  return `<div class="timeline-extra">${escapeHtml(extras.join(' · '))}</div>`
}

function renderTaskDetail() {
  const task = selectedTask()
  if (!task) {
    taskDetail.className = 'task-detail empty'
    taskDetail.innerHTML = '<div class="empty-state">选择一个任务查看详情</div>'
    return
  }
  taskDetail.className = `task-detail status-${statusClass(task.status)}`
  const canOpenChat = Boolean(task.chatId)
  const canShareConversation = Boolean(task.contextKey || task.chatId)
  taskDetail.innerHTML = [
    '<header class="detail-head">',
    '<div>',
    `<div class="detail-kicker">${escapeHtml(task.source || 'bridge')} · ${escapeHtml(statusLabel(task.status))}</div>`,
    `<h2>${escapeHtml(taskTitle(task))}</h2>`,
    '</div>',
    '<div class="detail-actions">',
    canOpenChat ? '<button type="button" data-action="open-chat">打开飞书会话</button>' : '',
    '<button type="button" data-action="share-task">分享本任务</button>',
    canShareConversation ? '<button type="button" data-action="share-conversation">分享本会话</button>' : '',
    '<button type="button" data-action="copy-id">复制 ID</button>',
    '</div>',
    '</header>',
    '<dl class="meta-grid">',
    renderMetaGrid(task),
    '</dl>',
    renderTextBlock('原始请求', task.prompt),
    renderTextBlock('最终回复', task.finalText, 'final'),
    renderTextBlock('错误', task.errorText, 'error'),
    renderTimeline(task),
  ].join('')
}

function render() {
  updateCounts()
  renderTaskList()
  renderTaskDetail()
}

async function refreshTasks() {
  state.loading = true
  state.error = ''
  updateStatus('正在读取本机 Bridge 任务...')
  render()
  const limit = Math.min(200, Math.max(1, Number(limitInput.value || 100)))
  try {
    const result = await window.pet.bridgeTasks?.({ ...bridgeRequest, limit })
    if (!result?.ok) {
      state.error = result?.error || 'Bridge 任务页不可用'
      state.tasks = []
      updateStatus(`读取失败：${state.error}`)
      return
    }
    state.tasks = Array.isArray(result.tasks) ? result.tasks : []
    state.updatedAt = result.updatedAt || new Date().toISOString()
    if (!state.tasks.some(task => task.id === state.selectedId)) {
      state.selectedId = state.tasks[0]?.id || ''
    }
    updateStatus(`已连接 ${result.bridgeUrl || 'Bridge'} · ${state.tasks.length} 个任务 · ${fmtDate(state.updatedAt)}`)
  } catch (error) {
    state.error = error?.message || String(error)
    state.tasks = []
    updateStatus(`读取失败：${state.error}`)
  } finally {
    state.loading = false
    render()
  }
}

async function shareViewer() {
  await shareBridgeTasks({}, shareButton, '分享全部任务')
}

async function shareBridgeTasks(scope = {}, button = null, label = '分享') {
  const targetButton = button || document.activeElement
  const canSetText = targetButton && 'textContent' in targetButton
  const oldText = canSetText ? targetButton.textContent : ''
  if (targetButton) targetButton.disabled = true
  if (canSetText) targetButton.textContent = '分享中...'
  try {
    const limit = Math.min(200, Math.max(1, Number(limitInput.value || 100)))
    const result = await window.pet.shareBridgeTasks?.({ ...bridgeRequest, limit, ...scope })
    if (!result?.ok) {
      updateStatus(`分享失败：${result?.error || 'bridge 没返回链接'}`)
      return
    }
    const count = Number.isFinite(Number(result.tasks)) ? ` · ${Number(result.tasks)} 个任务` : ''
    updateStatus(result.url ? `${label}链接已复制${count}：${result.url}` : `${label}页已生成${count}`)
  } catch (error) {
    updateStatus(`分享失败：${error?.message || error}`)
  } finally {
    if (targetButton) targetButton.disabled = false
    if (canSetText) targetButton.textContent = oldText
  }
}

async function openSelectedChat() {
  const task = selectedTask()
  if (!task?.chatId) return
  const result = await window.pet.openTarget?.({
    kind: 'lark',
    chatId: task.chatId,
    messageId: task.messageId || '',
    label: '打开飞书会话',
  })
  if (!result?.ok) updateStatus(`打开飞书失败：${result?.error || '没有会话信息'}`)
}

async function copySelectedId() {
  const task = selectedTask()
  if (!task?.id) return
  await window.pet.copyText?.(task.id)
  updateStatus(`已复制任务 ID：${task.id}`)
}

async function shareSelectedTask() {
  const task = selectedTask()
  if (!task?.id) return
  await shareBridgeTasks({ taskId: task.id }, null, '本任务')
}

async function shareSelectedConversation() {
  const task = selectedTask()
  if (!task) return
  const scope = task.contextKey ? { contextKey: task.contextKey } : { chatId: task.chatId || '' }
  if (!scope.contextKey && !scope.chatId) {
    updateStatus('这个任务没有会话上下文，无法分享本会话')
    return
  }
  await shareBridgeTasks(scope, null, '本会话')
}

refreshButton.addEventListener('click', refreshTasks)
shareButton.addEventListener('click', shareViewer)
limitInput.addEventListener('change', refreshTasks)
taskSearch.addEventListener('input', () => {
  state.query = taskSearch.value || ''
  render()
})
summaryButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter || 'all'
    render()
  })
})
taskList.addEventListener('click', (event) => {
  const row = event.target.closest?.('[data-task-id]')
  if (!row) return
  state.selectedId = row.dataset.taskId
  render()
})
taskDetail.addEventListener('click', (event) => {
  const action = event.target.closest?.('[data-action]')?.dataset.action
  if (action === 'open-chat') openSelectedChat()
  if (action === 'share-task') shareSelectedTask()
  if (action === 'share-conversation') shareSelectedConversation()
  if (action === 'copy-id') copySelectedId()
})

loadBridgeConfig().finally(refreshTasks)
