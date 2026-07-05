import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  contextFromPayload,
  enrichTraeEvent,
  parseTraeRendererContextFromText,
} from '../src/main/trae-context.js'

test('trae payload query text becomes prompt context', () => {
  const context = contextFromPayload({
    userMessage: {
      query: [
        { type: 'web_page', data: { url: 'https://ctf.bytedance.net/ctf/competition/11?challengeId=221&page=1' } },
        { type: 'text', data: { content: '完成这道 CTF 题' } },
      ],
    },
  })

  assert.equal(context.prompt, '完成这道 CTF 题')
})

test('trae renderer logs associate initial prompt with created session id', () => {
  const text = [
    '2026-07-04T20:32:18.931+08:00 [info] [trae-chat-core] [MessageInput] Creating session and sending message {"mode":"work","userMessage":{"query":[{"type":"web_page","data":{"url":"https://ctf.bytedance.net/ctf/competition/11?challengeId=224"}},{"type":"text","data":{"content":"完成这道CTF趣味竞赛题目。"}}]}} true isWorktreeMode: false',
    '2026-07-04T20:32:19.030+08:00 [info] [trae-chat-core] [ChatSessionService] createSessionAndSendMessage succeeded, sessionId: 6a48fd5292c14db1ad4c8657 userMessageId: 6a48fd5292c14db1ad4c8658',
    '2026-07-04T20:32:25.436+08:00 [info] [trae-chat-core] [ChatSessionService] Session renamed: 6a48fd5292c14db1ad4c8657 完成CTF挑战题',
  ].join('\n')

  assert.deepEqual(parseTraeRendererContextFromText(text, '6a48fd5292c14db1ad4c8657'), {
    prompt: '完成这道CTF趣味竞赛题目。',
    title: '完成CTF挑战题',
  })
})

test('trae completion events are enriched with readable title and summary text', () => {
  const event = enrichTraeEvent({
    type: 'task_done',
    source: 'local',
    text: '任务完成',
    sessionId: '6a48fd5292c14db1ad4c8657',
    cwd: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
  }, {
    conversationId: '6a48fd5292c14db1ad4c8657',
    repoWorkingDir: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
  }, {
    findLogContext: () => ({
      title: '完成CTF挑战题',
      prompt: '完成这道CTF趣味竞赛题目。',
    }),
  })

  assert.equal(event.client, 'trae-work')
  assert.equal(event.title, '完成CTF挑战题')
  assert.equal(event.prompt, '完成这道CTF趣味竞赛题目。')
  assert.equal(event.text, '任务完成：完成CTF挑战题')
})
