import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function statusLabel(status) {
  return {
    running: '运行中',
    done: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status] || status || '未知';
}

function eventLabel(type) {
  return {
    task_started: '开始',
    task_progress: '进度',
    task_done: '完成',
    task_failed: '失败',
    task_cancelled: '取消',
    lark_message_received: '飞书消息',
    lark_reply_sent: '飞书回复',
  }[type] || type || '事件';
}

function taskDuration(task) {
  const start = new Date(task.startedAt).getTime();
  const end = new Date(task.finishedAt || task.updatedAt).getTime();
  if (!start || !end || Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function renderTaskList(tasks) {
  return tasks
    .map((task, index) => {
      const title = task.title || task.prompt || task.id;
      const active = index === 0 ? ' is-active' : '';
      return `<button class="task-item${active}" type="button" data-task-id="${escapeHtml(task.id)}">
  <span class="task-title">${escapeHtml(title)}</span>
  <span class="task-meta">${escapeHtml(statusLabel(task.status))} · ${escapeHtml(formatTime(task.updatedAt))}</span>
</button>`;
    })
    .join('\n');
}

function renderTimeline(tasks) {
  return tasks
    .map((task, index) => {
      const events = Array.isArray(task.events) ? task.events : [];
      const rows = events.length
        ? events.map(event => `<li class="event event-${escapeHtml(event.type)}">
  <span class="event-time">${escapeHtml(formatTime(event.ts))}</span>
  <strong>${escapeHtml(eventLabel(event.type))}</strong>
  <p>${escapeHtml(event.text || event.reason || event.command || '')}</p>
</li>`).join('\n')
        : '<li class="event"><strong>暂无事件</strong><p>这个任务没有记录到可见进度。</p></li>';
      return `<article class="task-detail${index === 0 ? ' is-active' : ''}" data-task-id="${escapeHtml(task.id)}">
  <header class="detail-head">
    <div>
      <p class="eyebrow">Bridge Task</p>
      <h2>${escapeHtml(task.title || task.prompt || task.id)}</h2>
      <div class="chips">
        <span>${escapeHtml(statusLabel(task.status))}</span>
        ${task.backend ? `<span>${escapeHtml(task.backend)}</span>` : ''}
        ${task.runtime ? `<span>${escapeHtml(task.runtime)}</span>` : ''}
        ${task.tokens ? `<span>${Number(task.tokens)} tokens</span>` : ''}
        ${taskDuration(task) ? `<span>${escapeHtml(taskDuration(task))}</span>` : ''}
      </div>
    </div>
  </header>
  <section class="summary-grid">
    <div><b>Task ID</b><code>${escapeHtml(task.id)}</code></div>
    <div><b>Chat</b><code>${escapeHtml(task.chatId || '-')}</code></div>
    <div><b>Message</b><code>${escapeHtml(task.messageId || '-')}</code></div>
    <div><b>Context</b><code>${escapeHtml(task.contextKey || '-')}</code></div>
    <div><b>CWD</b><code>${escapeHtml(task.cwd || '-')}</code></div>
    <div><b>Sandbox</b><code>${escapeHtml(task.sandbox || '-')}</code></div>
  </section>
  ${task.prompt ? `<section class="prompt"><h3>请求摘要</h3><p>${escapeHtml(task.prompt)}</p></section>` : ''}
  ${task.finalText ? `<section class="final"><h3>最终回复</h3><p>${escapeHtml(task.finalText)}</p></section>` : ''}
  ${task.errorText ? `<section class="error"><h3>错误</h3><p>${escapeHtml(task.errorText)}</p></section>` : ''}
  <ol class="timeline">${rows}</ol>
</article>`;
    })
    .join('\n');
}

export function renderTaskViewerHtml(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const generatedAt = input.generatedAt || new Date().toISOString();
  const title = input.title || 'Bridge Task Session Viewer';
  const taskData = safeJson(tasks);
  const empty = tasks.length
    ? ''
    : '<section class="empty"><h2>还没有任务记录</h2><p>重启 bridge 并处理一条飞书请求后，这里会出现任务 timeline。</p></section>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fa;
      --panel: #ffffff;
      --ink: #18202a;
      --muted: #667085;
      --line: #d9e0ea;
      --accent: #0f7b65;
      --accent-soft: #e5f4ef;
      --warn: #b54708;
      --danger: #b42318;
      --code: #f1f5f9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background: var(--bg);
      font: 14px/1.56 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    }
    .shell {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      min-height: 100vh;
    }
    aside {
      border-right: 1px solid var(--line);
      background: #fbfcfe;
      padding: 20px;
      overflow: auto;
    }
    main {
      padding: 28px;
      overflow: auto;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 6px; font-size: 24px; letter-spacing: 0; }
    h2 { margin-bottom: 12px; font-size: 24px; letter-spacing: 0; }
    h3 { margin-bottom: 8px; font-size: 15px; }
    .sub { color: var(--muted); margin-bottom: 18px; }
    .task-list { display: grid; gap: 8px; }
    .task-item {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 11px 12px;
      background: var(--panel);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    .task-item:hover, .task-item.is-active {
      border-color: rgba(15, 123, 101, .42);
      background: var(--accent-soft);
    }
    .task-title {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }
    .task-meta { color: var(--muted); font-size: 12px; }
    .task-detail { display: none; max-width: 1120px; }
    .task-detail.is-active { display: block; }
    .detail-head {
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .eyebrow {
      margin-bottom: 6px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
    }
    .chips span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 9px;
      background: #f8fafc;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 14px 0;
    }
    .summary-grid > div, .prompt, .final, .error, .empty {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 14px;
      background: var(--panel);
    }
    .summary-grid b {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    code {
      border-radius: 5px;
      padding: 2px 5px;
      background: var(--code);
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }
    .prompt p, .final p, .error p {
      margin-bottom: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .error { border-color: rgba(180, 35, 24, .28); background: #fff7f7; }
    .timeline {
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
    }
    .event {
      position: relative;
      margin: 0 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 14px 12px 132px;
      background: var(--panel);
    }
    .event-time {
      position: absolute;
      left: 14px;
      top: 13px;
      width: 104px;
      color: var(--muted);
      font-size: 12px;
    }
    .event strong { display: block; margin-bottom: 4px; }
    .event p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .event-task_failed { border-color: rgba(180, 35, 24, .3); }
    .event-task_done { border-color: rgba(15, 123, 101, .3); }
    footer {
      margin-top: 20px;
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 820px) {
      .shell { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      main { padding: 18px; }
      .summary-grid { grid-template-columns: 1fr; }
      .event { padding-left: 14px; }
      .event-time { position: static; display: block; width: auto; margin-bottom: 4px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">Generated ${escapeHtml(formatTime(generatedAt))} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}</p>
      <nav class="task-list">${renderTaskList(tasks)}</nav>
    </aside>
    <main>
      ${empty || renderTimeline(tasks)}
      <footer>Generated by lark-codex-bridge. This page contains safe summaries only; hidden reasoning and raw tool output are not exported.</footer>
    </main>
  </div>
  <script id="task-data" type="application/json">${taskData}</script>
  <script>
    document.querySelectorAll('.task-item').forEach(function(button) {
      button.addEventListener('click', function() {
        var id = button.getAttribute('data-task-id');
        document.querySelectorAll('.task-item').forEach(function(item) {
          item.classList.toggle('is-active', item === button);
        });
        document.querySelectorAll('.task-detail').forEach(function(panel) {
          panel.classList.toggle('is-active', panel.getAttribute('data-task-id') === id);
        });
      });
    });
  </script>
</body>
</html>`;
}

export function writeTaskViewerSite({ tasks, outDir, title }) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const html = renderTaskViewerHtml({ tasks, title, generatedAt: new Date().toISOString() });
  writeFileSync(join(outDir, 'index.html'), html);
  writeFileSync(join(outDir, 'tasks.json'), JSON.stringify({ generatedAt: new Date().toISOString(), tasks }, null, 2));
  return join(outDir, 'index.html');
}
