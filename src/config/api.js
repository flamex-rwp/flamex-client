// API Configuration - Use environment variable
const BASE_URL = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001').replace(/\/$/, '');
export const API_BASE_URL = `${BASE_URL}/api`;

// API Endpoints
export const API_ENDPOINTS = {
  // Categories
  CATEGORIES: `${API_BASE_URL}/categories`,
  CATEGORY_BY_ID: (id) => `${API_BASE_URL}/categories/${id}`,

  // Menu Items
  MENU_ITEMS: `${API_BASE_URL}/menu-items`,
  MENU_ITEM_BY_ID: (id) => `${API_BASE_URL}/menu-items/${id}`,

  // Orders
  ORDERS: `${API_BASE_URL}/orders`,
  ORDER_BY_ID: (id) => `${API_BASE_URL}/orders/${id}`,
  ORDER_ITEMS: (id) => `${API_BASE_URL}/orders/${id}/items`,
  ITEMS_SALES: `${API_BASE_URL}/orders/items-sales`,

  // Expenses
  EXPENSES: `${API_BASE_URL}/expenses`,
  EXPENSE_BY_ID: (id) => `${API_BASE_URL}/expenses/${id}`,

  // Printer
  TEST_PRINTER: `${API_BASE_URL}/test-printer`,
  PRINTER_STATUS: `${API_BASE_URL}/printer-status`,
};

// HTTP Methods Helper
export const apiRequest = async (url, options = {}) => {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API request failed');
    }

    return await response.json();
  } catch (error) {
    console.error('API Request Error:', error);
    throw error;
  }
};

// API Service Functions
export const apiService = {
  // Categories
  getCategories: () => apiRequest(API_ENDPOINTS.CATEGORIES),
  createCategory: (data) => apiRequest(API_ENDPOINTS.CATEGORIES, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  deleteCategory: (id) => apiRequest(API_ENDPOINTS.CATEGORY_BY_ID(id), {
    method: 'DELETE',
  }),

  // Menu Items
  getMenuItems: () => apiRequest(API_ENDPOINTS.MENU_ITEMS),
  createMenuItem: (data) => apiRequest(API_ENDPOINTS.MENU_ITEMS, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateMenuItem: (id, data) => apiRequest(API_ENDPOINTS.MENU_ITEM_BY_ID(id), {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteMenuItem: (id) => apiRequest(API_ENDPOINTS.MENU_ITEM_BY_ID(id), {
    method: 'DELETE',
  }),

  // Orders
  getOrders: () => apiRequest(API_ENDPOINTS.ORDERS),
  getOrder: (id) => apiRequest(API_ENDPOINTS.ORDER_BY_ID(id)),
  getOrderItems: (id) => apiRequest(API_ENDPOINTS.ORDER_ITEMS(id)),
  createOrder: (data) => apiRequest(API_ENDPOINTS.ORDERS, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateOrder: (id, data) => apiRequest(API_ENDPOINTS.ORDER_BY_ID(id), {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  getItemsSales: () => apiRequest(API_ENDPOINTS.ITEMS_SALES),

  // Expenses
  getExpenses: () => apiRequest(API_ENDPOINTS.EXPENSES),
  createExpense: (data) => apiRequest(API_ENDPOINTS.EXPENSES, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateExpense: (id, data) => apiRequest(API_ENDPOINTS.EXPENSE_BY_ID(id), {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteExpense: (id) => apiRequest(API_ENDPOINTS.EXPENSE_BY_ID(id), {
    method: 'DELETE',
  }),

  // Printer
  testPrinter: () => apiRequest(API_ENDPOINTS.TEST_PRINTER, {
    method: 'POST',
  }),
  getPrinterStatus: () => apiRequest(API_ENDPOINTS.PRINTER_STATUS),
};

export default apiService;
