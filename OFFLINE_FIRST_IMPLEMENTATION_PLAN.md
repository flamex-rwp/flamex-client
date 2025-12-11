# Offline-First Implementation Plan

## Executive Summary

This document outlines a comprehensive plan to implement a robust, consistent offline-first caching and sync system across the entire Flamex POS client application. The system will ensure all API responses are cached locally, all operations work offline, and changes sync seamlessly when online.

## Current State Analysis

### API Endpoints Mapped

#### Authentication
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

#### Categories
- `GET /api/categories`
- `POST /api/categories`
- `DELETE /api/categories/:id`

#### Menu Items
- `GET /api/menu-items`
- `POST /api/menu-items`
- `PUT /api/menu-items/:id`
- `DELETE /api/menu-items/:id`

#### Orders
- `GET /api/orders`
- `GET /api/orders/:id`
- `GET /api/orders/:id/items`
- `GET /api/orders/:id/history`
- `POST /api/orders`
- `PUT /api/orders/:id`
- `PUT /api/orders/:id/cancel`
- `PUT /api/orders/:id/mark-paid`
- `PUT /api/orders/:id/status`
- `PUT /api/orders/:id/assign-rider`
- `PUT /api/orders/:id/delivery/status`
- `GET /api/orders/dine-in/active`
- `GET /api/orders/dine-in/stats`
- `GET /api/orders/dine-in/tables/availability`
- `GET /api/orders/delivery/active`
- `GET /api/orders/delivery/stats`
- `GET /api/orders/statistics/summary`
- `GET /api/orders/reports/sales`

#### Customers
- `GET /api/customers`
- `GET /api/customers/search`
- `GET /api/customers/search-by-phone`
- `GET /api/customers/:id`
- `GET /api/customers/:id/orders`
- `GET /api/customers/:id/addresses`
- `POST /api/customers`
- `POST /api/customers/find-or-create`
- `PUT /api/customers/:id`
- `DELETE /api/customers/:id`
- `POST /api/customers/:id/addresses`
- `PUT /api/customers/:id/addresses/:addressId`
- `DELETE /api/customers/:id/addresses/:addressId`

#### Expenses
- `GET /api/expenses`
- `POST /api/expenses`
- `PUT /api/expenses/:id`
- `DELETE /api/expenses/:id`

#### Reports
- `GET /api/reports/order-summary`
- `GET /api/reports/top-items`
- `GET /api/reports/financial-summary`
- `GET /api/reports/profit-loss`
- `GET /api/reports/daily-sales`
- `GET /api/reports/monthly-sales`
- `GET /api/reports/customer-loyalty`
- `GET /api/reports/rider-performance`
- `GET /api/reports/overview`
- `GET /api/reports/area-analysis`
- `GET /api/reports/pending-cod`

#### Riders
- `GET /api/riders`
- `POST /api/riders`
- `PUT /api/riders/:id`

#### Business Info
- `GET /api/business-info`
- `PUT /api/business-info/:key`

#### Printer
- `GET /api/printer/status`
- `POST /api/printer/test`

### Components Using APIs

1. **OrderSystem.js** - Creates/updates orders, fetches menu items, categories, table availability
2. **OrderHistory.js** - Fetches order history, generates receipts
3. **DineInOrders.js** - Manages dine-in orders, stats, table availability
4. **DeliveryOrders.js** - Manages delivery orders, stats
5. **DailySalesSummary.js** - Fetches sales statistics and summaries
6. **CustomerManagement.js** - CRUD operations on customers
7. **MenuManagement.js** - CRUD operations on menu items
8. **CategoryManagement.js** - CRUD operations on categories
9. **ExpenseManagement.js** - CRUD operations on expenses
10. **ExpenseHistory.js** - Views expense history
11. **DeliveryReports.js** - Fetches delivery reports and statistics
12. **ItemsSalesReport.js** - Fetches item sales reports
13. **CustomerSearchModal.js** - Searches customers
14. **CustomerAddressSelector.js** - Fetches customer addresses

### Current Infrastructure

#### Existing IndexedDB Schema (DB_VERSION: 2)
- `orders` - Stores orders with synced flag
- `menu-items` - Caches menu items
- `categories` - Caches categories
- `customers` - Caches customers
- `tables` - Caches table availability
- `pendingOperations` - Queue for offline operations
- `user-session` - User session data
- `sync-metadata` - Sync timestamps and metadata

#### Current Caching Implementation
- Partial caching in `apiCache.js` - only handles specific endpoints
- Inconsistent field preservation - some fields may be dropped
- No universal cache-on-every-API-hit
- Limited offline write support

#### Current Sync Service
- Basic sync in `offlineSyncService.js`
- Limited retry logic
- No conflict resolution
- No multi-tab coordination

## Implementation Plan

### Phase 1: Enhanced IndexedDB Schema & Universal Cache Layer

**Goal**: Create a comprehensive IndexedDB schema that preserves ALL server fields and implement universal caching.

**Tasks**:
1. Upgrade IndexedDB schema to version 3 with:
   - `api-responses` store - Generic store for ALL API responses (keyed by URL+params)
   - `expenses` store - Dedicated expenses store
   - `reports` store - Cached reports with query params
   - Enhanced `pendingOperations` with better metadata
   - `conflicts` store - Track conflict resolution

2. Create universal cache layer:
   - `src/services/cacheService.js` - Universal cache service
   - Cache every API response (GET, POST, PUT responses)
   - Preserve ALL fields from server
   - Support query param variations

### Phase 2: Local-First Data Access Layer

**Goal**: Create a data access layer that reads from IndexedDB first, then syncs with server.

**Tasks**:
1. Create `src/services/dataService.js`:
   - `getData(resource, params)` - Read from IndexedDB first, fetch from API if needed
   - `setData(resource, data)` - Write to IndexedDB and queue for sync
   - `subscribe(resource, callback)` - Real-time updates via BroadcastChannel

2. Refactor all components to use `dataService` instead of direct API calls

### Phase 3: Enhanced Pending Operations Queue

**Goal**: Robust queue system with idempotency and retry logic.

**Tasks**:
1. Enhance `pendingOperations` store:
   - Add idempotency keys
   - Add retry count and exponential backoff
   - Add priority levels
   - Add operation dependencies

2. Create `src/services/queueService.js`:
   - Queue operations with metadata
   - Process queue with retry logic
   - Handle idempotency

### Phase 4: Central Sync Engine

**Goal**: Unified sync engine with conflict resolution and multi-tab support.

**Tasks**:
1. Create `src/services/syncEngine.js`:
   - Push pending operations to server
   - Pull latest changes from server
   - Merge conflicts with deterministic rules
   - Multi-tab coordination via BroadcastChannel
   - Leader election for sync process

2. Conflict resolution:
   - Last-write-wins for most resources
   - Server-wins for canonical fields
   - Client-wins for transient metadata
   - Conflict logging and UI hooks

### Phase 5: Service Worker Enhancement

**Goal**: Enhanced service worker for background sync and asset caching.

**Tasks**:
1. Update `public/service-worker.js`:
   - Background sync for pending operations
   - Aggressive asset caching
   - API response caching (complement to IndexedDB)
   - Cache versioning and invalidation

### Phase 6: Component Refactoring

**Goal**: Refactor all components to use local-first pattern.

**Tasks**:
1. Update each component:
   - Replace direct API calls with `dataService`
   - Load from IndexedDB on mount
   - Subscribe to updates
   - Handle offline state gracefully

### Phase 7: Testing & Validation

**Goal**: Comprehensive testing and validation tools.

**Tasks**:
1. Create test utilities:
   - Mock offline/online state
   - Simulate network failures
   - Test conflict scenarios

2. Create debug UI:
   - Inspect IndexedDB content
   - View pending queue
   - Monitor sync status
   - Trigger manual sync

### Phase 8: Documentation

**Goal**: Comprehensive documentation.

**Tasks**:
1. Architecture documentation
2. API documentation
3. Usage guide
4. Troubleshooting guide

## File Structure

```
flamex-client/src/
├── services/
│   ├── api.js (enhanced with universal caching)
│   ├── cacheService.js (NEW - universal cache layer)
│   ├── dataService.js (NEW - local-first data access)
│   ├── queueService.js (NEW - pending operations queue)
│   ├── syncEngine.js (NEW - central sync engine)
│   └── offlineSyncService.js (refactored)
├── utils/
│   ├── offlineDB.js (enhanced schema)
│   ├── apiCache.js (deprecated - replaced by cacheService)
│   └── conflictResolver.js (NEW - conflict resolution logic)
├── hooks/
│   ├── useOfflineData.js (NEW - React hook for offline data)
│   └── useSyncStatus.js (NEW - React hook for sync status)
└── components/
    └── DebugPanel.js (NEW - debug UI for cache/queue inspection)
```

## Implementation Order

1. **Week 1**: Phase 1 & 2 - Schema upgrade and universal cache layer
2. **Week 2**: Phase 3 & 4 - Queue service and sync engine
3. **Week 3**: Phase 5 & 6 - Service worker and component refactoring
4. **Week 4**: Phase 7 & 8 - Testing and documentation

## Success Criteria

1. ✅ All API responses cached with full field preservation
2. ✅ All components work offline
3. ✅ Offline operations queue and sync correctly
4. ✅ Conflict resolution works deterministically
5. ✅ Multi-tab consistency maintained
6. ✅ Performance remains acceptable
7. ✅ Comprehensive test coverage
8. ✅ Complete documentation

## Risk Mitigation

1. **Data Loss**: Transactional updates, validation before cache writes
2. **Performance**: Batch operations, lazy loading, pagination
3. **Conflicts**: Clear resolution rules, conflict logging
4. **Storage Limits**: Cleanup policies, size limits
5. **Browser Compatibility**: Feature detection, polyfills



