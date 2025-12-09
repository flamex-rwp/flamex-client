/**
 * Enhanced Sync Engine
 * 
 * Central sync engine with conflict resolution, multi-tab coordination,
 * and comprehensive sync strategies.
 */

import api from './api';
import { getPendingOperations, markOperationComplete, markOperationFailed, getRetryDelay } from './queueService';
import { invalidateCache, getCachedAPIResponse } from './cacheService';
import { isOnline } from './offlineSyncService';
import { broadcastChannel } from './dataService';

const SYNC_INTERVAL = 10000; // 10 seconds
const SYNC_BATCH_SIZE = 5;
const MAX_CONCURRENT_SYNC = 1; // Only one tab should sync at a time

let syncInProgress = false;
let syncIntervalId = null;
let syncLeaderId = null;

// Generate unique tab ID
const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Leader election for sync coordination
 */
const acquireSyncLock = async () => {
  try {
    const db = await import('./cacheService').then(m => m.openDB());
    const tx = db.transaction('sync-metadata', 'readwrite');
    const store = tx.objectStore('sync-metadata');
    
    const lockKey = 'sync-lock';
    const request = store.get(lockKey);
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const lock = request.result;
        const now = Date.now();
        
        // If no lock or lock expired (30 seconds), acquire it
        if (!lock || !lock.tabId || (now - lock.timestamp) > 30000) {
          const newLock = {
            key: lockKey,
            tabId: TAB_ID,
            timestamp: now
          };
          store.put(newLock);
          syncLeaderId = TAB_ID;
          resolve(true);
        } else if (lock.tabId === TAB_ID) {
          // We already have the lock, refresh it
          lock.timestamp = now;
          store.put(lock);
          syncLeaderId = TAB_ID;
          resolve(true);
        } else {
          // Another tab has the lock
          syncLeaderId = lock.tabId;
          resolve(false);
        }
      };
      request.onerror = () => resolve(false);
    });
  } catch (error) {
    console.error('[SyncEngine] Error acquiring sync lock:', error);
    return false;
  }
};

/**
 * Process a single pending operation
 */
const processOperation = async (operation) => {
  try {
    const retryDelay = getRetryDelay(operation.retryCount || 0);
    
    // Wait before retry
    if (operation.retryCount > 0) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    
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
    
    // Mark as complete
    await markOperationComplete(operation.id);
    
    // Update cache with server response
    if (response.data) {
      await invalidateCache(operation.resourceType || 'unknown');
    }
    
    // Broadcast success
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'SYNC_SUCCESS',
        operationId: operation.id,
        timestamp: Date.now()
      });
    }
    
    return { success: true, operation, response };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    
    // Check if error is non-retryable
    const isNonRetryable = error.response?.status === 400 || // Bad request
                          error.response?.status === 404 || // Not found
                          error.response?.status === 422;   // Validation error
    
    if (isNonRetryable) {
      await markOperationComplete(operation.id); // Mark complete to stop retries
      console.warn(`[SyncEngine] Operation ${operation.id} failed (non-retryable):`, errorMessage);
      return { success: false, operation, error: errorMessage, skip: true };
    }
    
    // Mark as failed (will retry)
    await markOperationFailed(operation.id, error);
    return { success: false, operation, error: errorMessage };
  }
};

/**
 * Sync pending operations
 */
export const syncPendingOperations = async () => {
  if (!isOnline() || syncInProgress) {
    return { synced: 0, failed: 0, errors: [] };
  }
  
  // Check if we're the sync leader
  const isLeader = await acquireSyncLock();
  if (!isLeader) {
    return { synced: 0, failed: 0, errors: [], skipped: true };
  }
  
  syncInProgress = true;
  
  try {
    const pendingOps = await getPendingOperations(SYNC_BATCH_SIZE);
    if (pendingOps.length === 0) {
      return { synced: 0, failed: 0, errors: [] };
    }
    
    console.log(`[SyncEngine] Processing ${pendingOps.length} pending operations...`);
    
    const results = {
      synced: 0,
      failed: 0,
      errors: []
    };
    
    // Process operations sequentially to maintain order
    for (const operation of pendingOps) {
      try {
        const result = await processOperation(operation);
        if (result.success) {
          results.synced++;
        } else if (!result.skip) {
          results.failed++;
          results.errors.push({
            operationId: operation.id,
            error: result.error
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          operationId: operation.id,
          error: error.message
        });
      }
    }
    
    return results;
  } finally {
    syncInProgress = false;
  }
};

/**
 * Pull latest data from server and update cache
 */
export const pullLatestData = async (resources = null) => {
  if (!isOnline()) {
    return { updated: 0, errors: [] };
  }
  
  const resourcesToSync = resources || [
    'menu-items',
    'categories',
    'customers',
    'orders',
    'expenses'
  ];
  
  const results = {
    updated: 0,
    errors: []
  };
  
  for (const resource of resourcesToSync) {
    try {
      const response = await api.get(`/api/${resource}`);
      // Cache will be updated by API interceptor
      results.updated++;
    } catch (error) {
      console.error(`[SyncEngine] Failed to pull ${resource}:`, error);
      results.errors.push({ resource, error: error.message });
    }
  }
  
  return results;
};

/**
 * Full sync cycle: push pending operations, then pull latest data
 */
export const performFullSync = async () => {
  if (!isOnline()) {
    return { push: null, pull: null };
  }
  
  console.log('[SyncEngine] Starting full sync cycle...');
  
  // Push pending operations
  const pushResults = await syncPendingOperations();
  
  // Pull latest data
  const pullResults = await pullLatestData();
  
  // Broadcast sync complete
  if (broadcastChannel) {
    broadcastChannel.postMessage({
      type: 'SYNC_COMPLETE',
      pushResults,
      pullResults,
      timestamp: Date.now()
    });
  }
  
  return { push: pushResults, pull: pullResults };
};

/**
 * Start automatic sync
 */
export const startAutoSync = () => {
  if (syncIntervalId) {
    return; // Already started
  }
  
  console.log('[SyncEngine] Starting auto-sync...');
  
  // Initial sync
  performFullSync().catch(console.error);
  
  // Periodic sync
  syncIntervalId = setInterval(() => {
    if (isOnline() && !syncInProgress) {
      performFullSync().catch(console.error);
    }
  }, SYNC_INTERVAL);
  
  // Sync on online event
  window.addEventListener('online', () => {
    console.log('[SyncEngine] Network online, triggering sync...');
    performFullSync().catch(console.error);
  });
};

/**
 * Stop automatic sync
 */
export const stopAutoSync = () => {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log('[SyncEngine] Auto-sync stopped');
  }
};

/**
 * Manual sync trigger
 */
export const triggerSync = async () => {
  return await performFullSync();
};

// Auto-start sync when module loads (if in browser)
if (typeof window !== 'undefined') {
  startAutoSync();
}


