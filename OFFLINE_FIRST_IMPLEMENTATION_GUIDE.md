# Offline-First Implementation Guide

## Overview

This guide explains how to use the new offline-first infrastructure that has been implemented. The system provides:

1. **Universal API Response Caching** - All API responses are cached with full field preservation
2. **Local-First Data Access** - Read from IndexedDB first, sync with server in background
3. **Robust Pending Queue** - Offline operations are queued and synced when online
4. **Multi-Tab Coordination** - Changes sync across browser tabs
5. **Conflict Resolution** - Deterministic conflict handling

## Architecture

### Core Services

1. **cacheService.js** - Universal cache layer for all API responses
2. **queueService.js** - Pending operations queue with idempotency
3. **dataService.js** - Local-first data access layer
4. **syncEngine.js** - Central sync engine with conflict resolution

### Data Flow

```
User Action → dataService → IndexedDB (immediate) → Queue (if offline) → API (if online)
                                                          ↓
                                                    Sync Engine (when online)
```

## Usage Examples

### Reading Data (Local-First)

```javascript
import { getData } from '../services/dataService';

// In your component
const fetchOrders = async () => {
  try {
    // Reads from cache first, fetches from API in background if online
    const data = await getData('orders', { status: 'pending' });
    setOrders(data.data || data);
  } catch (error) {
    console.error('Failed to fetch orders:', error);
  }
};
```

### Creating Data (Optimistic Updates)

```javascript
import { createData } from '../services/dataService';

const handleCreateOrder = async (orderData) => {
  try {
    // Immediately updates local cache, queues for sync if offline
    const newOrder = await createData('orders', orderData, {
      endpoint: '/api/orders',
      optimisticUpdate: true,
      onSuccess: (order) => {
        console.log('Order created:', order);
        // UI updates immediately
      },
      onError: (error) => {
        console.error('Failed to create order:', error);
      }
    });
    
    return newOrder;
  } catch (error) {
    // Handle error
  }
};
```

### Updating Data

```javascript
import { updateData } from '../services/dataService';

const handleUpdateOrder = async (orderId, updates) => {
  try {
    const updated = await updateData('orders', orderId, updates, {
      endpoint: `/api/orders/${orderId}`,
      optimisticUpdate: true
    });
    
    return updated;
  } catch (error) {
    // Handle error
  }
};
```

### Subscribing to Updates (Multi-Tab)

```javascript
import { subscribe } from '../services/dataService';
import { useEffect } from 'react';

const MyComponent = () => {
  useEffect(() => {
    // Subscribe to order updates
    const unsubscribe = subscribe('orders', (update) => {
      console.log('Order updated in another tab:', update);
      // Refresh data
      fetchOrders();
    });
    
    return () => unsubscribe();
  }, []);
};
```

## Migration Guide

### Step 1: Update API Calls

**Before:**
```javascript
const response = await ordersAPI.getAll();
setOrders(response.data.data);
```

**After:**
```javascript
import { getData } from '../services/dataService';

const data = await getData('orders');
setOrders(data.data || data);
```

### Step 2: Update Write Operations

**Before:**
```javascript
const response = await ordersAPI.create(orderData);
```

**After:**
```javascript
import { createData } from '../services/dataService';

const newOrder = await createData('orders', orderData);
```

### Step 3: Handle Offline State

The system automatically handles offline state, but you can check:

```javascript
import { isOnline } from '../services/offlineSyncService';

if (!isOnline()) {
  // Show offline indicator
}
```

## Component Refactoring Checklist

For each component that uses APIs:

- [ ] Replace direct API calls with `getData()`, `createData()`, `updateData()`, `deleteData()`
- [ ] Load from cache on component mount
- [ ] Subscribe to updates for real-time UI
- [ ] Handle offline state gracefully
- [ ] Show loading states appropriately
- [ ] Display sync status if needed

## Testing Offline Functionality

### Simulate Offline Mode

1. **Chrome DevTools:**
   - Open DevTools → Network tab
   - Select "Offline" from throttling dropdown

2. **Programmatic:**
   ```javascript
   // Force offline
   window.dispatchEvent(new Event('offline'));
   
   // Force online
   window.dispatchEvent(new Event('online'));
   ```

### Verify Cache

```javascript
import { getCacheStats } from '../services/cacheService';

const stats = await getCacheStats();
console.log('Cache stats:', stats);
```

### Check Pending Queue

```javascript
import { getQueueStats } from '../services/queueService';

const stats = await getQueueStats();
console.log('Queue stats:', stats);
```

## Debugging

### Enable Debug Logging

The services log extensively. Check browser console for:
- `[CacheService]` - Cache operations
- `[QueueService]` - Queue operations
- `[SyncEngine]` - Sync operations
- `[DataService]` - Data access operations

### Inspect IndexedDB

1. Chrome DevTools → Application → IndexedDB
2. Check `flamex-pos-db` database
3. Inspect stores:
   - `api-responses` - Cached API responses
   - `pendingOperations` - Queued operations
   - `orders`, `menu-items`, etc. - Resource-specific stores

### Manual Sync Trigger

```javascript
import { triggerSync } from '../services/syncEngine';

// Manually trigger sync
const results = await triggerSync();
console.log('Sync results:', results);
```

## Performance Considerations

1. **Cache Size**: Cache is automatically managed, but old entries are cleaned up
2. **Batch Operations**: Sync processes operations in batches
3. **Background Refresh**: Cache is refreshed in background, UI stays responsive
4. **IndexedDB Transactions**: All operations use transactions for consistency

## Troubleshooting

### Cache Not Updating

- Check if API interceptor is caching responses
- Verify IndexedDB is accessible
- Check browser console for errors

### Operations Not Syncing

- Verify online status
- Check pending queue for failed operations
- Review sync engine logs
- Ensure sync lock is not held by another tab

### Data Conflicts

- Check conflicts store in IndexedDB
- Review conflict resolution logs
- Manually resolve if needed

## Next Steps

1. **Refactor Components**: Update all components to use `dataService`
2. **Add Tests**: Create unit/integration tests
3. **Monitor**: Add monitoring/analytics for sync operations
4. **Optimize**: Fine-tune sync intervals and batch sizes based on usage

## Support

For issues or questions:
1. Check browser console for error messages
2. Inspect IndexedDB for data consistency
3. Review sync engine logs
4. Check network tab for API call failures

