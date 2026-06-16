export function parseQueueCommand(content) {
  const match = String(content || '').trim().match(/^\/queue(?:\s+([\s\S]+))?$/iu);
  if (!match) return null;
  return { text: String(match[1] || '').trim() };
}

export function isStopCommand(content) {
  return /^\/(?:stop|停止|终止)(?:\s|$)/iu.test(String(content || '').trim());
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
  if (threadId) return `thread:${chatId || 'unknown'}:${threadId}`;
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
