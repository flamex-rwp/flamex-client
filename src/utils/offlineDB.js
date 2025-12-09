// Enhanced IndexedDB utility for complete offline-first PWA
const DB_NAME = 'flamex-pos-db';
const DB_VERSION = 3; // Upgraded for universal caching

// Open or create the database with all stores
export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Error opening IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion || 0;

      // Create/upgrade stores
      
      // 1. Orders store - stores all orders (synced and unsynced)
      if (!db.objectStoreNames.contains('orders')) {
        const ordersStore = db.createObjectStore('orders', { keyPath: 'id' });
        ordersStore.createIndex('orderNumber', 'orderNumber', { unique: false });
        ordersStore.createIndex('orderType', 'orderType', { unique: false });
        ordersStore.createIndex('paymentStatus', 'paymentStatus', { unique: false });
        ordersStore.createIndex('orderStatus', 'orderStatus', { unique: false });
        ordersStore.createIndex('tableNumber', 'tableNumber', { unique: false });
        ordersStore.createIndex('createdAt', 'createdAt', { unique: false });
        ordersStore.createIndex('synced', 'synced', { unique: false });
      }

      // 2. Menu items store
      if (!db.objectStoreNames.contains('menu-items')) {
        const menuStore = db.createObjectStore('menu-items', { keyPath: 'id' });
        menuStore.createIndex('categoryId', 'categoryId', { unique: false });
        menuStore.createIndex('available', 'available', { unique: false });
        menuStore.createIndex('lastSynced', 'lastSynced', { unique: false });
      }

      // 3. Categories store
      if (!db.objectStoreNames.contains('categories')) {
        const categoriesStore = db.createObjectStore('categories', { keyPath: 'id' });
        categoriesStore.createIndex('lastSynced', 'lastSynced', { unique: false });
      }

      // 4. Customers store
      if (!db.objectStoreNames.contains('customers')) {
        const customersStore = db.createObjectStore('customers', { keyPath: 'id' });
        customersStore.createIndex('phone', 'phone', { unique: true });
        customersStore.createIndex('lastSynced', 'lastSynced', { unique: false });
      }

      // 5. Table availability store (cached table status)
      if (!db.objectStoreNames.contains('tables')) {
        const tablesStore = db.createObjectStore('tables', { keyPath: 'tableNumber' });
        tablesStore.createIndex('occupied', 'occupied', { unique: false });
        tablesStore.createIndex('lastSynced', 'lastSynced', { unique: false });
      }

      // 6. Pending operations queue (for all offline actions)
      if (!db.objectStoreNames.contains('pendingOperations')) {
        const pendingStore = db.createObjectStore('pendingOperations', {
          keyPath: 'id',
          autoIncrement: true
        });
        pendingStore.createIndex('type', 'type', { unique: false });
        pendingStore.createIndex('status', 'status', { unique: false });
        pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
        pendingStore.createIndex('retryCount', 'retryCount', { unique: false });
      }

      // 7. User session store
      if (!db.objectStoreNames.contains('user-session')) {
        db.createObjectStore('user-session', { keyPath: 'key' });
      }

      // 8. Sync metadata store (tracks last sync times)
      if (!db.objectStoreNames.contains('sync-metadata')) {
        const syncStore = db.createObjectStore('sync-metadata', { keyPath: 'key' });
        syncStore.createIndex('lastSync', 'lastSync', { unique: false });
      }

      // 9. API responses store (universal cache for all API responses) - Version 3
      if (!db.objectStoreNames.contains('api-responses')) {
        const apiStore = db.createObjectStore('api-responses', { keyPath: 'cacheKey' });
        apiStore.createIndex('url', 'url', { unique: false });
        apiStore.createIndex('method', 'method', { unique: false });
        apiStore.createIndex('timestamp', 'timestamp', { unique: false });
        apiStore.createIndex('resourceType', 'resourceType', { unique: false });
      }

      // 10. Expenses store - Version 3
      if (!db.objectStoreNames.contains('expenses')) {
        const expensesStore = db.createObjectStore('expenses', { keyPath: 'id' });
        expensesStore.createIndex('date', 'date', { unique: false });
        expensesStore.createIndex('category', 'category', { unique: false });
        expensesStore.createIndex('lastSynced', 'lastSynced', { unique: false });
      }

      // 11. Reports store - Version 3
      if (!db.objectStoreNames.contains('reports')) {
        const reportsStore = db.createObjectStore('reports', { keyPath: 'cacheKey' });
        reportsStore.createIndex('reportType', 'reportType', { unique: false });
        reportsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // 12. Conflicts store - Version 3
      if (!db.objectStoreNames.contains('conflicts')) {
        const conflictsStore = db.createObjectStore('conflicts', {
          keyPath: 'id',
          autoIncrement: true
        });
        conflictsStore.createIndex('resourceType', 'resourceType', { unique: false });
        conflictsStore.createIndex('resourceId', 'resourceId', { unique: false });
        conflictsStore.createIndex('timestamp', 'timestamp', { unique: false });
        conflictsStore.createIndex('resolved', 'resolved', { unique: false });
      }

      // Upgrade pendingOperations store - Version 3
      if (oldVersion < 3 && db.objectStoreNames.contains('pendingOperations')) {
        const tx = event.target.transaction;
        const pendingStore = tx.objectStore('pendingOperations');
        if (!pendingStore.indexNames.contains('priority')) {
          pendingStore.createIndex('priority', 'priority', { unique: false });
        }
        if (!pendingStore.indexNames.contains('idempotencyKey')) {
          pendingStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
        }
      }

      // Migration: Migrate old offline-orders to new orders store
      if (oldVersion < 2 && db.objectStoreNames.contains('offline-orders')) {
        const oldStore = event.target.transaction.objectStore('offline-orders');
        const newStore = event.target.transaction.objectStore('orders');
        
        oldStore.getAll().onsuccess = (e) => {
          const oldOrders = e.target.result;
          oldOrders.forEach(oldOrder => {
            const order = {
              ...oldOrder.data,
              id: `OFFLINE-${oldOrder.id}`,
              synced: oldOrder.synced || false,
              createdAt: oldOrder.timestamp || new Date().toISOString(),
              offlineId: oldOrder.id
            };
            newStore.put(order);
          });
        };
      }

      console.log(`[IndexedDB] Database upgraded to version ${DB_VERSION}`);
    };
  });
};

// ==================== ORDERS ====================

export const saveOrder = async (orderData) => {
  try {
    // Always generate a new ID for offline orders to ensure it's never undefined
    // Check if orderData has a valid ID (from server response)
    let orderId = orderData.id;
    
    // Validate ID - must be truthy, non-empty string/number, and not '0'
    const hasValidId = orderId && 
                      orderId !== '' && 
                      orderId !== 0 && 
                      orderId !== '0' && 
                      orderId !== null && 
                      orderId !== undefined &&
                      (typeof orderId === 'string' || typeof orderId === 'number');
    
    if (!hasValidId) {
      // Generate a unique ID for offline orders
      orderId = `OFFLINE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Ensure it's a string
    orderId = String(orderId);
    
    // Validate final ID
    if (!orderId || orderId.trim() === '') {
      throw new Error('Failed to generate valid order ID');
    }
    
    const db = await openDB();
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    
    // Create order object with guaranteed ID
    // Remove any undefined/null id from orderData first to prevent overwriting
    const { id: _oldId, ...orderDataWithoutId } = orderData;
    const order = {
      ...orderDataWithoutId,
      id: orderId, // Always set ID explicitly
      synced: orderData.synced !== undefined ? orderData.synced : false,
      createdAt: orderData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Final validation
    if (!order.id || order.id === undefined || order.id === null || order.id === '') {
      throw new Error(`Order ID validation failed. Generated: ${orderId}, Final: ${order.id}`);
    }

    // Wrap put operation in Promise for proper async handling
    return new Promise((resolve, reject) => {
      const request = store.put(order);
      request.onsuccess = () => {
        console.log('[saveOrder] Order saved successfully with ID:', order.id);
        resolve(order);
      };
      request.onerror = () => {
        console.error('[saveOrder] Error saving order:', request.error);
        console.error('[saveOrder] Order ID:', order.id, 'Type:', typeof order.id, 'Value:', JSON.stringify(order.id));
        console.error('[saveOrder] Order keys:', Object.keys(order));
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[saveOrder] Error saving order:', error);
    console.error('[saveOrder] Order data received:', JSON.stringify(orderData, null, 2));
    throw error;
  }
};

export const getAllOrders = async (filters = {}) => {
  try {
    const db = await openDB();
    const tx = db.transaction('orders', 'readonly');
    const store = tx.objectStore('orders');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        let orders = request.result;
        
        // Apply filters
        if (filters.orderType) {
          orders = orders.filter(o => o.orderType === filters.orderType);
        }
        if (filters.paymentStatus) {
          orders = orders.filter(o => o.paymentStatus === filters.paymentStatus);
        }
        if (filters.orderStatus) {
          orders = orders.filter(o => o.orderStatus === filters.orderStatus);
        }
        if (filters.synced !== undefined) {
          orders = orders.filter(o => o.synced === filters.synced);
        }
        
        resolve(orders);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting orders:', error);
    return [];
  }
};

export const getOrderById = async (id) => {
  try {
    const db = await openDB();
    const tx = db.transaction('orders', 'readonly');
    const store = tx.objectStore('orders');
    const request = store.get(id);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting order:', error);
    return null;
  }
};

export const updateOrder = async (id, updates) => {
  try {
    const db = await openDB();
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    const request = store.get(id);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const order = request.result;
        if (!order) {
          reject(new Error('Order not found'));
          return;
        }

        const updated = {
          ...order,
          ...updates,
          updatedAt: new Date().toISOString(),
          synced: false // Mark as unsynced when updated
        };

        store.put(updated);
        resolve(updated);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error updating order:', error);
    throw error;
  }
};

export const markOrderSynced = async (id, serverOrder) => {
  try {
    const db = await openDB();
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    
    // If we have server order data, update with it
    if (serverOrder) {
      await store.put({
        ...serverOrder,
        synced: true,
        updatedAt: new Date().toISOString()
      });
    } else {
      const request = store.get(id);
      request.onsuccess = () => {
        const order = request.result;
        if (order) {
          order.synced = true;
          order.updatedAt = new Date().toISOString();
          store.put(order);
        }
      };
    }
  } catch (error) {
    console.error('Error marking order as synced:', error);
    throw error;
  }
};

// ==================== MENU ITEMS ====================

export const cacheMenuItems = async (menuItems) => {
  try {
    const db = await openDB();
    const tx = db.transaction('menu-items', 'readwrite');
    const store = tx.objectStore('menu-items');

    const now = new Date().toISOString();
    for (const item of menuItems) {
      await store.put({
        ...item,
        lastSynced: now
      });
    }

    await updateSyncMetadata('menu-items', now);
    console.log('Menu items cached:', menuItems.length);
  } catch (error) {
    console.error('Error caching menu items:', error);
    throw error;
  }
};

export const getCachedMenuItems = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('menu-items', 'readonly');
    const store = tx.objectStore('menu-items');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting cached menu items:', error);
    return [];
  }
};

// ==================== CATEGORIES ====================

export const cacheCategories = async (categories) => {
  try {
    const db = await openDB();
    const tx = db.transaction('categories', 'readwrite');
    const store = tx.objectStore('categories');

    const now = new Date().toISOString();
    for (const category of categories) {
      await store.put({
        ...category,
        lastSynced: now
      });
    }

    await updateSyncMetadata('categories', now);
    console.log('Categories cached:', categories.length);
  } catch (error) {
    console.error('Error caching categories:', error);
    throw error;
  }
};

export const getCachedCategories = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('categories', 'readonly');
    const store = tx.objectStore('categories');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting cached categories:', error);
    return [];
  }
};

// ==================== CUSTOMERS ====================

export const cacheCustomers = async (customers) => {
  try {
    const db = await openDB();
    const tx = db.transaction('customers', 'readwrite');
    const store = tx.objectStore('customers');

    const now = new Date().toISOString();
    for (const customer of customers) {
      await store.put({
        ...customer,
        lastSynced: now
      });
    }

    await updateSyncMetadata('customers', now);
    console.log('Customers cached:', customers.length);
  } catch (error) {
    console.error('Error caching customers:', error);
    throw error;
  }
};

export const getCachedCustomers = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('customers', 'readonly');
    const store = tx.objectStore('customers');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting cached customers:', error);
    return [];
  }
};

// ==================== TABLES ====================

export const cacheTableAvailability = async (occupiedTables) => {
  try {
    const db = await openDB();
    const tx = db.transaction('tables', 'readwrite');
    const store = tx.objectStore('tables');

    const now = new Date().toISOString();
    const occupiedTableNumbers = new Set(
      occupiedTables.map(t => t.tableNumber || t.table_number)
    );

    // Update all tables (1-10)
    for (let i = 1; i <= 10; i++) {
      await store.put({
        tableNumber: i,
        occupied: occupiedTableNumbers.has(i),
        orderId: occupiedTables.find(t => (t.tableNumber || t.table_number) === i)?.id,
        orderNumber: occupiedTables.find(t => (t.tableNumber || t.table_number) === i)?.orderNumber,
        lastSynced: now
      });
    }

    await updateSyncMetadata('tables', now);
    console.log('Table availability cached');
  } catch (error) {
    console.error('Error caching table availability:', error);
    throw error;
  }
};

export const getCachedTableAvailability = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('tables', 'readonly');
    const store = tx.objectStore('tables');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const tables = request.result || [];
        const occupiedTables = tables
          .filter(t => t.occupied)
          .map(t => ({
            tableNumber: t.tableNumber,
            id: t.orderId,
            orderNumber: t.orderNumber
          }));
        resolve(occupiedTables);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting cached table availability:', error);
    return [];
  }
};

// ==================== PENDING OPERATIONS QUEUE ====================

export const addPendingOperation = async (operation) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');

    const op = {
      type: operation.type, // 'create_order', 'update_order', 'update_status', 'mark_paid', etc.
      endpoint: operation.endpoint,
      method: operation.method,
      data: operation.data,
      status: 'pending',
      timestamp: new Date().toISOString(),
      retryCount: 0,
      lastAttempt: null,
      error: null
    };

    const request = store.add(op);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error adding pending operation:', error);
    throw error;
  }
};

export const getPendingOperations = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readonly');
    const store = tx.objectStore('pendingOperations');
    const index = store.index('status');
    const request = index.getAll('pending');

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting pending operations:', error);
    return [];
  }
};

export const markOperationComplete = async (operationId) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    const request = store.delete(operationId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error marking operation complete:', error);
    throw error;
  }
};

export const markOperationFailed = async (operationId, error) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    const request = store.get(operationId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const op = request.result;
        if (op) {
          op.status = 'failed';
          op.retryCount = (op.retryCount || 0) + 1;
          op.lastAttempt = new Date().toISOString();
          op.error = error.message || String(error);
          
          // Auto-retry up to 3 times
          if (op.retryCount < 3) {
            op.status = 'pending';
          }
          
          store.put(op);
          resolve(op);
        } else {
          reject(new Error('Operation not found'));
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error marking operation failed:', error);
    throw error;
  }
};

// ==================== SYNC METADATA ====================

export const updateSyncMetadata = async (key, lastSync) => {
  try {
    const db = await openDB();
    const tx = db.transaction('sync-metadata', 'readwrite');
    const store = tx.objectStore('sync-metadata');
    await store.put({ key, lastSync });
  } catch (error) {
    console.error('Error updating sync metadata:', error);
  }
};

export const getSyncMetadata = async (key) => {
  try {
    const db = await openDB();
    const tx = db.transaction('sync-metadata', 'readonly');
    const store = tx.objectStore('sync-metadata');
    const request = store.get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.lastSync : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting sync metadata:', error);
    return null;
  }
};

// ==================== USER SESSION ====================

export const saveUserSession = async (user) => {
  try {
    const db = await openDB();
    const tx = db.transaction('user-session', 'readwrite');
    const store = tx.objectStore('user-session');
    await store.put({
      key: 'current-user',
      user: user,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error saving user session:', error);
    throw error;
  }
};

export const getCachedUserSession = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('user-session', 'readonly');
    const store = tx.objectStore('user-session');
    const request = store.get('current-user');

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.user : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting cached user session:', error);
    return null;
  }
};

export const clearUserSession = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('user-session', 'readwrite');
    const store = tx.objectStore('user-session');
    await store.delete('current-user');
  } catch (error) {
    console.error('Error clearing user session:', error);
    throw error;
  }
};

// ==================== LEGACY SUPPORT (for backward compatibility) ====================

// Keep old functions for backward compatibility
export const saveOfflineOrder = async (orderData) => {
  return saveOrder(orderData);
};

export const getOfflineOrders = async () => {
  const orders = await getAllOrders({ synced: false });
  return orders.map(order => ({
    id: order.offlineId || order.id,
    data: order,
    timestamp: order.createdAt,
    synced: order.synced || false
  }));
};

export const getOfflineOrdersCount = async () => {
  const orders = await getAllOrders({ synced: false });
  return orders.length;
};

export const updateOfflineOrder = async (orderId, updates) => {
  return updateOrder(orderId, updates);
};

export const deleteOfflineOrder = async (orderId) => {
  try {
    const db = await openDB();
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    await store.delete(orderId);
  } catch (error) {
    console.error('Error deleting order:', error);
    throw error;
  }
};

// ==================== UTILITY ====================

export const clearAllOfflineData = async () => {
  try {
    const db = await openDB();
    const stores = ['orders', 'menu-items', 'categories', 'customers', 'tables', 'pendingOperations', 'user-session', 'sync-metadata'];

    for (const storeName of stores) {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      await store.clear();
    }

    console.log('All offline data cleared');
  } catch (error) {
    console.error('Error clearing offline data:', error);
    throw error;
  }
};
