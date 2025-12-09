// Enhanced Service Worker for complete offline-first PWA
const CACHE_NAME = 'flamex-pos-v2';
const RUNTIME_CACHE = 'flamex-pos-runtime-v2';
const API_CACHE = 'flamex-pos-api-v2';

// Assets to cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/static/css/main.css',
  '/static/js/main.js',
  '/logo.png'
];

// API endpoints to cache (read-only GET requests)
const CACHEABLE_API_PATTERNS = [
  /\/api\/menu-items$/,
  /\/api\/categories$/,
  /\/api\/customers\?/,
  /\/api\/orders\/dine-in\/tables\/availability$/
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing v2...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Precaching app shell');
        return cache.addAll(PRECACHE_URLS.map(url => new Request(url, { credentials: 'same-origin' })));
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[Service Worker] Precache failed:', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating v2...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => 
            cacheName !== CACHE_NAME && 
            cacheName !== RUNTIME_CACHE && 
            cacheName !== API_CACHE &&
            !cacheName.startsWith('flamex-pos-')
          )
          .map(cacheName => {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests (let them pass through)
  if (url.origin !== location.origin) {
    return;
  }

  // Skip non-GET requests (POST, PUT, DELETE should always go to network)
  if (request.method !== 'GET') {
    return;
  }

  // Navigation requests - network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstStrategy(request, RUNTIME_CACHE));
    return;
  }

  // API requests - cache first for GET requests, network first for others
  if (url.pathname.startsWith('/api/')) {
    const isCacheable = CACHEABLE_API_PATTERNS.some(pattern => pattern.test(url.pathname + url.search));
    
    if (isCacheable) {
      // Cache-first for read-only API endpoints
      event.respondWith(cacheFirstStrategy(request, API_CACHE));
    } else {
      // Network-first for dynamic API endpoints
      event.respondWith(networkFirstStrategy(request, API_CACHE));
    }
    return;
  }

  // Static assets - cache first
  if (request.destination === 'script' || 
      request.destination === 'style' || 
      request.destination === 'image' ||
      request.destination === 'font') {
    event.respondWith(cacheFirstStrategy(request, CACHE_NAME));
    return;
  }

  // Default: network first
  event.respondWith(networkFirstStrategy(request, RUNTIME_CACHE));
});

// Cache-first strategy: Try cache, fallback to network
async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    console.log('[Service Worker] Serving from cache:', request.url);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.status === 200) {
      // Clone response before caching (responses can only be read once)
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[Service Worker] Fetch failed:', error);
    // Return a basic offline response if available
    if (request.mode === 'navigate') {
      const offlinePage = await cache.match('/index.html');
      if (offlinePage) {
        return offlinePage;
      }
    }
    throw error;
  }
}

// Network-first strategy: Try network, fallback to cache
async function networkFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('[Service Worker] Network failed, trying cache:', request.url);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    
    // If it's a navigation request and we have an offline page, return it
    if (request.mode === 'navigate') {
      const offlinePage = await cache.match('/index.html');
      if (offlinePage) {
        return offlinePage;
      }
    }
    
    throw error;
  }
}

// Background sync for offline orders
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync triggered:', event.tag);

  if (event.tag === 'sync-offline-orders') {
    event.waitUntil(syncOfflineOrders());
  }
});

// Sync offline orders when connection is restored
async function syncOfflineOrders() {
  try {
    // This will be handled by the main app's sync service
    // Service worker just triggers it
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_ORDERS',
        timestamp: Date.now()
      });
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('[Service Worker] Sync failed:', error);
    return Promise.reject(error);
  }
}

// Message handler for commands from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_MENU_DATA') {
    event.waitUntil(cacheMenuData(event.data.payload));
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearAllCaches());
  }
});

// Cache menu data for offline access
async function cacheMenuData(data) {
  try {
    // This is handled by IndexedDB in the main app
    // Service worker can cache API responses
    const cache = await caches.open(API_CACHE);
    
    if (data.menuItems) {
      const menuRequest = new Request('/api/menu-items');
      const menuResponse = new Response(JSON.stringify({ data: data.menuItems }), {
        headers: { 'Content-Type': 'application/json' }
      });
      await cache.put(menuRequest, menuResponse);
    }

    if (data.categories) {
      const categoriesRequest = new Request('/api/categories');
      const categoriesResponse = new Response(JSON.stringify({ data: data.categories }), {
        headers: { 'Content-Type': 'application/json' }
      });
      await cache.put(categoriesRequest, categoriesResponse);
    }

    console.log('[Service Worker] Menu data cached successfully');
  } catch (error) {
    console.error('[Service Worker] Failed to cache menu data:', error);
  }
}

// Clear all caches
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => caches.delete(cacheName))
    );
    console.log('[Service Worker] All caches cleared');
  } catch (error) {
    console.error('[Service Worker] Failed to clear caches:', error);
  }
}
