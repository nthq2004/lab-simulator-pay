# lab-simulator
电气与自动化仿真教学系统

## 项目结构
- `index.html` — 主入口，分类导航到各评估/技能库模块（大管轮、三管轮、电子员、自动化技能库、电子电气技能库）
- `chief/`、`third/`、`ethird/` — 评估项目仿真
- `transmitter/`、`auto/`、`elec/`、`motor/` — 技能库仿真
- `lib/` — 共享前端库（`marked.min.js`、`mermaid.min.js`）
- `workers/` — Cloudflare Worker API（注册/登录/支付）

## 部署
- **静态站点**：由 Cloudflare Pages 通过 GitHub 集成自动部署（生产分支 `master`）。若 push 后长时间未更新，检查 GitHub 仓库 Webhooks 中是否有 Cloudflare 的 webhook，必要时在 Cloudflare Pages 重新连接 GitHub 仓库。
- **Worker API**：`cd workers && pnpm run deploy`（部署到 pay.wangaijun.click）
