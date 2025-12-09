// Debug utility for offline orders
import { getOfflineOrders, deleteOfflineOrder } from './offlineDB';

// View all offline orders
export const viewOfflineOrders = async () => {
  try {
    const orders = await getOfflineOrders();
    console.log('=== OFFLINE ORDERS ===');
    console.log('Total orders:', orders.length);

    orders.forEach((order, index) => {
      console.log(`\n--- Order #${index + 1} ---`);
      console.log('ID:', order.id);
      console.log('Timestamp:', order.timestamp);
      console.log('Synced:', order.synced);
      console.log('Data:', order.data);
    });

    return orders;
  } catch (error) {
    console.error('Error viewing offline orders:', error);
    return [];
  }
};

// Clear all offline orders
export const clearAllOfflineOrders = async () => {
  try {
    const orders = await getOfflineOrders();
    console.log(`Clearing ${orders.length} offline orders...`);

    for (const order of orders) {
      await deleteOfflineOrder(order.id);
    }

    console.log('All offline orders cleared successfully!');
    return true;
  } catch (error) {
    console.error('Error clearing offline orders:', error);
    return false;
  }
};

// Clear only synced orders
export const clearSyncedOrders = async () => {
  try {
    const orders = await getOfflineOrders();
    const syncedOrders = orders.filter(order => order.synced);

    console.log(`Clearing ${syncedOrders.length} synced orders...`);

    for (const order of syncedOrders) {
      await deleteOfflineOrder(order.id);
    }

    console.log('Synced orders cleared successfully!');
    return true;
  } catch (error) {
    console.error('Error clearing synced orders:', error);
    return false;
  }
};

// Make functions available globally for console debugging
if (typeof window !== 'undefined') {
  window.debugOfflineOrders = {
    view: viewOfflineOrders,
    clearAll: clearAllOfflineOrders,
    clearSynced: clearSyncedOrders
  };
}
