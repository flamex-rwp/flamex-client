import api from './api';

export const customerAPI = {
  // Search customers by phone, name, or address - matches backend route /api/customers/search?q=query
  search: (query) => api.get('/api/customers/search', { params: { q: query } }),

  // Search customers by partial phone number (for dynamic dropdown)
  searchByPhone: (partialPhone, limit = 10) =>
    api.get('/api/customers/search-by-phone', { params: { q: partialPhone, limit } }),

  // List customers with pagination
  list: (page = 1, limit = 25, params = {}) =>
    api.get('/api/customers', {
      params: { page, limit, ...params }
    }),

  // Get customer by ID
  getById: (id) => api.get(`/api/customers/${id}`),

  // Create new customer
  create: (data) => api.post('/api/customers', data),

  // Update customer
  update: (id, data) => api.put(`/api/customers/${id}`, data),

  // Delete customer
  delete: (id) => api.delete(`/api/customers/${id}`),

  // Get customer orders
  getOrders: (customerId, params = {}) =>
    api.get(`/api/customers/${customerId}/orders`, { params }),

  // Get customer loyalty data
  getLoyaltyData: (customerId) =>
    api.get(`/api/customers/${customerId}/loyalty`),

  // Address management
  getAddresses: (customerId) =>
    api.get(`/api/customers/${customerId}/addresses`),

  createAddress: (customerId, data) =>
    api.post(`/api/customers/${customerId}/addresses`, data),

  updateAddress: (addressId, data) =>
    api.put(`/api/customers/addresses/${addressId}`, data),

  deleteAddress: (addressId) =>
    api.delete(`/api/customers/addresses/${addressId}`),

  // Find or create customer by phone (auto-create if not found)
  findOrCreate: (data) =>
    api.post('/api/customers/find-or-create', data),
};