// 整站访问密码门（fork 新增）：前台与数据接口在输入站点密码前不可见。
// 会话机制与后台管理员会话保持一致：KV 存放随机令牌，Cookie 只带令牌本身。
import { parseCookies } from './admin/auth.js';

export const GATE_COOKIE_NAME = 'nav_gate_session';
const GATE_PREFIX = 'gate:';
const GATE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天，减少自用时的重复输入

export function buildGateCookie(token, maxAge = GATE_TTL_SECONDS) {
  return [
    `${GATE_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ].join('; ');
}

export async function createGateSession(env) {
  const token = crypto.randomUUID();
  await env.NAV_AUTH.put(`${GATE_PREFIX}${token}`, JSON.stringify({ createdAt: Date.now() }), {
    expirationTtl: GATE_TTL_SECONDS,
  });
  return token;
}

export async function validateGateSession(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[GATE_COOKIE_NAME];
  if (!token) return false;
  const payload = await env.NAV_AUTH.get(`${GATE_PREFIX}${token}`);
  return Boolean(payload);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 简单的恒定时间比较，避免逐字短路。
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkSitePassword(env, submitted) {
  const stored = await env.NAV_AUTH.get('site_password');
  if (!stored || !submitted) return false;
  const [a, b] = await Promise.all([sha256Hex(submitted), sha256Hex(stored)]);
  return safeEqual(a, b);
}

export function renderGatePage(error = '') {
  const errorHtml = error ? `<p class="error">${error}</p>` : '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>豆豆书签 · 需要密码</title><link rel="icon" type="image/png" href="/logo.png">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #0a1128 url('/wallpaper.jpg?v=3') center / cover no-repeat fixed; color: #e6e9f2; padding: 24px; }
  .card { width: 100%; max-width: 360px; background: rgb(22 25 32 / 52%);
    -webkit-backdrop-filter: blur(32px) saturate(1.8); backdrop-filter: blur(32px) saturate(1.8);
    border: 1px solid rgba(255,255,255,0.16); border-radius: 20px; padding: 32px 28px;
    box-shadow: 0 30px 64px -26px rgba(0,0,0,0.74), inset 0 1px 0 rgba(255,255,255,0.26); }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  p.sub { font-size: 13px; color: #9aa3b8; margin-bottom: 20px; }
  p.error { font-size: 13px; color: #ff8a8a; margin-bottom: 12px; }
  input { width: 100%; padding: 11px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06); color: #e6e9f2; font-size: 15px; outline: none; margin-bottom: 14px; }
  input:focus { border-color: rgba(125,160,255,0.7); }
  button { width: 100%; padding: 11px; border: none; border-radius: 10px; cursor: pointer;
    background: #4f7cff; color: #fff; font-size: 15px; font-weight: 600; }
  button:hover { background: #3f6ef0; }
</style>
</head>
<body>
  <form class="card" method="POST" action="/gate">
    <img src="/logo.png" alt="" style="width:54px;height:54px;border-radius:13px;display:block;margin:0 auto 12px">
    <h1>豆豆书签</h1>
    <p class="sub">这是私人书签页，输入访问密码继续。</p>
    ${errorHtml}
    <input type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus required>
    <button type="submit">进入</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleGateLogin(request, env) {
  let password = '';
  const contentType = request.headers.get('Content-Type') || '';
  try {
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      password = String(form.get('password') || '');
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      password = String(body.password || '');
    }
  } catch {
    password = '';
  }
  if (!(await checkSitePassword(env, password))) {
    return renderGatePage('密码不正确，请重试。');
  }
  const token = await createGateSession(env);
  return new Response(null, {
    status: 302,
    headers: { Location: '/', 'Set-Cookie': buildGateCookie(token) },
  });
}
