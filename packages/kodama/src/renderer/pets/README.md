# GIF / sprite 桌宠素材目录

放 GIF / APNG 桌宠素材。默认桌宠仍是 Live2D;这里的素材是**可选**后端,通过
`config/render.local.js` 启用(见 `config/render.local.example.js`)。

## 内置:slime（CC0,已随仓库分发）

`slime/` 是一只**随等级进化变色**的史莱姆(绿→蓝→黄→红→紫),
素材为 **"Slime (CC0)" by Rick Hoppmann**(https://opengameart.org/content/slime-0),
CC0 可商用、免署名(详见 `slime/LICENSE.txt`)。启用:

```
cp ../config/render.local.example.js ../config/render.local.js && pnpm start
```

等级阈值与配色在 `render.local.example.js` 的 `stages` 里可调。

## 自定义:你自己的私人 GIF

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
