import { handleApiRequest } from './api/router.js';
import { handleAdminRequest } from './admin/router.js';
import { handleFrontendRequest } from './frontend/renderer.js';
import { isAdminAuthenticated } from './admin/auth.js';
import { validateGateSession, renderGatePage, handleGateLogin } from './gate.js';
import { wallpaperResponse } from './wallpaper.js';

export default {
  // Worker 收到请求时，按路径交给接口、后台或前台处理。
  // 前台与数据接口先过整站密码门：管理员会话或访客会话任一有效才放行。
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 壁纸是公开静态资源（不含任何数据），密码门与后台都不拦它。
    if (path === '/wallpaper.jpg') {
      return wallpaperResponse();
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

    if (path.startsWith('/api')) {
      return handleApiRequest(request, env, ctx);
    }
    return handleFrontendRequest(request, env, ctx);
  },
};
