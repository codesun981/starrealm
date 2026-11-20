// 桌面壁纸（fork 新增）：优先返回用户自定义壁纸（KV wallpaper_custom），
// 没有时回退到随 Worker 打包的默认壁纸（GlassDesk 的 deep-blue，MIT）。
import wallpaperData from './assets/wallpaper.jpg';

export async function wallpaperResponse(request, env) {
  try {
    const custom = await env.NAV_AUTH.get('wallpaper_custom', 'arrayBuffer');
    if (custom && custom.byteLength > 0) {
      const ct = (await env.NAV_AUTH.get('wallpaper_custom_ct')) || 'image/jpeg';
      return new Response(custom, {
        headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' },
      });
    }
  } catch (e) {
    console.error('读取自定义壁纸失败，回退默认壁纸', e);
  }
  // 默认壁纸也只短缓存：曾用 immutable 长缓存，导致换自定义壁纸后浏览器长期显示旧图。
  return new Response(wallpaperData, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
