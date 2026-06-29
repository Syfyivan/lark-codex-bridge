# Kodama TODO

> 续接清单（2026-06-29 整理）。配合 `docs/ROADMAP.md` 和 `git log` 看。
> 勾掉做完的；新发现的往对应分组里加。

---

## 1. 本轮功能待人工验证（代码已合并、测试已过，但有几项无法自动验）

- [ ] **Live2D 动作状态机**（commit `1eae0b7`）：启动桌宠肉眼验——
  - [ ] 连续快速触发两个反应（如 task_started 再 lark_reply_sent）→ 动作应**排队/平滑过渡**，不是闪烁或互相截断
  - [ ] 反应播放途中点「摸摸」/双击 → 应被 **FORCE 立刻打断**换成 Tap
  - [ ] 静置 → 自动循环 idle 待机（库内置 IDLE loop），且 idle 不顶掉正在播的反应
  - [ ] 控制台无 `model.motion` 报错
- [ ] **MCP server**（commit `da43e71`）：端到端验证——
  - [ ] 在 Claude Code 配置加：
    ```json
    { "mcpServers": { "kodama": {
      "command": "node",
      "args": ["/Users/bytedance/code/lark-codex-bridge/packages/kodama/src/mcp/server.mjs"]
    }}}
    ```
  - [ ] 让 agent 调 `say("正在跑测试")` → 桌宠冒泡；调 `set_state("working")` → 桌宠切状态
  - [ ] 协议层已冒烟通过（initialize/tools/list），仅差「真在跑的桌宠 + Claude Code」这步
- [ ] **token 成本**（commit `cd68b38`）：`summarize()` 已返回 `cost:{today,last7,total}`，但**还没接到 UI**（托盘/管理中心/onTap 显示成本）。定价表是 2026-06 近似快照，见 `src/main/pricing.js`。

## 2. 待推送（本地已提交，未 push）

- [ ] monorepo `main`：feature wave 1 等多个提交（`cd68b38` `1eae0b7` `da43e71` `72e955d` 及之前的修复链）
- [ ] standalone `Syfyivan/kodama`：同步提交链（最新 `f6e2c8a`）
- [ ] push 命令需绕代理：`HTTP_PROXY= HTTPS_PROXY= git push origin HEAD`（github 直连可通，代理 CONNECT 会被掐）

## 3. 第二梯队功能（研究报告点名、尚未做的差距）

> 详见飞书文档《[Kodama] 开源项目学习与功能差距》+ 本地 `~/code/kodama-interview-notes/04-向开源项目学习-功能与架构差距.md`

- [ ] **插件 SDK**（参考 openpets）：把反应/事件源/配饰做成可插拔插件（能力对象 + 沙箱 + 权限模型）
- [ ] **本地 IPC 脊柱 + lease 仲裁**（openpets）：番茄钟/飞书/MCP/agent 抢一只宠物时按 lease 排他，避免互相踩气泡
- [ ] **上下文感知**（Live2DPet）：截屏 + 活动窗口感知（内存 ring buffer、不落盘），桌宠按你在干嘛说更贴切的话。**隐私必须做得比 Live2DPet 好**：默认关闭 + 敏感应用黑名单 + 可选本地 VLM
- [ ] **语音 ASR/TTS 管线**（Open-LLM-VTuber）：先把单点 macOS `say` 抽成 `TTSInterface` 的一个 provider（后续加 Edge-TTS/Piper 零改调用点）；ASR/可打断对话作中长期

## 4. 可选加固（之前审查标记、属设计权衡/需联网验证，没擅自改）

- [ ] **token 日界用 UTC**（`src/main/token-usage.js`）：`today`/`last7` 按时间戳自身日期(≈UTC)分桶，对 UTC+8 滞后 8h。改本地日期会让测试依赖运行环境时区——要改需一并处理测试确定性
- [ ] **token 去重已做**，但 **cost 仍是近似**（定价快照、Codex 模型默认 gpt-5）；要精确账单接真实计费 API
- [ ] **bridge transcript 安全**（`packages/bridge/lark-codex-bridge.mjs`）：`isPathInside` 用词法 resolve（不解析符号链接）；`readFileSync` 无大小上限。要严格可改 `realpathSync` + 加读上限
- [ ] **setup-assets 供应链**（`scripts/setup-assets.mjs`）：vendor JS 无 checksum；`live2dcubismcore` 未锁版本、Live2D 样例用 `@master`/`@develop` 移动分支。建议 pin 到具体 tag/commit + 给执行型 JS 加 SHA-256（需联网验证可用 pin）
- [ ] **Codex hook 注册方式**：当前写 `~/.codex/hooks.json`（保留现状）；若要切 `notify`/`config.toml` 是行为变更，单独评估
- [ ] **standalone 打包无 Dock 图标**：standalone `package.json` 没有 monorepo 的 `mac.extendInfo.LSUIElement:true`，想要安装版也无 Dock 图标需手动加

## 5. 外部 / 运维动作

- [ ] **切 cmux → Automation 模式**（精确跳转的真正解法）：cmux Settings → Automation → Socket control mode →「Automation mode」，或 `~/.config/cmux/cmux.json` 加 `{"automation":{"socketControlMode":"automation"}}`
- [ ] **cmux PR #7041**（https://github.com/manaflow-ai/cmux/pull/7041）跟进：把 cmuxOnly 死胡同报错改成可操作提示，分支 `actionable-socket-denial-hint`，未本地构建验证

---

## 同步两仓的方式（别手动 copy）

monorepo 是唯一事实源。改完 monorepo 跑：

```bash
node packages/kodama/scripts/sync-standalone.mjs   # 同步进 ~/code/kodama
```

它按 `git ls-files` 拷贝、跳过 `package.json`（身份）和自身、自动排除 gitignore 文件。
