# 留言系统 + 登录UI改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为系统增加留言反馈功能，并改造右上角登录UI为圆形头像+下拉菜单

**Architecture:** 数据库新增 messages 表；Worker API 新增4个端点；index.html 改造用户区域为圆形头像+下拉菜单，并增加留言弹窗；admin.html 新增留言管理标签页；auth.js 新增留言API方法。

**Tech Stack:** Cloudflare Workers + D1 (SQLite), 纯静态 HTML/CSS/JS

---

### Task 1: 数据库 — schema.sql 新增 messages 表

**Files:**
- Modify: `workers/schema.sql`

- [ ] **Step 1: 在 schema.sql 末尾添加 messages 表**

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

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
```

- [ ] **Step 2: Commit**

```bash
git add workers/schema.sql
git commit -m "feat: add messages table to schema"
```

---

### Task 2: Worker API — 新增留言相关端点

**Files:**
- Modify: `workers/src/index.js`

- [ ] **Step 1: 在 handleAdminReject 之后（或 handleAdminUsers 附近），添加留言处理函数**

```javascript
// ---- 留言系统 ----

async function handleMessageCreate(request, env) {
  const user = await getSessionUser(request.headers.get('Authorization'), env);
  if (!user) return json({ success: false, message: '请先登录' }, 401);

  const { content } = await request.json();
  if (!content || content.trim().length === 0)
    return json({ success: false, message: '留言内容不能为空' });
  if (content.length > 500)
    return json({ success: false, message: '留言内容不能超过500字' });

  const result = await env.DB.prepare(
    'INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)'
  ).bind(user.id, user.username, content.trim()).run();

  return json({ success: true, message_id: result.meta.last_row_id });
}

async function handleMessageList(request, env) {
  const user = await getSessionUser(request.headers.get('Authorization'), env);
  if (!user) return json({ success: false, message: '请先登录' }, 401);

  const rows = await env.DB.prepare(
    'SELECT id, user_id, username, content, reply, replied_at, created_at FROM messages ORDER BY created_at DESC'
  ).all();

  return json({ success: true, messages: rows.results });
}

async function handleMessageReply(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const { message_id, reply } = await request.json();
  if (!message_id) return json({ success: false, message: '缺少留言ID' });
  if (!reply || reply.trim().length === 0)
    return json({ success: false, message: '回复内容不能为空' });

  const msg = await env.DB.prepare(
    'SELECT id FROM messages WHERE id = ?'
  ).bind(message_id).first();
  if (!msg) return json({ success: false, message: '留言不存在' });

  await env.DB.prepare(
    "UPDATE messages SET reply = ?, replied_at = datetime('now') WHERE id = ?"
  ).bind(reply.trim(), message_id).run();

  return json({ success: true, message: '回复成功' });
}

async function handleMessageDelete(request, env) {
  const user = await getSessionUser(request.headers.get('Authorization'), env);
  if (!user) return json({ success: false, message: '请先登录' }, 401);

  const { message_id } = await request.json();
  if (!message_id) return json({ success: false, message: '缺少留言ID' });

  const msg = await env.DB.prepare(
    'SELECT id, user_id FROM messages WHERE id = ?'
  ).bind(message_id).first();
  if (!msg) return json({ success: false, message: '留言不存在' });
  if (msg.user_id !== user.id) return json({ success: false, message: '只能删除自己的留言' });

  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(message_id).run();
  return json({ success: true, message: '已删除' });
}
```

- [ ] **Step 2: 在路由 switch 中添加新的 case**

```javascript
        case '/api/messages/create':
          return handleMessageCreate(request, env);
        case '/api/messages/list':
          return handleMessageList(request, env);
        case '/api/messages/reply':
          return handleMessageReply(request, env);
        case '/api/messages/delete':
          return handleMessageDelete(request, env);
```

需要添加的位置在 `case '/api/admin/revoke':` 之后、`default:` 之前。

- [ ] **Step 3: Commit**

```bash
git add workers/src/index.js
git commit -m "feat: add message system API endpoints"
```

---

### Task 3: auth.js — 新增留言相关 API 方法

**Files:**
- Modify: `auth.js`

- [ ] **Step 1: 在 Auth 对象末尾、getAccessLevel 方法之后添加留言方法**

```javascript
  // ---- 留言系统 ----

  async createMessage(content) {
    const res = await fetch(API_BASE + '/messages/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this._token,
      },
      body: JSON.stringify({ content }),
    });
    return res.json();
  },

  async getMessages() {
    const res = await fetch(API_BASE + '/messages/list', {
      headers: { Authorization: 'Bearer ' + this._token },
    });
    return res.json();
  },

  async deleteMessage(message_id) {
    const res = await fetch(API_BASE + '/messages/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this._token,
      },
      body: JSON.stringify({ message_id }),
    });
    return res.json();
  },
```

- [ ] **Step 2: Commit**

```bash
git add auth.js
git commit -m "feat: add message API methods to auth module"
```

---

### Task 4: index.html — 右上角改造为圆形头像+下拉菜单

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 替换用户区域 HTML**

将现有 `user-area` 部分（约第373-383行）替换为：

```html
    <div class="user-area" id="userArea">
        <!-- 未登录 -->
        <span class="user-btn" id="loginBtn" onclick="showLoginModal()">登录</span>
        <span class="user-btn" id="registerBtn" onclick="showRegisterModal()">注册</span>
        <!-- 已登录：圆形头像 -->
        <div class="user-avatar-wrapper" id="userAvatarWrapper" style="display:none;">
            <div class="user-avatar" id="userAvatar" onclick="toggleMenu(event)">
                <span id="avatarLetter"></span>
            </div>
            <!-- 下拉菜单 -->
            <div class="dropdown-menu" id="dropdownMenu">
                <div class="dropdown-item user-info-row" id="menuUserInfo">
                    <span class="dropdown-avatar" id="menuAvatarLetter"></span>
                    <span class="dropdown-username" id="menuUsername"></span>
                    <span class="vip-badge" id="menuVipBadge" style="display:none">VIP</span>
                </div>
                <div class="dropdown-item" id="menuMessages" onclick="showMessageModal()">
                    <span class="menu-icon">💬</span>
                    <span>留言系统</span>
                </div>
                <div class="dropdown-divider"></div>
                <div class="dropdown-item" onclick="handleLogout()">
                    <span class="menu-icon">🚪</span>
                    <span>退出登录</span>
                </div>
            </div>
        </div>
    </div>
```

- [ ] **Step 2: 添加圆形头像和下拉菜单的 CSS 样式**

在 `<style>` 标签内，`/* 认证样式 */` 部分添加：

```css
/* 圆形头像 */
.user-avatar-wrapper{
    position:relative;
    display:inline-block;
}
.user-avatar{
    width:36px;height:36px;
    border-radius:50%;
    background:rgba(0,180,255,0.7);
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    transition:0.3s;
    user-select:none;
}
.user-avatar:hover{
    background:rgba(0,180,255,0.9);
    box-shadow:0 0 12px rgba(0,180,255,0.4);
}
.user-avatar span{
    color:white;
    font-size:16px;
    font-weight:bold;
}

/* 下拉菜单 */
.dropdown-menu{
    display:none;
    position:absolute;
    top:44px;
    right:0;
    width:200px;
    background:rgba(15,32,39,0.96);
    border:1px solid rgba(0,180,255,0.3);
    border-radius:12px;
    backdrop-filter:blur(10px);
    box-shadow:0 8px 30px rgba(0,0,0,0.4);
    z-index:50;
    overflow:hidden;
}
.dropdown-menu.active{
    display:block;
}
.dropdown-item{
    padding:12px 16px;
    display:flex;
    align-items:center;
    gap:10px;
    cursor:pointer;
    transition:0.2s;
    font-size:14px;
    color:rgba(255,255,255,0.85);
}
.dropdown-item:hover{
    background:rgba(0,180,255,0.1);
}
.dropdown-item .menu-icon{
    font-size:16px;
    width:20px;
    text-align:center;
}
.dropdown-divider{
    height:1px;
    background:rgba(255,255,255,0.08);
    margin:0;
}
.user-info-row{
    cursor:default;
    pointer-events:none;
}
.user-info-row:hover{
    background:transparent;
}
.dropdown-avatar{
    width:28px;height:28px;
    border-radius:50%;
    background:rgba(0,180,255,0.7);
    display:inline-flex;
    align-items:center;
    justify-content:center;
    color:white;
    font-size:13px;
    font-weight:bold;
    flex-shrink:0;
}
.dropdown-username{
    font-weight:bold;
    flex:1;
}
```

- [ ] **Step 3: 修改 `updateAuthUI()` 函数**

```javascript
function updateAuthUI(){
    const loginBtn=document.getElementById("loginBtn")
    const registerBtn=document.getElementById("registerBtn")
    const avatarWrapper=document.getElementById("userAvatarWrapper")
    const avatarLetter=document.getElementById("avatarLetter")
    const menuAvatarLetter=document.getElementById("menuAvatarLetter")
    const menuUsername=document.getElementById("menuUsername")
    const menuVipBadge=document.getElementById("menuVipBadge")

    if(Auth.isLoggedIn()){
        loginBtn.style.display="none"
        registerBtn.style.display="none"
        avatarWrapper.style.display="inline-block"
        const user=Auth.getCurrentUser()
        const firstChar=user.username.charAt(0)
        avatarLetter.textContent=firstChar
        menuAvatarLetter.textContent=firstChar
        menuUsername.textContent=user.username
        menuVipBadge.style.display=Auth.isPaid()?"inline":"none"
    }else{
        loginBtn.style.display="inline"
        registerBtn.style.display="inline"
        avatarWrapper.style.display="none"
    }
}
```

- [ ] **Step 4: 添加下拉菜单开关函数**

```javascript
function toggleMenu(event){
    event.stopPropagation()
    const menu=document.getElementById("dropdownMenu")
    menu.classList.toggle("active")
}

// 点击页面其他区域关闭菜单
document.addEventListener("click",function(){
    document.getElementById("dropdownMenu").classList.remove("active")
})
```

将这段代码加在 `handleLogout` 函数之后（或 DOMContentLoaded 之前）。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: redesign login UI with avatar and dropdown menu"
```

---

### Task 5: index.html — 新增留言弹窗

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在支付弹窗 `paymentModal` 之后添加留言弹窗 HTML**

```html
<!-- ===== 留言弹窗 ===== -->
<div class="modal-overlay" id="messageModal">
    <div class="modal-card" style="width:550px;max-height:80vh;display:flex;flex-direction:column;">
        <span class="modal-close" onclick="closeModal('messageModal')">&times;</span>
        <h2>留言系统</h2>
        <div id="messageList" style="flex:1;overflow-y:auto;margin-bottom:15px;min-height:200px;max-height:50vh;">
            <div class="empty" id="messageEmpty" style="padding:60px 20px;color:rgba(255,255,255,0.4);text-align:center;font-size:15px;">
                暂无留言
            </div>
        </div>
        <div style="display:flex;gap:10px;border-top:1px solid rgba(255,255,255,0.08);padding-top:15px;">
            <textarea id="messageInput" placeholder="请输入留言内容..." style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid rgba(0,180,255,0.3);background:rgba(255,255,255,0.05);color:white;font-size:14px;outline:none;resize:none;height:44px;font-family:inherit;box-sizing:border-box;" maxlength="500"></textarea>
            <button onclick="submitMessage()" style="padding:10px 24px;border-radius:10px;border:none;background:rgba(0,180,255,0.7);color:white;font-size:14px;cursor:pointer;white-space:nowrap;transition:0.3s;height:44px;">提交</button>
        </div>
        <div id="messageError" style="color:#ff6b6b;font-size:13px;margin-top:8px;min-height:18px;"></div>
    </div>
</div>
```

- [ ] **Step 2: 添加留言弹窗相关 JS 函数（放在 `handleLogout` 附近或 updateAuthUI 之后）**

```javascript
// ---- 留言系统 ----

function showMessageModal(){
    document.getElementById("messageModal").classList.add("active")
    loadMessages()
}

async function loadMessages(){
    const list=document.getElementById("messageList")
    const empty=document.getElementById("messageEmpty")
    const r=await Auth.getMessages()
    if(!r.success)return

    const msgs=r.messages||[]
    empty.style.display=msgs.length?"none":"block"

    list.innerHTML=msgs.map(m=>{
        const isOwner=Auth.getCurrentUser()&&Auth.getCurrentUser().username===m.username
        const replyHtml=m.reply
            ?'<div style="margin-top:10px;padding:10px 14px;background:rgba(0,180,255,0.08);border-left:3px solid #00b4ff;border-radius:6px;font-size:13px;">'+
              '<span style="color:#00b4ff;font-weight:bold;">管理员回复</span>'+
              '<div style="margin-top:4px;color:rgba(255,255,255,0.85);">'+escapeHtml(m.reply)+'</div>'+
              '<div style="margin-top:4px;color:rgba(255,255,255,0.4);font-size:12px;">'+(m.replied_at||'')+'</div>'+
              '</div>'
            :''
        const deleteBtn=isOwner
            ?'<span style="margin-left:12px;color:#ff4d4f;cursor:pointer;font-size:12px;" onclick="deleteMessage('+m.id+')">删除</span>'
            :''
        return '<div style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'+
            '<span style="font-weight:bold;font-size:14px;">'+escapeHtml(m.username)+'</span>'+
            '<span style="color:rgba(255,255,255,0.35);font-size:12px;">'+m.created_at+'</span>'+
            deleteBtn+
            '</div>'+
            '<div style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;">'+escapeHtml(m.content)+'</div>'+
            replyHtml+
            '</div>'
    }).join('')+'<div style="height:4px;"></div>' // 底部留白

    // 滚动到顶部
    list.scrollTop=0
}

async function submitMessage(){
    const input=document.getElementById("messageInput")
    const errEl=document.getElementById("messageError")
    const content=input.value.trim()
    if(!content){errEl.textContent="留言内容不能为空";return}
    if(content.length>500){errEl.textContent="留言内容不能超过500字";return}
    errEl.textContent=""
    const r=await Auth.createMessage(content)
    if(r.success){
        input.value=""
        loadMessages()
    }else{
        errEl.textContent=r.message
    }
}

async function deleteMessage(id){
    if(!confirm("确定删除该留言？"))return
    const r=await Auth.deleteMessage(id)
    if(r.success){
        loadMessages()
    }else{
        alert(r.message)
    }
}
```

- [ ] **Step 3: 在 `closeModal` 函数中，关闭留言弹窗时清空输入框错误信息**

找到 `closeModal` 函数定义（大约第579行），在其函数体内添加：

```javascript
// 关闭留言弹窗时清空
if(id==="messageModal"){
    document.getElementById("messageError").textContent=""
}
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add message modal with list, submit, and delete"
```

---

### Task 6: admin.html — 新增留言管理标签页

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 在标签栏中添加"留言管理"按钮**

找到 `<div class="tabs">`，在已付款用户按钮之后添加：

```html
    <button class="tab-btn" id="tabMessages" onclick="switchTab('messages')">留言管理</button>
```

- [ ] **Step 2: 在已付款用户标签内容之后添加留言管理标签内容**

在 `</div> <!-- 已付款用户标签页结束 -->` 之后、`</div> <!-- adminPanel结束 -->` 之前添加：

```html
  <!-- 留言管理标签页 -->
  <div class="tab-content" id="tabContentMessages">
    <div class="toolbar">
      <span class="count" id="messagesCount">留言：0</span>
      <button class="refresh-btn" onclick="loadMessages()">&#x21bb; 刷新</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>用户名</th>
          <th>留言内容</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="messagesList"></tbody>
    </table>
    <div class="empty" id="messagesEmptyHint">暂无留言</div>
  </div>
```

- [ ] **Step 3: 修改 `switchTab` 函数，增加 messages 分支**

```javascript
  } else if (tab === 'messages') {
    document.getElementById('tabMessages').classList.add('active');
    document.getElementById('tabContentMessages').classList.add('active');
    loadMessages();
  } else {
```

- [ ] **Step 4: 添加回复弹窗 HTML（在留言管理标签内容之后、adminPanel结束之前）**

```html
  <!-- 回复弹窗 -->
  <div class="modal-overlay" id="replyModal">
    <div class="modal-card">
      <span class="modal-close" onclick="closeModal('replyModal')">&times;</span>
      <h2>回复留言</h2>
      <div id="replyOriginalMsg" style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:15px;font-size:13px;color:rgba(255,255,255,0.7);"></div>
      <textarea id="replyContent" placeholder="请输入回复内容..." style="width:100%;padding:12px 15px;border-radius:10px;border:1px solid rgba(0,180,255,0.3);background:rgba(255,255,255,0.05);color:white;font-size:14px;outline:none;resize:vertical;min-height:100px;font-family:inherit;box-sizing:border-box;margin-bottom:15px;"></textarea>
      <div style="display:flex;gap:10px;">
        <button onclick="closeModal('replyModal')" style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:white;font-size:14px;cursor:pointer;">取消</button>
        <button onclick="submitReply()" style="flex:1;padding:12px;border-radius:10px;border:none;background:rgba(0,180,255,0.7);color:white;font-size:14px;cursor:pointer;">提交回复</button>
      </div>
      <div id="replyError" style="color:#ff6b6b;font-size:13px;margin-top:10px;min-height:18px;"></div>
    </div>
  </div>
```

- [ ] **Step 5: 添加留言管理相关的 JS 函数**

在 `revokeVip` 函数之前添加 `loadMessages` 相关变量和函数，以及回复函数：

```javascript
let currentReplyMessageId = null;

async function loadMessages() {
  const list = document.getElementById('messagesList');
  const emptyHint = document.getElementById('messagesEmptyHint');
  const countEl = document.getElementById('messagesCount');

  try {
    const res = await fetch(API_BASE + '/admin/messages', {
      headers: { 'X-Admin-Secret': adminSecret || '' },
    });
    const data = await res.json();
    if (!data.success) return;

    const rows = data.messages || [];
    countEl.textContent = '留言：' + rows.length;
    emptyHint.style.display = rows.length ? 'none' : 'block';

    if (!rows.length) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = rows.map(m => {
      const replied = m.reply !== null;
      const statusHtml = replied
        ? '<span style="color:#07c160;">已回复</span>'
        : '<span style="color:#ff4d4f;">未回复</span>';
      const contentPreview = m.content.length > 50
        ? escapeHtml(m.content.substring(0, 50)) + '...'
        : escapeHtml(m.content);
      return '<tr>' +
        '<td>' + m.id + '</td>' +
        '<td>' + escapeHtml(m.username) + '</td>' +
        '<td title="' + escapeHtml(m.content).replace(/"/g, '&quot;') + '">' + contentPreview + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td><button class="btn-approve" onclick="openReply(' + m.id + ')">回复</button></td>' +
      '</tr>';
    }).join('');
  } catch (_) {}
}

function openReply(messageId) {
  currentReplyMessageId = messageId;
  // 找到原始留言内容
  const list = document.getElementById('messagesList');
  const row = list.querySelector('tr:nth-child(' + (messageId) + ')');
  // 通过 API 获取留言详情
  fetch(API_BASE + '/admin/message?id=' + messageId, {
    headers: { 'X-Admin-Secret': adminSecret || '' },
  }).then(res => res.json()).then(data => {
    if (data.success && data.message) {
      document.getElementById('replyOriginalMsg').innerHTML =
        '<strong>' + escapeHtml(data.message.username) + '</strong>：' + escapeHtml(data.message.content);
    } else {
      document.getElementById('replyOriginalMsg').textContent = '无法加载留言内容';
    }
  }).catch(() => {
    document.getElementById('replyOriginalMsg').textContent = '无法加载留言内容';
  });
  document.getElementById('replyContent').value = '';
  document.getElementById('replyError').textContent = '';
  document.getElementById('replyModal').classList.add('active');
}

async function submitReply() {
  const reply = document.getElementById('replyContent').value.trim();
  const errEl = document.getElementById('replyError');
  if (!reply) { errEl.textContent = '回复内容不能为空'; return; }
  errEl.textContent = '';
  const res = await fetch(API_BASE + '/messages/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret || '' },
    body: JSON.stringify({ message_id: currentReplyMessageId, reply }),
  });
  const data = await res.json();
  if (data.success) {
    closeModal('replyModal');
    loadMessages();
  } else {
    errEl.textContent = data.message;
  }
}
```

- [ ] **Step 6: 添加 /admin/closeModal 函数复用（或确保 closeModal 可用）**

检查 admin.html 中是否有 `closeModal` 函数，如果没有就添加：

```javascript
function closeModal(id){
    document.getElementById(id).classList.remove("active")
}
```

放到脚本顶部的工具函数区域（`escapeHtml` 函数附近）。

- [ ] **Step 7: Commit**

```bash
git add admin.html
git commit -m "feat: add message management tab to admin panel"
```

---

### Task 7: Worker API — 新增管理员获取留言的端点

**Files:**
- Modify: `workers/src/index.js`

- [ ] **Step 1: 添加管理员获取留言列表和单条留言的端点**

```javascript
// ---- 管理员留言管理 ----

async function handleAdminMessages(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const rows = await env.DB.prepare(
    'SELECT id, user_id, username, content, reply, replied_at, created_at FROM messages ORDER BY created_at DESC'
  ).all();

  return json({ success: true, messages: rows.results });
}

async function handleAdminMessageDetail(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return json({ success: false, message: '缺少留言ID' });

  const msg = await env.DB.prepare(
    'SELECT id, user_id, username, content, reply, replied_at, created_at FROM messages WHERE id = ?'
  ).bind(id).first();

  if (!msg) return json({ success: false, message: '留言不存在' });

  return json({ success: true, message: msg });
}
```

- [ ] **Step 2: 在路由表中注册新端点**

```javascript
        case '/api/admin/messages':
          return handleAdminMessages(request, env);
        case '/api/admin/message':
          return handleAdminMessageDetail(request, env);
```

放在 `/api/admin/revoke` 之后、`default:` 之前。

- [ ] **Step 3: Commit**

```bash
git add workers/src/index.js
git commit -m "feat: add admin message list and detail API endpoints"
```

- [ ] **Step 4: 验证：确保 CORS_HEADERS 中未遗漏相关路由（已验证：OPTIONS 已统一处理，不需要为每个路由单独配置 CORS）**

---

### Task 8: 最终验证

**Files:** Check all modified files

- [ ] **Step 1: 确认所有文件已保存且无语法错误**

```bash
cd "e:/BaiduSyncdisk/03 教学材料/仿真软件制作/网站/lab-simulator-pay"
node -e "
  // 粗略语法检查
  const fs=require('fs');
  const files=['auth.js','index.html','admin.html','workers/src/index.js'];
  files.forEach(f=>{
    try{
      const c=fs.readFileSync(f,'utf8');
      console.log(f+': OK ('+c.split('\\n').length+' lines)');
    }catch(e){console.log(f+': ERROR '+e.message);}
  });
"
```

- [ ] **Step 2: 检查 schema.sql 中 messages 表定义**

```bash
grep -A 10 "CREATE TABLE IF NOT EXISTS messages" workers/schema.sql
```

- [ ] **Step 3: 完整 git 状态检查**

```bash
git status
git log --oneline -5
```
