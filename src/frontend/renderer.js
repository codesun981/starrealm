import { escapeHTML, sanitizeUrl } from '../utils/html.js';
import { normalizeSortOrder } from '../utils/sort.js';
import { readCategoryOrders, buildCategoryList } from '../utils/categories.js';
import frontendTemplate from '../templates/frontend.html';

// 桌面风前台（fork 重写）：分类 = 桌面，书签 = 桌面图标，
// “常用”分类同时进入底部 Dock；全部数据一次渲染，切换与搜索都在本地完成。
export async function handleFrontendRequest(request, env, ctx) {
  let sites = [];
  try {
    const { results } = await env.NAV_DB.prepare('SELECT * FROM sites ORDER BY sort_order ASC, create_time DESC').all();
    sites = results;
  } catch (e) {
    console.error('加载书签失败', e);
    return new Response('加载书签失败，请稍后重试', { status: 500 });
  }

  const totalSites = sites.length;

  const categoryCountMap = new Map();
  const categoryMinSort = new Map();
  const categorySet = new Set();
  sites.forEach((site) => {
    const name = (site.catelog || '').trim() || '未分类';
    categorySet.add(name);
    categoryCountMap.set(name, (categoryCountMap.get(name) || 0) + 1);
    const normalized = normalizeSortOrder(site.sort_order);
    if (!categoryMinSort.has(name) || normalized < categoryMinSort.get(name)) {
      categoryMinSort.set(name, normalized);
    }
  });

  let categoryOrderMap;
  try {
    categoryOrderMap = await readCategoryOrders(env);
  } catch (error) {
    console.error('加载分类失败', error);
    return new Response('加载分类失败，请稍后重试', { status: 500 });
  }

  const categoryRows = Array.from(categorySet, catelog => ({
    catelog,
    site_count: categoryCountMap.get(catelog),
    min_site_sort: categoryMinSort.get(catelog),
  }));
  const catalogs = buildCategoryList(categoryRows, categoryOrderMap).map(item => item.catelog);

  const byCatalog = new Map(catalogs.map(c => [c, []]));
  sites.forEach((site) => {
    const cat = (site.catelog || '').trim() || '未分类';
    if (byCatalog.has(cat)) byCatalog.get(cat).push(site);
  });

  const desktopsHtml = catalogs.map((cat, i) => {
    const list = byCatalog.get(cat) || [];
    const tiles = list.map(site => buildIconTile(site)).join('');
    return `<section class="desktop${i === 0 ? ' active' : ''}" data-index="${i}" data-name="${escapeHTML(cat)}" aria-label="${escapeHTML(cat)}">
      <div class="desk-head"><h2>${escapeHTML(cat)}</h2><span>${list.length} 个书签</span></div>
      <div class="icon-grid">${tiles || '<p class="desk-empty">这个桌面还没有书签</p>'}</div>
    </section>`;
  }).join('');

  const menuHtml = catalogs.map((cat, i) =>
    `<button type="button" class="menu-item${i === 0 ? ' active' : ''}" data-goto="${i}">${escapeHTML(cat)}</button>`
  ).join('');

  const dotsHtml = catalogs.map((cat, i) =>
    `<button type="button" class="dot${i === 0 ? ' active' : ''}" data-goto="${i}" aria-label="切换到${escapeHTML(cat)}"></button>`
  ).join('');

  // Dock 构成：“常用”分类（固定成员）+ 任意桌面钉住的书签（in_dock=1，可拖出取消）。
  const dockSeen = new Set();
  const dockEntries = [];
  (byCatalog.get('常用') || []).forEach(site => { dockSeen.add(site.id); dockEntries.push({ site, pinned: false }); });
  sites.filter(s => s.in_dock).forEach(site => {
    if (!dockSeen.has(site.id)) { dockSeen.add(site.id); dockEntries.push({ site, pinned: true }); }
  });
  const dockHtml = dockEntries.map(({ site, pinned }) => buildIconTile(site, { dock: true, pinned })).join('');

  const html = renderTemplate(frontendTemplate, {
    DESKTOPS: desktopsHtml,
    MENU_ITEMS: menuHtml,
    DOTS: dotsHtml,
    DOCK_ITEMS: dockHtml,
    TOTAL_SITES: String(totalSites),
    CATALOG_COUNT: String(catalogs.length),
    FIRST_DESKTOP: escapeHTML(catalogs[0] || '星境'),
  });

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// 单个桌面图标：优先站点自带 logo，其次 apple-touch-icon / favicon，失败回退首字色块。
function buildIconTile(site, options = {}) {
  const rawName = site.name || '未命名';
  const safeName = escapeHTML(rawName);
  const safeDesc = escapeHTML(site.desc || '');
  const safeCatalog = escapeHTML((site.catelog || '').trim() || '未分类');
  const url = sanitizeUrl(site.url) || '';
  const safeUrl = escapeHTML(url);
  const logoUrl = sanitizeUrl(site.logo);
  let origin = '';
  try { origin = url ? new URL(url).origin : ''; } catch { origin = ''; }
  const iconSrc = logoUrl || (origin ? `${origin}/apple-touch-icon.png` : '');
  const faviconSrc = origin ? `${origin}/favicon.ico` : '';
  const initial = escapeHTML((rawName.trim().charAt(0) || '站').toUpperCase());
  const [c1, c2] = gradientFor(rawName);
  const img = iconSrc
    ? `<img src="${escapeHTML(iconSrc)}" data-fav="${escapeHTML(faviconSrc)}" alt="" loading="lazy" onerror="iconErr(this)">`
    : '';
  if (options.dock) {
    return `<a class="dock-app" href="${safeUrl}" target="_blank" rel="noopener noreferrer" data-tip="${safeName}" data-name="${safeName}" data-id="${site.id}" data-pinned="${options.pinned ? '1' : '0'}"${options.pinned ? ' draggable="true"' : ''} aria-label="${safeName}">
      <span class="dock-icon"><span class="app-letter" style="background:linear-gradient(135deg,${c1},${c2})">${initial}</span>${img}</span>
    </a>`;
  }
  const domain = escapeHTML(extractDomain(url));
  return `<a class="app" href="${safeUrl}" target="_blank" rel="noopener noreferrer" draggable="true" data-id="${site.id}" data-name="${safeName}" data-catalog="${safeCatalog}" data-url="${safeUrl}" title="${safeDesc || safeName}">
    <span class="app-icon"><span class="app-letter" style="background:linear-gradient(135deg,${c1},${c2})">${initial}</span>${img}<span class="app-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M17 7H8M17 7V16"/></svg></span></span>
    <span class="app-name">${safeName}</span>
    <span class="app-info"><span class="app-title">${safeName}</span><span class="app-desc">${safeDesc || '暂无描述'}</span><span class="app-domain">${domain}</span></span>
  </a>`;
}

// 从 URL 提取精简域名，卡片模式下展示。
function extractDomain(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return (u.hostname.replace(/^www\./i, '') || urlStr) + (u.port ? ':' + u.port : '');
  } catch {
    return urlStr.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0] || urlStr;
  }
}

// 名称哈希取一对固定渐变色（原 Tailwind 调色板的手写等价）。
function gradientFor(name) {
  const palettes = [
    ['#6366f1', '#0ea5e9'], ['#8b5cf6', '#d946ef'], ['#f43f5e', '#f59e0b'],
    ['#10b981', '#14b8a6'], ['#2563eb', '#06b6d4'], ['#f59e0b', '#ea580c'],
  ];
  let hash = 0;
  const str = String(name || '站点');
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  return palettes[Math.abs(hash) % palettes.length];
}

// 组合页面时，替换模板中已知的占位符。
function renderTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}
