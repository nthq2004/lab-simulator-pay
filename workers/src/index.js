// Cloudflare Worker — 认证 & 支付 API（微信支付 + 支付宝）
// ============================================================

const AMOUNT = 990;          // 微信支付金额（分），9.9元 = 990分
const AMOUNT_YUAN = '9.90';  // 支付宝金额（元）
const SUBJECT = '仿真教学系统VIP解锁';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
};

let dbInitialized = false;

async function ensureDbTables(env) {
  if (dbInitialized) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS messages (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "user_id INTEGER NOT NULL," +
    "username TEXT NOT NULL," +
    "content TEXT NOT NULL," +
    "reply TEXT," +
    "replied_at TEXT," +
    "created_at TEXT DEFAULT (datetime('now'))," +
    "FOREIGN KEY (user_id) REFERENCES users(id)" +
    ");" +
    "CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);"
  );
  dbInitialized = true;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ====================================================================
// 工具函数
// ====================================================================

function randomHex(len) {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + password));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateOrderId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `ORD_${y}${m}${d}_${h}${min}${s}_${randomHex(4)}`;
}

function pemToBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [\w ]+-----/g, '')
    .replace(/-----END [\w ]+-----/g, '')
    .replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// ====================================================================
// Session 验证
// ====================================================================

async function getSessionUser(authHeader, env) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const session = await env.DB.prepare(`
    SELECT u.id, u.username, u.paid FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).bind(token).first();
  return session || null;
}

// ====================================================================
// 微信支付 Native 模式
// ====================================================================

async function wechatSign(params, apiKey) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&') + `&key=${apiKey}`;
  // 使用 HMAC-SHA256
  const enc = new TextEncoder();
  const key = crypto.subtle.importKey(
    'raw', enc.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  // 同步转异步
  const k_1 = await key;
  const buf = await crypto.subtle.sign('HMAC', k_1, enc.encode(str));
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

function buildWechatXml(params) {
  let xml = '<xml>';
  for (const [k, v] of Object.entries(params)) {
    xml += `<${k}><![CDATA[${v}]]></${k}>`;
  }
  xml += '</xml>';
  return xml;
}

function parseWechatXml(xml) {
  const obj = {};
  const re = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) obj[m[1]] = m[2];

  // 也解析非 CDATA 字段（有些字段可能没有 CDATA）
  const re2 = /<(\w+)>([^<]+)<\/\1>/g;
  while ((m = re2.exec(xml)) !== null) {
    if (!obj[m[1]]) obj[m[1]] = m[2];
  }
  return obj;
}

async function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || '127.0.0.1';
}

async function callWechatPay(orderId, totalFee, notifyUrl, env) {
  const nonceStr = randomHex(16);
  const params = {
    appid: env.WECHAT_APPID,
    mch_id: env.WECHAT_MCH_ID,
    nonce_str: nonceStr,
    body: SUBJECT,
    out_trade_no: orderId,
    total_fee: String(totalFee),
    spbill_create_ip: '0.0.0.0',  // 由微信侧自动获取
    notify_url: notifyUrl,
    trade_type: 'NATIVE',
  };

  const sign = await wechatSign(params, env.WECHAT_API_KEY);
  params.sign = sign;

  const xmlBody = buildWechatXml(params);
  const resp = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlBody,
  });

  const xmlText = await resp.text();
  const result = parseWechatXml(xmlText);

  if (result.return_code !== 'SUCCESS') {
    return { success: false, message: result.return_msg || '微信支付接口返回错误' };
  }
  if (result.result_code !== 'SUCCESS') {
    return { success: false, message: result.err_code_des || '微信支付业务错误' };
  }

  return {
    success: true,
    prepay_id: result.prepay_id,
    code_url: result.code_url,
  };
}

// ====================================================================
// 支付宝 支付
// ====================================================================

let _cachedAlipayKey = null;

async function getAlipayPrivateKey(pem) {
  if (_cachedAlipayKey) return _cachedAlipayKey;
  _cachedAlipayKey = await crypto.subtle.importKey(
    'pkcs8', pemToBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  return _cachedAlipayKey;
}

async function alipaySign(params, privateKeyPem) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&');
  const key = await getAlipayPrivateKey(privateKeyPem);
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, key, enc.encode(str)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function alipayFormEncode(params) {
  const keys = Object.keys(params).sort();
  return keys.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
}

async function callAlipay(orderId, notifyUrl, env) {
  const now = new Date();
  const timestamp = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');

  const bizContent = JSON.stringify({
    out_trade_no: orderId,
    total_amount: AMOUNT_YUAN,
    subject: SUBJECT,
  });

  const params = {
    app_id: env.ALIPAY_APP_ID,
    method: 'alipay.trade.precreate',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp,
    version: '1.0',
    notify_url: notifyUrl,
    biz_content: bizContent,
  };

  // 签名（使用原始值，不编码；发送时才 URL 编码）
  const sortedKeys = Object.keys(params).sort();
  const signStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&');

  const privateKeyPem = env.ALIPAY_PRIVATE_KEY.replace(/\\n/g, '\n');
  const key = await getAlipayPrivateKey(privateKeyPem);
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, key, enc.encode(signStr)
  );
  params.sign = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // 发送请求（值做 URL 编码）
  const body = alipayFormEncode(params);
  const resp = await fetch('https://openapi.alipay.com/gateway.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });

  const text = await resp.text();
  try {
    const data = JSON.parse(text);
    const response = data.alipay_trade_precreate_response;
    if (response.code === '10000') {
      return { success: true, qr_code: response.qr_code };
    }
    return { success: false, message: response.msg + ': ' + (response.sub_msg || '') };
  } catch (_) {
    return { success: false, message: '支付宝返回格式异常' };
  }
}

// ====================================================================
// 支付宝回调验签
// ====================================================================

let _cachedAlipayPublicKey = null;

async function getAlipayPublicKey(pem) {
  if (_cachedAlipayPublicKey) return _cachedAlipayPublicKey;
  _cachedAlipayPublicKey = await crypto.subtle.importKey(
    'spki', pemToBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );
  return _cachedAlipayPublicKey;
}

async function alipayVerifySign(params, sign, publicKeyPem) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&');
  const key = await getAlipayPublicKey(publicKeyPem);
  const enc = new TextEncoder();
  const sigBuf = Uint8Array.from(atob(sign), c => c.charCodeAt(0));
  return await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, key, sigBuf, enc.encode(str)
  );
}

// ====================================================================
// 路由处理
// ====================================================================

async function handleRegister(request, env) {
  const { username, password } = await request.json();
  if (!username || username.length < 2)
    return json({ success: false, message: '用户名至少2个字符' });
  if (!password || password.length < 6)
    return json({ success: false, message: '密码至少6个字符' });

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username).first();
  if (existing)
    return json({ success: false, message: '用户名已存在' });

  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  await env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)'
  ).bind(username, passwordHash, salt).run();
  return json({ success: true, message: '注册成功' });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, salt, paid FROM users WHERE username = ?'
  ).bind(username).first();
  if (!user) return json({ success: false, message: '用户不存在' });

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash)
    return json({ success: false, message: '密码错误' });

  const token = randomHex(32);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare(
    'INSERT INTO sessions (user_id, token) VALUES (?, ?)'
  ).bind(user.id, token).run();

  return json({
    success: true, token,
    user: { username: user.username, paid: user.paid },
  });
}

async function handleVerify(request, env) {
  const user = await getSessionUser(
    request.headers.get('Authorization'), env
  );
  if (!user) return json({ success: false, message: '令牌无效或已过期' });
  return json({ success: true, user: { username: user.username, paid: user.paid } });
}

// ---- 创建支付订单 ----

async function handlePayCreate(request, env) {
  const user = await getSessionUser(
    request.headers.get('Authorization'), env
  );
  if (!user) return json({ success: false, message: '请先登录' }, 401);
  if (user.paid) return json({ success: false, message: '已是付费用户' });

  const { method } = await request.json(); // 'wechat' 或 'alipay'
  if (!method || !['wechat', 'alipay'].includes(method))
    return json({ success: false, message: '请选择支付方式' });

  const orderId = generateOrderId();
  const notifyBase = env.NOTIFY_BASE_URL || 'https://pay.wangaijun.click';
  const notifyUrl = `${notifyBase}/api/pay/notify/${method}`;

  let providerResult;
  let codeUrl = null;
  let prepayId = null;

  if (method === 'wechat') {
    if (env.WECHAT_APPID && env.WECHAT_MCH_ID && env.WECHAT_API_KEY) {
      providerResult = await callWechatPay(orderId, AMOUNT, notifyUrl, env);
      if (providerResult.success) {
        codeUrl = providerResult.code_url;
        prepayId = providerResult.prepay_id;
      }
    }
  } else {
    if (env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY) {
      providerResult = await callAlipay(orderId, notifyUrl, env);
      if (providerResult.success) {
        codeUrl = providerResult.qr_code;
      }
    }
  }

  // 创建订单记录
  await env.DB.prepare(
    `INSERT INTO orders (id, user_id, amount, provider, status, prepay_id, code_url)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(orderId, user.id, AMOUNT, method, prepayId, codeUrl).run();

  if (!codeUrl) {
    // 支付 API 调用失败，但订单已创建
    return json({
      success: true,
      order_id: orderId,
      code_url: null,
      message: providerResult?.message || '支付初始化失败，请稍后重试或联系管理员',
    });
  }

  return json({
    success: true,
    order_id: orderId,
    code_url: codeUrl,
    provider: method,
  });
}

// ---- 微信异步回调 ----

async function handlePayNotifyWechat(request, env) {
  const xmlText = await request.text();
  const params = parseWechatXml(xmlText);

  // 验签
  if (params.sign) {
    const signStr = params.sign;
    delete params.sign;
    const expectedSign = await wechatSign(params, env.WECHAT_API_KEY);
    if (signStr !== expectedSign) {
      return new Response(buildWechatXml({ return_code: 'FAIL', return_msg: '签名验证失败' }), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }
    params.sign = signStr;
  }

  if (params.return_code !== 'SUCCESS' || params.result_code !== 'SUCCESS') {
    return new Response(buildWechatXml({ return_code: 'FAIL', return_msg: '支付未成功' }), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const orderId = params.out_trade_no;
  const tradeNo = params.transaction_id;

  // 校验金额
  if (params.total_fee && parseInt(params.total_fee) !== AMOUNT) {
    return new Response(buildWechatXml({ return_code: 'FAIL', return_msg: '金额不匹配' }), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // 防重复处理
  const existing = await env.DB.prepare(
    'SELECT status FROM orders WHERE id = ?'
  ).bind(orderId).first();

  if (existing && existing.status === 'paid') {
    // 已处理过，直接返回成功
    return new Response(buildWechatXml({ return_code: 'SUCCESS', return_msg: 'OK' }), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // 更新订单
  await env.DB.prepare(
    `UPDATE orders SET status = 'paid', trade_no = ?,
     paid_at = datetime('now') WHERE id = ?`
  ).bind(tradeNo, orderId).run();

  // 更新用户
  await env.DB.prepare(
    `UPDATE users SET paid = 1, paid_at = datetime('now')
     WHERE id = (SELECT user_id FROM orders WHERE id = ?)`
  ).bind(orderId).run();

  return new Response(buildWechatXml({ return_code: 'SUCCESS', return_msg: 'OK' }), {
    headers: { 'Content-Type': 'text/xml' },
  });
}

// ---- 支付宝异步回调 ----

async function handlePayNotifyAlipay(request, env) {
  const formData = await request.formData();
  const params = {};
  for (const [k, v] of formData.entries()) {
    params[k] = v;
  }

  const sign = params.sign;
  const signType = params.sign_type;
  delete params.sign;
  delete params.sign_type;

  // 验签
  const publicKeyPem = (env.ALIPAY_PUBLIC_KEY || '').replace(/\\n/g, '\n');
  if (publicKeyPem) {
    const valid = await alipayVerifySign(params, sign, publicKeyPem);
    if (!valid) {
      return new Response('failure');
    }
  }

  if (params.trade_status !== 'TRADE_SUCCESS') {
    return new Response('failure');
  }

  const orderId = params.out_trade_no;
  const tradeNo = params.trade_no;

  // 校验金额
  if (params.total_amount && parseFloat(params.total_amount) !== parseFloat(AMOUNT_YUAN)) {
    return new Response('failure');
  }

  // 防重复处理
  const existing = await env.DB.prepare(
    'SELECT status FROM orders WHERE id = ?'
  ).bind(orderId).first();

  if (existing && existing.status === 'paid') {
    return new Response('success');
  }

  await env.DB.prepare(
    `UPDATE orders SET status = 'paid', trade_no = ?,
     paid_at = datetime('now') WHERE id = ?`
  ).bind(tradeNo, orderId).run();

  await env.DB.prepare(
    `UPDATE users SET paid = 1, paid_at = datetime('now')
     WHERE id = (SELECT user_id FROM orders WHERE id = ?)`
  ).bind(orderId).run();

  return new Response('success');
}

// ---- 查询订单状态 ----

async function handlePayStatus(request, env) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('id');
  if (!orderId) return json({ success: false, message: '缺少订单号' });

  const user = await getSessionUser(
    request.headers.get('Authorization'), env
  );
  if (!user) return json({ success: false, message: '请先登录' }, 401);

  const order = await env.DB.prepare(
    'SELECT id, status, provider FROM orders WHERE id = ? AND user_id = ?'
  ).bind(orderId, user.id).first();

  if (!order) return json({ success: false, message: '订单不存在' });

  return json({
    success: true,
    order_id: order.id,
    status: order.status,
    paid: order.status === 'paid',
  });
}

// ---- 提交付款通知（用户点击"我已支付"） ----

async function handlePayNotify(request, env) {
  const user = await getSessionUser(
    request.headers.get('Authorization'), env
  );
  if (!user) return json({ success: false, message: '请先登录' }, 401);
  if (user.paid) return json({ success: false, message: '已是付费用户' });

  const { provider } = await request.json();
  if (!provider || !['wechat', 'alipay'].includes(provider))
    return json({ success: false, message: '请选择支付方式' });

  // 防重复提交
  const existing = await env.DB.prepare(
    "SELECT id FROM payment_requests WHERE user_id = ? AND status = 'pending'"
  ).bind(user.id).first();
  if (existing)
    return json({ success: false, message: '您已提交过付款通知，请等待管理员审核' });

  await env.DB.prepare(
    `INSERT INTO payment_requests (user_id, username, provider, amount)
     VALUES (?, ?, ?, ?)`
  ).bind(user.id, user.username, provider, AMOUNT).run();

  return json({ success: true, message: '已通知管理员，请等待审核通过' });
}

// ---- 管理员验证 ----

function checkAdmin(request, env) {
  const secret = request.headers.get('X-Admin-Secret');
  if (!secret || secret !== env.ADMIN_SECRET)
    return json({ success: false, message: '管理员验证失败' }, 403);
  return null; // 通过
}

// ---- 获取已付款用户列表 ----

async function handleAdminUsers(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  const total = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE paid = 1"
  ).first();

  const rows = await env.DB.prepare(
    `SELECT id, username, paid_at, created_at
     FROM users WHERE paid = 1
     ORDER BY paid_at DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return json({
    success: true,
    users: rows.results,
    total: total.count,
    page,
    pages: Math.ceil(total.count / limit),
  });
}

// ---- 获取待审核列表 ----

async function handleAdminPending(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const rows = await env.DB.prepare(
    `SELECT id, user_id, username, provider, amount, created_at
     FROM payment_requests WHERE status = 'pending'
     ORDER BY created_at DESC`
  ).all();

  return json({ success: true, requests: rows.results });
}

// ---- 批准支付 ----

async function handleAdminApprove(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const { request_id } = await request.json();
  if (!request_id) return json({ success: false, message: '缺少请求ID' });

  const req = await env.DB.prepare(
    "SELECT id, user_id, status FROM payment_requests WHERE id = ?"
  ).bind(request_id).first();

  if (!req) return json({ success: false, message: '请求不存在' });
  if (req.status !== 'pending') return json({ success: false, message: '该请求已处理' });

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE payment_requests SET status = 'approved', processed_at = datetime('now')
       WHERE id = ?`
    ).bind(request_id),
    env.DB.prepare(
      "UPDATE users SET paid = 1, paid_at = datetime('now') WHERE id = ?"
    ).bind(req.user_id),
  ]);

  return json({ success: true, message: '已批准，用户已升级为VIP' });
}

// ---- 取消 VIP（管理员删除用户付费状态） ----

async function handleAdminRevoke(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const { user_id } = await request.json();
  if (!user_id) return json({ success: false, message: '缺少用户ID' });

  const user = await env.DB.prepare(
    'SELECT id, paid FROM users WHERE id = ?'
  ).bind(user_id).first();

  if (!user) return json({ success: false, message: '用户不存在' });
  if (!user.paid) return json({ success: false, message: '该用户不是VIP' });

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET paid = 0, paid_at = NULL WHERE id = ?"
    ).bind(user_id),
    env.DB.prepare(
      "DELETE FROM sessions WHERE user_id = ?"
    ).bind(user_id),
  ]);

  return json({ success: true, message: '已取消该用户的VIP权限' });
}

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

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const filter = url.searchParams.get('filter') || 'mine';
  const search = url.searchParams.get('search') || '';
  const limit = 10;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (filter === 'mine') {
    conditions.push('user_id = ?');
    params.push(user.id);
  }

  if (search.trim()) {
    const kw = '%' + search.trim() + '%';
    conditions.push('(content LIKE ? OR reply LIKE ?)');
    params.push(kw, kw);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM messages ' + where
  ).bind(...params).first();
  const total = countResult ? countResult.count : 0;

  const rows = await env.DB.prepare(
    'SELECT id, user_id, username, content, reply, replied_at, created_at FROM messages ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(...params, limit, offset).all();

  return json({
    success: true,
    messages: rows.results,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
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

// ---- 拒绝支付 ----

async function handleAdminReject(request, env) {
  const authErr = checkAdmin(request, env);
  if (authErr) return authErr;

  const { request_id } = await request.json();
  if (!request_id) return json({ success: false, message: '缺少请求ID' });

  const req = await env.DB.prepare(
    "SELECT id, status FROM payment_requests WHERE id = ?"
  ).bind(request_id).first();

  if (!req) return json({ success: false, message: '请求不存在' });
  if (req.status !== 'pending') return json({ success: false, message: '该请求已处理' });

  await env.DB.prepare(
    `UPDATE payment_requests SET status = 'rejected', processed_at = datetime('now')
     WHERE id = ?`
  ).bind(request_id).run();

  return json({ success: true, message: '已拒绝' });
}

// ====================================================================
// 入口
// ====================================================================

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS')
      return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      await ensureDbTables(env).catch(() => {});

      switch (path) {
        case '/api/register':
          return handleRegister(request, env);
        case '/api/login':
          return handleLogin(request, env);
        case '/api/verify':
          return handleVerify(request, env);
        case '/api/pay/create':
          return handlePayCreate(request, env);
        case '/api/pay/notify/wechat':
          return handlePayNotifyWechat(request, env);
        case '/api/pay/notify/alipay':
          return handlePayNotifyAlipay(request, env);
        case '/api/pay/status':
          return handlePayStatus(request, env);
        case '/api/pay/notify':
          return handlePayNotify(request, env);
        case '/api/admin/users':
          return handleAdminUsers(request, env);
        case '/api/admin/pending':
          return handleAdminPending(request, env);
        case '/api/admin/approve':
          return handleAdminApprove(request, env);
        case '/api/admin/reject':
          return handleAdminReject(request, env);
        case '/api/admin/revoke':
          return handleAdminRevoke(request, env);
        case '/api/messages/create':
          return handleMessageCreate(request, env);
        case '/api/messages/list':
          return handleMessageList(request, env);
        case '/api/messages/reply':
          return handleMessageReply(request, env);
        case '/api/messages/delete':
          return handleMessageDelete(request, env);
        case '/api/admin/messages':
          return handleAdminMessages(request, env);
        case '/api/admin/message':
          return handleAdminMessageDetail(request, env);
        default:
          return json({ success: false, message: '未找到路由' }, 404);
      }
    } catch (e) {
      return json({ success: false, message: '服务器错误: ' + e.message }, 500);
    }
  },
};
