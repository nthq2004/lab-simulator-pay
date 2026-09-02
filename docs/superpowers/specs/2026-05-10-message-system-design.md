# 留言系统 + 登录UI改造 设计文档

## 概述

为海事电气与自动化仿真教学系统增加留言反馈功能，同时对右上角登录UI进行改造，使用户体验更现代化。

## 1. 右上角登录UI改造

### 1.1 未登录状态
- 保持现有"登录"链接按钮不变

### 1.2 已登录状态
- 右上角显示**圆形头像**，内容为用户名首字（白色字体，蓝色背景）
- 点击圆形头像弹出**下拉菜单**，包含三栏：
  - **第一栏**：显示用户名 + VIP标志（金色VIP徽章）
  - **第二栏**："留言系统"入口（带消息图标），点击打开留言弹窗
  - **第三栏**："退出登录"（带退出图标），点击执行登出

### 1.3 交互行为
- 点击头像区域外任意位置关闭下拉菜单
- 下拉菜单位于头像正下方，半透明毛玻璃背景

## 2. 留言系统 - 前端 (index.html)

### 2.1 入口
- 通过右上角下拉菜单的"留言系统"菜单项打开
- 使用已有的 modal-overlay 弹窗机制

### 2.2 留言弹窗布局
- **顶部**：标题"留言系统" + 关闭按钮
- **中间**：留言列表（按时间倒序），每条显示：
  - 留言者用户名 + 留言时间
  - 留言内容
  - 管理员回复（如果有，用缩进/边框区分）
- **底部**：文本输入框 + 提交按钮

### 2.3 留言可见范围
- **公开可见**：所有登录用户可以看到所有留言及管理员回复

### 2.4 提交留言
- 用户在底部输入框填写内容，点击提交
- 提交成功后自动刷新列表
- 用户可对自己已提交的留言进行删除（仅限自己的留言）

## 3. 留言系统 - 管理后台 (admin.html)

### 3.1 标签页
- 新增"留言管理"标签页，放在"已付款用户"之后

### 3.2 留言列表（表格形式）
| 列 | 说明 |
|------|------|
| ID | 留言编号 |
| 用户名 | 留言者 |
| 留言内容 | 截取前50字，完整内容鼠标悬停或点击查看 |
| 状态 | 「未回复」(红色) 或 「已回复」(绿色) |
| 操作 | 「回复」按钮 |

### 3.3 回复功能
- 点击"回复"按钮弹出回复弹窗
- 显示原留言内容（只读）
- 输入回复内容，提交后更新数据库
- 回复成功后刷新列表

## 4. Worker API 端点

### 4.1 用户提交留言
```
POST /api/messages/create
Headers: Authorization: Bearer <token>
Body: { "content": "留言内容" }
Response: { success: true, message_id: 123 }
```

### 4.2 获取留言列表
```
GET /api/messages/list
Headers: Authorization: Bearer <token>
Response: {
  success: true,
  messages: [
    {
      id: 1,
      user_id: 1,
      username: "张三",
      content: "留言内容",
      reply: "管理员回复" | null,
      replied_at: "2026-05-10 15:00:00" | null,
      created_at: "2026-05-10 14:30:00"
    }
  ]
}
```

### 4.3 管理员回复留言
```
POST /api/messages/reply
Headers: X-Admin-Secret: <secret>
Body: { "message_id": 1, "reply": "回复内容" }
Response: { success: true }
```

### 4.4 用户删除自己的留言
```
POST /api/messages/delete
Headers: Authorization: Bearer <token>
Body: { "message_id": 1 }
Response: { success: true }
```

## 5. 数据库变更

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  reply TEXT,
  replied_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## 6. auth.js 新增方法

```js
Auth.createMessage(content)  // POST /api/messages/create
Auth.getMessages()           // GET /api/messages/list
Auth.deleteMessage(id)       // POST /api/messages/delete
```

## 7. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `workers/src/index.js` | 修改 | 新增4个API端点 + 路由注册 |
| `workers/schema.sql` | 修改 | 新增 messages 表 |
| `index.html` | 修改 | 头像+下拉菜单UI、留言弹窗UI、留言逻辑 |
| `auth.js` | 修改 | 新增留言相关 API 方法 |
| `admin.html` | 修改 | 新增"留言管理"标签页 |

## 8. 约束条件

- 所有留言内容不能为空，最大长度500字
- 未登录用户不能查看留言系统
- 管理员回复后，用户端自动刷新显示（通过重新请求列表）
- 遵循现有项目风格：深色主题、毛玻璃效果、蓝色主色调
