// 桌面壁纸（fork 新增）：随 Worker 一起打包，由 /wallpaper.jpg 路由长期缓存返回。
// 壁纸文件来自 GlassDesk 项目（MIT）：public/wallpapers/deep-blue.jpg。
import wallpaperData from './assets/wallpaper.jpg';

export function wallpaperResponse() {
  return new Response(wallpaperData, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
