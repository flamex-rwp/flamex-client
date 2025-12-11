// Offline sync utility for syncing data when internet is restored
import { getOfflineOrders, deleteOfflineOrder, markOrderSynced } from './offlineDB';
import api from '../services/api';

// Global sync lock to prevent duplicate syncing
let globalSyncInProgress = false;
let lastSyncTimestamp = 0;
const MIN_SYNC_INTERVAL = 3000; // Minimum 3 seconds between syncs

// Check if the browser is online
export const isOnline = () => {
  return navigator.onLine;
};

// Sync all offline orders to the server
export const syncOfflineOrders = async () => {
  // Check if sync is already in progress
  if (globalSyncInProgress) {
    console.log('Sync already in progress, skipping...');
    return { success: false, message: 'Sync already in progress' };
  }

  // Check if minimum time has passed since last sync
  const now = Date.now();
  if (now - lastSyncTimestamp < MIN_SYNC_INTERVAL) {
    console.log('Sync called too soon after last sync, skipping...');
    return { success: false, message: 'Sync throttled' };
  }

  if (!isOnline()) {
    console.log('Cannot sync: Device is offline');
    return { success: false, message: 'Device is offline' };
  }

  // Set global lock
  globalSyncInProgress = true;
  lastSyncTimestamp = now;

  try {
    const offlineOrders = await getOfflineOrders();
    const pendingOrders = offlineOrders.filter(order => !order.synced);

    if (pendingOrders.length === 0) {
      console.log('No pending orders to sync');
      return { success: true, synced: 0, message: 'No pending orders' };
    }

    console.log(`Syncing ${pendingOrders.length} offline orders...`);

    let syncedCount = 0;
    let failedCount = 0;
    const errors = [];

    for (const order of pendingOrders) {
      try {
        // Transform order data to match backend API schema
        const transformedData = {
          items: (order.data.items || []).map(item => ({
            menuItemId: item.id || item.menuItemId,
            quantity: item.quantity,
            price: parseFloat(item.price) // Convert to number
          })),
          totalAmount: order.data.total_amount || order.data.totalAmount,
          paymentMethod: order.data.payment_method || order.data.paymentMethod || 'cash',
          amountTaken: order.data.amount_taken || order.data.amountTaken || undefined,
          returnAmount: order.data.return_amount || order.data.returnAmount || undefined,
          orderType: order.data.order_type || order.data.orderType || 'dine_in',
          customerId: order.data.customer_id || order.data.customerId || undefined,
          deliveryAddress: order.data.delivery_address || order.data.deliveryAddress || undefined,
          deliveryNotes: order.data.delivery_notes || order.data.deliveryNotes || undefined,
          deliveryCharge: order.data.delivery_charge !== undefined ? order.data.delivery_charge : (order.data.deliveryCharge !== undefined ? order.data.deliveryCharge : 0),
          paymentStatus: order.data.payment_status || order.data.paymentStatus || 'pending',
          specialInstructions: order.data.special_instructions || order.data.specialInstructions || undefined,
          tableNumber: order.data.table_number || order.data.tableNumber || undefined
        };

        // Remove undefined values
        Object.keys(transformedData).forEach(key => {
          if (transformedData[key] === undefined) {
            delete transformedData[key];
          }
        });

        // Try to submit the order to the server
        const response = await api.post('/api/orders', transformedData);

        if (response.status === 201 || response.status === 200) {
          // Mark order as synced instead of deleting (keep for records)
          // CRITICAL: Pass the server order response to markOrderSynced so it can update pending operations
          const serverOrder = response.data?.data || response.data;
          if (serverOrder) {
            await markOrderSynced(order.id, serverOrder);
          } else {
            await markOrderSynced(order.id);
          }
          syncedCount++;
          console.log(`Order ${order.id} synced successfully`);
        } else {
          failedCount++;
          errors.push({
            orderId: order.id,
            error: 'Unexpected response status: ' + response.status
          });
        }
      } catch (error) {
        failedCount++;
        const errorData = error.response?.data || {};
        const errorMessage = errorData.message || error.message || '';

        // Check if error is "Table already occupied"
        const isTableOccupied = errorMessage.toLowerCase().includes('table') &&
          (errorMessage.toLowerCase().includes('occupied') ||
            errorMessage.toLowerCase().includes('already'));

        if (isTableOccupied) {
          // Table is occupied - mark this order as synced to prevent retrying
          // This is a valid backend rejection, not a sync failure
          // Note: No server order data available, so just mark as synced without updating operations
          await markOrderSynced(order.id);
          console.warn(`⚠️ Order ${order.id} rejected: ${errorMessage}`);
          console.warn(`   This order will not be retried. Table may have been reused.`);

          // Don't count this as a failure since backend correctly validated the request
          failedCount--;
          continue; // Skip error logging for this specific case
        }

        // Log detailed error information for other errors
        console.error(`❌ Failed to sync order ${order.id}:`);
        console.error('Response:', errorData);
        console.error('Validation errors:', errorData.errors);

        // If errors array exists, log each error detail
        if (Array.isArray(errorData.errors)) {
          errorData.errors.forEach((err, index) => {
            console.error(`  Error ${index + 1}:`, {
              field: err.field || err.path,
              message: err.message,
              code: err.code,
              received: err.received,
              expected: err.expected
            });
          });
        }


        errors.push({
          orderId: order.id,
          error: errorData.message || error.message,
          details: errorData.errors
        });
      }
    }

    if (syncedCount > 0) {
      console.log(`✅ Successfully synced ${syncedCount} orders`);
    }
    if (failedCount > 0) {
      console.error(`❌ Failed to sync ${failedCount} orders. See details above.`);
    }

    const message = `Synced ${syncedCount} orders. ${failedCount > 0 ? `${failedCount} failed.` : ''}`;

    return {
      success: failedCount === 0,
      synced: syncedCount,
      failed: failedCount,
      errors: errors,
      message: message
    };
  } catch (error) {
    console.error('Error syncing offline orders:', error);
    return {
      success: false,
      synced: 0,
      failed: 0,
      errors: [{ error: error.message }],
      message: 'Failed to sync orders: ' + error.message
    };
  } finally {
    // Always release lock
    globalSyncInProgress = false;
  }
};

// Start automatic sync when online
export const startAutoSync = (onSyncComplete) => {
  const performSync = async () => {
    try {
      const result = await syncOfflineOrders();
      if (onSyncComplete && result.synced > 0) {
        onSyncComplete(result);
      }
    } catch (error) {
      console.error('Auto-sync failed:', error);
    }
  };

  // Sync when online status changes
  const onlineHandler = () => {
    console.log('Device is online - starting sync...');
    setTimeout(performSync, 1000);
  };

  window.addEventListener('online', onlineHandler);

  // Sync on page visibility change
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible' && isOnline()) {
      console.log('App became visible and online - checking for pending orders...');
      setTimeout(performSync, 500);
    }
  };

  document.addEventListener('visibilitychange', visibilityHandler);

  // Initial sync if online
  if (isOnline()) {
    setTimeout(performSync, 2000);
  }

  // Return cleanup function
  return () => {
    window.removeEventListener('online', onlineHandler);
    document.removeEventListener('visibilitychange', visibilityHandler);
  };
};

// Register for background sync (if supported)
export const registerBackgroundSync = async () => {
  if ('serviceWorker' in navigator && 'sync' in window.registration) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-offline-orders');
      console.log('Background sync registered');
      return true;
    } catch (error) {
      console.error('Failed to register background sync:', error);
      return false;
    }
  } else {
    console.log('Background sync not supported');
    return false;
  }
};

// Check if there are pending orders to sync
export const hasPendingOrders = async () => {
  try {
    const offlineOrders = await getOfflineOrders();
    return offlineOrders.filter(order => !order.synced).length > 0;
  } catch (error) {
    console.error('Error checking pending orders:', error);
    return false;
  }
};

// Get pending orders count
export const getPendingOrdersCount = async () => {
  try {
    const offlineOrders = await getOfflineOrders();
    return offlineOrders.filter(order => !order.synced).length;
  } catch (error) {
    console.error('Error getting pending orders count:', error);
    return 0;
  }
};

// Force sync now (for manual sync button)
export const forceSyncNow = async () => {
  if (!isOnline()) {
    throw new Error('Cannot sync: Device is offline');
  }

  const result = await syncOfflineOrders();
  return result;
};

// Clean up old synced orders (keep last 100)
export const cleanupSyncedOrders = async () => {
  try {
    const allOrders = await getOfflineOrders();
    const syncedOrders = allOrders
      .filter(order => order.synced)
      .sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));

    // Keep only the last 100 synced orders
    if (syncedOrders.length > 100) {
      const ordersToDelete = syncedOrders.slice(100);
      for (const order of ordersToDelete) {
        await deleteOfflineOrder(order.id);
      }
      console.log(`Cleaned up ${ordersToDelete.length} old synced orders`);
    }
  } catch (error) {
    console.error('Error cleaning up synced orders:', error);
  }
};
