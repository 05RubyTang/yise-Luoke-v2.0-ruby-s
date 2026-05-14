/**
 * Service Worker — 图片预缓存 + Cache First + 自动更新通知
 *
 * ── 设计原则 ──────────────────────────────────────────────────────────────────
 * 图片缓存（IMG_CACHE）与 SW 版本完全解耦：
 *   · IMG_CACHE 使用固定名称，SW 更新时不清空，图片缓存永久复用
 *   · 静态图片 URL 不变则内容不变，旧缓存完全有效，无需随 SW 版本失效
 *
 * 自动更新：
 *   · SW 更新后等待页面进入后台（visibilityState=hidden）再 reload
 *   · 避免用户正在操作时被打断，也避免白屏
 *
 * install 阶段：预缓存 24 张关键 UI 图
 *   · 精灵图/果实图按需 Cache First 懒加载，无需预缓存
 */

// 图片缓存：固定名称，不随 SW 版本变化，避免每次更新清空缓存
const IMG_CACHE = 'luoke-images';

// ── 关键 UI 图预缓存列表（WebP 优先，体积比 PNG 小 80-95%）────────────────────
const PRECACHE_URLS = [
  'bg.webp',
  'home-page-bg.webp',
  'app-title.webp',
  'xiaoluoke.webp',
  'btn-start.webp',
  'section-title-banner.webp',
  'tab-bg.webp',
  'tab-home.webp',
  'tab-history.webp',
  'tab-plans.webp',
  'tab-collection.webp',
  'tab-profile.webp',
  'card-frame-compact.webp',
  'card-frame-detail.webp',
  'detail-bg.webp',
  'detail-content-card.webp',
  'detail-hero-card.webp',
  'profile-bg.webp',
  'home-card-bg.webp',
  'plan-deco.webp',
  'default-avatar.webp',
  'back-icon.webp',
  'dimo-icon.webp',
  'dimo-bg.webp',
].map(name => new URL(name, self.location).href);

// ── 安装：预缓存关键图，立即激活 ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(IMG_CACHE).then(cache =>
      Promise.allSettled(
        PRECACHE_URLS.map(url =>
          // 已在缓存中的跳过，只补充缺失的
          cache.match(url).then(cached => {
            if (cached) return;
            return fetch(url, { cache: 'no-cache' })
              .then(res => { if (res.ok) cache.put(url, res); })
              .catch(() => {});
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── 激活：接管页面 → 广播"有新版本"（不清图片缓存！）────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // 只清理旧版本格式的缓存名（luoke-images-v*），保留当前 luoke-images
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => /^luoke-images-v\d+$/.test(k))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' })))
  );
});

// ── Fetch 拦截：Cache First ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理图片请求（通过 destination 或 URL 后缀判断）
  const isImage =
    request.destination === 'image' ||
    /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url.pathname);

  if (!isImage) return;

  event.respondWith(
    caches.open(IMG_CACHE).then(async (cache) => {
      // 1. 查缓存
      const cached = await cache.match(request);
      if (cached) return cached;

      // 2. 缓存未命中 → 发起网络请求
      try {
        const response = await fetch(request);
        // status === 200：正常响应；status === 0：跨域 opaque 响应（BWIKI 图片）
        if (response.status === 200 || response.status === 0) {
          // 异步写缓存，不阻塞响应返回
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // 离线/网络错误 → 尝试宽松匹配（忽略 ?v=x 查询参数）
        const fallback = await cache.match(request, { ignoreSearch: true });
        if (fallback) return fallback;
        // 完全失败 → 返回空响应，让 <img> 的 onError 正常触发
        return new Response('', { status: 408, statusText: 'Offline' });
      }
    })
  );
});
