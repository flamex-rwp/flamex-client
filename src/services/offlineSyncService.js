// Unified offline sync service for complete PWA offline-first architecture
import api from './api';
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
  getSyncMetadata
} from '../utils/offlineDB';

// Sync configuration
const SYNC_INTERVAL = 8000; // 8 seconds polling interval
const MAX_RETRIES = 3;
const SYNC_BATCH_SIZE = 5; // Process 5 operations at a time

// Global sync state
let syncInProgress = false;
let syncIntervalId = null;
let lastSyncTime = null;

// Check if online
export const isOnline = () => {
  return navigator.onLine;
};

// Transform order data to match backend API schema
const transformOrderForAPI = (order) => {
  return {
    items: (order.items || order.orderItems || []).map(item => ({
      menuItemId: item.menuItemId || item.id,
      quantity: parseInt(item.quantity) || 1,
      price: parseFloat(item.price) || 0
    })),
    totalAmount: parseFloat(order.totalAmount || order.total_amount || 0),
    paymentMethod: order.paymentMethod || order.payment_method || 'cash',
    amountTaken: order.amountTaken || order.amount_taken ? parseFloat(order.amountTaken || order.amount_taken) : undefined,
    returnAmount: order.returnAmount || order.return_amount ? parseFloat(order.returnAmount || order.return_amount) : undefined,
    orderType: order.orderType || order.order_type || 'dine_in',
    customerId: order.customerId || order.customer_id,
    deliveryAddress: order.deliveryAddress || order.delivery_address,
    deliveryNotes: order.deliveryNotes || order.delivery_notes,
    deliveryCharge: order.deliveryCharge || order.delivery_charge ? parseFloat(order.deliveryCharge || order.delivery_charge) : 0,
    paymentStatus: order.paymentStatus || order.payment_status || 'pending',
    specialInstructions: order.specialInstructions || order.special_instructions,
    tableNumber: order.tableNumber || order.table_number,
    discountPercent: order.discountPercent || order.discount_percent || 0
  };
};

// Process a single pending operation
const processOperation = async (operation) => {
  try {
    let response;

    switch (operation.method) {
      case 'POST':
        response = await api.post(operation.endpoint, operation.data);
        break;
      case 'PUT':
        response = await api.put(operation.endpoint, operation.data);
        break;
      case 'PATCH':
        response = await api.patch(operation.endpoint, operation.data);
        break;
      case 'DELETE':
        response = await api.delete(operation.endpoint);
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
    }

    return { success: true, operation, response };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    
    // Check if it's a validation error that shouldn't be retried
    const isTableOccupied = errorMessage.toLowerCase().includes('table') && 
                           (errorMessage.toLowerCase().includes('occupied') || 
                            errorMessage.toLowerCase().includes('already'));
    
    if (isTableOccupied) {
      // Table conflict - mark as complete to prevent retries
      await markOperationComplete(operation.id);
      console.warn(`⚠️ Operation ${operation.id} rejected: ${errorMessage}`);
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

  console.log(`[Sync] Processing ${pendingOps.length} pending operations...`);

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

// Fetch and cache customers
export const syncCustomers = async () => {
  try {
    const response = await api.get('/api/customers');
    const data = response.data.data || response.data || {};
    const customers = data.customers || data || [];
    await cacheCustomers(Array.isArray(customers) ? customers : []);
    return customers;
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
    await cacheTableAvailability(occupiedTables);
    return occupiedTables;
  } catch (error) {
    console.error('[Sync] Failed to sync table availability:', error);
    return await getCachedTableAvailability();
  }
};

// Fetch and cache orders (only recent ones to avoid loading too much)
export const syncOrders = async (filters = {}) => {
  try {
    const params = {
      page: 1,
      limit: 100, // Sync last 100 orders
      ...filters
    };

    const response = await api.get('/api/orders', { params });
    const data = response.data.data || response.data || {};
    const orders = data.orders || data || [];

    // Update orders in IndexedDB
    const db = await import('../utils/offlineDB').then(m => m.openDB());
    const tx = db.transaction('orders', 'readwrite');
    const store = tx.objectStore('orders');

    for (const order of orders) {
      await store.put({
        ...order,
        synced: true,
        updatedAt: new Date().toISOString()
      });
    }

    await updateSyncMetadata('orders', new Date().toISOString());
    return orders;
  } catch (error) {
    console.error('[Sync] Failed to sync orders:', error);
    return await getAllOrders();
  }
};

// Complete sync cycle: push pending ops + fetch fresh data
export const performFullSync = async () => {
  if (syncInProgress) {
    console.log('[Sync] Sync already in progress, skipping...');
    return;
  }

  if (!isOnline()) {
    console.log('[Sync] Offline, skipping sync');
    return;
  }

  syncInProgress = true;
  const startTime = Date.now();

  try {
    console.log('[Sync] Starting full sync cycle...');

    // 1. First, sync pending operations
    const opResults = await syncPendingOperations();
    console.log(`[Sync] Operations: ${opResults.synced} synced, ${opResults.failed} failed`);

    // 2. Then fetch fresh data (in parallel where possible)
    const [menuItems, categories, customers, tables] = await Promise.all([
      syncMenuItems(),
      syncCategories(),
      syncCustomers(),
      syncTableAvailability()
    ]);

    console.log(`[Sync] Data synced: ${menuItems.length} menu items, ${categories.length} categories, ${customers.length} customers`);

    // 3. Sync recent orders (only if we have pending operations or it's been a while)
    const lastOrderSync = await getSyncMetadata('orders');
    const shouldSyncOrders = opResults.synced > 0 || 
                            !lastOrderSync || 
                            (Date.now() - new Date(lastOrderSync).getTime()) > 60000; // 1 minute

    if (shouldSyncOrders) {
      await syncOrders();
    }

    lastSyncTime = new Date().toISOString();
    await updateSyncMetadata('lastFullSync', lastSyncTime);

    const duration = Date.now() - startTime;
    console.log(`[Sync] Full sync completed in ${duration}ms`);

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
    console.log('[Sync] Auto-sync already running');
    return;
  }

  console.log('[Sync] Starting auto-sync with', SYNC_INTERVAL, 'ms interval');

  // Initial sync
  if (isOnline()) {
    setTimeout(() => performFullSync().then(onSyncComplete), 2000);
  }

  // Set up polling interval
  syncIntervalId = setInterval(async () => {
    if (isOnline() && !syncInProgress) {
      const result = await performFullSync();
      if (onSyncComplete) {
        onSyncComplete(result);
      }
    }
  }, SYNC_INTERVAL);

  // Sync when coming online
  const onlineHandler = () => {
    console.log('[Sync] Device came online, triggering sync...');
    setTimeout(() => performFullSync().then(onSyncComplete), 1000);
  };

  window.addEventListener('online', onlineHandler);

  // Sync when app becomes visible
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible' && isOnline() && !syncInProgress) {
      console.log('[Sync] App became visible, triggering sync...');
      setTimeout(() => performFullSync().then(onSyncComplete), 500);
    }
  };

  document.addEventListener('visibilitychange', visibilityHandler);

  // Return cleanup function
  return () => {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
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
    console.log('[Sync] Auto-sync stopped');
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
export default {
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
  syncOrders
};


