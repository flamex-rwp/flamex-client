// Unified offline sync service for complete PWA offline-first architecture
import api, { API_BASE_URL } from './api';
import { customerAPI } from './customerAPI';
import { ordersAPI } from './api';
import {
  getPendingOperations,
  markOperationComplete,
  markOperationFailed,
  getAllOrders,
  markOrderSynced,
  cacheMenuItems,
  cacheCategories,
  cacheCustomers,
  cacheTableAvailability,
  getCachedMenuItems,
  getCachedCategories,
  getCachedCustomers,
  getCachedTableAvailability,
  updateSyncMetadata,
  getSyncMetadata,
  saveCustomer
} from '../utils/offlineDB';
import { clearAllCache } from './cacheService';

// Sync configuration
const SYNC_INTERVAL = 30000; // 30 seconds polling interval for pending operations (quick sync)
const DATA_SYNC_INTERVAL = 120000; // 2 minutes for full data sync (customers, addresses, orders)
const SYNC_BATCH_SIZE = 5; // Process 5 operations at a time

// Global sync state
let syncInProgress = false;
let syncIntervalId = null;
let cacheClearIntervalId = null;
let lastSyncTime = null;

// Cache for server connectivity check (avoid multiple simultaneous checks)
let serverConnectivityCache = {
  isOnline: navigator.onLine,
  lastCheck: 0,
  checking: false
};
const CONNECTIVITY_CHECK_INTERVAL = 5000; // Check every 5 seconds max
const CONNECTIVITY_CHECK_TIMEOUT = 3000; // 3 second timeout

// Check if the browser is online AND server is reachable
export const isOnline = async () => {
  // First check: navigator.onLine (fast check)
  if (!navigator.onLine) {
    return false;
  }

  // Second check: Test server connectivity (cached for performance)
  const now = Date.now();
  if (now - serverConnectivityCache.lastCheck < CONNECTIVITY_CHECK_INTERVAL && !serverConnectivityCache.checking) {
    return serverConnectivityCache.isOnline;
  }

  // If already checking, return cached result
  if (serverConnectivityCache.checking) {
    return serverConnectivityCache.isOnline;
  }

  // Perform connectivity check
  serverConnectivityCache.checking = true;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_CHECK_TIMEOUT);
    
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache'
    });
    
    clearTimeout(timeoutId);
    
    const isServerOnline = response.ok || response.status < 500;
    serverConnectivityCache = {
      isOnline: isServerOnline,
      lastCheck: now,
      checking: false
    };
    
    return isServerOnline;
  } catch (error) {
    // Network error or timeout - server is not reachable
    serverConnectivityCache = {
      isOnline: false,
      lastCheck: now,
      checking: false
    };
    return false;
  }
};

// Synchronous version for immediate checks (uses cached result)
export const isOnlineSync = () => {
  if (!navigator.onLine) {
    return false;
  }
  return serverConnectivityCache.isOnline !== false; // Default to true if not checked yet
};


// Process a single pending operation
const processOperation = async (operation) => {
  try {
    let response;

    // Special handling for customer operations
    if (operation.type === 'create_customer' && operation.endpoint.includes('/customers/find-or-create')) {
      // For customer find-or-create, check if customer already exists in cache
      const cachedCustomers = await getCachedCustomers();
      const phone = operation.data?.phone?.replace(/\s+/g, '');
      const existingCustomer = cachedCustomers.find(c => 
        (c.phone || '').replace(/\s+/g, '') === phone
      );
      
      if (existingCustomer && !existingCustomer.id?.startsWith('OFFLINE-')) {
        // Customer already exists in DB (not offline), skip creation
        // Only add address if provided and it's new
        if (operation.data?.address) {
          try {
            // Check if address already exists
            const addressesResponse = await api.get(`/api/customers/${existingCustomer.id}/addresses`);
            const existingAddresses = addressesResponse.data?.data || [];
            const addressExists = existingAddresses.some(addr => 
              (addr.address || '').trim().toLowerCase() === operation.data.address.trim().toLowerCase()
            );
            
            if (!addressExists) {
              // Add new address only
              await api.post(`/api/customers/${existingCustomer.id}/addresses`, {
                address: operation.data.address.trim()
              });
            }
          } catch (addrError) {
            // Address might already exist or error, that's okay
          }
        }
        await markOperationComplete(operation.id);
        return { success: true, operation, response: { data: { data: existingCustomer } } };
      }
    }
    
    // Handle add_customer_address operations (only add address, don't update user)
    if (operation.type === 'add_customer_address' && operation.endpoint.includes('/addresses')) {
      try {
        // Check if address already exists before adding
        const customerId = operation.endpoint.split('/customers/')[1]?.split('/')[0];
        if (customerId) {
          const addressesResponse = await api.get(`/api/customers/${customerId}/addresses`);
          const existingAddresses = addressesResponse.data?.data || [];
          const addressExists = existingAddresses.some(addr => 
            (addr.address || '').trim().toLowerCase() === (operation.data?.address || '').trim().toLowerCase()
          );
          
          if (addressExists) {
            // Address already exists, skip
            await markOperationComplete(operation.id);
            return { success: true, operation, response: { data: { message: 'Address already exists' } }, skip: true };
          }
        }
      } catch (checkError) {
        // Continue with adding address if check fails
      }
    }

    // Handle delete_customer_address explicitly to allow offline queueing
    if (operation.type === 'delete_customer_address' && operation.endpoint.includes('/customers/addresses/')) {
      try {
        response = await api.delete(operation.endpoint);
        await markOperationComplete(operation.id);
        // Refresh customer cache if we know the customerId
        const customerId = operation.data?.customerId;
        if (customerId) {
          try {
            const updatedCustomer = await customerAPI.getById(customerId);
            if (updatedCustomer.data?.data) {
              await saveCustomer(updatedCustomer.data.data);
            }
          } catch (refreshErr) {
            // Silently handle refresh errors
          }
        }
        return { success: true, operation, response };
      } catch (delErr) {
        console.error('Failed to delete customer address:', delErr);
        throw delErr;
      }
    }

    // Normalize offline IDs for orders before sending to API
    // CRITICAL: When an order is synced, pending operations should have been updated with server ID
    // But if they weren't, we need to look up the server ID from the synced order
    const normalizeOrderIdInEndpoint = async (endpoint, operation) => {
      if (!endpoint) return endpoint;
      
      // Check if endpoint contains an OFFLINE- ID
      const offlineIdMatch = endpoint.match(/\/orders\/(OFFLINE-[^/]+)/);
      if (offlineIdMatch && offlineIdMatch[1]) {
        const offlineId = offlineIdMatch[1];
        
        // Try to find the synced order by offlineId to get the server ID
        try {
          const { openDB } = await import('../utils/offlineDB');
          const db = await openDB();
          const tx = db.transaction('orders', 'readonly');
          const store = tx.objectStore('orders');
          
          // First try to get by the offline ID directly
          let orderRequest = store.get(offlineId);
          let order = null;
          
          await new Promise((resolve) => {
            orderRequest.onsuccess = () => {
              order = orderRequest.result;
              resolve();
            };
            orderRequest.onerror = () => resolve();
          });
          
          // If not found, try to find by orderNumber (for orders that were synced)
          if (!order || !order.synced) {
            // Extract the real offline ID (without OFFLINE- prefix)
            const realOfflineId = offlineId.replace(/^OFFLINE-.*?-/, '').replace(/^OFFLINE-/, '');
            orderRequest = store.get(realOfflineId);
            await new Promise((resolve) => {
              orderRequest.onsuccess = () => {
                order = orderRequest.result;
                resolve();
              };
              orderRequest.onerror = () => resolve();
            });
          }
          
          // If we found a synced order, use its server ID
          if (order && order.synced && order.id && !order.id.startsWith('OFFLINE-')) {
            const serverId = order.id;
            return endpoint.replace(offlineId, serverId);
          }
          
          // If order not synced yet, try to use offlineId from operation data
          if (operation.data?.offlineId && typeof operation.data.offlineId === 'string') {
            const trimmed = operation.data.offlineId.replace(/^OFFLINE-.*?-/, '').replace(/^OFFLINE-/, '');
            return endpoint.replace(/OFFLINE-[^/]+/, trimmed);
          }
        } catch (lookupError) {
          // Silently handle lookup errors
        }
      }
      
      // Fallback: try to use offlineId from operation data
      if (operation.data?.offlineId && typeof operation.data.offlineId === 'string') {
        if (endpoint.includes('OFFLINE-')) {
          const trimmed = operation.data.offlineId.replace(/^OFFLINE-.*?-/, '').replace(/^OFFLINE-/, '');
          return endpoint.replace(/OFFLINE-[^/]+/, trimmed);
        }
      }
      
      return endpoint;
    };

    let endpointToUse = operation.endpoint;
    // For order-related operations, attempt to normalize the id
    if (operation.type && operation.type.includes('order')) {
      endpointToUse = await normalizeOrderIdInEndpoint(operation.endpoint, operation);
    }


    switch (operation.method) {
      case 'POST':
        response = await api.post(endpointToUse, operation.data);
        break;
      case 'PUT':
        response = await api.put(endpointToUse, operation.data);
        break;
      case 'PATCH':
        response = await api.patch(endpointToUse, operation.data);
        break;
      case 'DELETE':
        response = await api.delete(endpointToUse);
        break;
      default:
        throw new Error(`Unsupported method: ${operation.method}`);
    }

    // Mark operation as complete
    await markOperationComplete(operation.id);

    // If this was an order operation, mark the order as synced
    if (operation.type === 'create_order' && response.data?.data) {
      const serverOrder = response.data.data;
      await markOrderSynced(operation.data.id || operation.data.offlineId, serverOrder);
    } else if (operation.type === 'update_order' && response.data?.data) {
      const serverOrder = response.data.data;
      await markOrderSynced(operation.data.id, serverOrder);
    } else if (operation.type === 'mark_as_paid' && response.data?.data) {
      // If mark_as_paid succeeds, also mark order as synced if server order returned
      const serverOrder = response.data.data;
      await markOrderSynced(operation.data.id || operation.data.offlineId, serverOrder);
    } else if (operation.type === 'update_order_status' && response.data?.data) {
      const serverOrder = response.data.data;
      await markOrderSynced(operation.data.id || operation.data.offlineId, serverOrder);
    } else if (operation.type === 'update_delivery_status' && response.data?.data) {
      // If delivery status update succeeds, also mark order as synced
      const serverOrder = response.data.data;
      // CRITICAL: Use offlineId from operation to find the local order
      // The offlineId is the IndexedDB ID, not the server ID
      const offlineId = operation.offlineId || operation.data?.offlineId;
      const orderNumber = serverOrder.orderNumber || serverOrder.order_number;
      const idForMark = offlineId || orderNumber || serverOrder.id;
      
      if (!offlineId) {
        const match = operation.endpoint?.match(/\/orders\/([^/]+)\/delivery\/status/);
        if (match && match[1]) {
          const extractedId = match[1];
          if (extractedId.startsWith('OFFLINE-')) {
            const realOfflineId = extractedId.replace(/^OFFLINE-.*?-/, '').replace(/^OFFLINE-/, '');
            await markOrderSynced(realOfflineId, serverOrder);
          } else {
            await markOrderSynced(orderNumber || extractedId, serverOrder);
          }
        } else {
          await markOrderSynced(idForMark, serverOrder);
        }
      } else {
        await markOrderSynced(idForMark, serverOrder);
      }
    } else if (operation.type === 'create_customer' && response.data?.data) {
      // Update cached customer with server response
      const serverCustomer = response.data.data || response.data;
      if (serverCustomer && serverCustomer.id) {
        await cacheCustomers([serverCustomer]);
      }
    } else if (operation.type === 'update_customer_address') {
      // Refresh customer cache if possible
      const customerId = operation.endpoint.split('/')[3]; // /api/customers/{id}/addresses or /api/customers/addresses/{addressId}
      if (customerId) {
        try {
          const updatedCustomer = await customerAPI.getById(customerId);
          if (updatedCustomer.data?.data) {
            await saveCustomer(updatedCustomer.data.data);
          }
        } catch (refreshErr) {
          // Silently handle refresh errors
        }
      }
    }

    return { success: true, operation, response };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    
    // Check if it's a validation error that shouldn't be retried
    const isTableOccupied = errorMessage.toLowerCase().includes('table') && 
                           (errorMessage.toLowerCase().includes('occupied') || 
                            errorMessage.toLowerCase().includes('already'));
    
    // Check if customer already exists (not an error, just skip)
    const isCustomerExists = errorMessage.toLowerCase().includes('customer') && 
                             (errorMessage.toLowerCase().includes('already') ||
                              errorMessage.toLowerCase().includes('exists'));
    
    if (isTableOccupied || isCustomerExists) {
      await markOperationComplete(operation.id);
      return { success: false, operation, error: errorMessage, skip: true };
    }

    // Mark as failed (will retry if retryCount < MAX_RETRIES)
    await markOperationFailed(operation.id, error);
    return { success: false, operation, error: errorMessage };
  }
};

// Sync pending operations queue
export const syncPendingOperations = async () => {
  if (!isOnline()) {
    return { synced: 0, failed: 0, errors: [] };
  }

  const pendingOps = await getPendingOperations();
  if (pendingOps.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  const results = {
    synced: 0,
    failed: 0,
    errors: []
  };

  // Process in batches to avoid overwhelming the server
  for (let i = 0; i < pendingOps.length; i += SYNC_BATCH_SIZE) {
    const batch = pendingOps.slice(i, i + SYNC_BATCH_SIZE);
    const batchPromises = batch.map(op => processOperation(op));
    const batchResults = await Promise.allSettled(batchPromises);

    batchResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          results.synced++;
        } else if (!result.value.skip) {
          results.failed++;
          results.errors.push({
            operationId: result.value.operation.id,
            error: result.value.error
          });
        }
      } else {
        results.failed++;
        results.errors.push({
          operationId: batch[idx].id,
          error: result.reason?.message || 'Unknown error'
        });
      }
    });

    // Small delay between batches
    if (i + SYNC_BATCH_SIZE < pendingOps.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
};

// Fetch and cache menu items
export const syncMenuItems = async () => {
  try {
    const response = await api.get('/api/menu-items');
    const menuItems = response.data.data || response.data || [];
    await cacheMenuItems(menuItems);
    return menuItems;
  } catch (error) {
    console.error('[Sync] Failed to sync menu items:', error);
    // Return cached data on error
    return await getCachedMenuItems();
  }
};

// Fetch and cache categories
export const syncCategories = async () => {
  try {
    const response = await api.get('/api/categories');
    const categories = response.data.data || response.data || [];
    await cacheCategories(categories);
    return categories;
  } catch (error) {
    console.error('[Sync] Failed to sync categories:', error);
    return await getCachedCategories();
  }
};

// Fetch and cache customers with their addresses
export const syncCustomers = async () => {
  try {
    // Fetch customers with pagination to get all customers
    let allCustomers = [];
    let page = 1;
    const limit = 100; // Fetch 100 at a time
    let hasMore = true;

    while (hasMore) {
      const response = await api.get('/api/customers', {
        params: { page, limit }
      });
      const data = response.data.data || response.data || {};
      const customers = data.customers || (Array.isArray(data) ? data : []);
      
      if (Array.isArray(customers) && customers.length > 0) {
        allCustomers = [...allCustomers, ...customers];
        // Check if there are more pages
        hasMore = customers.length === limit;
        page++;
      } else {
        hasMore = false;
      }
    }


    // Fetch addresses for each customer and enrich customer data
    // Process in batches to avoid overwhelming the server
    const BATCH_SIZE = 10; // Process 10 customers at a time
    const customersWithAddresses = [];
    const syncTime = new Date().toISOString();

    for (let i = 0; i < allCustomers.length; i += BATCH_SIZE) {
      const batch = allCustomers.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (customer) => {
          try {
            // Fetch addresses for this customer
            const addressesResponse = await customerAPI.getAddresses(customer.id);
            const addresses = addressesResponse.data?.data || addressesResponse.data || [];
            
            return {
              ...customer,
              addresses: Array.isArray(addresses) ? addresses : [],
              lastSynced: syncTime
            };
          } catch (addrError) {
            return {
              ...customer,
              addresses: customer.addresses || [],
              lastSynced: syncTime
            };
          }
        })
      );
      customersWithAddresses.push(...batchResults);
      
      // Small delay between batches to avoid overwhelming the server
      if (i + BATCH_SIZE < allCustomers.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    await cacheCustomers(customersWithAddresses);
    return customersWithAddresses;
  } catch (error) {
    console.error('[Sync] Failed to sync customers:', error);
    return await getCachedCustomers();
  }
};

// Fetch and cache table availability
export const syncTableAvailability = async () => {
  try {
    const response = await api.get('/api/orders/dine-in/tables/availability');
    const occupiedTables = response.data.data?.occupied_tables || response.data.data || [];
    // Normalize table structure to ensure consistent format
    const normalizedTables = occupiedTables.map(t => ({
      tableNumber: t.tableNumber || t.table_number,
      id: t.id,
      orderId: t.id,
      orderNumber: t.orderNumber || t.order_number
    }));
    await cacheTableAvailability(normalizedTables);
    return normalizedTables;
  } catch (error) {
    console.error('[Sync] Failed to sync table availability:', error);
    return await getCachedTableAvailability();
  }
};

// Fetch and cache orders (recent orders to keep cache fresh)
export const syncOrders = async (filters = {}) => {
  try {
    // Fetch recent orders - get multiple pages if needed
    let allOrders = [];
    let page = 1;
    const limit = 100; // Fetch 100 at a time
    let hasMore = true;
    const maxPages = 5; // Limit to 5 pages (500 orders max) to avoid loading too much

    while (hasMore && page <= maxPages) {
      const params = {
        page,
        limit,
        ...filters
      };

      const response = await api.get('/api/orders', { params });
      const data = response.data.data || response.data || {};
      const orders = data.orders || (Array.isArray(data) ? data : []);
      
      if (Array.isArray(orders) && orders.length > 0) {
        allOrders = [...allOrders, ...orders];
        // Check if there are more pages
        hasMore = orders.length === limit;
        page++;
      } else {
        hasMore = false;
      }
    }


    // Update orders in IndexedDB
    const db = await import('../utils/offlineDB').then(m => m.openDB());
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');

    for (const order of allOrders) {
      await store.put({
        ...order,
        synced: true,
        updatedAt: new Date().toISOString()
      });
    }

    await updateSyncMetadata('orders', new Date().toISOString());
    return allOrders;
  } catch (error) {
    console.error('[Sync] Failed to sync orders:', error);
    return await getAllOrders();
  }
};

// Fetch and cache delivery orders specifically
export const syncDeliveryOrders = async (filters = {}) => {
  try {
    let allDeliveryOrders = [];
    
    // Fetch both pending and completed delivery orders
    const statuses = ['pending', 'completed'];
    
    for (const status of statuses) {
      try {
        const params = {
          status,
          ...filters
        };

        const response = await ordersAPI.getDeliveryOrders(params);
        const deliveryOrders = response.data?.data || response.data || [];
        
        if (Array.isArray(deliveryOrders)) {
          allDeliveryOrders = [...allDeliveryOrders, ...deliveryOrders];
        }
      } catch (statusError) {
        // Continue with other statuses
      }
    }
    
    if (allDeliveryOrders.length === 0) {
      return [];
    }

    // Update orders in IndexedDB
    const db = await import('../utils/offlineDB').then(m => m.openDB());
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');

    for (const order of allDeliveryOrders) {
      const normalizedOrder = { ...order };
      // Keep server statuses as-is for delivery; do not auto-upgrade based solely on payment status
      
      // Check if local order exists and preserve offline status updates
      // Try multiple matching strategies: by orderNumber, or by characteristics for unsynced orders
      const orderNumber = normalizedOrder.orderNumber || normalizedOrder.order_number;
      let localOrder = null;
      
      // Strategy 1: Match by orderNumber (for orders that have synced before)
      if (orderNumber) {
        const index = store.index('orderNumber');
        const localOrderRequest = index.get(orderNumber);
        await new Promise((resolve) => {
          localOrderRequest.onsuccess = () => {
            localOrder = localOrderRequest.result;
            resolve();
          };
          localOrderRequest.onerror = () => resolve();
        });
      }
      
      // Strategy 2: If no match by orderNumber, try to find unsynced orders by matching characteristics
      // This handles newly created orders that haven't synced yet and don't have orderNumber
      if (!localOrder) {
        const orderType = normalizedOrder.orderType || normalizedOrder.order_type;
        const customerId = normalizedOrder.customerId || normalizedOrder.customer_id;
        const deliveryAddress = normalizedOrder.deliveryAddress || normalizedOrder.delivery_address;
        const createdAt = normalizedOrder.createdAt || normalizedOrder.created_at;
        
        if (orderType === 'delivery' && (customerId || deliveryAddress)) {
          // Search all unsynced orders
          const allOrdersRequest = store.getAll();
          await new Promise((resolve) => {
            allOrdersRequest.onsuccess = () => {
              const allOrders = allOrdersRequest.result || [];
              // Find unsynced delivery orders with matching characteristics
              const matchingOrder = allOrders.find(o => {
                const oData = o.data || o;
                const isUnsynced = !o.synced;
                const isDelivery = (oData.orderType || oData.order_type) === 'delivery';
                const matchesCustomer = customerId && (oData.customerId || oData.customer_id) === customerId;
                const matchesAddress = deliveryAddress && (oData.deliveryAddress || oData.delivery_address) === deliveryAddress;
                const oCreatedAt = oData.createdAt || oData.created_at || o.createdAt;
                const matchesTime = createdAt && oCreatedAt && Math.abs(new Date(oCreatedAt).getTime() - new Date(createdAt).getTime()) < 60000; // Within 1 minute
                
                return isUnsynced && isDelivery && (matchesCustomer || (matchesAddress && matchesTime));
              });
              
              if (matchingOrder) {
                localOrder = matchingOrder;
              }
              resolve();
            };
            allOrdersRequest.onerror = () => resolve();
          });
        }
      }
      
      // Preserve local status if found
      if (localOrder) {
        const localData = localOrder.data || localOrder;
        const localDeliveryStatus = localData.deliveryStatus || localData.delivery_status;
        const localOrderStatus = localData.orderStatus || localData.order_status;
        const localPaymentStatus = localData.paymentStatus || localData.payment_status;
        const offlineStatusUpdated = localData.offlineStatusUpdated || localOrder.offlineStatusUpdated;
        const orderStatus = normalizedOrder.orderStatus || normalizedOrder.order_status || 'pending';
        const paymentStatus = normalizedOrder.paymentStatus || normalizedOrder.payment_status || 'pending';
        
        // Status hierarchies for comparison
        const orderStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'];
        const deliveryStatusHierarchy = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
        
        // CRITICAL: If offlineStatusUpdated flag is set, ALWAYS preserve the local status
        // This ensures that manually updated offline statuses are never overwritten
        if (offlineStatusUpdated) {
          if (localDeliveryStatus && localDeliveryStatus !== 'pending') {
            normalizedOrder.deliveryStatus = localDeliveryStatus;
            normalizedOrder.delivery_status = localDeliveryStatus;
          }
          
          if (localOrderStatus && localOrderStatus !== 'pending') {
            normalizedOrder.orderStatus = localOrderStatus;
            normalizedOrder.order_status = localOrderStatus;
          }
          
          if (localPaymentStatus === 'completed') {
            normalizedOrder.paymentStatus = 'completed';
            normalizedOrder.payment_status = 'completed';
          }
          
          normalizedOrder.offlineStatusUpdated = true;
        } else {
          if (localDeliveryStatus && localDeliveryStatus !== 'pending') {
            const serverDeliveryStatus = normalizedOrder.deliveryStatus || normalizedOrder.delivery_status || 'pending';
            const localDeliveryIndex = deliveryStatusHierarchy.indexOf(localDeliveryStatus);
            const serverDeliveryIndex = serverDeliveryStatus ? deliveryStatusHierarchy.indexOf(serverDeliveryStatus) : -1;
            
            if (localDeliveryIndex > serverDeliveryIndex || !serverDeliveryStatus || serverDeliveryStatus === 'pending') {
              normalizedOrder.deliveryStatus = localDeliveryStatus;
              normalizedOrder.delivery_status = localDeliveryStatus;
            }
          }
          
          if (localOrderStatus && localOrderStatus !== 'pending' && localOrderStatus !== orderStatus) {
            const localIndex = orderStatusHierarchy.indexOf(localOrderStatus);
            const serverIndex = orderStatusHierarchy.indexOf(orderStatus);
            
            if (localIndex > serverIndex || orderStatus === 'pending') {
              normalizedOrder.orderStatus = localOrderStatus;
              normalizedOrder.order_status = localOrderStatus;
            }
          }
          
          if (localPaymentStatus === 'completed' && paymentStatus !== 'completed') {
            normalizedOrder.paymentStatus = 'completed';
            normalizedOrder.payment_status = 'completed';
          }
        }
      }
      
      // Store the normalized order (with preserved offline status if applicable)
      // CRITICAL: Use the existing order's ID if it exists to avoid creating duplicates
      const orderIdToUse = localOrder?.id || normalizedOrder.id;
      await store.put({
        ...normalizedOrder,
        id: orderIdToUse, // Use existing ID to update, not create new
        synced: true,
        updatedAt: new Date().toISOString()
      });
    }

    await updateSyncMetadata('deliveryOrders', new Date().toISOString());
    return allDeliveryOrders;
  } catch (error) {
    console.error('[Sync] Failed to sync delivery orders:', error);
    // Return cached delivery orders on error
    const allOrders = await getAllOrders();
    return allOrders.filter(order => 
      order.orderType === 'delivery' || order.order_type === 'delivery'
    );
  }
};

// Fetch and cache dine-in orders specifically
export const syncDineInOrders = async (filters = {}) => {
  try {
    let allDineInOrders = [];
    
    // Fetch both pending and completed dine-in orders
    const statuses = ['pending', 'completed'];
    
    for (const status of statuses) {
      try {
        const params = {
          status,
          ...filters
        };

        const response = await ordersAPI.getDineInOrders(params);
        const dineInOrders = response.data?.data || response.data || [];
        
        if (Array.isArray(dineInOrders)) {
          allDineInOrders = [...allDineInOrders, ...dineInOrders];
        }
      } catch (statusError) {
        // Continue with other statuses
      }
    }
    
    if (allDineInOrders.length === 0) {
      return [];
    }

    // Update orders in IndexedDB
    const db = await import('../utils/offlineDB').then(m => m.openDB());
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');

    for (const order of allDineInOrders) {
      // Check if payment is completed but orderStatus is still pending
      // If so, update orderStatus to completed to match paymentStatus
      const normalizedOrder = { ...order };
      
      // Normalize status fields
      const paymentStatus = normalizedOrder.paymentStatus || normalizedOrder.payment_status || 'pending';
      const orderStatus = normalizedOrder.orderStatus || normalizedOrder.order_status || 'pending';
      
      // If payment is completed, ensure orderStatus is also completed
      if (paymentStatus === 'completed' && orderStatus !== 'completed' && orderStatus !== 'cancelled') {
        normalizedOrder.orderStatus = 'completed';
        normalizedOrder.order_status = 'completed';
      }
      
      // Check if local order exists and preserve offline status updates
      // Match by orderNumber since local orders have OFFLINE- IDs but server orders have numeric IDs
      const orderNumber = normalizedOrder.orderNumber || normalizedOrder.order_number;
      if (orderNumber) {
        // Search for local order by orderNumber
        const index = store.index('orderNumber');
        const localOrderRequest = index.get(orderNumber);
        await new Promise((resolve) => {
          localOrderRequest.onsuccess = () => {
            const localOrder = localOrderRequest.result;
            if (localOrder) {
              const localData = localOrder.data || localOrder;
              const localOrderStatus = localData.orderStatus || localData.order_status;
              const localPaymentStatus = localData.paymentStatus || localData.payment_status;
              const offlineStatusUpdated = localData.offlineStatusUpdated;
              
              // Preserve offline status updates
              if (offlineStatusUpdated) {
                // Preserve orderStatus if it was updated offline and is more advanced
                if (localOrderStatus && localOrderStatus !== 'pending' && localOrderStatus !== orderStatus) {
                  const statusHierarchy = ['pending', 'preparing', 'ready', 'completed'];
                  const localIndex = statusHierarchy.indexOf(localOrderStatus);
                  const serverIndex = statusHierarchy.indexOf(orderStatus);
                  
                  if (localIndex > serverIndex) {
                    normalizedOrder.orderStatus = localOrderStatus;
                    normalizedOrder.order_status = localOrderStatus;
                  }
                }
                
                if (localPaymentStatus === 'completed' && paymentStatus !== 'completed') {
                  normalizedOrder.paymentStatus = 'completed';
                  normalizedOrder.payment_status = 'completed';
                }
              }
            }
            resolve();
          };
          localOrderRequest.onerror = () => resolve();
        });
      }
      
      await store.put({
        ...normalizedOrder,
        synced: true,
        updatedAt: new Date().toISOString()
      });
    }

    await updateSyncMetadata('dineInOrders', new Date().toISOString());
    return allDineInOrders;
  } catch (error) {
    console.error('[Sync] Failed to sync dine-in orders:', error);
    // Return cached dine-in orders on error
    const allOrders = await getAllOrders();
    return allOrders.filter(order => 
      order.orderType === 'dine_in' || order.order_type === 'dine_in' || order.orderType === 'dine-in'
    );
  }
};

// Complete sync cycle: push pending ops + fetch fresh data
export const performFullSync = async () => {
  if (syncInProgress) {
    return;
  }

  if (!isOnline()) {
    return;
  }

  syncInProgress = true;
  const startTime = Date.now();

  try {
    const opResults = await syncPendingOperations();

    // 2. Then fetch fresh data (in parallel where possible)
    // Note: syncCustomers now includes addresses, so it may take longer
    const [menuItems, categories, customers] = await Promise.all([
      syncMenuItems(),
      syncCategories(),
      syncCustomers(), // This now fetches and caches customer addresses too
      syncTableAvailability() // Sync tables but don't need to store result
    ]);


    // 3. Sync recent orders (including delivery and dine-in orders)
    // Always sync orders to keep cache fresh, but check last sync time to avoid too frequent syncing
    const lastOrderSync = await getSyncMetadata('orders');
    const lastDeliveryOrderSync = await getSyncMetadata('deliveryOrders');
    const lastDineInOrderSync = await getSyncMetadata('dineInOrders');
    const shouldSyncOrders = !lastOrderSync || 
                            (Date.now() - new Date(lastOrderSync).getTime()) > 30000; // 30 seconds
    const shouldSyncDeliveryOrders = !lastDeliveryOrderSync || 
                                    (Date.now() - new Date(lastDeliveryOrderSync).getTime()) > 30000; // 30 seconds
    const shouldSyncDineInOrders = !lastDineInOrderSync || 
                                   (Date.now() - new Date(lastDineInOrderSync).getTime()) > 30000; // 30 seconds

    if (shouldSyncOrders) {
      await syncOrders();
    }

    if (shouldSyncDeliveryOrders) {
      await syncDeliveryOrders();
    }

    if (shouldSyncDineInOrders) {
      await syncDineInOrders();
    }

    lastSyncTime = new Date().toISOString();
    await updateSyncMetadata('lastFullSync', lastSyncTime);

    const duration = Date.now() - startTime;

    return {
      success: true,
      operations: opResults,
      menuItems: menuItems.length,
      categories: categories.length,
      customers: customers.length,
      duration
    };
  } catch (error) {
    console.error('[Sync] Full sync failed:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    syncInProgress = false;
  }
};

// Start automatic sync polling
export const startAutoSync = (onSyncComplete) => {
  if (syncIntervalId) {
    return;
  }

  let lastDataSync = 0;

  if (isOnline()) {
    setTimeout(() => {
      performFullSync().then((result) => {
        lastDataSync = Date.now();
        if (onSyncComplete) {
          onSyncComplete(result);
        }
      });
    }, 2000);
  }

  // Set up polling interval
  syncIntervalId = setInterval(async () => {
    if (isOnline() && !syncInProgress) {
      const now = Date.now();
      
      if (now - lastDataSync >= DATA_SYNC_INTERVAL) {
        lastDataSync = now;
        const result = await performFullSync();
        if (onSyncComplete) {
          onSyncComplete(result);
        }
      } else {
        const opResults = await syncPendingOperations();
        if (opResults.synced > 0 && onSyncComplete) {
          onSyncComplete({ success: true, operations: opResults });
        }
      }
    }
  }, SYNC_INTERVAL);

  // Background cache cleanup every 30s when online (skip auth/session stores)
  if (!cacheClearIntervalId) {
    cacheClearIntervalId = setInterval(() => {
      if (isOnline()) {
        clearAllCache().catch((err) => console.warn('[CacheCleanup] Failed to clear cache:', err));
      }
    }, 30000);
  }

  const onlineHandler = () => {
    lastDataSync = 0;
    setTimeout(() => {
      performFullSync().then((result) => {
        lastDataSync = Date.now();
        if (onSyncComplete) {
          onSyncComplete(result);
        }
      });
    }, 1000);
  };

  window.addEventListener('online', onlineHandler);

  const visibilityHandler = () => {
    if (document.visibilityState === 'visible' && isOnline() && !syncInProgress) {
      const now = Date.now();
      if (now - lastDataSync >= 60000) {
        lastDataSync = now;
        setTimeout(() => {
          performFullSync().then((result) => {
            if (onSyncComplete) {
              onSyncComplete(result);
            }
          });
        }, 500);
      } else {
        syncPendingOperations();
      }
    }
  };

  document.addEventListener('visibilitychange', visibilityHandler);

  // Return cleanup function
  return () => {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
    if (cacheClearIntervalId) {
      clearInterval(cacheClearIntervalId);
      cacheClearIntervalId = null;
    }
    window.removeEventListener('online', onlineHandler);
    document.removeEventListener('visibilitychange', visibilityHandler);
  };
};

// Stop automatic sync
export const stopAutoSync = () => {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
};

// Force sync now (manual trigger)
export const forceSyncNow = async () => {
  if (!isOnline()) {
    throw new Error('Cannot sync: Device is offline');
  }
  return await performFullSync();
};

// Get sync status
export const getSyncStatus = async () => {
  const pendingOps = await getPendingOperations();
  const lastSync = await getSyncMetadata('lastFullSync');
  
  return {
    online: isOnline(),
    syncInProgress,
    pendingOperations: pendingOps.length,
    lastSyncTime: lastSync
  };
};

// Export for use in components
const offlineSyncService = {
  isOnline,
  syncPendingOperations,
  performFullSync,
  startAutoSync,
  stopAutoSync,
  forceSyncNow,
  getSyncStatus,
  syncMenuItems,
  syncCategories,
  syncCustomers,
  syncTableAvailability,
  syncOrders,
  syncDeliveryOrders,
  syncDineInOrders
};

export default offlineSyncService;


