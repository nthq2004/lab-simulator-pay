// 前端认证模块 — 通过 Cloudflare Worker API 与 D1 数据库交互

// 自动检测环境：本地开发(localhost)用 wrangler dev，线上用远程 Worker
const API_HOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://pay.wangaijun.click';
const API_BASE = API_HOST + '/api';

const Auth = {
  _token: localStorage.getItem('auth_token'),
  _user: null,
  _ready: false,

  // ---- 初始化：验证已有令牌 ----

  async init() {
    this._ready = false;
    if (!this._token) { this._ready = true; return null; }
    try {
      const res = await fetch(API_BASE + '/verify', {
        headers: { Authorization: 'Bearer ' + this._token },
      });
      const data = await res.json();
      if (data.success) {
        this._user = data.user;
        this._ready = true;
        return this._user;
      }
    } catch (_) { /* 网络错误，离线时静默处理 */ }
    this._token = null;
    this._user = null;
    localStorage.removeItem('auth_token');
    this._ready = true;
    return null;
  },

  // ---- 注册 ----

  async register(username, password) {
    const res = await fetch(API_BASE + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return res.json();
  },

  // ---- 登录 ----

  async login(username, password) {
    const res = await fetch(API_BASE + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      this._token = data.token;
      this._user = data.user;
      localStorage.setItem('auth_token', data.token);
    }
    return data;
  },

  // ---- 登出 ----

  logout() {
    this._token = null;
    this._user = null;
    localStorage.removeItem('auth_token');
  },

  // ---- 支付 ----

  // 提交付款通知（用户点击"我已支付"后通知管理员）
  async submitPaymentNotify(provider) {
    const res = await fetch(API_BASE + '/pay/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this._token,
      },
      body: JSON.stringify({ provider }),
    });
    return res.json();
  },

  // ---- 状态查询 ----

  isLoggedIn() { return !!this._user; },
  isPaid()     { return this._user && this._user.paid === 1; },
  getCurrentUser() { return this._user; },

  getAccessLevel() {
    if (this._user && this._user.paid === 1) return 2; // 付费用户
    if (this._user) return 1; // 注册用户
    return 0; // 访客
  },
};

// ---- 自动页面访问检查 ----

(function () {
  const PWD = window.location.pathname;

  // 判断当前页面属于哪个目录
  let required = 0;
  if (/\/auto\//.test(PWD)) required = 2;
  else if (/\/transmitter\//.test(PWD)) required = 1;
  // chief/ 和 third/ → required = 0 (始终允许)

  if (required === 0) return; // 无需检查

  // 获取返回到 index.html 的相对路径
  function getIndexPath() {
    const depth = (PWD.replace(/\/+$/, '').match(/\//g) || []).length - 1;
    return '../'.repeat(Math.max(0, depth)) + 'index.html';
  }

  // 异步检查：先初始化，再判断权限
  (async () => {
    await Auth.init();
    if (Auth.getAccessLevel() < required) {
      const msg = required === 2
        ? '此页面需要付费解锁。请返回首页完成支付。'
        : '请先登录以访问此页面。';
      alert(msg);
      window.location.href = getIndexPath();
    }
  })();
})();
