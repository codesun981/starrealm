import { handleApiRequest } from './api/router.js';
import { handleAdminRequest } from './admin/router.js';
import { handleFrontendRequest } from './frontend/renderer.js';
import { isAdminAuthenticated } from './admin/auth.js';
import { validateGateSession, renderGatePage, handleGateLogin } from './gate.js';
import { wallpaperResponse } from './wallpaper.js';

// 自定义壁纸上传：原始图片字节存 KV（上限 8MB），类型单独存一键。
async function handleWallpaperUpload(request, env) {
  const ct = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!/^image\/(jpeg|png|webp|avif)$/.test(ct)) {
    return new Response(JSON.stringify({ error: 'unsupported image type' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'image empty or too large' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  await env.NAV_AUTH.put('wallpaper_custom', buf);
  await env.NAV_AUTH.put('wallpaper_custom_ct', ct);
  return new Response(JSON.stringify({ ok: true, size: buf.byteLength }), { headers: { 'Content-Type': 'application/json' } });
}

// 把书签钉到 Dock 或取消钉住，状态存 sites.in_dock，桌面与 Dock 渲染时读取。
async function handleDockToggle(request, env) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const id = Number(body && body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'invalid id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const dock = body.dock ? 1 : 0;
  await env.NAV_DB.prepare('UPDATE sites SET in_dock = ? WHERE id = ?').bind(dock, id).run();
  return new Response(JSON.stringify({ ok: true, id, dock: Boolean(dock) }), { headers: { 'Content-Type': 'application/json' } });
}

export default {
  // Worker 收到请求时，按路径交给接口、后台或前台处理。
  // 前台与数据接口先过整站密码门：管理员会话或访客会话任一有效才放行。
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 壁纸是公开静态资源（不含任何数据），密码门与后台都不拦它。
    if (path === '/wallpaper.jpg') {
      return wallpaperResponse(request, env);
    }
    // 密码门入口本身与后台登录互不依赖，后台始终走自己的管理员认证。
    if (path === '/gate') {
      if (request.method === 'POST') return handleGateLogin(request, env);
      return renderGatePage();
    }
    if (path === '/admin' || path === '/admin/logout' || path.startsWith('/static')) {
      return handleAdminRequest(request, env, ctx);
    }

    const [gateOk, adminOk] = await Promise.all([
      validateGateSession(request, env),
      isAdminAuthenticated(request, env),
    ]);
    if (!gateOk && !adminOk) {
      if (path.startsWith('/api')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return renderGatePage();
    }

    // Dock 钉住开关（fork 新增）：前台拖拽调用，门会话或管理员会话均可。
    if (path === '/api/dock' && request.method === 'POST') {
      return handleDockToggle(request, env);
    }
    // 自定义壁纸（fork 新增）：POST 上传图片存 KV，DELETE 恢复默认壁纸。
    if (path === '/api/wallpaper' && request.method === 'POST') {
      return handleWallpaperUpload(request, env);
    }
    if (path === '/api/wallpaper' && request.method === 'DELETE') {
      await env.NAV_AUTH.delete('wallpaper_custom');
      await env.NAV_AUTH.delete('wallpaper_custom_ct');
      return new Response(JSON.stringify({ ok: true, reset: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (path.startsWith('/api')) {
      return handleApiRequest(request, env, ctx);
    }
    return handleFrontendRequest(request, env, ctx);
  },
};
