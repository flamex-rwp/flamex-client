/**
 * Universal Cache Service
 * 
 * Caches ALL API responses to IndexedDB with full field preservation.
 * Provides a unified interface for caching and retrieving API responses.
 */

// Use the existing database from offlineDB.js
// All schema upgrades are handled in offlineDB.js
import { openDB } from '../utils/offlineDB';

/**
 * Generate cache key from URL and params
 * Handles both URL query params and params object
 */
const generateCacheKey = (url, method = 'GET', params = {}) => {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`, window.location.origin);
    const urlPath = urlObj.pathname;
    
    // Merge URL query params with params object
    const allParams = { ...params };
    urlObj.searchParams.forEach((value, key) => {
      // URL params take precedence if both exist
      allParams[key] = value;
    });
    
    // Sort params for consistent keys
    const sortedKeys = Object.keys(allParams).sort();
    const sortedParams = sortedKeys
      .map(key => `${key}=${allParams[key]}`)
      .join('&');
    
    const fullKey = `${method}:${urlPath}${sortedParams ? `?${sortedParams}` : ''}`;
    
    return fullKey;
  } catch (error) {
    // Fallback if URL parsing fails
    console.warn('[CacheService] URL parsing failed, using simple key:', error);
    return `${method}:${url}`;
  }
};

/**
 * Determine resource type from URL
 */
const getResourceType = (url) => {
  if (url.includes('/api/orders')) return 'orders';
  if (url.includes('/api/menu-items')) return 'menu-items';
  if (url.includes('/api/categories')) return 'categories';
  if (url.includes('/api/customers')) return 'customers';
  if (url.includes('/api/expenses')) return 'expenses';
  if (url.includes('/api/reports')) return 'reports';
  if (url.includes('/api/riders')) return 'riders';
  if (url.includes('/api/business-info')) return 'business-info';
  return 'unknown';
};

/**
 * Cache expenses to dedicated expenses store
 */
const cacheExpensesToStore = async (expenses) => {
  try {
    if (!Array.isArray(expenses) || expenses.length === 0) return;
    
    const db = await openDB();
    const tx = db.transaction('expenses', 'readwrite');
    const store = tx.objectStore('expenses');
    const now = new Date().toISOString();
    
    return new Promise((resolve) => {
      let processed = 0;
      const total = expenses.length;
      
      if (total === 0) {
        resolve();
        return;
      }
      
      expenses.forEach(expense => {
        if (expense.id) {
          const request = store.put({
            ...expense,
            lastSynced: now
          });
          request.onsuccess = () => {
            processed++;
            if (processed === total) {
              console.log('[CacheService] Cached expenses to store:', total);
              resolve();
            }
          };
          request.onerror = () => {
            processed++;
            if (processed === total) resolve();
          };
        } else {
          processed++;
          if (processed === total) resolve();
        }
      });
    });
  } catch (error) {
    console.error('[CacheService] Error caching expenses to store:', error);
  }
};

/**
 * Cache an API response
 * Preserves ALL fields from the server response
 */
export const cacheAPIResponse = async (url, method, responseData, params = {}) => {
  try {
    const db = await openDB();
    const tx = db.transaction('api-responses', 'readwrite');
    const store = tx.objectStore('api-responses');
    
    // Normalize URL - ensure it includes query params
    let normalizedUrl = url;
    if (!normalizedUrl.includes('?') && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      normalizedUrl = `${url}?${queryString}`;
    }
    
    const cacheKey = generateCacheKey(normalizedUrl, method, params);
    const resourceType = getResourceType(normalizedUrl);
    
    // Preserve the ENTIRE response object - no field dropping
    const cacheEntry = {
      cacheKey,
      url: normalizedUrl, // Store normalized URL
      method,
      params: JSON.stringify(params),
      resourceType,
      data: responseData, // Store complete response - could be {data: {...}} or array or object
      timestamp: new Date().toISOString(),
      // Store raw response for debugging
      rawResponse: JSON.stringify(responseData)
    };

    return new Promise((resolve, reject) => {
      const request = store.put(cacheEntry);
      request.onsuccess = () => {
        console.log(`[CacheService] ✅ Cached ${method} ${normalizedUrl} (${resourceType}, key: ${cacheKey})`);
        
        // Also cache expenses to dedicated store if applicable
        if (resourceType === 'expenses') {
          const expenses = responseData.data?.expenses || responseData.data || responseData || [];
          if (Array.isArray(expenses)) {
            cacheExpensesToStore(expenses).catch(console.error);
          }
        }
        
        resolve(cacheEntry);
      };
      request.onerror = () => {
        console.error('[CacheService] Error caching API response:', request.error);
        resolve(null); // Don't reject - caching failures shouldn't break the app
      };
    });
  } catch (error) {
    console.error('[CacheService] Error caching API response:', error);
    // Don't throw - caching failures shouldn't break the app
    return null;
  }
};

/**
 * Get cached API response
 */
export const getCachedAPIResponse = async (url, method = 'GET', params = {}) => {
  try {
    const urlPath = url.split('?')[0];
    
    // Expenses - check dedicated store first
    if (urlPath === '/api/expenses' || urlPath.includes('/api/expenses')) {
      try {
        const db = await openDB();
        const tx = db.transaction('expenses', 'readonly');
        const store = tx.objectStore('expenses');
        const request = store.getAll();
        
        const expenses = await new Promise((resolve) => {
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
        });
        
        if (expenses.length > 0) {
          // Apply query params filtering if needed
          // Parse params from both URL and params object
          let startDate, endDate, filter;
          
          try {
          const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`, window.location.origin);
            // Check both URL params and params object (params object takes precedence)
            startDate = params.start || params.startDate || urlObj.searchParams.get('start') || urlObj.searchParams.get('startDate');
            endDate = params.end || params.endDate || urlObj.searchParams.get('end') || urlObj.searchParams.get('endDate');
            filter = params.filter || urlObj.searchParams.get('filter');
          } catch (e) {
            // If URL parsing fails, use params object directly
            startDate = params.start || params.startDate;
            endDate = params.end || params.endDate;
            filter = params.filter;
          }
          
          // Helper function to get expense date from various possible fields
          const getExpenseDate = (exp) => {
            // Try all possible date fields in order of preference
            const dateField = exp.expense_date || exp.expenseDate || exp.date || exp.createdAt || exp.created_at;
            if (!dateField) return null;
            
            try {
              const date = new Date(dateField);
              if (isNaN(date.getTime())) return null;
              return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
            } catch (e) {
              return null;
            }
          };
          
          let filtered = expenses;
          
          // Apply date range filter (custom range)
          if (startDate || endDate) {
            filtered = expenses.filter(exp => {
              const expDateStr = getExpenseDate(exp);
              if (!expDateStr) return false;
              
              if (startDate && expDateStr < startDate) return false;
              if (endDate && expDateStr > endDate) return false;
              return true;
            });
          } else if (filter) {
            // Apply date filter (today, yesterday, etc.)
            const now = new Date();
            let filterStartDate, filterEndDate;
            
            if (filter === 'today') {
              filterStartDate = now.toISOString().split('T')[0];
              filterEndDate = filterStartDate;
            } else if (filter === 'yesterday') {
              const yesterday = new Date(now);
              yesterday.setDate(yesterday.getDate() - 1);
              filterStartDate = yesterday.toISOString().split('T')[0];
              filterEndDate = filterStartDate;
            } else if (filter === 'this_week' || filter === 'this week') {
              const weekStart = new Date(now);
              weekStart.setDate(weekStart.getDate() - weekStart.getDay());
              weekStart.setHours(0, 0, 0, 0);
              filterStartDate = weekStart.toISOString().split('T')[0];
              filterEndDate = now.toISOString().split('T')[0];
            } else if (filter === 'this_month' || filter === 'this month') {
              filterStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
              filterEndDate = now.toISOString().split('T')[0];
            }
            
            if (filterStartDate && filterEndDate) {
              filtered = expenses.filter(exp => {
                const expDateStr = getExpenseDate(exp);
                if (!expDateStr) return false;
                return expDateStr >= filterStartDate && expDateStr <= filterEndDate;
              });
            }
          }
          
          // Sort by date descending (newest first) to match API behavior
          filtered.sort((a, b) => {
            const dateA = getExpenseDate(a);
            const dateB = getExpenseDate(b);
            if (!dateA || !dateB) return 0;
            return dateB.localeCompare(dateA); // Descending order
          });
          
          // Return filtered results even if empty (means we have data but filter matched nothing)
          // Only fall through if we have no expenses in store at all
          if (expenses.length > 0) {
            console.log(`[CacheService] Cache HIT (expenses store): ${method} ${url} - Found ${filtered.length} expenses (filtered from ${expenses.length})`);
            // Return in the same format as the API response, even if filtered array is empty
            return { data: { expenses: filtered } };
          }
        }
        // Fall through to api-responses check if no expenses found in store
      } catch (error) {
        console.error('[CacheService] Error getting cached expenses:', error);
        // Fall through to api-responses check
      }
    }
    
    // Check api-responses store
    const db = await openDB();
    const tx = db.transaction('api-responses', 'readonly');
    const store = tx.objectStore('api-responses');
    
    // Try exact match first
    const cacheKey = generateCacheKey(url, method, params);
    console.log(`[CacheService] Looking up cache for: ${method} ${url} (key: ${cacheKey})`);
    const request = store.get(cacheKey);
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.data) {
          console.log(`[CacheService] ✅ Cache HIT: ${method} ${url} (key: ${cacheKey})`);
          resolve(result.data);
        } else {
          // Try fallback: search by URL path (without query params) and method
          const urlPath = url.split('?')[0];
          const index = store.index('resourceType');
          const resourceType = getResourceType(url);
          console.log(`[CacheService] Trying fallback lookup for: ${method} ${urlPath} (resourceType: ${resourceType})`);
          const cursorRequest = index.openCursor(IDBKeyRange.only(resourceType));
          
          let foundMatch = false;
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const entry = cursor.value;
              // Check if URL path matches (ignore query params for fallback)
              if (entry.url && entry.url.split('?')[0] === urlPath && entry.method === method) {
                let cachedData = entry.data;
                
                // For expenses, apply filtering if params differ from cached params
                if (resourceType === 'expenses' && cachedData) {
                  const expenses = cachedData.data?.expenses || cachedData.expenses || cachedData || [];
                  if (Array.isArray(expenses) && expenses.length > 0) {
                    // Parse current request params
                    let startDate, endDate, filter;
                    try {
                      const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`, window.location.origin);
                      startDate = params.start || params.startDate || urlObj.searchParams.get('start') || urlObj.searchParams.get('startDate');
                      endDate = params.end || params.endDate || urlObj.searchParams.get('end') || urlObj.searchParams.get('endDate');
                      filter = params.filter || urlObj.searchParams.get('filter');
                    } catch (e) {
                      startDate = params.start || params.startDate;
                      endDate = params.end || params.endDate;
                      filter = params.filter;
                    }
                    
                    // Apply filtering if params are present
                    if (startDate || endDate || filter) {
                      const getExpenseDate = (exp) => {
                        const dateField = exp.expense_date || exp.expenseDate || exp.date || exp.createdAt || exp.created_at;
                        if (!dateField) return null;
                        try {
                          const date = new Date(dateField);
                          if (isNaN(date.getTime())) return null;
                          return date.toISOString().split('T')[0];
                        } catch (e) {
                          return null;
                        }
                      };
                      
                      let filtered = expenses;
                      
                      if (startDate || endDate) {
                        filtered = expenses.filter(exp => {
                          const expDateStr = getExpenseDate(exp);
                          if (!expDateStr) return false;
                          if (startDate && expDateStr < startDate) return false;
                          if (endDate && expDateStr > endDate) return false;
                          return true;
                        });
                      } else if (filter) {
                        const now = new Date();
                        let filterStartDate, filterEndDate;
                        
                        if (filter === 'today') {
                          filterStartDate = now.toISOString().split('T')[0];
                          filterEndDate = filterStartDate;
                        } else if (filter === 'yesterday') {
                          const yesterday = new Date(now);
                          yesterday.setDate(yesterday.getDate() - 1);
                          filterStartDate = yesterday.toISOString().split('T')[0];
                          filterEndDate = filterStartDate;
                        } else if (filter === 'this_week' || filter === 'this week') {
                          const weekStart = new Date(now);
                          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                          weekStart.setHours(0, 0, 0, 0);
                          filterStartDate = weekStart.toISOString().split('T')[0];
                          filterEndDate = now.toISOString().split('T')[0];
                        } else if (filter === 'this_month' || filter === 'this month') {
                          filterStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                          filterEndDate = now.toISOString().split('T')[0];
                        }
                        
                        if (filterStartDate && filterEndDate) {
                          filtered = expenses.filter(exp => {
                            const expDateStr = getExpenseDate(exp);
                            if (!expDateStr) return false;
                            return expDateStr >= filterStartDate && expDateStr <= filterEndDate;
                          });
                        }
                      }
                      
                      // Sort by date descending
                      filtered.sort((a, b) => {
                        const dateA = getExpenseDate(a);
                        const dateB = getExpenseDate(b);
                        if (!dateA || !dateB) return 0;
                        return dateB.localeCompare(dateA);
                      });
                      
                      cachedData = { data: { expenses: filtered } };
                      console.log(`[CacheService] ✅ Cache HIT (fallback with filtering): ${method} ${url} - Found ${filtered.length} expenses`);
                    }
                  }
                }
                
                console.log(`[CacheService] ✅ Cache HIT (fallback): ${method} ${url} (found: ${entry.url})`);
                resolve(cachedData);
                foundMatch = true;
                return;
              }
              cursor.continue();
            } else {
              if (!foundMatch) {
                console.log(`[CacheService] ❌ Cache MISS: ${method} ${url} (key: ${cacheKey})`);
                resolve(null);
              }
            }
          };
          
          cursorRequest.onerror = () => {
            if (!foundMatch) {
              console.log(`[CacheService] ❌ Cache MISS (error): ${method} ${url} (key: ${cacheKey})`);
              resolve(null);
            }
          };
        }
      };
      request.onerror = () => {
        console.error('[CacheService] Error getting cached response:', request.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('[CacheService] Error getting cached response:', error);
    return null;
  }
};

/**
 * Invalidate cache for a resource type or specific URL
 */
export const invalidateCache = async (resourceType = null, url = null) => {
  try {
    const db = await openDB();
    const tx = db.transaction('api-responses', 'readwrite');
    const store = tx.objectStore('api-responses');
    
    if (url) {
      // Invalidate specific URL
      const cacheKey = generateCacheKey(url);
      const request = store.delete(cacheKey);
      return new Promise((resolve) => {
        request.onsuccess = () => {
          console.log(`[CacheService] Invalidated cache for: ${url}`);
          resolve();
        };
        request.onerror = () => resolve();
      });
    } else if (resourceType) {
      // Invalidate all entries of a resource type
      const index = store.index('resourceType');
      const request = index.openCursor(IDBKeyRange.only(resourceType));
      
      return new Promise((resolve) => {
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            console.log(`[CacheService] Invalidated all cache for: ${resourceType}`);
            resolve();
          }
        };
        request.onerror = () => resolve();
      });
    }
  } catch (error) {
    console.error('[CacheService] Error invalidating cache:', error);
  }
};

/**
 * Clear all cached API responses
 */
export const clearAllCache = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('api-responses', 'readwrite');
    const store = tx.objectStore('api-responses');
    const request = store.clear();
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        console.log('[CacheService] Cleared all API cache');
        resolve();
      };
      request.onerror = () => resolve();
    });
  } catch (error) {
    console.error('[CacheService] Error clearing cache:', error);
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction('api-responses', 'readonly');
    const store = tx.objectStore('api-responses');
    const request = store.getAll();
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const entries = request.result || [];
        const stats = {
          totalEntries: entries.length,
          byResourceType: {},
          oldestEntry: null,
          newestEntry: null
        };
        
        let oldest = Infinity;
        let newest = 0;
        
        entries.forEach(entry => {
          // Count by resource type
          stats.byResourceType[entry.resourceType] = 
            (stats.byResourceType[entry.resourceType] || 0) + 1;
          
          // Find oldest and newest
          const timestamp = new Date(entry.timestamp).getTime();
          if (timestamp < oldest) {
            oldest = timestamp;
            stats.oldestEntry = entry;
          }
          if (timestamp > newest) {
            newest = timestamp;
            stats.newestEntry = entry;
          }
        });
        
        resolve(stats);
      };
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.error('[CacheService] Error getting cache stats:', error);
    return null;
  }
};
