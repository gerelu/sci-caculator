const CACHE_NAME = 'sci-calc-v51';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './mathlive.min.js',
    './compute-engine.min.js',
    './share-tech-mono.ttf',
    './icon-192.png',
    './icon-512.png',
    './fonts/KaTeX_AMS-Regular.woff2',
    './fonts/KaTeX_Caligraphic-Bold.woff2',
    './fonts/KaTeX_Caligraphic-Regular.woff2',
    './fonts/KaTeX_Fraktur-Bold.woff2',
    './fonts/KaTeX_Fraktur-Regular.woff2',
    './fonts/KaTeX_Main-Bold.woff2',
    './fonts/KaTeX_Main-BoldItalic.woff2',
    './fonts/KaTeX_Main-Italic.woff2',
    './fonts/KaTeX_Main-Regular.woff2',
    './fonts/KaTeX_Math-BoldItalic.woff2',
    './fonts/KaTeX_Math-Italic.woff2',
    './fonts/KaTeX_SansSerif-Bold.woff2',
    './fonts/KaTeX_SansSerif-Italic.woff2',
    './fonts/KaTeX_SansSerif-Regular.woff2',
    './fonts/KaTeX_Script-Regular.woff2',
    './fonts/KaTeX_Size1-Regular.woff2',
    './fonts/KaTeX_Size2-Regular.woff2',
    './fonts/KaTeX_Size3-Regular.woff2',
    './fonts/KaTeX_Size4-Regular.woff2',
    './fonts/KaTeX_Typewriter-Regular.woff2'
];

// 安裝 Service Worker 並強制立即啟用新版
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

// 清理舊版本快取 (如 計算機-calc-v1)
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Network-First 策略：優先向網路獲取最新檔案，並即時更新快取；離線時回退至快取
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                }
                return networkResponse;
            })
            .catch(() => {
                // 離線回退：忽略 Query String (?v=...) 比對快取
                return caches.match(event.request, { ignoreSearch: true })
                    .then(cachedResponse => {
                        if (cachedResponse) return cachedResponse;
                        // 若為頁面導航請求且未命中，回退到主頁
                        if (event.request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }
                    });
            })
    );
});
