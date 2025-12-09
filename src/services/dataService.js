/**
 * Data Service - Local-First Data Access Layer
 * 
 * Provides a unified interface for reading/writing data that:
 * 1. Reads from IndexedDB first (instant UI)
 * 2. Fetches from API if needed (background sync)
 * 3. Writes to IndexedDB immediately (optimistic updates)
 * 4. Queues operations for sync when offline
 */

import api from './api';
import { cacheAPIResponse, getCachedAPIResponse, invalidateCache } from './cacheService';
import { queueOperation } from './queueService';
import { isOnline } from './offlineSyncService';

// BroadcastChannel for multi-tab communication
const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
  ? new BroadcastChannel('flamex-data-updates')
  : null;

/**
 * Get data from cache first, then API if online
 */
export const getData = async (resource, params = {}, options = {}) => {
  const { 
    endpoint, 
    forceRefresh = false,
    useCache = true 
  } = options;
  
  const url = endpoint || `/api/${resource}`;
  
  // Try cache first (unless force refresh)
  if (useCache && !forceRefresh) {
    const cached = await getCachedAPIResponse(url, 'GET', params);
    if (cached) {
      // Return cached data immediately
      // Then fetch fresh data in background if online
      if (isOnline()) {
        fetchDataInBackground(url, params).catch(console.error);
      }
      return cached;
    }
  }
  
  // If no cache or force refresh, fetch from API
  if (isOnline()) {
    try {
      const response = await api.get(url, { params });
      return response.data;
    } catch (error) {
      // If API fails but we have cache, return cache
      if (useCache) {
        const cached = await getCachedAPIResponse(url, 'GET', params);
        if (cached) {
          console.warn('[DataService] API failed, using cache:', url);
          return cached;
        }
      }
      throw error;
    }
  } else {
    // Offline - return cache or throw
    const cached = await getCachedAPIResponse(url, 'GET', params);
    if (cached) {
      return cached;
    }
    throw new Error('No cached data available and offline');
  }
};

/**
 * Fetch data in background (for cache refresh)
 */
const fetchDataInBackground = async (url, params) => {
  try {
    const response = await api.get(url, { params });
    // Cache will be updated by API interceptor
    // Broadcast update to other tabs
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'DATA_UPDATED',
        url,
        params,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    // Silently fail - background refresh shouldn't break UI
    console.warn('[DataService] Background refresh failed:', url);
  }
};

/**
 * Create data (write operation)
 */
export const createData = async (resource, data, options = {}) => {
  const {
    endpoint,
    queueIfOffline = true,
    optimisticUpdate = true,
    onSuccess,
    onError
  } = options;
  
  const url = endpoint || `/api/${resource}`;
  
  // Generate temporary ID for optimistic update
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const optimisticData = { ...data, id: tempId, synced: false };
  
  // Optimistic update to cache
  if (optimisticUpdate) {
    try {
      await cacheAPIResponse(url, 'POST', { data: optimisticData }, {});
      // Broadcast update
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'DATA_CREATED',
          resource,
          data: optimisticData,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.warn('[DataService] Optimistic update failed:', error);
    }
  }
  
  // Try API if online
  if (isOnline()) {
    try {
      const response = await api.post(url, data);
      const serverData = response.data.data || response.data;
      
      // Update cache with server response
      await cacheAPIResponse(url, 'POST', response.data, {});
      
      // Invalidate list caches
      await invalidateCache(resource);
      
      // Broadcast update
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'DATA_CREATED',
          resource,
          data: serverData,
          timestamp: Date.now()
        });
      }
      
      if (onSuccess) onSuccess(serverData);
      return serverData;
    } catch (error) {
      // If API fails and queueIfOffline, queue operation
      if (queueIfOffline) {
        await queueOperation({
          type: `create_${resource}`,
          method: 'POST',
          endpoint: url,
          data,
          priority: 1
        });
      }
      if (onError) onError(error);
      throw error;
    }
  } else {
    // Offline - queue operation
    if (queueIfOffline) {
      await queueOperation({
        type: `create_${resource}`,
        method: 'POST',
        endpoint: url,
        data,
        priority: 1
      });
    }
    
    if (onSuccess) onSuccess(optimisticData);
    return optimisticData;
  }
};

/**
 * Update data
 */
export const updateData = async (resource, id, data, options = {}) => {
  const {
    endpoint,
    queueIfOffline = true,
    optimisticUpdate = true,
    onSuccess,
    onError
  } = options;
  
  const url = endpoint || `/api/${resource}/${id}`;
  const optimisticData = { ...data, id, synced: false };
  
  // Optimistic update
  if (optimisticUpdate) {
    try {
      await cacheAPIResponse(url, 'PUT', { data: optimisticData }, {});
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'DATA_UPDATED',
          resource,
          id,
          data: optimisticData,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.warn('[DataService] Optimistic update failed:', error);
    }
  }
  
  // Try API if online
  if (isOnline()) {
    try {
      const response = await api.put(url, data);
      const serverData = response.data.data || response.data;
      
      await cacheAPIResponse(url, 'PUT', response.data, {});
      await invalidateCache(resource);
      
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'DATA_UPDATED',
          resource,
          id,
          data: serverData,
          timestamp: Date.now()
        });
      }
      
      if (onSuccess) onSuccess(serverData);
      return serverData;
    } catch (error) {
      if (queueIfOffline) {
        await queueOperation({
          type: `update_${resource}`,
          method: 'PUT',
          endpoint: url,
          data: { id, ...data },
          priority: 1
        });
      }
      if (onError) onError(error);
      throw error;
    }
  } else {
    if (queueIfOffline) {
      await queueOperation({
        type: `update_${resource}`,
        method: 'PUT',
        endpoint: url,
        data: { id, ...data },
        priority: 1
      });
    }
    
    if (onSuccess) onSuccess(optimisticData);
    return optimisticData;
  }
};

/**
 * Delete data
 */
export const deleteData = async (resource, id, options = {}) => {
  const {
    endpoint,
    queueIfOffline = true,
    optimisticUpdate = true,
    onSuccess,
    onError
  } = options;
  
  const url = endpoint || `/api/${resource}/${id}`;
  
  // Optimistic delete (remove from cache)
  if (optimisticUpdate) {
    try {
      await invalidateCache(resource, url);
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'DATA_DELETED',
          resource,
          id,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.warn('[DataService] Optimistic delete failed:', error);
    }
  }
  
  // Try API if online
  if (isOnline()) {
    try {
      await api.delete(url);
      await invalidateCache(resource);
      
      if (broadcastChannel) {
        broadcastChannel.postMessage({
          type: 'DATA_DELETED',
          resource,
          id,
          timestamp: Date.now()
        });
      }
      
      if (onSuccess) onSuccess();
      return true;
    } catch (error) {
      if (queueIfOffline) {
        await queueOperation({
          type: `delete_${resource}`,
          method: 'DELETE',
          endpoint: url,
          data: { id },
          priority: 1
        });
      }
      if (onError) onError(error);
      throw error;
    }
  } else {
    if (queueIfOffline) {
      await queueOperation({
        type: `delete_${resource}`,
        method: 'DELETE',
        endpoint: url,
        data: { id },
        priority: 1
      });
    }
    
    if (onSuccess) onSuccess();
    return true;
  }
};

/**
 * Subscribe to data updates (for real-time UI updates)
 */
export const subscribe = (resource, callback) => {
  if (!broadcastChannel) {
    console.warn('[DataService] BroadcastChannel not supported');
    return () => {};
  }
  
  const handler = (event) => {
    if (event.data.type === 'DATA_UPDATED' && event.data.resource === resource) {
      callback(event.data);
    } else if (event.data.type === 'DATA_CREATED' && event.data.resource === resource) {
      callback(event.data);
    } else if (event.data.type === 'DATA_DELETED' && event.data.resource === resource) {
      callback(event.data);
    }
  };
  
  broadcastChannel.addEventListener('message', handler);
  
  // Return unsubscribe function
  return () => {
    broadcastChannel.removeEventListener('message', handler);
  };
};

// Export broadcast channel for external use
export { broadcastChannel };
