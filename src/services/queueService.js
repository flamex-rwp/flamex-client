/**
 * Queue Service
 * 
 * Manages pending operations queue with idempotency, retry logic, and priorities.
 */

import { openDB } from './cacheService';

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

/**
 * Generate idempotency key from operation
 */
const generateIdempotencyKey = (method, endpoint, data) => {
  const dataStr = JSON.stringify(data || {});
  return `${method}:${endpoint}:${dataStr}`;
};

/**
 * Add operation to pending queue
 */
export const queueOperation = async (operation) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    
    // Generate idempotency key
    const idempotencyKey = operation.idempotencyKey || 
      generateIdempotencyKey(operation.method, operation.endpoint, operation.data);
    
    // Check if operation already exists (idempotency check)
    const index = store.index('idempotencyKey');
    const existingRequest = index.get(idempotencyKey);
    
    return new Promise((resolve, reject) => {
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result;
        
        if (existing && existing.status === 'pending') {
          // Operation already queued
          console.log('[QueueService] Operation already queued:', idempotencyKey);
          resolve(existing);
          return;
        }
        
        // Create new operation
        const queuedOperation = {
          ...operation,
          idempotencyKey,
          status: 'pending',
          retryCount: 0,
          priority: operation.priority || 0, // Higher number = higher priority
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          lastAttempt: null,
          error: null
        };
        
        const addRequest = store.add(queuedOperation);
        addRequest.onsuccess = () => {
          console.log('[QueueService] Operation queued:', queuedOperation.id, operation.endpoint);
          resolve(queuedOperation);
        };
        addRequest.onerror = () => {
          console.error('[QueueService] Error queueing operation:', addRequest.error);
          reject(addRequest.error);
        };
      };
      existingRequest.onerror = () => reject(existingRequest.error);
    });
  } catch (error) {
    console.error('[QueueService] Error queueing operation:', error);
    throw error;
  }
};

/**
 * Get pending operations
 */
export const getPendingOperations = async (limit = null, priority = null) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readonly');
    const store = tx.objectStore('pendingOperations');
    
    const index = store.index('status');
    const request = index.getAll('pending');
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        let operations = request.result || [];
        
        // Filter by priority if specified
        if (priority !== null) {
          operations = operations.filter(op => op.priority === priority);
        }
        
        // Sort by priority (descending) then timestamp (ascending)
        operations.sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority; // Higher priority first
          }
          return new Date(a.timestamp) - new Date(b.timestamp); // Older first
        });
        
        // Apply limit
        if (limit) {
          operations = operations.slice(0, limit);
        }
        
        resolve(operations);
      };
      request.onerror = () => resolve([]);
    });
  } catch (error) {
    console.error('[QueueService] Error getting pending operations:', error);
    return [];
  }
};

/**
 * Mark operation as complete
 */
export const markOperationComplete = async (operationId) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    
    const request = store.get(operationId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const operation = request.result;
        if (operation) {
          operation.status = 'completed';
          operation.completedAt = new Date().toISOString();
          store.put(operation);
          resolve(operation);
        } else {
          reject(new Error('Operation not found'));
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[QueueService] Error marking operation complete:', error);
    throw error;
  }
};

/**
 * Mark operation as failed and increment retry count
 */
export const markOperationFailed = async (operationId, error) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    
    const request = store.get(operationId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const operation = request.result;
        if (operation) {
          operation.retryCount = (operation.retryCount || 0) + 1;
          operation.lastAttempt = new Date().toISOString();
          operation.error = {
            message: error.message || String(error),
            code: error.code,
            status: error.response?.status
          };
          
          // Mark as failed if max retries exceeded
          if (operation.retryCount >= MAX_RETRIES) {
            operation.status = 'failed';
            operation.failedAt = new Date().toISOString();
          }
          
          store.put(operation);
          resolve(operation);
        } else {
          reject(new Error('Operation not found'));
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[QueueService] Error marking operation failed:', error);
    throw error;
  }
};

/**
 * Calculate retry delay with exponential backoff
 */
export const getRetryDelay = (retryCount) => {
  const delay = Math.min(
    INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
    MAX_RETRY_DELAY
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
};

/**
 * Remove completed/failed operations older than specified days
 */
export const cleanupOldOperations = async (daysOld = 7) => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const index = store.index('status');
    const completedRequest = index.getAll('completed');
    const failedRequest = index.getAll('failed');
    
    return new Promise((resolve) => {
      let processed = 0;
      let toDelete = [];
      
      const processResults = (operations) => {
        operations.forEach(op => {
          const opDate = new Date(op.completedAt || op.failedAt || op.timestamp);
          if (opDate < cutoffDate) {
            toDelete.push(op.id);
          }
        });
        
        processed++;
        if (processed === 2) {
          // Delete old operations
          toDelete.forEach(id => store.delete(id));
          console.log(`[QueueService] Cleaned up ${toDelete.length} old operations`);
          resolve(toDelete.length);
        }
      };
      
      completedRequest.onsuccess = () => processResults(completedRequest.result || []);
      failedRequest.onsuccess = () => processResults(failedRequest.result || []);
    });
  } catch (error) {
    console.error('[QueueService] Error cleaning up operations:', error);
    return 0;
  }
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOperations', 'readonly');
    const store = tx.objectStore('pendingOperations');
    const request = store.getAll();
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const operations = request.result || [];
        const stats = {
          total: operations.length,
          pending: operations.filter(op => op.status === 'pending').length,
          completed: operations.filter(op => op.status === 'completed').length,
          failed: operations.filter(op => op.status === 'failed').length,
          byType: {},
          byPriority: {}
        };
        
        operations.forEach(op => {
          stats.byType[op.type] = (stats.byType[op.type] || 0) + 1;
          stats.byPriority[op.priority] = (stats.byPriority[op.priority] || 0) + 1;
        });
        
        resolve(stats);
      };
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.error('[QueueService] Error getting queue stats:', error);
    return null;
  }
};


