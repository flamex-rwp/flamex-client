import axios from 'axios';
import { cacheAPIResponse, getCachedAPIResponse } from '../services/cacheService';
import { isOnline } from './offlineSyncService';
import { serverErrorService } from './serverErrorService';

// Use environment variable for API URL
// Debug: Log all environment variables that start with REACT_APP
if (typeof window !== 'undefined') {
  console.log('🔍 Environment Variables Check:', {
    REACT_APP_API_BASE_URL: process.env.REACT_APP_API_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    allReactEnvVars: Object.keys(process.env).filter(key => key.startsWith('REACT_APP_'))
  });
}

export const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001').replace(/\/$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Add request interceptor for auth token and logging
api.interceptors.request.use(
  (config) => {
    // Add auth token
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Log request for debugging
    const method = config.method?.toUpperCase() || 'UNKNOWN';
    const url = config.url || 'UNKNOWN';
    console.log(`🔵 API Request: ${method} ${url}`, {
      params: config.params,
      data: config.data
    });

    // Debug telemetry removed - was causing ERR_CONNECTION_REFUSED errors

    // Mark GET requests for cache checking (only used when offline / network fail)
    if (method === 'GET') {
      config._shouldCheckCache = true;
    }

    return config;
  },
  (error) => {
    console.error('🔴 API Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for logging, error handling, and automatic caching
api.interceptors.response.use(
  async (response) => {
    // Log successful response
    const method = response.config.method?.toUpperCase() || 'UNKNOWN';
    const url = response.config.url || 'UNKNOWN';
    console.log(`🟢 API Response: ${method} ${url}`, response.data);

    // Automatically cache ALL successful responses to IndexedDB (GET, POST, PUT)
    // This ensures we have the latest server state cached locally
    // Skip caching auth endpoints
    if (response.data && !url.includes('/api/auth/')) {
      try {
        // Build full URL with query params for consistent caching
        const params = response.config.params || {};
        const fullUrl = url.includes('?') ? url : url + (Object.keys(params).length > 0 ? '?' + new URLSearchParams(params).toString() : '');
        await cacheAPIResponse(fullUrl, method, response.data, params);
        console.log(`✅ Cached response: ${method} ${fullUrl}`);
      } catch (cacheError) {
        console.warn('[API] Failed to cache response (non-critical):', cacheError);
        // Don't fail the request if caching fails
      }
    }

    return response;
  },
  async (error) => {
    // Extract detailed error message from backend
    const errorMsg = error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'Unknown error';

    const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
    const url = error.config?.url || 'UNKNOWN';
    const status = error.response?.status || 'N/A';

    // For GET requests when offline or network error, try to return cached data
    // Check for network errors: no response object, or network error code, or offline
    // Check if it's a network error (not a server validation error)
    const isNetworkError = !error.response || 
                          error.code === 'ERR_NETWORK' || 
                          error.message === 'Network Error';
    
    let hasCachedData = false;
    
    if (method === 'GET' && error.config?._shouldCheckCache && isNetworkError && !error.config?.disableCacheFallback) {
      try {
        const params = error.config.params || {};
        // Normalize URL - remove base URL if present, ensure it starts with /
        let normalizedUrl = url;
        if (normalizedUrl.startsWith('http')) {
          try {
            const urlObj = new URL(normalizedUrl);
            normalizedUrl = urlObj.pathname + urlObj.search;
          } catch (e) {
            // If URL parsing fails, try to extract path
            const match = normalizedUrl.match(/\/api\/.*/);
            if (match) normalizedUrl = match[0];
          }
        }
        if (!normalizedUrl.startsWith('/')) {
          normalizedUrl = '/' + normalizedUrl;
        }
        
        // Build full URL with query params for cache lookup
        const fullUrl = normalizedUrl.includes('?') 
          ? normalizedUrl 
          : normalizedUrl + (Object.keys(params).length > 0 ? '?' + new URLSearchParams(params).toString() : '');
        
        const cachedResponse = await getCachedAPIResponse(fullUrl, method, params);
        if (cachedResponse) {
          console.log(`📦 Serving from cache (${!isOnline() ? 'offline' : 'network error'}): ${fullUrl}`);
          hasCachedData = true;
          // Return cached response wrapped in axios format
          return Promise.resolve({
            data: cachedResponse,
            status: 200,
            statusText: 'OK (Cached)',
            headers: {},
            config: error.config,
            isCached: true
          });
        } else {
          console.log(`📦 No cache available for: ${fullUrl}`);
        }
      } catch (cacheError) {
        console.warn('[API] Cache lookup failed:', cacheError);
      }
    }

    console.error(`🔴 API Error: ${method} ${url} [${status}]`, {
      message: errorMsg,
      data: error.response?.data,
      fullError: error,
      isNetworkError: !error.response
    });

    // Debug telemetry removed - was causing ERR_CONNECTION_REFUSED errors

    // Trigger server connection modal ONLY for auth endpoints
    // Show modal if:
    // 1. Endpoint is auth AND network error (no cache or non-GET)
    // 2. Endpoint is auth AND server error (500+)
    const isServerError = error.response?.status >= 500;
    const isAuthEndpoint = url.includes('/api/auth/');
    const shouldShowModal = isAuthEndpoint && ((isNetworkError && !hasCachedData) || isServerError);
    
    // #region agent log
    // Debug telemetry removed - was causing ERR_CONNECTION_REFUSED errors
    // #endregion
    
    if (shouldShowModal) {
      serverErrorService.triggerError(error);
    }

    // Handle unauthorized - clear auth and redirect
    if (error.response?.status === 401) {
      // Don't redirect if we're already on the login page or if it's the me check
      const isAuthCheck = url.includes('/auth/me');
      const isLoginPage = window.location.pathname === '/login';

      if (!isAuthCheck && !isLoginPage) {
        console.warn('🔴 Unauthorized - redirecting to login');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      } else {
        // Just clear local storage if auth check failed (so we don't try again with invalid token)
        if (isAuthCheck) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/api/auth/login', credentials),
  logout: () => api.post('/api/auth/logout'),
  getCurrentUser: () => api.get('/api/auth/me'),
};

// Categories API
export const categoriesAPI = {
  getAll: () => api.get('/api/categories'),
  create: (data) => api.post('/api/categories', data),
  delete: (id) => api.delete(`/api/categories/${id}`),
};

// Menu Items API
export const menuItemsAPI = {
  getAll: () => api.get('/api/menu-items'),
  create: (data) => api.post('/api/menu-items', data),
  update: (id, data) => api.put(`/api/menu-items/${id}`, data),
  delete: (id) => api.delete(`/api/menu-items/${id}`),
};

// Orders API - UPDATED TO MATCH BACKEND ROUTES
export const ordersAPI = {
  // Basic CRUD
  create: (data) => api.post('/api/orders', data),
  getAll: (params) => api.get('/api/orders', { params }),
  getById: (id) => api.get(`/api/orders/${id}`),
  getOrderItems: (id) => api.get(`/api/orders/${id}/items`),
  update: (id, data) => api.put(`/api/orders/${id}`, data),
  cancelOrder: (id) => api.put(`/api/orders/${id}/cancel`),

  // Dine-in orders
  getDineInOrders: (params = {}) => {
    const queryParams = { status: 'pending', ...params };
    return api.get('/api/orders/dine-in/active', { params: queryParams });
  },
  getDineInStats: (params = {}, config = {}) => api.get('/api/orders/dine-in/stats', { params, ...config }),
  markAsPaid: (id, data) => api.put(`/api/orders/${id}/mark-paid`, data),
  getTableAvailability: () => api.get('/api/orders/dine-in/tables/availability'),

  // Delivery orders
  getDeliveryOrders: (params = {}) => {
    const queryParams = { status: 'pending', ...params };
    return api.get('/api/orders/delivery/active', { params: queryParams });
  },
  getDeliveryStats: (params = {}, config = {}) => api.get('/api/orders/delivery/stats', { params, ...config }),
  assignRider: (id, riderId) => api.put(`/api/orders/${id}/assign-rider`, { riderId }),
  updateDeliveryStatus: (id, deliveryStatus) => api.put(`/api/orders/${id}/delivery/status`, { deliveryStatus }),

  // Order status updates (for both dine-in and delivery)
  updateOrderStatus: (id, order_status) => api.put(`/api/orders/${id}/status`, { order_status }),

  // Reports
  getOrderStatistics: (params) => api.get('/api/orders/statistics/summary', { params }),
  getItemsSales: (params) => api.get('/api/orders/reports/sales', { params }), // Renamed from getItemsSalesReport
  getItemsSalesReport: (params) => api.get('/api/orders/reports/sales', { params }), // Keep old name for backward compatibility

  // History
  getOrderHistory: (id) => api.get(`/api/orders/${id}/history`), // Added for frontend compatibility
  getOrderEditHistory: (id) => api.get(`/api/orders/${id}/history`),
};

// Delivery API (simplified - using ordersAPI instead)
export const deliveryAPI = {
  getActive: () => api.get('/api/orders/delivery/active'),
  getCompleted: () => api.get('/api/orders/delivery/completed'),
  assignRider: (orderId, riderId) => ordersAPI.assignRider(orderId, riderId),
  markDelivered: (orderId, data) => ordersAPI.updateDeliveryStatus(orderId, 'delivered'),
};

// Riders API
export const ridersAPI = {
  getAll: () => api.get('/api/riders'),
  getActive: () => api.get('/api/riders?status=active'),
  create: (data) => api.post('/api/riders', data),
  update: (id, data) => api.put(`/api/riders/${id}`, data),
};

// Reports API - UPDATED TO MATCH BACKEND ROUTES
export const reportsAPI = {
  getOrderSummary: (params) => api.get('/api/reports/order-summary', { params }),
  getTopSellingItems: (params) => api.get('/api/reports/top-items', { params }),
  getFinancialSummary: (params) => api.get('/api/reports/financial-summary', { params }),
  getProfitLoss: (params) => api.get('/api/reports/profit-loss', { params }),
  getDailySales: (date) => api.get('/api/reports/daily-sales', { params: { date } }),
  getMonthlySales: (params) => api.get('/api/reports/monthly-sales', { params }),
  getCustomerLoyalty: (params) => api.get('/api/reports/customer-loyalty', { params }),
  getRiderPerformance: (params) => api.get('/api/reports/rider-performance', { params }),
  // Delivery reports
  getOverview: (params) => api.get('/api/reports/overview', { params }),
  getAreaAnalysis: (params) => api.get('/api/reports/area-analysis', { params }),
  getPendingCOD: (params) => api.get('/api/reports/pending-cod', { params }),
};

// Expenses API
export const expensesAPI = {
  getAll: (params) => api.get('/api/expenses', { params }),
  create: (data) => api.post('/api/expenses', data),
  update: (id, data) => api.put(`/api/expenses/${id}`, data),
  delete: (id) => api.delete(`/api/expenses/${id}`),
};

// Printer API - UPDATED TO MATCH BACKEND ROUTES
export const printerAPI = {
  status: () => api.get('/api/printer/status'),
  test: () => api.post('/api/printer/test'),
};

// Business Info API
export const businessInfoAPI = {
  getAll: () => api.get('/api/business-info'),
  update: (key, value) => api.put(`/api/business-info/${key}`, { value }),
};

export default api;