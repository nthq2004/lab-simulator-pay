# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## language
所有的思考/计划/输出默认使用中文。

## Project Overview

海事电气与自动化仿真教学系统 — 面向轮机工程专业的交互式仿真工具，用于船舶自动化设备的测试、校准与故障排除训练。

## Architecture

**Pure static HTML/CSS/JS site** — no build tools, no framework, no package manager. Open `.html` files directly in a browser.

### Directory Structure

- `index.html` — 主入口，带粒子背景动画的导航门户，分类导航到 4 个评估模块
- `chief/` — 大管轮评估项目（4页）
- `third/` — 三管轮评估项目（7页）
- `transmitter/` — 自动化技能库·变送器仿真（4页）
- `auto/` — 自动化技能库·执行器/控制仿真（2页）

### Core Technology

- **Konva.js** (v10.3.0) — Canvas 2D 渲染引擎，通过 Vite 打包内联到每个页面
- 每个仿真页面是**自包含的独立 HTML 文件**：内联 Konva 库 + 内联 CSS + 内联 JS 逻辑
- `favicon.png` / `favicon-bUNewI43.png` — 站点图标

### Simulation Pattern

每个页面遵循相同结构：
1. **静态设备图** — 用 Konva 绘制的设备面板/接线图（Rect, Circle, Line, Text 等形状）
2. **交互元素** — 可拖拽滑块、按钮、输入框，调节参数（压力、温度、电压等）
3. **仿真逻辑** — 基于物理/工程公式计算输出值，实时更新显示
4. **指示/输出** — 数值显示、仪表指针、LED 状态灯、波形图

## Key Conventions

- 所有文本使用中文（面向海事/轮机工程学生）
- Konva 形状使用 `createRect/CreateCircle/CreateLine/createText/createImage` 等工厂方法
- 每个仿真页面无需网络请求即可离线运行（Konva 内联打包）
- 主入口 `index.html` 的导航使用 `switchPage()` 函数切换 4 个分类面板

## Authentication System

基于 **Cloudflare Workers + D1 数据库** 的注册/登录/支付系统。

### 访问权限

| 用户类型   | chief/ | third/ | transmitter/ | auto/ |
|------------|--------|--------|-------------|-------|
| 访客       | ✓      | ✓      | ✗           | ✗     |
| 注册用户   | ✓      | ✓      | ✓           | ✗     |
| 付费用户   | ✓      | ✓      | ✓           | ✓     |

### 项目文件

- `admin.html` — 管理后台：查看待审核付款、批准/拒绝用户升级 VIP
- `auth.js` — 前端认证模块，负责与 Worker API 通信、令牌管理、页面访问检查
- `workers/src/index.js` — Cloudflare Worker API（register/login/verify/pay/create/pay/notify/pay/status/pay/confirm）
- `workers/schema.sql` — D1 数据库表结构（users + sessions + orders）
- `workers/wrangler.toml` — 部署配置（本地开发默认 local D1, `[env.production]` 为线上）

### 环境变量（通过 `wrangler secret put` 配置）

| 变量 | 说明 |
|------|------|
| `WECHAT_APPID` | 微信 AppID |
| `WECHAT_MCH_ID` | 微信商户号 |
| `WECHAT_API_KEY` | 微信 API 密钥（HMAC-SHA256） |
| `ALIPAY_APP_ID` | 支付宝 AppID |
| `ALIPAY_PRIVATE_KEY` | 商户 RSA 私钥（PKCS8 PEM） |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥（用于验签） |
| `NOTIFY_BASE_URL` | 回调基础 URL，如 `https://pay.wangaijun.click` |
| `ADMIN_SECRET` | 管理后台密码（自行设置） |

### 部署步骤

1. 安装 Wrangler CLI: `pnpm add -g wrangler`
2. 登录 Cloudflare: `wrangler login`
3. 进入 workers 目录: `cd workers`
4. 安装依赖: `pnpm install`
5. 创建 D1 数据库: `pnpm run db:create`
6. 复制输出中的 database_id 到 `wrangler.toml` 的 `[[d1_databases]]` 配置
7. 初始化数据库表: `pnpm run db:init`
8. 配置自有域名: 取消 `wrangler.toml` 中 routes 的注释并填写域名
9. 配置支付密钥: `wrangler secret put WECHAT_APPID` （及其他环境变量）
10. 部署: `pnpm run deploy`

### 本地开发

`auth.js` 会自动检测环境：localhost 时连接 `localhost:8787`，线上时连接远程 Worker。

```bash
cd workers
pnpm run dev:local          # 启动本地开发服务器（使用 local D1）
pnpm run db:init:local      # 初始化本地 D1 数据库表
```

在浏览器打开 `index.html` 即可使用本地 API 进行注册/登录测试。

## No Tests / No Build

此项目无测试框架、无构建步骤。修改后直接在浏览器打开对应 HTML 文件即可验证。
