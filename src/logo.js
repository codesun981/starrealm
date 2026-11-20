// 项目 logo（fork 新增）：博客「不眠日志」的图标，随 Worker 打包，公开只读。
import logoData from './assets/logo.png';

export function logoResponse() {
  return new Response(logoData, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
