// API Wrapper that implements cache-first pattern for all API calls
import api, { API_BASE_URL } from './api';
import { getCachedAPIResponse, cacheAPIResponse } from '../utils/apiCache';
import { isOnline } from './offlineSyncService';

// Create wrapped axios instance with cache-first behavior
const createCachedRequest = (originalRequest) => {
  return async (...args) => {
    const config = typeof args[0] === 'string' 
      ? { url: args[0], method: args[1]?.method || 'GET', ...args[1] }
      : args[0];

    const method = (config.method || 'GET').toUpperCase();
    const url = config.url || '';
    const online = isOnline();

    // For GET requests, check cache first only when offline or explicitly allowed
    const allowCacheLookup = (!online || config?.useCache === true) && config?.disableCacheFallback !== true;
    if (method === 'GET' && allowCacheLookup) {
      try {
        const cachedResponse = await getCachedAPIResponse(url, method);
        if (cachedResponse) {
          console.log(`📦 Cache HIT: ${url}`);
          // Return cached response immediately
          return Promise.resolve({
            data: cachedResponse,
            status: 200,
            statusText: 'OK (Cached)',
            headers: {},
            config,
            isCached: true
          });
        }
        console.log(`📦 Cache MISS: ${url}`);
      } catch (cacheError) {
        console.warn('[APIWrapper] Cache lookup failed:', cacheError);
      }
    }

    // Make network request
    try {
      const response = await originalRequest(...args);
      
      // Cache successful GET responses
      if (method === 'GET' && response.data) {
        try {
          await cacheAPIResponse(url, method, response.data);
        } catch (cacheError) {
          console.warn('[APIWrapper] Failed to cache response:', cacheError);
        }
      }
      
      return response;
    } catch (error) {
      // If network fails and we have cache, return cache
      if (method === 'GET' && !error.response) {
        try {
          const cachedResponse = await getCachedAPIResponse(url, method);
          if (cachedResponse) {
            console.log(`📦 Network failed, serving from cache: ${url}`);
            return Promise.resolve({
              data: cachedResponse,
              status: 200,
              statusText: 'OK (Cached - Network Failed)',
              headers: {},
              config: error.config || config,
              isCached: true
            });
          }
        } catch (cacheError) {
          // No cache available, throw original error
        }
      }
      
      throw error;
    }
  };
};

// Wrap all axios methods
const cachedApi = {
  get: createCachedRequest(api.get.bind(api)),
  post: api.post.bind(api),
  put: api.put.bind(api),
  patch: api.patch.bind(api),
  delete: api.delete.bind(api),
  request: createCachedRequest(api.request.bind(api)),
  defaults: api.defaults,
  interceptors: api.interceptors
};

export default cachedApi;


