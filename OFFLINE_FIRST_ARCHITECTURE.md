# Offline-First PWA Architecture Documentation

## Overview

This POS system implements a complete **offline-first Progressive Web App (PWA)** architecture that ensures the application works seamlessly whether online or offline. All data is stored locally in IndexedDB and synced with the server when connectivity is available.

## Architecture Components

### 1. IndexedDB Schema (`src/utils/offlineDB.js`)

The database uses **IndexedDB** as the single source of truth with the following stores:

- **`orders`**: All orders (synced and unsynced)
  - Indexed by: `orderNumber`, `orderType`, `paymentStatus`, `orderStatus`, `tableNumber`, `createdAt`, `synced`
  
- **`menu-items`**: Menu items for offline access
  - Indexed by: `categoryId`, `available`, `lastSynced`
  
- **`categories`**: Product categories
  - Indexed by: `lastSynced`
  
- **`customers`**: Customer data
  - Indexed by: `phone` (unique), `lastSynced`
  
- **`tables`**: Table availability status (1-10)
  - Indexed by: `occupied`, `lastSynced`
  
- **`pendingOperations`**: Queue of offline operations to sync
  - Indexed by: `type`, `status`, `timestamp`, `retryCount`
  - Types: `create_order`, `update_order`, `update_status`, `mark_paid`, etc.
  
- **`user-session`**: Cached user authentication data
  
- **`sync-metadata`**: Tracks last sync times for each data type

### 2. Data Service (`src/services/dataService.js`)

Implements the **"Load from IndexedDB first"** pattern:

- All data loading functions (`getMenuItems`, `getOrders`, etc.) **always load from IndexedDB first** for instant UI
- If online, sync happens in the background
- Components get immediate data from cache, then updates arrive via sync

**Key Functions:**
- `getMenuItems(options)` - Loads menu items (cache first, sync in background)
- `getOrders(filters, options)` - Loads orders with filters
- `createOrder(orderData)` - Creates order locally, queues for sync
- `updateOrderData(id, updates)` - Updates locally, queues for sync
- `getTableAvailability(options)` - Gets table status (cached + background sync)

### 3. Sync Service (`src/services/offlineSyncService.js`)

Handles all synchronization logic:

- **Polling**: Syncs every 8 seconds when online
- **Pending Operations Queue**: Processes offline actions in batches
- **Retry Logic**: Automatically retries failed operations (up to 3 times)
- **Batch Processing**: Processes 5 operations at a time to avoid overwhelming server

**Sync Cycle:**
1. Process pending operations queue
2. Fetch fresh data from API (menu, categories, customers, tables)
3. Update IndexedDB with latest data
4. Broadcast sync completion to all tabs

**Key Functions:**
- `performFullSync()` - Complete sync cycle
- `startAutoSync(callback)` - Start automatic polling
- `syncPendingOperations()` - Process queued operations
- `forceSyncNow()` - Manual sync trigger

### 4. Multi-Tab Sync (`src/utils/multiTabSync.js`)

Uses **BroadcastChannel API** to keep all browser tabs synchronized:

- When one tab creates/updates data, other tabs are notified
- Prevents duplicate operations
- Ensures consistent UI across tabs

**Message Types:**
- `ORDER_CREATED`, `ORDER_UPDATED`, `ORDER_SYNCED`
- `MENU_UPDATED`, `TABLES_UPDATED`
- `SYNC_STARTED`, `SYNC_COMPLETED`
- `DATA_REFRESH`

### 5. Offline Context (`src/contexts/OfflineContext.js`)

React context that provides offline status and sync controls:

```javascript
const { online, syncInProgress, pendingOperations, syncNow } = useOffline();
```

**Provides:**
- `online` - Boolean indicating online status
- `syncInProgress` - Boolean indicating if sync is running
- `pendingOperations` - Count of queued operations
- `lastSyncTime` - Timestamp of last successful sync
- `syncNow()` - Function to manually trigger sync

### 6. Service Worker (`public/service-worker.js`)

Enhanced caching strategy:

- **Cache-First**: Static assets (JS, CSS, images)
- **Network-First**: Navigation requests, dynamic API endpoints
- **API Caching**: Caches read-only GET requests (menu items, categories)
- **Background Sync**: Triggers sync when connection restored

## Data Flow

### Creating an Order (Offline)

1. User creates order → `dataService.createOrder(orderData)`
2. Order saved to IndexedDB immediately with `synced: false`
3. Operation added to `pendingOperations` queue
4. UI updates immediately (order appears in list)
5. When online, sync service processes queue
6. Order synced to server, `synced: true` set
7. Other tabs notified via BroadcastChannel

### Loading Data

1. Component calls `dataService.getMenuItems()`
2. Data loaded from IndexedDB instantly (UI renders)
3. If online, background sync fetches fresh data
4. IndexedDB updated with latest data
5. Component re-renders with updated data (if subscribed)

### Syncing

1. Sync service runs every 8 seconds (when online)
2. Processes `pendingOperations` queue (5 at a time)
3. Fetches fresh data from API
4. Updates IndexedDB
5. Broadcasts completion to all tabs

## Migration Guide

### Updating Components to Use Offline-First Pattern

**Before:**
```javascript
const [menuItems, setMenuItems] = useState([]);

useEffect(() => {
  menuItemsAPI.getAll().then(response => {
    setMenuItems(response.data.data);
  });
}, []);
```

**After:**
```javascript
import dataService from '../services/dataService';

const [menuItems, setMenuItems] = useState([]);

useEffect(() => {
  // Load from cache first (instant), sync in background
  dataService.getMenuItems().then(items => {
    setMenuItems(items);
  });
}, []);
```

### Creating Orders

**Before:**
```javascript
const handleCheckout = async () => {
  const response = await ordersAPI.create(orderData);
  // Handle response
};
```

**After:**
```javascript
import dataService from '../services/dataService';
import { broadcastOrderCreated } from '../utils/multiTabSync';

const handleCheckout = async () => {
  // Works offline! Saves locally, queues for sync
  const order = await dataService.createOrder(orderData);
  broadcastOrderCreated(order); // Notify other tabs
  // Order is immediately available in UI
};
```

### Using Offline Status

```javascript
import { useOffline } from '../contexts/OfflineContext';

const MyComponent = () => {
  const { online, pendingOperations, syncNow } = useOffline();
  
  return (
    <div>
      {!online && <div>Offline Mode - {pendingOperations} pending</div>}
      <button onClick={syncNow}>Sync Now</button>
    </div>
  );
};
```

## Key Features

✅ **Works completely offline** - All core functionality available without internet
✅ **Instant UI** - Data loads from IndexedDB first, no waiting for API
✅ **Automatic sync** - Background sync every 8 seconds when online
✅ **Multi-tab support** - All tabs stay synchronized
✅ **Retry logic** - Failed operations automatically retry (up to 3 times)
✅ **Conflict handling** - Table conflicts handled gracefully
✅ **Service worker caching** - Aggressive caching for fast loading
✅ **Background sync** - Syncs when connection restored

## Testing Offline Behavior

1. Open DevTools → Network tab
2. Set throttling to "Offline"
3. Create an order → Should work immediately
4. Check IndexedDB → Order should be stored with `synced: false`
5. Set throttling back to "Online"
6. Wait 8 seconds → Order should sync automatically
7. Check IndexedDB → Order should have `synced: true`

## Performance Optimizations

- **Debounced search** - 300ms delay to reduce filtering
- **Memoized calculations** - Cart totals, filtered items cached
- **Batch operations** - Process 5 operations at a time
- **Selective syncing** - Only syncs recent orders (last 100)
- **Cache-first loading** - Instant UI from IndexedDB
- **Background sync** - Non-blocking data updates

## Troubleshooting

**Orders not syncing:**
- Check `pendingOperations` store in IndexedDB
- Verify online status
- Check browser console for sync errors
- Manually trigger sync: `window.forceSyncNow()`

**Data not updating:**
- Check `sync-metadata` store for last sync times
- Verify API endpoints are accessible
- Check network tab for failed requests

**Multi-tab not working:**
- Verify BroadcastChannel is supported (all modern browsers)
- Check browser console for tab sync messages

## Future Enhancements

- WebSocket support for real-time updates
- Conflict resolution UI
- Sync status dashboard
- Offline analytics
- Data compression for large datasets


