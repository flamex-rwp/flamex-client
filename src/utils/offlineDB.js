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

    };
  });
};

// ==================== ORDERS ====================

/**
 * Saves an order to IndexedDB. Generates an offline ID if needed.
 * For delivery orders, ensures deliveryStatus defaults to 'pending' for new orders.
 * 
 * @param {Object} orderData - Order data to save
 * @returns {Promise<Object>} Saved order object
 * @throws {Error} If order ID validation fails or IndexedDB operation fails
 */
export const saveOrder = async (orderData) => {
  try {
    let orderId = orderData?.id;
    
    const hasValidId = orderId && 
                      orderId !== '' && 
                      orderId !== 0 && 
                      orderId !== '0' && 
                      orderId !== null && 
                      orderId !== undefined &&
                      (typeof orderId === 'string' || typeof orderId === 'number');
    
    if (!hasValidId) {
      orderId = `OFFLINE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    orderId = String(orderId).trim();
    
    if (!orderId || orderId === '') {
      throw new Error('Failed to generate valid order ID');
    }
    
    const order = {};
    
    if (orderData && typeof orderData === 'object' && !Array.isArray(orderData)) {
      Object.keys(orderData).forEach(key => {
        if (key !== 'id' && orderData[key] !== undefined && orderData[key] !== null) {
          if (Array.isArray(orderData[key])) {
            order[key] = [...orderData[key]];
          } else if (typeof orderData[key] === 'object') {
            order[key] = { ...orderData[key] };
          } else {
            order[key] = orderData[key];
          }
        }
      });
    }
    
    order.synced = orderData?.synced !== undefined ? orderData.synced : false;
    order.createdAt = orderData?.createdAt || new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    
    if (!order.orderStatus && !order.order_status) {
      order.orderStatus = 'pending';
      order.order_status = 'pending';
    }
    
    const orderType = order.orderType || order.order_type;
    const orderDataId = orderData?.id;
    const isNewOrder = !orderDataId || 
                      (typeof orderDataId === 'string' && orderDataId.startsWith('OFFLINE-')) || 
                      order.synced === false;
    
    if (orderType === 'delivery') {
      if (isNewOrder) {
        order.deliveryStatus = 'pending';
        order.delivery_status = 'pending';
      } else if (!order.deliveryStatus && !order.delivery_status) {
        order.deliveryStatus = 'pending';
        order.delivery_status = 'pending';
      }
    }
    
    if (!order.paymentStatus && !order.payment_status) {
      order.paymentStatus = orderData?.paymentStatus || orderData?.payment_status || 'pending';
      order.payment_status = order.paymentStatus;
    }
    
    order.id = orderId;
    
    if (!order.hasOwnProperty('id') || !order.id || order.id === undefined || order.id === null || order.id === '') {
      throw new Error(`Order ID validation failed. Generated: ${orderId}, Final: ${order.id}`);
    }
    
    const finalId = String(order.id).trim();
    
    if (!finalId) {
      throw new Error(`Order ID is empty after string conversion. Original: ${order.id}`);
    }
    
    order.id = finalId;
    
    if (typeof order.id !== 'string' || order.id === '') {
      throw new Error(`Order ID is not a valid string. Value: ${order.id}, Type: ${typeof order.id}`);
    }
    
    const idValue = String(order.id).trim();
    
    if (!idValue || idValue === '') {
      throw new Error(`Invalid idValue: ${idValue}`);
    }
    
    const plainOrder = {};
    
    Object.keys(order).forEach(key => {
      if (key !== 'id') {
        plainOrder[key] = order[key];
      }
    });
    
    plainOrder.id = idValue;
    
    if (!plainOrder.id || typeof plainOrder.id !== 'string' || plainOrder.id.trim() === '') {
      throw new Error(`Plain object ID validation failed. Original: ${order.id}, Plain: ${plainOrder.id}, Extracted: ${idValue}`);
    }
    
    const testIdRead = plainOrder.id;
    if (!testIdRead || testIdRead !== idValue) {
      throw new Error(`ID read test failed. Expected: ${idValue}, Got: ${testIdRead}`);
    }
    
    Object.defineProperty(plainOrder, 'id', {
      value: idValue,
      enumerable: true,
      writable: true,
      configurable: true
    });
    
    const db = await openDB();
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');

    return new Promise((resolve, reject) => {
      if (!plainOrder.id || typeof plainOrder.id !== 'string' || plainOrder.id.trim() === '') {
        reject(new Error(`Cannot save order: Invalid ID. ID: ${plainOrder.id}, Type: ${typeof plainOrder.id}`));
        return;
      }
      
      const idDescriptor = Object.getOwnPropertyDescriptor(plainOrder, 'id');
      
      if (!idDescriptor || !idDescriptor.enumerable) {
        Object.defineProperty(plainOrder, 'id', {
          value: plainOrder.id,
          enumerable: true,
          writable: true,
          configurable: true
        });
      }
      
      const idToSave = plainOrder.id;
      if (!idToSave || typeof idToSave !== 'string') {
        reject(new Error(`Invalid ID before save: ${idToSave}`));
        return;
      }
      
      const request = store.put(plainOrder);
      
      request.onsuccess = () => {
        resolve(plainOrder);
      };
      
      request.onerror = () => {
        console.error('Error saving order to IndexedDB:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Error in saveOrder:', error);
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

/**
 * Retrieves an order from IndexedDB by orderNumber
 * @param {string|number} orderNumber - The order number to search for
 * @returns {Promise<Object|null>} The order object or null if not found
 */
export const getOrderByOrderNumber = async (orderNumber) => {
  try {
    if (!orderNumber) return null;
    const db = await openDB();
    const tx = db.transaction('orders', 'readonly');
    const store = tx.objectStore('orders');
    const index = store.index('orderNumber');
    const request = index.get(orderNumber);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting order by orderNumber:', error);
    return null;
  }
};

/**
 * Merges preserved offline status updates from IndexedDB into API-fetched orders.
 * Ensures that orders with offline status updates don't revert to server status.
 * 
 * @param {Array} apiOrders - Orders fetched from the API
 * @returns {Promise<Array>} Orders with preserved offline status merged in
 */
export const mergePreservedOfflineStatus = async (apiOrders) => {
  try {
    if (!apiOrders || apiOrders.length === 0) return apiOrders;
    
    const mergedOrders = await Promise.all(apiOrders.map(async (apiOrder) => {
      const orderNumber = apiOrder.orderNumber || apiOrder.order_number;
      if (!orderNumber) return apiOrder;
      
      // Check IndexedDB for order with preserved offline status
      const dbOrder = await getOrderByOrderNumber(orderNumber);
      if (!dbOrder) return apiOrder;
      
      // Check if order has offline status updates that need to be preserved
      // Handle both nested (data) and flat structures
      const dbData = dbOrder.data || dbOrder;
      const offlineStatusUpdated = dbData.offlineStatusUpdated !== undefined ? dbData.offlineStatusUpdated : (dbOrder.offlineStatusUpdated !== undefined ? dbOrder.offlineStatusUpdated : false);
      const dbDeliveryStatus = dbData.deliveryStatus || dbData.delivery_status || dbOrder.deliveryStatus || dbOrder.delivery_status;
      const dbOrderStatus = dbData.orderStatus || dbData.order_status || dbOrder.orderStatus || dbOrder.order_status;
      const dbPaymentStatus = dbData.paymentStatus || dbData.payment_status || dbOrder.paymentStatus || dbOrder.payment_status;
      
      // Status hierarchies for comparison
      const orderStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'];
      const deliveryStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
      
      const apiDeliveryStatus = apiOrder.deliveryStatus || apiOrder.delivery_status || 'pending';
      const apiOrderStatus = apiOrder.orderStatus || apiOrder.order_status || 'pending';
      const apiPaymentStatus = apiOrder.paymentStatus || apiOrder.payment_status || 'pending';
      
      // If offlineStatusUpdated flag is set, always preserve the offline status
      // Otherwise, preserve if local status is more advanced than server
      let shouldPreserveDelivery = false;
      let shouldPreserveOrder = false;
      let shouldPreservePayment = false;
      
      if (offlineStatusUpdated) {
        // Always preserve if flag is set
        shouldPreserveDelivery = dbDeliveryStatus && dbDeliveryStatus !== 'pending';
        shouldPreserveOrder = dbOrderStatus && dbOrderStatus !== 'pending';
        shouldPreservePayment = dbPaymentStatus === 'completed';
      } else {
        // Preserve if local is more advanced than server
        if (dbDeliveryStatus && dbDeliveryStatus !== 'pending') {
          const dbIndex = deliveryStatusHierarchy.indexOf(dbDeliveryStatus);
          const apiIndex = apiDeliveryStatus ? deliveryStatusHierarchy.indexOf(apiDeliveryStatus) : -1;
          shouldPreserveDelivery = dbIndex > apiIndex || !apiDeliveryStatus || apiDeliveryStatus === 'pending';
        }
        
        if (dbOrderStatus && dbOrderStatus !== 'pending') {
          const dbIndex = orderStatusHierarchy.indexOf(dbOrderStatus);
          const apiIndex = apiOrderStatus ? orderStatusHierarchy.indexOf(apiOrderStatus) : -1;
          shouldPreserveOrder = dbIndex > apiIndex || !apiOrderStatus || apiOrderStatus === 'pending';
        }
        
        if (dbPaymentStatus === 'completed' && apiPaymentStatus !== 'completed') {
          shouldPreservePayment = true;
        }
      }
      
      // Merge preserved status into API order
      const mergedOrder = { ...apiOrder };
      
      if (shouldPreserveDelivery && dbDeliveryStatus) {
        mergedOrder.deliveryStatus = dbDeliveryStatus;
        mergedOrder.delivery_status = dbDeliveryStatus;
      }
      
      if (shouldPreserveOrder && dbOrderStatus) {
        mergedOrder.orderStatus = dbOrderStatus;
        mergedOrder.order_status = dbOrderStatus;
      }
      
      if (shouldPreservePayment && dbPaymentStatus === 'completed') {
        mergedOrder.paymentStatus = 'completed';
        mergedOrder.payment_status = 'completed';
      }
      
      return mergedOrder;
    }));
    
    return mergedOrders;
  } catch (error) {
    console.error('Error merging preserved offline status:', error);
    return apiOrders; // Return original orders on error
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

        // Preserve existing status fields if they're more advanced than updates
        // This prevents overwriting status updates that haven't synced yet
        const existingDeliveryStatus = order.deliveryStatus || order.delivery_status;
        const existingOrderStatus = order.orderStatus || order.order_status;
        const existingPaymentStatus = order.paymentStatus || order.payment_status;
        const existingOfflineStatusUpdated = order.offlineStatusUpdated;
        
        const newDeliveryStatus = updates.deliveryStatus || updates.delivery_status;
        const newOrderStatus = updates.orderStatus || updates.order_status;
        const newPaymentStatus = updates.paymentStatus || updates.payment_status;
        
        // Status hierarchies for comparison
        const orderStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'];
        const deliveryStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
        
        // If offlineStatusUpdated flag is set, preserve existing statuses unless explicitly overwriting
        if (existingOfflineStatusUpdated && updates.offlineStatusUpdated !== false) {
          // Preserve existing deliveryStatus if it's more advanced
          if (existingDeliveryStatus && existingDeliveryStatus !== 'pending') {
            if (!newDeliveryStatus || deliveryStatusHierarchy.indexOf(existingDeliveryStatus) >= deliveryStatusHierarchy.indexOf(newDeliveryStatus)) {
              updates.deliveryStatus = existingDeliveryStatus;
              updates.delivery_status = existingDeliveryStatus;
            }
          }
          
          // Preserve existing orderStatus if it's more advanced
          if (existingOrderStatus && existingOrderStatus !== 'pending') {
            if (!newOrderStatus || orderStatusHierarchy.indexOf(existingOrderStatus) >= orderStatusHierarchy.indexOf(newOrderStatus)) {
              updates.orderStatus = existingOrderStatus;
              updates.order_status = existingOrderStatus;
            }
          }
          
          // Preserve existing paymentStatus if completed
          if (existingPaymentStatus === 'completed') {
            updates.paymentStatus = 'completed';
            updates.payment_status = 'completed';
          }
          
          // Preserve the flag
          updates.offlineStatusUpdated = true;
        }

        const updated = {
          ...order,
          ...updates,
          updatedAt: new Date().toISOString(),
          synced: order.synced !== false ? order.synced : false // Preserve synced status unless explicitly unsynced
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

/**
 * Updates pending operations that reference an offline order ID to use the server ID.
 * Called when an order is synced to ensure pending operations use the correct server ID.
 * 
 * @param {string} offlineId - The offline order ID
 * @param {string|number} serverOrderId - The server-assigned order ID
 */
export const updatePendingOperationsForOrder = async (offlineId, serverOrderId) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    const index = store.index('status');
    const request = index.getAll('pending');
    
    await new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        const operations = request.result || [];
        let updatedCount = 0;
        
        for (const op of operations) {
          // Check if this operation references the offline ID
          // Match both the full OFFLINE-xxx ID and the extracted ID (without OFFLINE- prefix)
          const fullOfflineId = offlineId.startsWith('OFFLINE-') ? offlineId : `OFFLINE-${offlineId}`;
          const extractedId = offlineId.replace(/^OFFLINE-.*?-/, '').replace(/^OFFLINE-/, '');
          
          const endpointContainsOfflineId = op.endpoint && (
            op.endpoint.includes(fullOfflineId) || 
            op.endpoint.includes(extractedId) ||
            op.endpoint.includes(offlineId)
          );
          const dataContainsOfflineId = op.data?.offlineId === offlineId || 
                                       op.data?.offlineId === extractedId ||
                                       op.data?.id === offlineId ||
                                       op.offlineId === offlineId ||
                                       op.offlineId === extractedId;
          
          if (endpointContainsOfflineId || dataContainsOfflineId) {
            // Update the endpoint to use server ID - replace all variations
            if (op.endpoint) {
              let updatedEndpoint = op.endpoint;
              const originalEndpoint = updatedEndpoint;
              
              // Replace full OFFLINE- ID
              if (updatedEndpoint.includes(fullOfflineId)) {
                updatedEndpoint = updatedEndpoint.replace(new RegExp(fullOfflineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), serverOrderId);
              }
              // Replace extracted ID
              if (updatedEndpoint.includes(extractedId) && extractedId !== serverOrderId) {
                updatedEndpoint = updatedEndpoint.replace(new RegExp(extractedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), serverOrderId);
              }
              // Replace any remaining OFFLINE- pattern as fallback
              if (updatedEndpoint.includes('OFFLINE-')) {
                updatedEndpoint = updatedEndpoint.replace(/OFFLINE-[^\/]+/, serverOrderId);
              }
              
              op.endpoint = updatedEndpoint;
            }
            
            // Update offlineId in data to server ID for future reference
            if (op.data) {
              op.data.offlineId = serverOrderId;
              op.data.id = serverOrderId;
            }
            if (op.offlineId) {
              op.offlineId = serverOrderId;
            }
            
            // Save the updated operation
            await store.put(op);
            updatedCount++;
          }
        }
        
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[updatePendingOperationsForOrder] Error updating pending operations:', error);
  }
};

/**
 * Marks an order as synced and updates it with server data.
 * Preserves offline status updates if they are more advanced than server status.
 * 
 * @param {string} id - The local order ID (may be offline ID)
 * @param {Object} serverOrder - The order data from the server
 */
export const markOrderSynced = async (id, serverOrder) => {
  try {
    // CRITICAL: Update all pending operations BEFORE opening the transaction
    // This prevents transaction conflicts
    if (serverOrder && id && serverOrder.id && id !== serverOrder.id) {
      await updatePendingOperationsForOrder(id, serverOrder.id);
      const extractedId = id.replace(/^OFFLINE-.*?-/, '').replace(/^OFFLINE-/, '');
      if (extractedId !== id && extractedId !== serverOrder.id) {
        await updatePendingOperationsForOrder(extractedId, serverOrder.id);
      }
    }
    
    const db = await openDB();
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');
    
    // If we have server order data, update with it
    if (serverOrder) {
      // Try multiple lookup strategies to find the local order (needed to preserve offline status)
      let localOrder = null;
      let lookupStrategy = 'direct-id';
      
      // Strategy 1: direct lookup with provided id
      const tryGet = async (lookupId) => {
        const req = store.get(lookupId);
        return new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      };
      
      localOrder = await tryGet(id);
      
      // Strategy 2: if not found and id lacks OFFLINE- prefix, try with OFFLINE- prefix
      if (!localOrder && id && !id.startsWith('OFFLINE-')) {
        const prefixedId = `OFFLINE-${id}`;
        localOrder = await tryGet(prefixedId);
        if (localOrder) lookupStrategy = 'offline-prefixed';
      }
      
      // Strategy 3: if still not found and serverOrder has orderNumber, try by orderNumber index
      if (!localOrder) {
        const orderNumber = serverOrder.orderNumber || serverOrder.order_number;
        if (orderNumber) {
          lookupStrategy = 'orderNumber';
          const index = store.index('orderNumber');
          const req = index.get(orderNumber);
          localOrder = await new Promise((resolve) => {
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
          });
        }
      }
      
      // Strategy 4: if still not found, try serverOrder.id
      if (!localOrder && serverOrder.id && serverOrder.id !== id) {
        lookupStrategy = 'server-id';
        localOrder = await tryGet(serverOrder.id);
      }
      
      
      const normalizedOrder = { ...serverOrder };
      // Keep server statuses as-is for delivery; do not auto-upgrade based solely on payment status
      const serverPaymentStatus = normalizedOrder.paymentStatus || normalizedOrder.payment_status || 'pending';
      const serverOrderStatus = normalizedOrder.orderStatus || normalizedOrder.order_status || 'pending';
      const serverDeliveryStatus = normalizedOrder.deliveryStatus || normalizedOrder.delivery_status || 'pending';
      
      // Preserve local status updates if they were made offline
      if (localOrder) {
        const localData = localOrder.data || localOrder;
        const localOrderStatus = localData.orderStatus || localData.order_status;
        const localDeliveryStatus = localData.deliveryStatus || localData.delivery_status;
        const localPaymentStatus = localData.paymentStatus || localData.payment_status;
        const offlineStatusUpdated = localData.offlineStatusUpdated;
        
        // Status hierarchy for comparison
        const orderStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'];
        const deliveryStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
        
        // Always check if local status is more advanced than server, regardless of offlineStatusUpdated flag
        // This handles cases where status was updated but flag wasn't set properly
        
        // For delivery orders, preserve deliveryStatus if local is more advanced OR if offlineStatusUpdated flag is set
        // This is critical - if status was updated offline, we MUST preserve it
        if (localDeliveryStatus && localDeliveryStatus !== 'pending') {
          const localDeliveryIndex = deliveryStatusHierarchy.indexOf(localDeliveryStatus);
          const serverDeliveryIndex = serverDeliveryStatus ? deliveryStatusHierarchy.indexOf(serverDeliveryStatus) : -1;
          
          // Preserve if:
          // 1. Local is more advanced than server, OR
          // 2. Server is pending/undefined, OR
          // 3. offlineStatusUpdated flag is set (status was explicitly updated offline)
          if (localDeliveryIndex > serverDeliveryIndex || !serverDeliveryStatus || serverDeliveryStatus === 'pending' || offlineStatusUpdated) {
            normalizedOrder.deliveryStatus = localDeliveryStatus;
            normalizedOrder.delivery_status = localDeliveryStatus;
          }
        }
        
        // Preserve orderStatus if local is more advanced than server OR if offlineStatusUpdated flag is set
        if (localOrderStatus && localOrderStatus !== 'pending' && localOrderStatus !== serverOrderStatus) {
          const localIndex = orderStatusHierarchy.indexOf(localOrderStatus);
          const serverIndex = orderStatusHierarchy.indexOf(serverOrderStatus);
          
          // Preserve if local is more advanced OR server is pending OR offlineStatusUpdated flag is set
          if (localIndex > serverIndex || serverOrderStatus === 'pending' || offlineStatusUpdated) {
            normalizedOrder.orderStatus = localOrderStatus;
            normalizedOrder.order_status = localOrderStatus;
          }
        }
        
        // Preserve paymentStatus if local is completed and server is not
        if (localPaymentStatus === 'completed' && serverPaymentStatus !== 'completed') {
          normalizedOrder.paymentStatus = 'completed';
          normalizedOrder.payment_status = 'completed';
        }
        
        if (offlineStatusUpdated) {
          normalizedOrder.offlineStatusUpdated = true;
        }
      }
      
      // CRITICAL: Delete the old offline order (by offline ID) before storing the server order
      // This prevents duplicate entries and ensures we use the server's ID
      if (id && id !== normalizedOrder.id) {
        try {
          await store.delete(id);
        } catch (deleteError) {
          // Silently handle delete errors - order may not exist
        }
      }
      
      await store.put({
        ...normalizedOrder,
        synced: true,
        updatedAt: new Date().toISOString()
      });
    } else {
      // No server order - just mark local order as synced
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

export const saveCustomer = async (customerData) => {
  try {
    const db = await openDB();
    const tx = db.transaction('customers', 'readwrite');
    const store = tx.objectStore('customers');
    
    const customer = {
      ...customerData,
      id: customerData.id || `CUSTOMER-${Date.now()}`,
      lastSynced: customerData.lastSynced || null
    };
    
    await store.put(customer);
    return customer;
  } catch (error) {
    console.error('Error saving customer:', error);
    throw error;
  }
};

// ==================== TABLES ====================

export const cacheTableAvailability = async (occupiedTables) => {
  try {
    const db = await openDB();
    const tx = db.transaction('tables', 'readwrite');
    const store = tx.objectStore('tables');

    const now = new Date().toISOString();
    // Normalize table numbers - ensure we're comparing numbers
    const occupiedTableNumbers = new Set(
      occupiedTables
        .map(t => {
          const tableNum = t.tableNumber || t.table_number;
          return tableNum !== null && tableNum !== undefined ? parseInt(tableNum) : null;
        })
        .filter(num => num !== null && num >= 1 && num <= 10)
    );

    // Update all tables (1-10)
    for (let i = 1; i <= 10; i++) {
      const isOccupied = occupiedTableNumbers.has(i);
      const occupiedTable = occupiedTables.find(t => {
        const tableNum = t.tableNumber || t.table_number;
        return tableNum !== null && tableNum !== undefined && parseInt(tableNum) === i;
      });
      
      await store.put({
        tableNumber: i,
        occupied: isOccupied,
        orderId: occupiedTable?.id || occupiedTable?.orderId || null,
        orderNumber: occupiedTable?.orderNumber || occupiedTable?.order_number || null,
        lastSynced: now
      });
    }

    await updateSyncMetadata('tables', now);
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
            table_number: t.tableNumber, // Add both formats for consistency
            id: t.orderId,
            orderId: t.orderId, // Add both formats for consistency
            orderNumber: t.orderNumber,
            order_number: t.orderNumber // Add both formats for consistency
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

/**
 * Legacy function for backward compatibility
 * @deprecated Use saveOrder instead
 */
export const saveOfflineOrder = async (orderData) => {
  return await saveOrder(orderData);
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

export const getOfflineOrderById = async (orderId) => {
  try {
    // Try to get by the orderId directly
    const order = await getOrderById(orderId);
    if (order && !order.synced) {
      return {
        id: order.id,
        data: order,
        timestamp: order.createdAt,
        synced: order.synced || false
      };
    }
    
    // If not found, try searching all offline orders
    const offlineOrders = await getOfflineOrders();
    const found = offlineOrders.find(o => 
      o.id === orderId || 
      o.data?.id === orderId || 
      String(o.id).includes(String(orderId)) ||
      String(o.data?.id).includes(String(orderId))
    );
    
    return found || null;
  } catch (error) {
    console.error('Error getting offline order by ID:', error);
    return null;
  }
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

  } catch (error) {
    console.error('Error clearing offline data:', error);
    throw error;
  }
};
