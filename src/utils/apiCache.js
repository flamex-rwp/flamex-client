// API Response Cache - Automatically caches all API responses to IndexedDB
import {
  cacheMenuItems,
  cacheCategories,
  cacheCustomers,
  cacheTableAvailability,
  saveOrder,
  updateOrder,
  getAllOrders,
  getCachedMenuItems,
  getCachedCategories,
  getCachedCustomers,
  getCachedTableAvailability,
  getOrderById
} from './offlineDB';

// Cache API responses based on endpoint pattern
export const cacheAPIResponse = async (url, method, responseData) => {
  try {
    // Only cache GET requests
    if (method !== 'GET') {
      return;
    }

    const urlPath = url.split('?')[0]; // Remove query params for matching

    // Menu items
    if (urlPath === '/api/menu-items' || urlPath.endsWith('/api/menu-items')) {
      const items = responseData.data || responseData || [];
      if (Array.isArray(items) && items.length > 0) {
        await cacheMenuItems(items);
        console.log('[APICache] Cached menu items:', items.length);
      }
    }

    // Categories
    if (urlPath === '/api/categories' || urlPath.endsWith('/api/categories')) {
      const categories = responseData.data || responseData || [];
      if (Array.isArray(categories) && categories.length > 0) {
        await cacheCategories(categories);
        console.log('[APICache] Cached categories:', categories.length);
      }
    }

    // Customers
    if (urlPath === '/api/customers' || urlPath.includes('/api/customers')) {
      const data = responseData.data || responseData || {};
      const customers = Array.isArray(data.customers) ? data.customers : (Array.isArray(data) ? data : []);
      if (customers.length > 0) {
        await cacheCustomers(customers);
        console.log('[APICache] Cached customers:', customers.length);
      }
    }

    // Table availability
    if (urlPath.includes('/api/orders/dine-in/tables/availability') || 
        urlPath.includes('/tables/availability')) {
      const occupiedTables = responseData.data?.occupied_tables || responseData.data || [];
      if (Array.isArray(occupiedTables)) {
        await cacheTableAvailability(occupiedTables);
        console.log('[APICache] Cached table availability');
      }
    }

    // Orders - various endpoints
    if (urlPath.includes('/api/orders')) {
      // Single order
      if (urlPath.match(/\/api\/orders\/\d+$/) && !urlPath.includes('/items') && !urlPath.includes('/history')) {
        const order = responseData.data || responseData;
        if (order && order.id) {
          await saveOrder({ ...order, synced: true });
          console.log('[APICache] Cached order:', order.id);
        }
      }
      // Order list (dine-in, delivery, etc.)
      else if (urlPath.includes('/dine-in/active') || urlPath.includes('/delivery/active') || urlPath === '/api/orders') {
        const orders = responseData.data || responseData || {};
        const orderList = Array.isArray(orders.orders) ? orders.orders : (Array.isArray(orders) ? orders : []);
        if (orderList.length > 0) {
          const db = await import('./offlineDB').then(m => m.openDB());
          const tx = db.transaction('orders', 'readwrite');
          const store = tx.objectStore('orders');
          
          for (const order of orderList) {
            await store.put({
              ...order,
              synced: true,
              updatedAt: new Date().toISOString()
            });
          }
          console.log('[APICache] Cached orders:', orderList.length);
        }
      }
      // Order items
      else if (urlPath.includes('/items')) {
        const items = responseData.data || responseData || [];
        if (Array.isArray(items) && items.length > 0) {
          // Get order ID from URL
          const orderIdMatch = urlPath.match(/\/api\/orders\/(\d+)\/items/);
          if (orderIdMatch) {
            const orderId = parseInt(orderIdMatch[1]);
            const order = await getOrderById(orderId);
            if (order) {
              await updateOrder(orderId, {
                orderItems: items,
                synced: true
              });
              console.log('[APICache] Cached order items for order:', orderId);
            }
          }
        }
      }
    }

    // Dine-in stats
    if (urlPath.includes('/api/orders/dine-in/stats')) {
      const stats = responseData.data || responseData || {};
      const db = await import('./offlineDB').then(m => m.openDB());
      const tx = db.transaction('sync-metadata', 'readwrite');
      const store = tx.objectStore('sync-metadata');
      await store.put({
        key: 'dinein-stats',
        data: stats,
        lastSync: new Date().toISOString()
      });
      console.log('[APICache] Cached dine-in stats');
    }

    // Delivery stats - cache with query params
    if (urlPath.includes('/api/orders/delivery/stats')) {
      const stats = responseData.data || responseData || {};
      const db = await import('./offlineDB').then(m => m.openDB());
      const tx = db.transaction('sync-metadata', 'readwrite');
      const store = tx.objectStore('sync-metadata');
      
      // Include query params in cache key
      const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`, window.location.origin);
      const queryString = urlObj.search;
      const cacheKey = `delivery-stats${queryString ? '-' + queryString.replace(/[^a-zA-Z0-9]/g, '-') : ''}`;
      
      await store.put({
        key: cacheKey,
        data: stats,
        lastSync: new Date().toISOString()
      });
      console.log('[APICache] Cached delivery stats:', cacheKey);
    }

    // Reports - cache with query params
    if (urlPath.includes('/api/reports/')) {
      const reportData = responseData.data || responseData || {};
      const db = await import('./offlineDB').then(m => m.openDB());
      const tx = db.transaction('sync-metadata', 'readwrite');
      const store = tx.objectStore('sync-metadata');
      
      // Include query params in cache key for reports
      const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`, window.location.origin);
      const queryString = urlObj.search;
      const cacheKey = `report-${urlPath.replace(/[^a-zA-Z0-9]/g, '-')}${queryString ? '-' + queryString.replace(/[^a-zA-Z0-9]/g, '-') : ''}`;
      
      await store.put({
        key: cacheKey,
        data: reportData,
        lastSync: new Date().toISOString()
      });
      console.log('[APICache] Cached report:', cacheKey);
    }

  } catch (error) {
    console.error('[APICache] Error caching API response:', error);
    // Don't throw - caching failures shouldn't break the app
  }
};

// Get cached API response
export const getCachedAPIResponse = async (url, method) => {
  try {
    if (method !== 'GET') {
      return null;
    }

    const urlPath = url.split('?')[0];
    const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`, window.location.origin);

    // Menu items
    if (urlPath === '/api/menu-items' || urlPath.endsWith('/api/menu-items')) {
      const items = await getCachedMenuItems();
      return items.length > 0 ? { data: items } : null;
    }

    // Categories
    if (urlPath === '/api/categories' || urlPath.endsWith('/api/categories')) {
      const categories = await getCachedCategories();
      return categories.length > 0 ? { data: categories } : null;
    }

    // Customers
    if (urlPath === '/api/customers' || urlPath.includes('/api/customers')) {
      const customers = await getCachedCustomers();
      if (customers.length > 0) {
        // Check if it's a search request
        const searchQuery = urlObj.searchParams.get('q');
        if (searchQuery) {
          // Filter customers by search query
          const filtered = customers.filter(c => 
            c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.phone?.includes(searchQuery) ||
            c.address?.toLowerCase().includes(searchQuery.toLowerCase())
          );
          return { data: filtered };
        }
        return { data: { customers } };
      }
      return null;
    }

    // Table availability
    if (urlPath.includes('/api/orders/dine-in/tables/availability') || 
        urlPath.includes('/tables/availability')) {
      const tables = await getCachedTableAvailability();
      return { data: { occupied_tables: tables } };
    }

    // Orders
    if (urlPath.includes('/api/orders')) {
      // Single order
      if (urlPath.match(/\/api\/orders\/\d+$/) && !urlPath.includes('/items') && !urlPath.includes('/history')) {
        const orderIdMatch = urlPath.match(/\/api\/orders\/(\d+)/);
        if (orderIdMatch) {
          const orderId = parseInt(orderIdMatch[1]);
          const order = await getOrderById(orderId);
          return order ? { data: order } : null;
        }
      }
      // Order items
      if (urlPath.includes('/items')) {
        const orderIdMatch = urlPath.match(/\/api\/orders\/(\d+)\/items/);
        if (orderIdMatch) {
          const orderId = parseInt(orderIdMatch[1]);
          const order = await getOrderById(orderId);
          if (order && order.orderItems) {
            return { data: order.orderItems };
          }
        }
      }
      // Order lists - parse query params
      const status = urlObj.searchParams.get('status');
      const filter = urlObj.searchParams.get('filter');
      const orderType = urlPath.includes('/dine-in') ? 'dine_in' : 
                       urlPath.includes('/delivery') ? 'delivery' : null;
      
      if (orderType) {
        const filters = { orderType };
        if (status) {
          filters.paymentStatus = status;
        }
        const orders = await getAllOrders(filters);
        return orders.length > 0 ? { data: orders } : null;
      }
      
      // General orders endpoint
      if (urlPath === '/api/orders') {
        const orderTypeParam = urlObj.searchParams.get('orderType');
        const paymentStatus = urlObj.searchParams.get('paymentStatus');
        const filters = {};
        if (orderTypeParam) filters.orderType = orderTypeParam;
        if (paymentStatus) filters.paymentStatus = paymentStatus;
        const orders = await getAllOrders(filters);
        if (orders.length > 0) {
          return { data: { orders } };
        }
      }
    }

    // Stats and reports from metadata store
    if (urlPath.includes('/stats') || urlPath.includes('/reports/')) {
      const db = await import('./offlineDB').then(m => m.openDB());
      const tx = db.transaction('sync-metadata', 'readonly');
      const store = tx.objectStore('sync-metadata');
      
      let cacheKey = '';
      if (urlPath.includes('/delivery/stats')) {
        cacheKey = 'delivery-stats';
      } else if (urlPath.includes('/dine-in/stats')) {
        cacheKey = 'dinein-stats';
      } else if (urlPath.includes('/reports/')) {
        // Include query params in cache key for reports
        const queryString = urlObj.search;
        cacheKey = `report-${urlPath.replace(/[^a-zA-Z0-9]/g, '-')}${queryString ? '-' + queryString.replace(/[^a-zA-Z0-9]/g, '-') : ''}`;
      }
      
      if (cacheKey) {
        const request = store.get(cacheKey);
        return new Promise((resolve) => {
          request.onsuccess = () => {
            const result = request.result;
            if (result && result.data) {
              resolve({ data: result.data });
            } else {
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        });
      }
    }

    return null;
  } catch (error) {
    console.error('[APICache] Error getting cached response:', error);
    return null;
  }
};

