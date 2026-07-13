export function parseQueueCommand(content) {
  const match = String(content || '').trim().match(/^\/queue(?:\s+([\s\S]+))?$/iu);
  if (!match) return null;
  return { text: String(match[1] || '').trim() };
}

export function isStopCommand(content) {
  return /^\/(?:stop|停止|终止)(?:\s|$)/iu.test(String(content || '').trim());
}

export function parseCodexSessionCommand(content) {
  const trimmed = String(content || '').trim();
  if (/^\/(?:sessions|会话列表)$/iu.test(trimmed)) return { action: 'list' };
  if (/^\/(?:session|当前会话)$/iu.test(trimmed)) return { action: 'status' };

  const use = trimmed.match(/^\/(?:use|切换会话)\s+(.+)$/iu);
  if (use?.[1]?.trim()) return { action: 'use', selector: use[1].trim() };

  const slashNew = trimmed.match(/^\/(?:new|新建)(?:\s+([\s\S]+))?$/iu);
  if (slashNew) return { action: 'new', title: String(slashNew[1] || '').trim() };

  const naturalNew = trimmed.match(
    /^(?:新建|创建)(?:一个|新的)?\s*(?:codex\s*)?(?:session|会话)(?:\s*[：:,，-]?\s*([\s\S]*))?$/iu,
  );
  if (naturalNew) return { action: 'new', title: String(naturalNew[1] || '').trim() };
  return null;
}

export async function executeCodexSessionCommand(input = {}) {
  const command = input.command;
  if (!command) return { handled: false, message: '' };
  const runner = input.runner;
  const contextKey = input.contextKey || '';
  const supportsSessions =
    runner?.persistentSessions !== false &&
    typeof runner?.newSession === 'function' &&
    typeof runner?.listSessions === 'function' &&
    typeof runner?.useSession === 'function' &&
    typeof runner?.activeSession === 'function';
  if (!supportsSessions) {
    return {
      handled: true,
      message: '当前 Codex runtime 不支持持久会话。请使用 CODEX_RUNTIME=app-server 且 CODEX_EPHEMERAL=0。',
    };
  }

  const mutating = command.action === 'new' || command.action === 'use';
  if (mutating && !input.isOwner) {
    return { handled: true, message: '只有 bridge owner 可以新建或切换当前群的 Codex Session。' };
  }
  if (mutating && (Number(input.activeCount || 0) > 0 || Number(input.queuedCount || 0) > 0)) {
    return {
      handled: true,
      message: '当前群还有运行中或排队中的任务。请等待完成，或先使用 /stop，再新建或切换 Session。',
    };
  }

  if (command.action === 'status') {
    const session = runner.activeSession({ contextKey });
    return {
      handled: true,
      session,
      message: session
        ? ['当前群的 Codex Session：', `title: ${session.title || '(未命名)'}`, `id: ${session.id}`, session.cwd ? `cwd: ${session.cwd}` : ''].filter(Boolean).join('\n')
        : '当前群还没有 Codex Session。发送普通任务或使用 /new 创建。',
    };
  }

  if (command.action === 'list') {
    const sessions = runner.listSessions({ contextKey });
    const active = runner.activeSession({ contextKey });
    return {
      handled: true,
      sessions,
      message: sessions.length
        ? [
            '当前群的 Codex Sessions：',
            ...sessions.map((session, index) =>
              `${index + 1}. ${session.id === active?.id ? '[当前] ' : ''}${session.title || '(未命名)'}\n   id: ${session.id}`,
            ),
            '',
            '使用 /use <序号|session_id|标题> 切换。',
          ].join('\n')
        : '当前群还没有 Codex Session。发送普通任务或使用 /new 创建。',
    };
  }

  if (command.action === 'new') {
    const title = command.title || input.defaultTitle || 'Lark 群新会话';
    const session = await runner.newSession({
      contextKey,
      title,
      cwd: input.cwd,
      sandbox: input.sandbox,
      messageIds: input.messageIds || [],
    });
    return {
      handled: true,
      session,
      message: ['已新建并切换当前群的 Codex Session。', `title: ${session.title || title}`, `id: ${session.id}`].join('\n'),
    };
  }

  if (command.action === 'use') {
    const session = runner.useSession({ contextKey, selector: command.selector });
    return {
      handled: true,
      session,
      message: session
        ? ['已切换当前群的 Codex Session。', `title: ${session.title || '(未命名)'}`, `id: ${session.id}`].join('\n')
        : `没有找到 Session：${command.selector}\n使用 /sessions 查看可切换列表。`,
    };
  }

  return { handled: false, message: '' };
}

export function codexSessionMessageIds(input = {}) {
  return [...new Set([
    input.messageId,
    input.message_id,
    input.threadId,
    input.thread_id,
    input.rootId,
    input.root_id,
    input.parentId,
    input.parent_id,
    input.replyToMessageId,
    input.reply_to_message_id,
  ].map(value => String(value || '').trim()).filter(Boolean))];
}

export function conversationKeyForEvent(input = {}) {
  const chatId = input.chatId || input.chat_id || '';
  const chatType = String(input.chatType || input.chat_type || '').toLowerCase();
  const threadId =
    input.threadId ||
    input.thread_id ||
    input.rootId ||
    input.root_id ||
    input.parentId ||
    input.parent_id ||
    input.replyToMessageId ||
    input.reply_to_message_id ||
    '';
  const groupScoped = input.groupScoped !== false;
  if (threadId && !groupScoped) return `thread:${chatId || 'unknown'}:${threadId}`;
  if (chatType === 'p2p') return `p2p:${chatId || input.senderId || input.sender_id || 'unknown'}`;
  return `chat:${chatId || 'unknown'}`;
}

export function createContextQueueRuntime(deps = {}) {
  const contextKeyForItem = deps.contextKeyForItem || conversationKeyForEvent;
  const runItem = deps.runItem;
  const onError = deps.onError || (() => {});
  if (typeof runItem !== 'function') throw new Error('createContextQueueRuntime requires runItem');

  const activeCounts = new Map();
  const queuedTasks = new Map();

  const activeCount = contextKey => activeCounts.get(contextKey) || 0;
  const queueForContext = contextKey => {
    const queue = queuedTasks.get(contextKey) || [];
    queuedTasks.set(contextKey, queue);
    return queue;
  };
  const createTask = (item, contextKey) => {
    let finish = () => {};
    const done = new Promise(resolve => {
      finish = resolve;
    });
    return { item, contextKey, done, finish };
  };

  const drain = contextKey => {
    if (activeCount(contextKey) > 0) return;
    const queue = queuedTasks.get(contextKey);
    if (!queue || queue.length === 0) {
      queuedTasks.delete(contextKey);
      return;
    }
    const next = queue.shift();
    if (!queue.length) queuedTasks.delete(contextKey);
    start(next);
  };

  const start = task => {
    activeCounts.set(task.contextKey, activeCount(task.contextKey) + 1);
    Promise.resolve()
      .then(() => runItem(task.item))
      .catch(error => onError(task.item, error))
      .finally(() => {
        const nextCount = activeCount(task.contextKey) - 1;
        if (nextCount > 0) activeCounts.set(task.contextKey, nextCount);
        else activeCounts.delete(task.contextKey);
        task.finish();
        drain(task.contextKey);
      });
  };

  return {
    dispatch(item, options = {}) {
      const contextKey = contextKeyForItem(item);
      const task = createTask(item, contextKey);
      const queue = queueForContext(contextKey);
      if (options.bypassQueue) {
        start(task);
        return { status: 'started', contextKey, position: 0, done: task.done };
      }
      if (activeCount(contextKey) > 0 || (queue.length > 0 && !options.front)) {
        if (options.front) queue.unshift(task);
        else queue.push(task);
        return {
          status: 'queued',
          contextKey,
          position: options.front ? 1 : queue.length,
          done: task.done,
        };
      }

      if (!queue.length) queuedTasks.delete(contextKey);
      start(task);
      return { status: 'started', contextKey, position: 0, done: task.done };
    },

    activeCount,

    activeTotal() {
      return Array.from(activeCounts.values()).reduce((sum, count) => sum + count, 0);
    },

    queuedCount(contextKey) {
      return queuedTasks.get(contextKey)?.length || 0;
    },

    queuedTotal() {
      return Array.from(queuedTasks.values()).reduce((sum, queue) => sum + queue.length, 0);
    },

    clearQueued(contextKey) {
      const queue = queuedTasks.get(contextKey);
      if (!queue?.length) return 0;
      queuedTasks.delete(contextKey);
      for (const task of queue) task.finish();
      return queue.length;
    },
  };
}

export function createStopRegistry(deps = {}) {
  const now = deps.now || (() => Date.now());
  const cancelledContexts = new Map();
  const controllersByContext = new Map();

  return {
    register(contextKey, controller) {
      if (!contextKey || !controller) return () => {};
      const controllers = controllersByContext.get(contextKey) || new Set();
      controllers.add(controller);
      controllersByContext.set(contextKey, controllers);
      return () => {
        controllers.delete(controller);
        if (!controllers.size) controllersByContext.delete(contextKey);
      };
    },

    cancel(contextKey, reason = 'stopped') {
      const cancelledAt = now();
      cancelledContexts.set(contextKey, cancelledAt);
      const controllers = controllersByContext.get(contextKey) || new Set();
      let aborted = 0;
      for (const controller of controllers) {
        if (!controller.signal?.aborted) {
          controller.abort(new Error(reason));
          aborted += 1;
        }
      }
      return { cancelledAt, aborted };
    },

    isCancelled(contextKey, startedAt) {
      const cancelledAt = cancelledContexts.get(contextKey);
      return Boolean(cancelledAt && startedAt <= cancelledAt);
    },

    activeCount(contextKey) {
      return controllersByContext.get(contextKey)?.size || 0;
    },

    activeTotal() {
      return Array.from(controllersByContext.values()).reduce((sum, controllers) => sum + controllers.size, 0);
    },
  };
}
