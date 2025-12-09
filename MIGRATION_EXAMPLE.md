# Migration Example: Updating OrderSystem.js

This document shows how to update `OrderSystem.js` to use the new offline-first data service.

## Key Changes

### 1. Import the Data Service

```javascript
// Add this import
import dataService from '../services/dataService';
import { useOffline } from '../contexts/OfflineContext';
import { broadcastOrderCreated } from '../utils/multiTabSync';
```

### 2. Update Menu Items Loading

**Before:**
```javascript
const fetchMenuItems = async () => {
  try {
    if (isOnline()) {
      const response = await menuItemsAPI.getAll();
      const items = response.data.data || response.data || [];
      setMenuItems(items);
      await cacheMenuItems(items);
    } else {
      const cached = await getCachedMenuItems();
      if (cached.length > 0) {
        setMenuItems(cached);
      }
    }
  } catch (error) {
    console.error('Error fetching menu items:', error);
    const cached = await getCachedMenuItems();
    if (cached.length > 0) {
      setMenuItems(cached);
    }
  }
};
```

**After:**
```javascript
const fetchMenuItems = async () => {
  // Loads from IndexedDB first (instant), syncs in background if online
  const items = await dataService.getMenuItems();
  setMenuItems(items);
};
```

### 3. Update Table Availability

**Before:**
```javascript
useEffect(() => {
  const fetchOccupiedTables = async () => {
    if (!isDelivery && isOnline()) {
      try {
        const response = await ordersAPI.getTableAvailability();
        setOccupiedTables(response.data.data?.occupied_tables || []);
      } catch (error) {
        console.warn('Failed to fetch table availability:', error);
      }
    }
  };
  fetchOccupiedTables();
  const interval = setInterval(fetchOccupiedTables, 30000);
  return () => clearInterval(interval);
}, [isDelivery]);
```

**After:**
```javascript
useEffect(() => {
  const fetchOccupiedTables = async () => {
    if (!isDelivery) {
      // Loads from cache first, syncs in background
      const tables = await dataService.getTableAvailability();
      setOccupiedTables(tables);
    }
  };
  
  fetchOccupiedTables();
  
  // Refresh when window becomes visible
  const handleVisibilityChange = () => {
    if (!document.hidden && !isDelivery) {
      fetchOccupiedTables();
    }
  };
  
  const handleFocus = () => {
    if (!isDelivery) {
      fetchOccupiedTables();
    }
  };
  
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleFocus);
  
  // Still poll, but less frequently (sync service handles frequent syncs)
  const interval = setInterval(fetchOccupiedTables, 30000);
  
  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleFocus);
  };
}, [isDelivery]);
```

### 4. Update Order Creation

**Before:**
```javascript
const handleCheckout = async () => {
  // ... validation ...
  
  try {
    const response = await ordersAPI.create(orderData);
    // Handle success
  } catch (error) {
    if (!isOnline()) {
      await saveOfflineOrder(orderData);
    }
    // Handle error
  }
};
```

**After:**
```javascript
const handleCheckout = async () => {
  // ... validation ...
  
  try {
    // Works offline! Saves locally, queues for sync
    const order = await dataService.createOrder(orderData);
    
    // Notify other tabs
    broadcastOrderCreated(order);
    
    // Order is immediately available in UI
    showSuccess('Order created successfully');
    
    // Clear cart, etc.
  } catch (error) {
    showError(error.message || 'Failed to create order');
  }
};
```

### 5. Add Offline Status Indicator

```javascript
const { online, pendingOperations } = useOffline();

// In JSX:
{!online && (
  <div style={{ 
    background: '#fff3cd', 
    padding: '0.5rem', 
    textAlign: 'center',
    fontSize: '0.85rem'
  }}>
    ⚠️ Offline Mode - {pendingOperations} orders pending sync
  </div>
)}
```

## Benefits

1. **Instant UI** - Data loads immediately from IndexedDB
2. **Works Offline** - All operations work without internet
3. **Automatic Sync** - Background sync handles everything
4. **Multi-tab** - Changes sync across all tabs automatically
5. **Simpler Code** - No manual cache management needed

## Testing

1. Go offline in DevTools
2. Create an order → Should work immediately
3. Check IndexedDB → Order should be stored
4. Go online → Order should sync automatically
5. Open another tab → Should see the order appear


