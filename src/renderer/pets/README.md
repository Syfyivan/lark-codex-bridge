# 私人 GIF 素材目录

这里放**自己用、不公开**的 GIF 桌宠素材（比如水豚噜噜）。

## 用法

1. 在这里新建一个角色文件夹，例如 `capybara/`
2. 把 GIF 丢进去，按状态命名（最少放一个 `idle.gif`，其它缺失会回退到 idle）：
   - `idle.gif` 待机（必须）
   - `looking.gif` 收到飞书消息
   - `working.gif` 干活中
   - `waiting.gif` 需要你确认
   - `done.gif` 完成
   - `failed.gif` 失败
   - `tap.gif` 被点击
3. `cp ../config/render.local.example.js ../config/render.local.js`（如名字不是 `capybara` 就改里面的 `set`）
4. `pnpm start`

## ⚠️ 版权

本目录与 `config/render.local.js` 已 **gitignore**，不会被提交或打包分发。
网上找的 GIF 多数有版权，**仅限本机私人使用，不要公开 / 分发 / 提交**。
对外发布请用默认的 Live2D 后端（官方免费可商用模型）。
