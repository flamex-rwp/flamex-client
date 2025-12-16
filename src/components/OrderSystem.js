import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { menuItemsAPI, ordersAPI, API_BASE_URL } from '../services/api';
import { printReceipt } from './Receipt';
import OfflineIndicator from './OfflineIndicator';
import { customerAPI } from '../services/customerAPI';
import { saveOfflineOrder, cacheMenuItems, getCachedMenuItems, getCachedTableAvailability, getOfflineOrderById, updateOfflineOrder, addPendingOperation, getAllOrders, cacheTableAvailability } from '../utils/offlineDB';
import { isOnline } from '../utils/offlineSync';
import { isOnline as checkServerOnline } from '../services/offlineSyncService';
import { useToast } from '../contexts/ToastContext';
import { keyboardShortcuts } from '../utils/keyboardShortcuts';
import EmptyState from './EmptyState';
import CustomerAddressSelector from './CustomerAddressSelector';

const createCartTemplate = (id, name = `Cart ${id}`) => ({
  id,
  name,
  items: [],
  paymentMethod: 'cash',
  amountTaken: '',
  specialInstructions: '',
  orderType: 'dine_in',
  tableNumber: '',
  deliveryName: '',
  deliveryPhone: '',
  deliveryBackupPhone: '',
  deliveryAddress: '',
  deliveryNotes: '',
  googleMapsLink: '',
  deliveryCharge: '',
  deliveryPaymentType: 'cod',
  discountPercent: 0
});

const OrderSystem = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showSuccess, showError, showInfo } = useToast();
  const [menuItems, setMenuItems] = useState([]);

  // Helper function to get initials for fallback image
  const getInitials = (name) => {
    if (!name) return '🍽️';
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  // Add these missing state variables
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const searchDebounceRef = useRef(null);

  const [carts, setCarts] = useState([createCartTemplate(1, 'Cart 1')]);
  const [activeCartId, setActiveCartId] = useState(1);
  const [nextCartId, setNextCartId] = useState(2);
  const [checkoutError, setCheckoutError] = useState('');
  const [editingOrder, setEditingOrder] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editLoadError, setEditLoadError] = useState('');
  const [occupiedTables, setOccupiedTables] = useState([]);
  const [phoneSuggestions, setPhoneSuggestions] = useState([]);
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [phoneSearchLoading, setPhoneSearchLoading] = useState(false);
  const reserveTableRef = useRef(null);
  const releaseTableRef = useRef(null);

  const activeCart = carts.find(c => c.id === activeCartId) || carts[0];
  const cart = activeCart.items;
  const amountTaken = activeCart.amountTaken;
  const specialInstructions = activeCart.specialInstructions;
  const orderType = activeCart.orderType || 'dine_in';
  const tableNumber = activeCart.tableNumber || '';
  const deliveryName = activeCart.deliveryName || '';
  const deliveryPhone = activeCart.deliveryPhone || '';
  const deliveryBackupPhone = activeCart.deliveryBackupPhone || '';
  const deliveryAddress = activeCart.deliveryAddress || '';
  const deliveryNotes = activeCart.deliveryNotes || '';
  const googleMapsLink = activeCart.googleMapsLink || '';
  const deliveryCharge = activeCart.deliveryCharge === 0 ? '0' : (activeCart.deliveryCharge || '');
  const deliveryPaymentType = activeCart.deliveryPaymentType || 'cod';
  const discountPercent = activeCart.discountPercent || 0;
  const isDelivery = orderType === 'delivery';
  const parsedDeliveryCharge = deliveryCharge === '' ? 0 : (parseFloat(deliveryCharge) || 0);

  useEffect(() => {
    const fetchOccupiedTables = async () => {
      if (isDelivery) return;

      try {
        if (isOnline()) {
          // Fetch from API when online
          const response = await ordersAPI.getTableAvailability();
          const tables = response.data.data?.occupied_tables || [];
          // Normalize table structure to ensure consistent format
          const normalizedTables = tables.map(t => ({
            tableNumber: t.tableNumber || t.table_number,
            id: t.id,
            orderId: t.id,
            orderNumber: t.orderNumber || t.order_number
          }));
          setOccupiedTables(normalizedTables);
          // Persist latest server state to offline cache so going offline reflects reality
          try {
            await cacheTableAvailability(normalizedTables);
          } catch (err) {
            console.warn('[OrderSystem] Failed to cache latest table availability:', err);
          }
        } else {
          // Load from cache when offline
          const cachedTables = await getCachedTableAvailability();
          console.log('[OrderSystem] Cached tables from store:', cachedTables);

          // Also check offline orders that might be occupying tables
          const allOrders = await getAllOrders();
          console.log('[OrderSystem] All orders from IndexedDB:', allOrders.length);

          // Filter for dine-in orders with pending payment status and table numbers
          const offlineOccupiedTables = allOrders
            .filter(order =>
              order.orderType === 'dine_in' &&
              order.paymentStatus === 'pending' &&
              order.orderStatus !== 'cancelled' &&
              order.tableNumber !== null &&
              order.tableNumber !== undefined
            )
            .map(order => ({
              tableNumber: order.tableNumber,
              table_number: order.tableNumber,
              id: order.id,
              orderId: order.id,
              orderNumber: order.orderNumber || order.order_number,
              order_number: order.orderNumber || order.order_number
            }));

          console.log('[OrderSystem] Offline occupied tables from orders:', offlineOccupiedTables);

          // Combine cached tables and offline orders, removing duplicates
          // Remove any cached tables that no longer have corresponding offline orders
          const combinedTables = [...cachedTables].filter(t => {
            const tNum = t.tableNumber || t.table_number;
            return offlineOccupiedTables.some(o => String(o.tableNumber) === String(tNum));
          });
          offlineOccupiedTables.forEach(offlineTable => {
            const tableNum = offlineTable.tableNumber;
            // Check if this table is already in the list
            const exists = combinedTables.some(t => {
              const tNum = t.tableNumber || t.table_number;
              return tNum !== null && tNum !== undefined && parseInt(tNum) === parseInt(tableNum);
            });
            if (!exists) {
              combinedTables.push(offlineTable);
            }
          });

          console.log('[OrderSystem] Combined occupied tables (offline):', combinedTables);
          setOccupiedTables(combinedTables);
        }
      } catch (error) {
        console.warn('Failed to fetch table availability:', error);
        // Try to load from cache as fallback
        try {
          const cachedTables = await getCachedTableAvailability();

          // Also check offline orders
          try {
            const allOrders = await getAllOrders();
            const offlineOccupiedTables = allOrders
              .filter(order =>
                order.orderType === 'dine_in' &&
                order.paymentStatus === 'pending' &&
                order.orderStatus !== 'cancelled' &&
                order.tableNumber !== null &&
                order.tableNumber !== undefined
              )
              .map(order => ({
                tableNumber: order.tableNumber,
                table_number: order.tableNumber,
                id: order.id,
                orderId: order.id,
                orderNumber: order.orderNumber || order.order_number,
                order_number: order.orderNumber || order.order_number
              }));

            const combinedTables = [...cachedTables];
            offlineOccupiedTables.forEach(offlineTable => {
              const tableNum = offlineTable.tableNumber;
              const exists = combinedTables.some(t =>
                (t.tableNumber || t.table_number) === tableNum
              );
              if (!exists) {
                combinedTables.push(offlineTable);
              }
            });

            setOccupiedTables(combinedTables);
          } catch (offlineError) {
            console.warn('Failed to load offline orders:', offlineError);
            setOccupiedTables(cachedTables || []);
          }
        } catch (cacheError) {
          console.warn('Failed to load cached tables:', cacheError);
          setOccupiedTables([]);
        }
      }
    };

    // Fetch immediately on mount and when order type changes
    fetchOccupiedTables();

    // Refresh when window becomes visible (user navigates back to tab)
    const handleVisibilityChange = () => {
      if (!document.hidden && !isDelivery) {
        fetchOccupiedTables();
      }
    };

    // Refresh when window gains focus
    const handleFocus = () => {
      if (!isDelivery) {
        fetchOccupiedTables();
      }
    };

    // Set up interval for periodic updates
    const interval = setInterval(fetchOccupiedTables, 30000);

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isDelivery]);

  // Also update occupied tables when orders change (for offline mode)
  useEffect(() => {
    if (isDelivery || isOnline()) return;

    const updateOccupiedTablesFromOrders = async () => {
      try {
        const cachedTables = await getCachedTableAvailability();
        const allOrders = await getAllOrders();

        // Filter for dine-in orders with pending payment status and table numbers
        const offlineOccupiedTables = allOrders
          .filter(order =>
            order.orderType === 'dine_in' &&
            order.paymentStatus === 'pending' &&
            order.orderStatus !== 'cancelled' &&
            order.tableNumber !== null &&
            order.tableNumber !== undefined
          )
          .map(order => ({
            tableNumber: order.tableNumber,
            table_number: order.tableNumber,
            id: order.id,
            orderId: order.id,
            orderNumber: order.orderNumber || order.order_number,
            order_number: order.orderNumber || order.order_number
          }));

        // Combine cached tables and offline orders, removing duplicates
        const combinedTables = [...cachedTables].filter(t => {
          const tNum = t.tableNumber || t.table_number;
          return offlineOccupiedTables.some(o => parseInt(o.tableNumber) === parseInt(tNum));
        });
        offlineOccupiedTables.forEach(offlineTable => {
          const tableNum = offlineTable.tableNumber;
          // Check if this table is already in the list
          const exists = combinedTables.some(t =>
            (t.tableNumber || t.table_number) === tableNum
          );
          if (!exists) {
            combinedTables.push(offlineTable);
          }
        });

        console.log('[OrderSystem] Updated occupied tables from orders:', combinedTables);
        setOccupiedTables(combinedTables);
      } catch (error) {
        console.warn('Failed to update occupied tables from orders:', error);
      }
    };

    // Update immediately
    updateOccupiedTablesFromOrders();

    // Set up interval to check for changes
    const interval = setInterval(updateOccupiedTablesFromOrders, 5000);

    return () => clearInterval(interval);
  }, [isDelivery]);

  // Helpers to reserve/release tables locally and persist to cache
  reserveTableRef.current = useCallback(async (tableNum, orderInfo = {}) => {
    if (isDelivery) return;
    const numericTable = parseInt(tableNum);
    if (Number.isNaN(numericTable)) return;

    // Update local state so the UI immediately disables the table
    setOccupiedTables(prev => {
      const exists = prev.some(t => parseInt(t.tableNumber || t.table_number) === numericTable);
      if (exists) return prev;
      return [...prev, {
        tableNumber: numericTable,
        table_number: numericTable,
        id: orderInfo.orderId || orderInfo.id || null,
        orderId: orderInfo.orderId || orderInfo.id || null,
        orderNumber: orderInfo.orderNumber || orderInfo.order_number || null,
        order_number: orderInfo.orderNumber || orderInfo.order_number || null
      }];
    });

    // Persist to cached table availability so refresh keeps it reserved
    try {
      const cached = await getCachedTableAvailability();
      const exists = cached.some(t => parseInt(t.tableNumber || t.table_number) === numericTable);
      if (!exists) {
        const merged = [...cached, {
          tableNumber: numericTable,
          table_number: numericTable,
          id: orderInfo.orderId || orderInfo.id || null,
          orderId: orderInfo.orderId || orderInfo.id || null,
          orderNumber: orderInfo.orderNumber || orderInfo.order_number || null,
          order_number: orderInfo.orderNumber || orderInfo.order_number || null
        }];
        await cacheTableAvailability(merged);
      }
    } catch (err) {
      console.warn('[OrderSystem] Failed to persist offline table reservation:', err);
    }
  }, [isDelivery]);

  releaseTableRef.current = useCallback(async (tableNum) => {
    if (isDelivery) return;
    const numericTable = parseInt(tableNum);
    if (Number.isNaN(numericTable)) return;

    setOccupiedTables(prev => prev.filter(t => parseInt(t.tableNumber || t.table_number) !== numericTable));

    try {
      const cached = await getCachedTableAvailability();
      const filtered = cached.filter(t => parseInt(t.tableNumber || t.table_number) !== numericTable);
      await cacheTableAvailability(filtered);
    } catch (err) {
      console.warn('[OrderSystem] Failed to persist table release:', err);
    }
  }, [isDelivery]);

  // Listen for table release events from other parts of the app
  useEffect(() => {
    const handleTableFreed = async (event) => {
      const tableNum = event?.detail?.tableNumber;
      if (!tableNum) return;
      if (releaseTableRef.current) {
        await releaseTableRef.current(tableNum);
      }
    };
    window.addEventListener('tableFreed', handleTableFreed);
    return () => window.removeEventListener('tableFreed', handleTableFreed);
  }, []);

  // Local helper to reserve a table in offline cache/state when creating dine-in orders offline
  reserveTableRef.current = useCallback(async (tableNum, orderInfo = {}) => {
    if (isDelivery) return;
    const numericTable = parseInt(tableNum);
    if (Number.isNaN(numericTable)) return;

    // Update local state so UI reflects reservation immediately
    setOccupiedTables(prev => {
      const exists = prev.some(t => parseInt(t.tableNumber || t.table_number) === numericTable);
      if (exists) return prev;
      return [...prev, {
        tableNumber: numericTable,
        table_number: numericTable,
        id: orderInfo.orderId || orderInfo.id || null,
        orderId: orderInfo.orderId || orderInfo.id || null,
        orderNumber: orderInfo.orderNumber || orderInfo.order_number || null,
        order_number: orderInfo.orderNumber || orderInfo.order_number || null
      }];
    });

    // Persist to cached table availability so a refresh still shows it occupied
    try {
      const cached = await getCachedTableAvailability();
      const exists = cached.some(t => parseInt(t.tableNumber || t.table_number) === numericTable);
      if (!exists) {
        const merged = [...cached, {
          tableNumber: numericTable,
          table_number: numericTable,
          id: orderInfo.orderId || orderInfo.id || null,
          orderId: orderInfo.orderId || orderInfo.id || null,
          orderNumber: orderInfo.orderNumber || orderInfo.order_number || null,
          order_number: orderInfo.orderNumber || orderInfo.order_number || null
        }];
        await cacheTableAvailability(merged);
      }
    } catch (err) {
      console.warn('[OrderSystem] Failed to persist offline table reservation:', err);
    }
  }, [isDelivery, setOccupiedTables]);

  const updateActiveCart = useCallback((updates) => {
    setCarts(prevCarts =>
      prevCarts.map(c =>
        c.id === activeCartId ? { ...c, ...updates } : c
      )
    );
  }, [activeCartId]);

  const setCart = (newCart) => {
    updateActiveCart({ items: newCart });
  };

  const setSpecialInstructions = (instructions) => {
    updateActiveCart({ specialInstructions: instructions });
  };

  const handleOrderTypeChange = (type) => {
    setCheckoutError('');
    updateActiveCart({ orderType: type });
  };

  const handleDeliveryChargeChange = (value) => {
    if (value === '' || value === null || value === undefined) {
      updateActiveCart({ deliveryCharge: '' });
      return;
    }

    const cleaned = value.toString().replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2
      ? parts[0] + '.' + parts.slice(1).join('')
      : cleaned;

    updateActiveCart({ deliveryCharge: sanitized });
  };

  const handleDeliveryPaymentChange = (type) => {
    updateActiveCart({ deliveryPaymentType: type });
    setCheckoutError('');
  };

  const handleDeliveryFieldChange = (field, value) => {
    updateActiveCart({ [field]: value });
    setCheckoutError('');
  };

  const handleTableNumberChange = (value) => {
    // Check if table is occupied before allowing selection (skip check for "takeaway")
    if (value && !isDelivery && value !== 'takeaway') {
      const tableNum = parseInt(value);
      if (!isNaN(tableNum)) {
        const isOccupied = occupiedTables.some(t => {
          // If editing and this is the same order, don't consider it occupied
          const occupiedOrderId = t.orderId || t.order_id || t.id;
          const occupiedOrderNumber = t.orderNumber || t.order_number;

          if (editingOrder && (
            (occupiedOrderId && String(occupiedOrderId) === String(editingOrder.id)) ||
            (occupiedOrderNumber && String(occupiedOrderNumber) === String(editingOrder.order_number))
          )) {
            return false;
          }
          // Check both tableNumber and table_number fields, ensure proper comparison
          const occupiedTableNum = t.tableNumber || t.table_number;
          if (occupiedTableNum === null || occupiedTableNum === undefined) return false;
          return String(occupiedTableNum) === String(tableNum);
        });

        if (isOccupied) {
          const occupiedOrder = occupiedTables.find(t => {
            const occupiedTableNum = t.tableNumber || t.table_number;
            return occupiedTableNum !== null && occupiedTableNum !== undefined && String(occupiedTableNum) === String(tableNum);
          });
          const orderNumber = occupiedOrder?.orderNumber || occupiedOrder?.order_number || 'N/A';
          showError(`Table #${tableNum} is already reserved (Order #${orderNumber}). Please select a different table.`);
          return; // Don't update the table number
        }
      }
    }

    updateActiveCart({ tableNumber: value });
    setCheckoutError('');
  };

  const phoneIsValid = (phone) => {
    if (!phone) return false;
    // Remove spaces and non-digits for validation
    const cleaned = phone.trim().replace(/\s+/g, '').replace(/[^0-9]/g, '');
    // Pakistani phone numbers: 11 digits starting with 0, or 10 digits starting with 3
    // Maximum 11 digits as per backend validation
    if (cleaned.length < 10 || cleaned.length > 11) return false;
    // Must start with 0 or 3
    return /^[03]/.test(cleaned);
  };

  const validateDeliveryFields = () => {
    if (!deliveryName.trim()) {
      return 'Delivery customer name is required.';
    }
    if (!deliveryPhone.trim()) {
      return 'Phone number is required.';
    }
    // Check length first
    const cleanedPhone = deliveryPhone.trim().replace(/\s+/g, '').replace(/[^0-9]/g, '');
    if (cleanedPhone.length > 11) {
      return 'Phone number must be maximum 11 digits (e.g., 03001234567).';
    }
    if (!phoneIsValid(deliveryPhone)) {
      return 'Enter a valid phone number (10-11 digits starting with 0 or 3, e.g., 03001234567).';
    }
    if (!deliveryAddress.trim()) {
      return 'Delivery address is required.';
    }
    return '';
  };

  // Handle phone search for suggestions
  const handlePhoneSearch = useCallback(async (phoneValue) => {
    const trimmedPhone = phoneValue.trim();
    if (trimmedPhone.length < 1) {
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
      setSelectedCustomer(null);
      return;
    }

    setPhoneSearchLoading(true);
    try {
      let customers = [];

      // Check if offline - use cached customers
      if (!isOnline()) {
        const { getCachedCustomers } = await import('../utils/offlineDB');
        const cachedCustomers = await getCachedCustomers();
        // Filter customers by phone number (partial match)
        const normalizedSearch = trimmedPhone.replace(/\s+/g, '');
        customers = cachedCustomers.filter(c => {
          const customerPhone = (c.phone || '').replace(/\s+/g, '');
          return customerPhone.includes(normalizedSearch) || normalizedSearch.includes(customerPhone);
        }).slice(0, 10);
      } else {
        // Online - use API
        try {
          const response = await customerAPI.searchByPhone(trimmedPhone, 10);
          customers = response.data?.data || response.data || [];

          // Cache customers for offline use
          if (Array.isArray(customers) && customers.length > 0) {
            const { cacheCustomers } = await import('../utils/offlineDB');
            await cacheCustomers(customers);
          }
        } catch (apiErr) {
          // If API fails, fall back to cached customers
          if (apiErr.code === 'ERR_NETWORK' || !apiErr.response) {
            const { getCachedCustomers } = await import('../utils/offlineDB');
            const cachedCustomers = await getCachedCustomers();
            const normalizedSearch = trimmedPhone.replace(/\s+/g, '');
            customers = cachedCustomers.filter(c => {
              const customerPhone = (c.phone || '').replace(/\s+/g, '');
              return customerPhone.includes(normalizedSearch) || normalizedSearch.includes(customerPhone);
            }).slice(0, 10);
          } else {
            throw apiErr;
          }
        }
      }

      setPhoneSuggestions(Array.isArray(customers) ? customers : []);
      setShowPhoneSuggestions(true);
    } catch (err) {
      console.error('Failed to search customers by phone:', err);
      setPhoneSuggestions([]);
    } finally {
      setPhoneSearchLoading(false);
    }
  }, []);

  // Handle phone input change
  const handlePhoneChange = (value) => {
    handleDeliveryFieldChange('deliveryPhone', value);
    handlePhoneSearch(value);
    setSelectedCustomer(null);
    // Clear address when phone changes
    handleDeliveryFieldChange('deliveryAddress', '');
  };

  // Handle customer selection from phone suggestions
  const handleCustomerSelect = useCallback(async (customer) => {
    // Immediately update form fields for instant feedback
    updateActiveCart({
      deliveryPhone: customer.phone,
      deliveryName: customer.name,
      deliveryBackupPhone: customer.backupPhone || customer.backup_phone || ''
    });
    setCheckoutError('');

    // Hide suggestions immediately
    setShowPhoneSuggestions(false);
    setPhoneSuggestions([]);

    // Fetch full customer data with addresses (online) or use cached data (offline)
    try {
      const customerIdStr = String(customer.id ?? '');
      const isOfflineId = typeof customer.id === 'string' && customerIdStr.startsWith('OFFLINE-');

      if (isOnline() && !isOfflineId) {
        // Online - fetch full customer data
        const response = await customerAPI.getById(customer.id);
        const fullCustomer = response.data?.data || response.data;

        // Update selected customer with full data
        setSelectedCustomer(fullCustomer);

        // Set first address if available
        const firstAddress = fullCustomer.addresses && fullCustomer.addresses.length > 0
          ? fullCustomer.addresses[0].address
          : fullCustomer.address || customer.address || '';
        if (firstAddress) {
          updateActiveCart({ deliveryAddress: firstAddress });
        }
      } else {
        // Offline or offline customer - use cached data
        setSelectedCustomer(customer);
        const firstAddress = customer.addresses && customer.addresses.length > 0
          ? customer.addresses[0].address
          : customer.address || '';
        if (firstAddress) {
          updateActiveCart({ deliveryAddress: firstAddress });
        }
      }
    } catch (err) {
      console.error('Failed to load full customer data:', err);
      // Fallback to using partial customer data
      setSelectedCustomer(customer);
      const firstAddress = customer.addresses && customer.addresses.length > 0
        ? customer.addresses[0].address
        : customer.address || '';
      if (firstAddress) {
        updateActiveCart({ deliveryAddress: firstAddress });
      }
    }
  }, [updateActiveCart]);

  const ensureDeliveryCustomer = async () => {
    const name = deliveryName.trim() || 'Delivery Customer';
    const phone = deliveryPhone.trim().replace(/\s+/g, '');
    const backup = deliveryBackupPhone.trim().replace(/\s+/g, '') || '';
    const address = deliveryAddress.trim();
    const notes = deliveryNotes.trim() || '';

    if (!phone) {
      throw new Error('Customer phone is required');
    }

    // Check if offline - use cached customers or create offline customer
    if (!isOnline()) {
      try {
        const { getCachedCustomers, saveCustomer } = await import('../utils/offlineDB');
        const cachedCustomers = await getCachedCustomers();

        // Find existing customer by phone
        const existingCustomer = cachedCustomers.find(c =>
          (c.phone || '').replace(/\s+/g, '') === phone
        );

        if (existingCustomer) {
          // Customer exists, check if address is different
          const existingAddresses = existingCustomer.addresses || [];
          const addressExists = existingAddresses.some(addr =>
            (addr.address || '').trim() === address.trim()
          );

          // If address is different and provided, we'll queue it for sync
          if (address && !addressExists) {
            // Queue address update for sync
            const { addPendingOperation } = await import('../utils/offlineDB');
            await addPendingOperation({
              type: 'update_customer_address',
              endpoint: `/api/customers/${existingCustomer.id}/address`,
              method: 'POST',
              data: { address }
            });
          }

          return existingCustomer.id;
        } else {
          // Create offline customer
          const offlineCustomerId = `OFFLINE-CUSTOMER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const newCustomer = {
            id: offlineCustomerId,
            phone,
            name: name || 'Delivery Customer',
            backupPhone: backup || null,
            addresses: address ? [{ address, isDefault: true }] : [],
            notes: notes || null,
            synced: false,
            createdAt: new Date().toISOString()
          };

          await saveCustomer(newCustomer);

          // Queue customer creation for sync
          const { addPendingOperation } = await import('../utils/offlineDB');
          await addPendingOperation({
            type: 'create_customer',
            endpoint: '/api/customers/find-or-create',
            method: 'POST',
            data: {
              phone,
              name: name || undefined,
              address: address || undefined,
              backupPhone: backup || undefined,
              notes: notes || undefined
            },
            offlineId: offlineCustomerId
          });

          return offlineCustomerId;
        }
      } catch (offlineErr) {
        console.error('Failed to handle customer offline:', offlineErr);
        // Fallback: create a temporary offline customer ID
        return `OFFLINE-CUSTOMER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
    }

    // Online: Use findOrCreate API for automatic customer creation
    try {
      const response = await customerAPI.findOrCreate({
        phone,
        name: name || undefined,
        address: address || undefined,
        backupPhone: backup || undefined,
        notes: notes || undefined
      });

      const customer = response.data?.data || response.data;
      return customer.id;
    } catch (err) {
      console.error('Failed to find or create customer:', err);

      // If network error, fall back to offline mode
      if (err.code === 'ERR_NETWORK' || !err.response) {
        try {
          const { getCachedCustomers, saveCustomer } = await import('../utils/offlineDB');
          const cachedCustomers = await getCachedCustomers();

          const existingCustomer = cachedCustomers.find(c =>
            (c.phone || '').replace(/\s+/g, '') === phone
          );

          if (existingCustomer) {
            // Customer exists - only add address if it's new, don't update user
            if (address && address.trim()) {
              const existingAddresses = existingCustomer.addresses || [];
              const addressExists = existingAddresses.some(addr =>
                (addr.address || '').trim().toLowerCase() === address.trim().toLowerCase()
              );

              if (!addressExists) {
                const { addPendingOperation } = await import('../utils/offlineDB');
                await addPendingOperation({
                  type: 'add_customer_address',
                  endpoint: `/api/customers/${existingCustomer.id}/addresses`,
                  method: 'POST',
                  data: { address: address.trim() }
                });
              }
            }
            return existingCustomer.id;
          } else {
            // Customer doesn't exist - create new entry
            const offlineCustomerId = `OFFLINE-CUSTOMER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const newCustomer = {
              id: offlineCustomerId,
              phone,
              name: name || 'Delivery Customer',
              backupPhone: backup || null,
              addresses: address ? [{ address: address.trim(), isDefault: true }] : [],
              notes: notes || null,
              synced: false,
              createdAt: new Date().toISOString()
            };

            await saveCustomer(newCustomer);

            const { addPendingOperation } = await import('../utils/offlineDB');
            await addPendingOperation({
              type: 'create_customer',
              endpoint: '/api/customers/find-or-create',
              method: 'POST',
              data: {
                phone,
                name: name || undefined,
                address: address || undefined,
                backupPhone: backup || undefined,
                notes: notes || undefined
              },
              offlineId: offlineCustomerId
            });

            return offlineCustomerId;
          }
        } catch (fallbackErr) {
          console.error('Fallback customer creation failed:', fallbackErr);
        }
      }

      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      throw new Error(errorMsg || 'Unable to process customer information');
    }
  };

  const loadOrderForEditing = useCallback(async (orderMeta) => {
    if (!orderMeta?.id) return;
    const targetCartId = activeCartId;
    setEditLoading(true);
    setEditLoadError('');
    try {
      let orderDetails = {};
      let itemDetails = [];

      // Check if this is an offline order
      if (orderMeta.offline || String(orderMeta.id).startsWith('OFFLINE-')) {
        // Load from IndexedDB
        const offlineOrder = await getOfflineOrderById(orderMeta.offlineId || orderMeta.id);
        if (offlineOrder) {
          const orderData = offlineOrder.data || offlineOrder;
          orderDetails = orderData;
          itemDetails = (orderData.orderItems || orderData.items || []).map(item => ({
            id: item.menuItemId || item.menu_item_id || item.id,
            name: item.itemName || item.name || item.item_name || item.menuItem?.name || 'Item',
            price: Number(item.price || item.item_price || 0),
            quantity: item.quantity || 1
          }));
        } else {
          throw new Error('Offline order not found');
        }
      } else {
        // Load from API
        const [orderRes, itemsRes] = await Promise.all([
          ordersAPI.getById(orderMeta.id),
          ordersAPI.getOrderItems(orderMeta.id)
        ]);

        orderDetails = orderRes.data.data || {};
        itemDetails = (itemsRes.data.data || []).map(item => ({
          id: item.menuItemId || item.menu_item_id,
          name: item.itemName || item.name || item.item_name,
          price: Number(item.price) || 0,
          quantity: item.quantity || 1
        }));
      }

      setCarts(prevCarts =>
        prevCarts.map(c => {
          if (c.id !== targetCartId) {
            return c;
          }

          // Get customer info from order or customer object
          const customer = orderDetails.customer || {};
          const deliveryAddress = orderDetails.deliveryAddress ||
            orderDetails.delivery_address ||
            customer.address ||
            '';

          const deliveryCharge = orderDetails.deliveryCharge ||
            orderDetails.delivery_charge ||
            '0';

          const paymentMethod = orderDetails.paymentMethod ||
            orderDetails.payment_method ||
            'cash';
          const paymentStatus = orderDetails.paymentStatus ||
            orderDetails.payment_status ||
            'pending';

          return {
            ...c,
            items: itemDetails,
            orderType: orderDetails.orderType || orderDetails.order_type || 'dine_in',
            paymentMethod: paymentMethod,
            amountTaken: orderDetails.amountTaken || orderDetails.amount_taken || '',
            specialInstructions: orderDetails.specialInstructions || orderDetails.special_instructions || '',
            tableNumber: orderDetails.tableNumber || orderDetails.table_number || '',
            deliveryName: customer.name || orderDetails.customerName || orderDetails.customer_name || '',
            deliveryPhone: customer.phone || orderDetails.customerPhone || orderDetails.customer_phone || '',
            deliveryBackupPhone: customer.backupPhone || customer.backup_phone || '',
            deliveryAddress: deliveryAddress,
            deliveryNotes: orderDetails.deliveryNotes || orderDetails.delivery_notes || '',
            deliveryCharge: deliveryCharge,
            deliveryPaymentType: paymentMethod === 'cash' && paymentStatus !== 'completed' ? 'cod' : 'prepaid',
            discountPercent: orderDetails.discountPercent || orderDetails.discount_percent || 0
          };
        })
      );

      setEditingOrder({
        id: orderMeta.id,
        order_number: orderDetails.orderNumber || orderDetails.order_number,
        orderType: orderDetails.orderType || orderDetails.order_type || 'dine_in',
        offline: orderMeta.offline || false,
        offlineId: orderMeta.offlineId || null
      });
      setCheckoutError('');
    } catch (error) {
      console.error('Failed to load order for editing', error);
      setEditLoadError('Failed to load order for editing. Please try again.');
      setEditingOrder(null);
    } finally {
      setEditLoading(false);
    }
  }, [activeCartId]);

  const cancelEditingOrder = () => {
    setEditingOrder(null);
    setEditLoadError('');
    // Reset the cart
    setCarts(prevCarts =>
      prevCarts.map(c =>
        c.id === activeCartId ? createCartTemplate(activeCartId, c.name) : c
      )
    );
  };

  const addNewCart = () => {
    const newCart = createCartTemplate(nextCartId, `Cart ${nextCartId}`);
    setCarts([...carts, newCart]);
    setActiveCartId(nextCartId);
    setNextCartId(nextCartId + 1);
  };

  const removeCart = (cartId) => {
    if (carts.length === 1) {
      setCarts([createCartTemplate(1, 'Cart 1')]);
      setActiveCartId(1);
      return;
    }

    const newCarts = carts.filter(c => c.id !== cartId);
    setCarts(newCarts);

    if (cartId === activeCartId) {
      setActiveCartId(newCarts[0].id);
    }
  };

  const switchToCart = (cartId) => {
    setActiveCartId(cartId);
  };

  useEffect(() => {
    fetchMenuItems();
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem('orderToEdit');
    if (stored) {
      sessionStorage.removeItem('orderToEdit');
      try {
        const parsed = JSON.parse(stored);
        loadOrderForEditing(parsed);
      } catch (error) {
        console.error('Invalid payload for orderToEdit', error);
        setEditLoadError('Unable to open order for editing.');
      }
    }
  }, [loadOrderForEditing]);

  useEffect(() => {
    const editOrderId = searchParams.get('edit');
    if (editOrderId && !editingOrder && !editLoading) {
      loadOrderForEditing({ id: parseInt(editOrderId) });
      setSearchParams({});
    }
  }, [searchParams, editingOrder, editLoading, loadOrderForEditing, setSearchParams]);

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
          console.log('Loaded menu items from cache');
        } else {
          console.warn('No cached menu items available');
        }
      }
    } catch (error) {
      console.error('Error fetching menu items:', error);
      const cached = await getCachedMenuItems();
      if (cached.length > 0) {
        setMenuItems(cached);
        console.log('Loaded menu items from cache after API error');
      }
    }
  };

  const addToCart = useCallback((item) => {
    setCarts(prevCarts =>
      prevCarts.map(c =>
        c.id === activeCartId
          ? {
            ...c,
            items: (() => {
              const existingItem = c.items.find(cartItem => cartItem.id === item.id);
              if (existingItem) {
                return c.items.map(cartItem =>
                  cartItem.id === item.id
                    ? { ...cartItem, quantity: cartItem.quantity + 1 }
                    : cartItem
                );
              } else {
                return [...c.items, { ...item, quantity: 1 }];
              }
            })()
          }
          : c
      )
    );
  }, [activeCartId]);

  const updateQuantity = useCallback((itemId, quantity) => {
    setCarts(prevCarts =>
      prevCarts.map(c =>
        c.id === activeCartId
          ? {
            ...c,
            items: quantity <= 0
              ? c.items.filter(item => item.id !== itemId)
              : c.items.map(item =>
                item.id === itemId ? { ...item, quantity } : item
              )
          }
          : c
      )
    );
  }, [activeCartId]);

  const removeFromCart = useCallback((itemId) => {
    setCarts(prevCarts =>
      prevCarts.map(c =>
        c.id === activeCartId
          ? { ...c, items: c.items.filter(item => item.id !== itemId) }
          : c
      )
    );
  }, [activeCartId]);

  const getTotal = useCallback(() => {
    return cart.reduce((total, item) => total + (parseFloat(item.price) || 0) * (item.quantity || 0), 0);
  }, [cart]);

  const getReturnAmount = useCallback(() => {
    const total = getTotal();
    const taken = parseFloat(amountTaken) || 0;
    return Math.max(0, taken - total);
  }, [getTotal, amountTaken]);

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setCheckoutError('Cart is empty. Add items before checking out.');
      return;
    }

    if (isDelivery) {
      const validationMessage = validateDeliveryFields();
      if (validationMessage) {
        setCheckoutError(validationMessage);
        return;
      }
    } else {
      if (!tableNumber || String(tableNumber).trim() === '') {
        setCheckoutError('Table number is required for dine-in orders.');
        return;
      }
      // Allow "takeaway" or numeric table numbers 1-9
      if (tableNumber !== 'takeaway') {
        const tableNum = parseInt(tableNumber);
        if (isNaN(tableNum) || tableNum < 1) {
          setCheckoutError('Please enter a valid table number (1-9) or select "Take Away".');
          return;
        }
      }

      // Check if table is occupied (excluding current order if editing, skip check for "takeaway")
      if (tableNumber !== 'takeaway') {
        const tableNum = parseInt(tableNumber);
        const isOccupied = occupiedTables.some(t => {
          // If editing and this is the same order, don't consider it occupied
          const occupiedOrderId = t.orderId || t.order_id || t.id;
          const occupiedOrderNumber = t.orderNumber || t.order_number;

          if (editingOrder && (
            (occupiedOrderId && String(occupiedOrderId) === String(editingOrder.id)) ||
            (occupiedOrderNumber && String(occupiedOrderNumber) === String(editingOrder.order_number))
          )) {
            return false;
          }
          // Check both tableNumber and table_number fields, ensure proper comparison
          const occupiedTableNum = t.tableNumber || t.table_number;
          if (occupiedTableNum === null || occupiedTableNum === undefined) return false;
          return String(occupiedTableNum) === String(tableNum);
        });

        if (isOccupied) {
          const occupiedOrder = occupiedTables.find(t => String(t.tableNumber || t.table_number) === String(tableNum));
          setCheckoutError(`Table #${tableNum} already has a pending order (Order #${occupiedOrder?.orderNumber || occupiedOrder?.order_number || 'N/A'}). Please complete or cancel the existing order first.`);
          return;
        }
      }
    }

    setCheckoutError('');

    try {
      const subtotal = subtotalAmount; // Use memoized value
      const deliveryChargeValue = deliveryFee; // Use memoized value
      const discount = discountAmount; // Use memoized value
      const totalAmount = grandTotalAmount; // Use memoized value

      // Determine payment details based on order type and payment type
      let paymentMethod = 'cash';
      let paymentStatus = 'pending';

      if (isDelivery) {
        paymentMethod = deliveryPaymentType === 'prepaid' ? 'bank_transfer' : 'cash';
        paymentStatus = deliveryPaymentType === 'prepaid' ? 'completed' : 'pending';
      }

      let customerId = null;
      if (isDelivery) {
        try {
          customerId = await ensureDeliveryCustomer();
          if (!customerId) {
            setCheckoutError('Unable to save customer details. Please try again.');
            return;
          }
        } catch (err) {
          console.error('Failed to ensure customer record', err);
          setCheckoutError(err.message || 'Unable to save customer details. Please try again.');
          return;
        }
      }

      const orderItems = cart.map(item => ({
        menuItemId: item.id,
        quantity: item.quantity,
        price: parseFloat(item.price)
      }));

      let orderId = editingOrder ? editingOrder.id : null;
      let orderNumber = null;
      let isOffline = false;

      if (editingOrder) {
        const updateData = {
          items: orderItems,
          totalAmount: totalAmount,
          orderType: orderType,
          paymentMethod: paymentMethod,
          paymentStatus: paymentStatus,
          ...(isDelivery && {
            customerId: customerId,
            deliveryAddress: deliveryAddress.trim(),
            deliveryNotes: deliveryNotes.trim() || undefined,
            googleMapsLink: googleMapsLink.trim() || undefined,
            deliveryCharge: deliveryChargeValue
          }),
          ...(!isDelivery && {
            tableNumber: tableNumber || undefined
          }),
          specialInstructions: specialInstructions.trim() || undefined,
          discountPercent: discountPercent || 0
        };

        // Check if editing an offline order
        if (editingOrder.offline || !isOnline()) {
          try {
            // Update offline order in IndexedDB
            const offlineId = editingOrder.offlineId || editingOrder.id;
            await updateOfflineOrder(offlineId, {
              ...updateData,
              updatedAt: new Date().toISOString()
            });

            // Queue update operation for sync
            await addPendingOperation({
              type: 'update_order',
              endpoint: `/api/orders/${editingOrder.id}`,
              method: 'PUT',
              data: updateData,
              offlineId: offlineId
            });

            orderNumber = editingOrder.order_number;
            isOffline = true;
            showSuccess(`Order #${orderNumber || editingOrder.id} updated offline. It will sync when you are back online.`);
          } catch (error) {
            console.error('Error updating offline order:', error);
            setCheckoutError('Failed to update order offline. Please try again.');
            return;
          }
        } else {
          // Online order update
          try {
            const response = await ordersAPI.update(editingOrder.id, updateData);
            orderNumber = response.data.data?.orderNumber || response.data.data?.order_number;
            showSuccess(`Order #${orderNumber || editingOrder.id} updated successfully!`);
          } catch (error) {
            console.error('Error updating order:', error);
            // If API fails, try to save offline
            if (!error.response || error.code === 'ERR_NETWORK') {
              try {
                const offlineId = editingOrder.offlineId || editingOrder.id;
                await updateOfflineOrder(offlineId, {
                  ...updateData,
                  updatedAt: new Date().toISOString()
                });
                await addPendingOperation({
                  type: 'update_order',
                  endpoint: `/api/orders/${editingOrder.id}`,
                  method: 'PUT',
                  data: updateData,
                  offlineId: offlineId
                });
                orderNumber = editingOrder.order_number;
                isOffline = true;
                showInfo('Order update saved offline. It will sync when connection is restored.');
              } catch (offlineError) {
                console.error('Error saving update offline:', offlineError);
                const message = error.response?.data?.error || 'Failed to update order. Please try again.';
                setCheckoutError(message);
                return;
              }
            } else {
              const message = error.response?.data?.error || 'Failed to update order. Please try again.';
              setCheckoutError(message);
              return;
            }
          }
        }
      } else {
        const orderData = {
          items: orderItems,
          totalAmount: totalAmount,
          orderType: orderType,
          paymentMethod: paymentMethod,
          paymentStatus: paymentStatus,
          ...(isDelivery && {
            customerId: customerId,
            deliveryAddress: deliveryAddress.trim(),
            deliveryNotes: deliveryNotes.trim() || undefined,
            googleMapsLink: googleMapsLink.trim() || undefined,
            deliveryCharge: deliveryChargeValue
          }),
          ...(!isDelivery && {
            tableNumber: tableNumber || undefined
          }),
          specialInstructions: specialInstructions.trim() || undefined,
          discountPercent: discountPercent || 0
        };

        // Check if server is actually reachable (not just browser online status)
        const serverOnline = await isOnline();
        if (serverOnline) {
          try {
            // Clean up orderData - remove empty strings, ensure proper types
            const cleanedOrderData = {
              ...orderData,
              // Ensure tableNumber is always a string (never a number)
              tableNumber: orderData.tableNumber
                ? (typeof orderData.tableNumber === 'string'
                  ? (orderData.tableNumber.trim() !== '' ? orderData.tableNumber : undefined)
                  : String(orderData.tableNumber))
                : undefined,
              deliveryAddress: orderData.deliveryAddress && orderData.deliveryAddress.trim() !== '' ? orderData.deliveryAddress : undefined,
              deliveryNotes: orderData.deliveryNotes && orderData.deliveryNotes.trim() !== '' ? orderData.deliveryNotes : undefined,
              googleMapsLink: orderData.googleMapsLink && orderData.googleMapsLink.trim() !== '' ? orderData.googleMapsLink : undefined,
              specialInstructions: orderData.specialInstructions && orderData.specialInstructions.trim() !== '' ? orderData.specialInstructions : undefined,
            };

            console.log('Creating order with cleaned data:', cleanedOrderData);
            const response = await ordersAPI.create(cleanedOrderData);
            orderId = response.data.data?.id;
            orderNumber = response.data.data?.orderNumber || response.data.data?.order_number;

            if (!orderId) {
              throw new Error('Order was created but no ID was returned from server');
            }

            showSuccess(`Order #${orderNumber || orderId} created successfully!`);

            // Dispatch event to refresh badges immediately
            window.dispatchEvent(new CustomEvent('orderCreated', {
              detail: { orderType: orderType, orderId, orderNumber }
            }));
          } catch (error) {
            console.error('Order creation error details:', {
              error,
              response: error.response,
              status: error.response?.status,
              data: error.response?.data,
              orderData
            });
            console.error('Failed to create order online:', error);

            // Only save offline if it's a network error, not a validation/server error
            const isNetworkError = !error.response ||
              error.code === 'ERR_NETWORK' ||
              error.message === 'Network Error' ||
              (error.response && error.response.status >= 500);

            if (isNetworkError) {
              console.warn('Network error detected, saving offline:', error);
              const savedOrder = await saveOfflineOrder(orderData);
              orderId = savedOrder.id;
              orderNumber = null;
              isOffline = true;
              showInfo('Order saved offline. It will sync when you are back online.');

              // Reserve table locally for offline order
              if (!isDelivery && reserveTableRef.current) {
                await reserveTableRef.current(tableNumber, { orderId, orderNumber });
              }

              // Dispatch event for offline orders too
              window.dispatchEvent(new CustomEvent('orderCreated', {
                detail: { orderType: orderType, orderId, orderNumber: null, offline: true }
              }));
            } else {
              // Server validation error or other API error - show error message and STOP
              const errorData = error.response?.data || {};
              const validationErrors = errorData.errors || [];
              let errorMessage = errorData.error || errorData.message || error.message || 'Failed to create order. Please check your input and try again.';

              // If there are specific validation errors, show them
              if (validationErrors.length > 0) {
                const errorDetails = validationErrors.map(err => {
                  const field = err.path?.join('.') || err.field || 'field';
                  const msg = err.message || err.msg || 'Invalid value';
                  return `${field}: ${msg}`;
                }).join(', ');
                errorMessage = `Validation failed: ${errorDetails}`;
              }

              console.error('Order creation failed - Full error details:', {
                errorMessage,
                validationErrors,
                errorData,
                orderData,
                status: error.response?.status
              });

              setCheckoutError(errorMessage);
              showError(errorMessage);
              // Return early - don't print receipt or clear cart if order creation failed
              return;
            }
          }
        } else {
          const savedOrder = await saveOfflineOrder(orderData);
          orderId = savedOrder.id;
          orderNumber = null;
          isOffline = true;
          showInfo('Order saved offline. It will sync when you are back online.');

          // Reserve table locally for offline order
          if (!isDelivery && reserveTableRef.current) {
            await reserveTableRef.current(tableNumber, { orderId, orderNumber });
          }

          // Dispatch event for offline orders
          window.dispatchEvent(new CustomEvent('orderCreated', {
            detail: { orderType: orderType, orderId, orderNumber: null, offline: true }
          }));
        }
      }

      // Only proceed if order was successfully created (has orderId)
      if (!orderId) {
        console.error('Cannot print receipt: Order was not created successfully');
        return;
      }

      // Prepare receipt data
      const receiptData = {
        id: orderId,
        order_number: orderNumber || orderId,
        table_number: !isDelivery ? (tableNumber || null) : null,
        items: cart.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })),
        subtotal: subtotal,
        total_amount: totalAmount,
        // pass discount so receipts show it
        discount_percent: discountPercent || 0,
        discountPercent: discountPercent || 0,
        delivery_charge: deliveryChargeValue,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        cashier_name: 'Cashier',
        special_instructions: specialInstructions,
        offline: isOffline,
        order_type: orderType,
        customer_name: isDelivery ? deliveryName.trim() : null,
        customer_phone: isDelivery ? deliveryPhone.trim() : null,
        customer_address: isDelivery ? deliveryAddress : null,
        delivery_notes: isDelivery ? deliveryNotes : '',
        customer: isDelivery && selectedCustomer ? selectedCustomer : null, // Include customer object for notes fallback
        created_at: new Date().toISOString()
      };

      // Print receipts
      if (isDelivery) {
        try {
          // Use combined receipt printing for delivery orders
          const { printCombinedReceipt } = await import('./Receipt');
          await printCombinedReceipt(receiptData);
        } catch (error) {
          console.error('Error printing receipt:', error);
        }
      } else {
        try {
          await printReceipt(receiptData, 'kitchen');
        } catch (error) {
          console.error('Error printing kitchen receipt:', error);
        }
      }

      // Reset cart
      setCarts(prevCarts =>
        prevCarts.map(c =>
          c.id === activeCartId
            ? createCartTemplate(c.id, c.name)
            : c
        )
      );

      // If editing, clear editing state
      if (editingOrder) {
        setEditingOrder(null);
        setEditLoadError('');
      }

      // If multiple carts, remove current cart after checkout
      if (carts.length > 1) {
        setTimeout(() => {
          removeCart(activeCartId);
        }, 1000);
      }

    } catch (error) {
      console.error('Error during checkout:', error);
      showError('Error during checkout. Please try again.');
      setCheckoutError('An unexpected error occurred. Please try again.');
    }
  };

  // Debounce search term
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300); // 300ms debounce

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchTerm]);

  // Memoize filtered items to avoid recalculating on every render
  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const isAvailable = item.available === 1 || item.available === true;
      const matchesCategory = selectedCategory ? item.category?.name === selectedCategory : true;
      const matchesSearch = debouncedSearchTerm
        ? item.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        : true;
      return isAvailable && matchesCategory && matchesSearch;
    });
  }, [menuItems, selectedCategory, debouncedSearchTerm]);

  // Memoize categories
  const categories = useMemo(() => {
    return [...new Set(menuItems
      .map(item => item.category?.name)
      .filter(Boolean)
    )];
  }, [menuItems]);

  // Memoize cart calculations
  const subtotalAmount = useMemo(() => {
    return cart.reduce((total, item) => total + (parseFloat(item.price) || 0) * (item.quantity || 0), 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    return subtotalAmount * (discountPercent / 100);
  }, [subtotalAmount, discountPercent]);

  const deliveryFee = useMemo(() => {
    return isDelivery ? parsedDeliveryCharge : 0;
  }, [isDelivery, parsedDeliveryCharge]);

  const grandTotalAmount = useMemo(() => {
    return (subtotalAmount - discountAmount) + deliveryFee;
  }, [subtotalAmount, discountAmount, deliveryFee]);

  const deliveryFormComplete = !isDelivery || (
    deliveryName.trim() &&
    phoneIsValid(deliveryPhone) &&
    deliveryAddress.trim()
  );

  // Check if selected table is occupied (for dine-in orders)
  const isSelectedTableOccupied = useMemo(() => {
    if (isDelivery || !tableNumber) return false;

    const tableNum = parseInt(tableNumber);
    if (isNaN(tableNum)) return false;

    return occupiedTables.some(t => {
      // If editing and this is the same order, don't consider it occupied
      const occupiedOrderId = t.orderId || t.order_id || t.id;
      const occupiedOrderNumber = t.orderNumber || t.order_number;

      if (editingOrder && (
        (occupiedOrderId && String(occupiedOrderId) === String(editingOrder.id)) ||
        (occupiedOrderNumber && String(occupiedOrderNumber) === String(editingOrder.order_number))
      )) {
        return false;
      }

      // Check both tableNumber and table_number fields, ensure proper number comparison
      const occupiedTableNum = t.tableNumber || t.table_number;
      if (occupiedTableNum === null || occupiedTableNum === undefined) return false;
      return parseInt(occupiedTableNum) === tableNum;
    });
  }, [isDelivery, tableNumber, occupiedTables, editingOrder]);

  const checkoutButtonLabel = editingOrder
    ? (isDelivery ? '💾 Update Delivery Order' : '💾 Update Order')
    : (isDelivery ? '🚚 Create Delivery Order' : '🍽️ Create Dine-In Order');

  const canSubmitOrder = cart.length > 0 && deliveryFormComplete && !editLoading && !isSelectedTableOccupied;

  useEffect(() => {
    const handleCtrlN = () => {
      addNewCart();
      showInfo('New cart created');
    };

    const handleCtrlS = () => {
      if (canSubmitOrder) {
        handleCheckout();
      }
    };

    const handleEscape = () => {
      if (editingOrder) {
        cancelEditingOrder();
      }
    };

    keyboardShortcuts.register('ctrl+n', handleCtrlN);
    keyboardShortcuts.register('ctrl+s', handleCtrlS);
    keyboardShortcuts.register('escape', handleEscape);

    return () => {
      keyboardShortcuts.unregister('ctrl+n');
      keyboardShortcuts.unregister('ctrl+s');
      keyboardShortcuts.unregister('escape');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmitOrder, editingOrder]);


  return (
    <>
      <OfflineIndicator />

      <div style={{
        position: 'fixed',
        top: '70px',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        background: 'var(--gradient-primary)',
        overflow: 'hidden',
        zIndex: 100
      }}>
        {/* Left Panel - Menu Items */}
        <div style={{
          flex: '1',
          display: 'flex',
          flexDirection: 'column',
          background: '#f8f9fa',
          borderRight: '3px solid #dee2e6'
        }}>
          {/* Search and Filter Bar */}
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderBottom: '2px solid #e9ecef',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="🔍 Search menu items..."
                style={{
                  width: '100%',
                  padding: '1rem 1.5rem',
                  border: '3px solid #e2e8f0',
                  borderRadius: '12px',
                  fontSize: '1.1rem',
                  background: '#f8f9fa',
                  fontWeight: '500',
                  transition: 'all 0.3s'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--color-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
              />
            </div>

            {/* Category Pills */}
            <div style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center'
            }}>
              <button
                onClick={() => setSelectedCategory('')}
                style={{
                  padding: '0.6rem 1.2rem',
                  border: selectedCategory === '' ? '3px solid var(--color-primary)' : '2px solid var(--color-border)',
                  borderRadius: '25px',
                  background: selectedCategory === '' ? 'var(--gradient-primary)' : 'white',
                  color: selectedCategory === '' ? 'white' : 'var(--color-text)',
                  fontWeight: 'bold',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  boxShadow: selectedCategory === '' ? 'var(--shadow-md)' : 'none'
                }}
              >
                All Items
              </button>
              {categories.map(category => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  style={{
                    padding: '0.6rem 1.2rem',
                    border: selectedCategory === category ? '3px solid var(--color-primary)' : '2px solid var(--color-border)',
                    borderRadius: '25px',
                    background: selectedCategory === category ? 'var(--gradient-primary)' : 'white',
                    color: selectedCategory === category ? 'white' : 'var(--color-text)',
                    fontWeight: 'bold',
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                    boxShadow: selectedCategory === category ? 'var(--shadow-md)' : 'none'
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Menu Items Grid */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: '1rem',
            alignContent: 'start'
          }}>
            {filteredItems.length === 0 ? (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '3rem',
                color: '#6c757d'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                <div style={{ fontSize: '1.2rem', fontWeight: '600' }}>
                  {searchTerm ? 'No items found matching your search' : 'No available items in this category'}
                </div>
                {searchTerm && (
                  <div style={{
                    fontSize: '0.9rem',
                    color: '#adb5bd',
                    marginTop: '0.5rem'
                  }}>
                    Try different keywords or browse categories
                  </div>
                )}
              </div>
            ) : (
              filteredItems.map(item => (
                <div
                  key={item.id}
                  onClick={() => addToCart(item)}
                  style={{
                    background: 'white',
                    borderRadius: '12px',
                    padding: '1rem',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: '1px solid #e9ecef',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    minHeight:'300px',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
                    e.currentTarget.style.borderColor = 'var(--color-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                    e.currentTarget.style.borderColor = '#e9ecef';
                  }}
                >
                  {/* Image Container */}
                  <div style={{
                    width: '100%',
                    height: '160px',
                    marginBottom: '0.75rem',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: '#f8f9fa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}>
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl?.startsWith('http') ? item.imageUrl : `${API_BASE_URL}${item.imageUrl}`}
                        alt={item.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'center'
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          const emoji = (item.name?.trim()?.charAt(0)) || '🍽️';
                          e.target.parentElement.innerHTML = `
                  <div style="
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 1rem;
                    text-align: center;
                  ">
                    <div style="
                      font-size: 2rem;
                      font-weight: 700;
                      margin-bottom: 0.25rem;
                    ">
                      ${getInitials(item.name)}
                    </div>
                    <div style="
                      font-size: 0.8rem;
                      font-weight: 500;
                      opacity: 0.9;
                      max-width: 90%;
                      line-height: 1.2;
                    ">
                      ${item.name}
                    </div>
                  </div>
                `;
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        padding: '1rem',
                        textAlign: 'center'
                      }}>
                        <div style={{
                          fontSize: '2rem',
                          fontWeight: '700',
                          marginBottom: '0.25rem'
                        }}>
                          {getInitials(item.name)}
                        </div>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: '500',
                          opacity: '0.9',
                          maxWidth: '90%',
                          lineHeight: '1.2'
                        }}>
                          {item.name}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Category Badge */}
                  <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--color-primary)',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '0.4rem'
                  }}>
                    {item.category?.name || 'Uncategorized'}
                  </div>

                  {/* Item Name */}
                  <h3 style={{
                    margin: '0 0 0.5rem 0',
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: '#212529',
                    flex: 1,
                    lineHeight: '1.3',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minHeight: '2.6em'
                  }}>
                    {item.name}
                  </h3>

                  {/* Description */}
                  {item.description && (
                    <p style={{
                      margin: '0 0 0.75rem 0',
                      fontSize: '0.8rem',
                      color: '#6c757d',
                      lineHeight: '1.4',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flexShrink: 0
                    }}>
                      {item.description}
                    </p>
                  )}

                  {/* Price and Add Button */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 'auto'
                  }}>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      color: 'var(--color-primary)'
                    }}>
                      PKR {parseFloat(item.price).toFixed(2)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(item);
                      }}
                      style={{
                        background: 'var(--gradient-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.8rem',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                    >
                      <span>Add</span>
                      <span style={{ fontSize: '0.9rem' }}>+</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Cart */}
        <div className="cart-panel" style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'white',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.1)'
        }}>
          {/* Cart Tabs */}
          <div style={{
            background: 'var(--gradient-primary)',
            display: 'flex',
            alignItems: 'flex-end',
            overflowX: 'auto',
            overflowY: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '0.5rem 0.5rem 0 0.5rem',
            gap: '0.5rem',
            minHeight: '56px',
            maxHeight: '56px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
            className="cart-tabs-container"
          >
            {carts.map(c => (
              <div
                key={c.id}
                onClick={() => switchToCart(c.id)}
                style={{
                  background: c.id === activeCartId ? 'white' : 'rgba(255,255,255,0.2)',
                  color: c.id === activeCartId ? 'var(--color-primary)' : 'white',
                  padding: '0.625rem 1rem',
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  minWidth: '110px',
                  maxWidth: '150px',
                  height: '48px',
                  position: 'relative',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxSizing: 'border-box'
                }}
                onMouseEnter={(e) => {
                  if (c.id !== activeCartId) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (c.id !== activeCartId) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                  }
                }}
              >
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0
                }}>
                  <span style={{ flexShrink: 0 }}>🛒</span>
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>{c.name}</span>
                </span>
                {c.items.length > 0 && (
                  <span style={{
                    background: c.id === activeCartId ? 'var(--color-primary)' : 'rgba(255,255,255,0.3)',
                    color: 'white',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    flexShrink: 0,
                    lineHeight: '1.2'
                  }}>
                    {c.items.length}
                  </span>
                )}
                {carts.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCart(c.id);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: c.id === activeCartId ? '#dc3545' : 'rgba(255,255,255,0.8)',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      padding: '0.125rem 0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: '0.25rem',
                      flexShrink: 0,
                      width: '20px',
                      height: '20px',
                      lineHeight: '1',
                      borderRadius: '4px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = c.id === activeCartId ? 'rgba(220, 53, 69, 0.1)' : 'rgba(255,255,255,0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                    title="Close cart"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addNewCart}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '2px dashed rgba(255,255,255,0.5)',
                borderRadius: '8px 8px 0 0',
                padding: '0.625rem 1rem',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '600',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                height: '48px',
                minWidth: '110px',
                flexShrink: 0,
                boxSizing: 'border-box'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.8)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)';
              }}
              title="Add new cart"
            >
              <span>+</span>
              <span>New</span>
            </button>
          </div>

          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            minHeight: 0
          }}>
            {/* Order Type Toggle */}
            <div style={{
              background: 'white',
              padding: '0.75rem 1rem',
              borderBottom: '2px solid #e9ecef',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              position: 'sticky',
              top: 0,
              zIndex: 5,
              boxShadow: '0 4px 12px rgba(0,0,0,0.04)'
            }}>
              <div style={{ fontWeight: '600', color: '#495057', fontSize: '0.85rem' }}>
                Order Mode
              </div>
              <div style={{
                display: 'flex',
                gap: '0.5rem',
                background: '#f1f3f5',
                padding: '0.25rem',
                borderRadius: '999px'
              }}>
                {['dine_in', 'delivery'].map(type => (
                  <button
                    key={type}
                    onClick={() => handleOrderTypeChange(type)}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: '999px',
                      padding: '0.45rem 0.75rem',
                      fontWeight: '600',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      background: orderType === type ? 'var(--gradient-primary)' : 'transparent',
                      color: orderType === type ? 'white' : 'var(--color-text)',
                      transition: 'all 0.3s'
                    }}
                  >
                    {type === 'dine_in' ? 'Dine-In' : 'Delivery'}
                  </button>
                ))}
              </div>
              {editLoading && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: '#e7f5ff',
                  color: '#0b7285',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}>
                  Loading order details...
                </div>
              )}
              {editingOrder && !editLoading && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  background: '#fff4d8',
                  border: '1px dashed #f59f00',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem'
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#7c2d12' }}>
                      Editing Order #{editingOrder.order_number || editingOrder.id}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#7c2d12' }}>
                      Update the cart and save to reprint / resend this order.
                    </div>
                  </div>
                  <button
                    onClick={cancelEditingOrder}
                    style={{
                      border: 'none',
                      borderRadius: '8px',
                      background: '#ffec99',
                      padding: '0.5rem 0.9rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      color: '#7c2d12'
                    }}
                  >
                    Exit Editing
                  </button>
                </div>
              )}
              {editLoadError && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: '#fff5f5',
                  color: '#c92a2a',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}>
                  {editLoadError}
                </div>
              )}
            </div>

            {/* Cart Info */}
            <div style={{
              background: 'white',
              color: 'var(--color-primary)',
              padding: '0.75rem 1rem',
              borderBottom: '2px solid #e9ecef',
              fontWeight: '600'
            }}>
              <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                {cart.length} {cart.length === 1 ? 'item' : 'items'} in {activeCart.name}
              </div>
            </div>

            {/* Dine-In Details */}
            {!isDelivery && (
              <div style={{
                background: 'white',
                borderBottom: '2px solid #e9ecef',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}>
                <div>
                  <h3 style={{ margin: 0 }}>Table Information</h3>
                  <p style={{ margin: '0.25rem 0 0 0', color: '#6c757d', fontSize: '0.9rem' }}>
                    Table number is required for dine-in orders
                  </p>
                </div>

                <div>
                  <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                    Table Number <span style={{ color: '#dc3545' }}>*</span>
                  </label>

                  {/* Quick Table Selection (1-9 + Take Away) */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: '0.5rem',
                    marginBottom: '0.75rem'
                  }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tableNum => {
                      const isOccupied = occupiedTables.some(t => {
                        // If editing and this is the same order, don't consider it occupied
                        const occupiedOrderId = t.orderId || t.order_id || t.id;
                        const occupiedOrderNumber = t.orderNumber || t.order_number;

                        if (editingOrder && (
                          (occupiedOrderId && String(occupiedOrderId) === String(editingOrder.id)) ||
                          (occupiedOrderNumber && String(occupiedOrderNumber) === String(editingOrder.order_number))
                        )) {
                          return false;
                        }
                        // Check both tableNumber and table_number fields
                        const occupiedTableNum = t.tableNumber || t.table_number;
                        // Ensure we're comparing numbers
                        return occupiedTableNum !== null && occupiedTableNum !== undefined && String(occupiedTableNum) === String(tableNum);
                      });
                      const isSelected = String(tableNumber) === String(tableNum);
                      return (
                        <button
                          key={tableNum}
                          type="button"
                          onClick={() => {
                            if (!isOccupied) {
                              handleTableNumberChange(tableNum.toString());
                            } else {
                              // Show error message when clicking on occupied table
                              const occupiedOrder = occupiedTables.find(t => {
                                const occupiedTableNum = t.tableNumber || t.table_number;
                                return occupiedTableNum !== null && occupiedTableNum !== undefined && String(occupiedTableNum) === String(tableNum);
                              });
                              const orderNumber = occupiedOrder?.orderNumber || occupiedOrder?.order_number || 'N/A';
                              showError(`Table #${tableNum} is already reserved (Order #${orderNumber}). Please select a different table.`);
                            }
                          }}
                          disabled={isOccupied}
                          style={{
                            padding: '0.75rem',
                            borderRadius: '8px',
                            border: isSelected ? '3px solid var(--color-primary)' : isOccupied ? '2px solid #ffc107' : '2px solid #e2e8f0',
                            background: isSelected ? 'var(--gradient-primary)' : isOccupied ? '#fff4d8' : 'white',
                            color: isSelected ? 'white' : isOccupied ? '#7c2d12' : '#495057',
                            fontWeight: isSelected ? 'bold' : '600',
                            cursor: isOccupied ? 'not-allowed' : 'pointer',
                            fontSize: '0.9rem',
                            position: 'relative',
                            opacity: isOccupied ? 0.7 : 1
                          }}
                          title={isOccupied ? `Table ${tableNum} is occupied` : `Select Table ${tableNum}`}
                        >
                          {tableNum}
                          {isOccupied && (
                            <span style={{
                              position: 'absolute',
                              top: '2px',
                              right: '4px',
                              fontSize: '0.7rem',
                              color: '#dc3545'
                            }}>●</span>
                          )}
                        </button>
                      );
                    })}
                    {/* Take Away Button */}
                    <button
                      type="button"
                      onClick={() => handleTableNumberChange('takeaway')}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '8px',
                        border: tableNumber === 'takeaway' ? '3px solid var(--color-primary)' : '2px solid #e2e8f0',
                        background: tableNumber === 'takeaway' ? 'var(--gradient-primary)' : 'white',
                        color: tableNumber === 'takeaway' ? 'white' : '#495057',
                        fontWeight: tableNumber === 'takeaway' ? 'bold' : '600',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        gridColumn: 'span 1'
                      }}
                      title="Select Take Away"
                    >
                      Take Away
                    </button>
                  </div>

                  {/* Manual Input */}
                  <input
                    type="text"
                    required
                    value={tableNumber}
                    onChange={(e) => handleTableNumberChange(e.target.value)}
                    placeholder="Or enter table number or 'takeaway'..."
                    style={{
                      width: '100%',
                      padding: '0.85rem',
                      borderRadius: '10px',
                      border: '2px solid #e2e8f0',
                      fontSize: '1rem',
                      fontWeight: '600',
                      backgroundColor: 'white'
                    }}
                  />
                  {occupiedTables.some(t => {
                    // If editing and this is the same order, don't consider it occupied
                    const occupiedOrderId = t.orderId || t.order_id || t.id;
                    const occupiedOrderNumber = t.orderNumber || t.order_number;

                    if (editingOrder && (
                      (occupiedOrderId && String(occupiedOrderId) === String(editingOrder.id)) ||
                      (occupiedOrderNumber && String(occupiedOrderNumber) === String(editingOrder.order_number))
                    )) {
                      return false;
                    }
                    // Check both tableNumber and table_number fields, ensure proper comparison
                    const occupiedTableNum = t.tableNumber || t.table_number;
                    if (occupiedTableNum === null || occupiedTableNum === undefined) return false;
                    return String(occupiedTableNum) === String(tableNumber);
                  }) && tableNumber && tableNumber !== 'takeaway' && (
                      <div style={{
                        marginTop: '0.5rem',
                        padding: '0.5rem',
                        background: '#fff4d8',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        color: '#7c2d12',
                        fontWeight: '600'
                      }}>
                        ⚠️ This table has a pending order
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Delivery Details */}
            {isDelivery && (
              <div style={{
                background: 'white',
                borderBottom: '2px solid #e9ecef',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}>
                <div>
                  <h3 style={{ margin: 0 }}>Delivery Details</h3>
                  <p style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>
                    Capture customer info directly on the ticket.
                  </p>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem'
                }}>
                  <label style={{ fontWeight: 600 }}>
                    Full Name*
                    <input
                      type="text"
                      value={deliveryName}
                      onChange={(e) => handleDeliveryFieldChange('deliveryName', e.target.value)}
                      placeholder="Customer name"
                      style={{
                        width: '100%',
                        marginTop: '0.35rem',
                        padding: '0.85rem',
                        borderRadius: '10px',
                        border: '2px solid #e2e8f0'
                      }}
                    />
                  </label>
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontWeight: 600 }}>
                      Phone*
                      <input
                        type="tel"
                        value={deliveryPhone}
                        onChange={(e) => handlePhoneChange(e.target.value)}
                        onFocus={() => {
                          if (deliveryPhone.trim().length >= 1) {
                            setShowPhoneSuggestions(true);
                          }
                        }}
                        onBlur={(e) => {
                          // Don't hide if clicking inside the suggestions dropdown
                          const relatedTarget = e.relatedTarget || document.activeElement;
                          const suggestionsContainer = e.currentTarget.parentElement?.querySelector('[data-suggestions]');
                          if (suggestionsContainer && suggestionsContainer.contains(relatedTarget)) {
                            return;
                          }
                          // Delay hiding suggestions to allow click
                          setTimeout(() => setShowPhoneSuggestions(false), 200);
                        }}
                        placeholder="Start typing phone number..."
                        style={{
                          width: '100%',
                          marginTop: '0.35rem',
                          padding: '0.85rem',
                          borderRadius: '10px',
                          border: '2px solid #e2e8f0'
                        }}
                      />
                    </label>
                    {showPhoneSuggestions && phoneSuggestions.length > 0 && (
                      <div
                        data-suggestions
                        onMouseDown={(e) => {
                          // Prevent blur event when clicking inside dropdown
                          e.preventDefault();
                        }}
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          marginTop: '0.25rem',
                          background: 'white',
                          border: '2px solid #e2e8f0',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          zIndex: 1000,
                          maxHeight: '300px',
                          overflowY: 'auto'
                        }}
                      >
                        {phoneSuggestions.map((customer) => {
                          const firstAddress = customer.addresses && customer.addresses.length > 0
                            ? customer.addresses[0].address
                            : customer.address || '';
                          return (
                            <button
                              key={customer.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleCustomerSelect(customer);
                              }}
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '0.75rem 1rem',
                                border: 'none',
                                borderBottom: '1px solid #f1f3f5',
                                background: 'white',
                                cursor: 'pointer',
                                transition: 'background 0.2s'
                              }}
                              onMouseEnter={(e) => e.target.style.background = '#f8f9fa'}
                              onMouseLeave={(e) => e.target.style.background = 'white'}
                            >
                              <div style={{ fontWeight: '600', fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                                {customer.name || 'Unnamed Customer'}
                              </div>
                              <div style={{ color: '#495057', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                                {customer.phone}
                              </div>
                              {firstAddress && (
                                <div style={{ color: '#6c757d', fontSize: '0.8rem' }}>
                                  {firstAddress.slice(0, 60)}{firstAddress.length > 60 ? '...' : ''}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {phoneSearchLoading && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: '0.25rem',
                        padding: '0.5rem',
                        background: 'white',
                        border: '2px solid #e2e8f0',
                        borderRadius: '8px',
                        textAlign: 'center',
                        color: '#6c757d',
                        fontSize: '0.85rem'
                      }}>
                        Searching...
                      </div>
                    )}
                  </div>
                  <label style={{ fontWeight: 600 }}>
                    Backup Phone
                    <input
                      type="tel"
                      value={deliveryBackupPhone}
                      onChange={(e) => handleDeliveryFieldChange('deliveryBackupPhone', e.target.value)}
                      placeholder="Optional contact"
                      style={{
                        width: '100%',
                        marginTop: '0.35rem',
                        padding: '0.85rem',
                        borderRadius: '10px',
                        border: '2px solid #e2e8f0'
                      }}
                    />
                  </label>
                </div>

                {selectedCustomer ? (
                  <CustomerAddressSelector
                    customer={selectedCustomer}
                    selectedAddress={deliveryAddress}
                    onAddressSelect={(address) => {
                      // Handle both string (legacy) and object (new) formats
                      if (typeof address === 'object' && address.address) {
                        handleDeliveryFieldChange('deliveryAddress', address.address);
                        handleDeliveryFieldChange('deliveryNotes', address.notes || '');
                        handleDeliveryFieldChange('googleMapsLink', address.googleMapsLink || '');
                      } else {
                        handleDeliveryFieldChange('deliveryAddress', address);
                      }
                    }}
                    onNewAddress={(address) => {
                      // Handle both string (legacy) and object (new) formats
                      if (typeof address === 'object' && address.address) {
                        handleDeliveryFieldChange('deliveryAddress', address.address);
                        handleDeliveryFieldChange('deliveryNotes', address.notes || '');
                        handleDeliveryFieldChange('googleMapsLink', address.googleMapsLink || '');
                      } else {
                        handleDeliveryFieldChange('deliveryAddress', address);
                      }
                      // Reload customer to get updated addresses
                      if (selectedCustomer.id) {
                        customerAPI.getById(selectedCustomer.id).then(response => {
                          const updatedCustomer = response.data?.data || response.data;
                          setSelectedCustomer(updatedCustomer);
                        }).catch(err => console.error('Failed to reload customer:', err));
                      }
                    }}
                  />
                ) : (
                  <label style={{ fontWeight: 600 }}>
                    Address*
                    <textarea
                      value={deliveryAddress}
                      onChange={(e) => handleDeliveryFieldChange('deliveryAddress', e.target.value)}
                      placeholder="Select a customer first, or enter address manually..."
                      rows="3"
                      style={{
                        width: '100%',
                        marginTop: '0.35rem',
                        padding: '0.85rem',
                        borderRadius: '10px',
                        border: '2px solid #e2e8f0',
                        resize: 'vertical'
                      }}
                    />
                    <small style={{ display: 'block', marginTop: '0.25rem', color: '#6c757d', fontSize: '0.85rem' }}>
                      Tip: Start typing a phone number above to search for existing customers and their addresses
                    </small>
                  </label>
                )}

                <label style={{ fontWeight: 600 }}>
                  Notes / Instructions
                  <textarea
                    value={deliveryNotes}
                    onChange={(e) => handleDeliveryFieldChange('deliveryNotes', e.target.value)}
                    placeholder="Gate 2, call when outside, etc."
                    rows="3"
                    style={{
                      width: '100%',
                      marginTop: '0.35rem',
                      padding: '0.85rem',
                      borderRadius: '10px',
                      border: '2px solid #e2e8f0',
                      resize: 'vertical'
                    }}
                  />
                </label>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                      Delivery Charge (PKR)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={deliveryCharge}
                      onChange={(e) => handleDeliveryChargeChange(e.target.value)}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '0.9rem',
                        borderRadius: '10px',
                        border: '2px solid #e2e8f0',
                        fontSize: '1.1rem',
                        fontWeight: '600'
                      }}
                    />
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                      Payment Status
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => handleDeliveryPaymentChange('cod')}
                        style={{
                          flex: 1,
                          borderRadius: '10px',
                          border: deliveryPaymentType === 'cod' ? '3px solid #ffc107' : '2px solid #e2e8f0',
                          background: deliveryPaymentType === 'cod' ? '#fff4d8' : 'white',
                          fontWeight: '600',
                          cursor: 'pointer',
                          padding: '0.65rem'
                        }}
                      >
                        COD (Pending)
                      </button>
                      <button
                        onClick={() => handleDeliveryPaymentChange('prepaid')}
                        style={{
                          flex: 1,
                          borderRadius: '10px',
                          border: deliveryPaymentType === 'prepaid' ? '3px solid #28a745' : '2px solid #e2e8f0',
                          background: deliveryPaymentType === 'prepaid' ? '#e6ffed' : 'white',
                          fontWeight: '600',
                          cursor: 'pointer',
                          padding: '0.65rem'
                        }}
                      >
                        Prepaid (Paid)
                      </button>
                    </div>
                    <small style={{ display: 'block', marginTop: '0.35rem', color: '#6c757d' }}>
                      {deliveryPaymentType === 'cod'
                        ? 'Marked as pending until rider collects cash.'
                        : 'Payment already received (bank transfer).'}
                    </small>
                  </div>
                </div>
              </div>
            )}
            {cart.length === 0 ? (
              <div style={{ flex: 1, padding: '2rem' }}>
                <EmptyState
                  icon="🛒"
                  title="Cart is Empty"
                  message="Add items from the menu to start creating an order"
                />
              </div>
            ) : (
              <>
                {/* Cart Items */}
                <div style={{
                  padding: '1rem'
                }}>
                  {cart.map(item => (
                    <div
                      key={item.id}
                      style={{
                        background: '#f8f9fa',
                        borderRadius: '12px',
                        padding: '1rem',
                        marginBottom: '0.75rem',
                        border: '2px solid #e9ecef',
                        transition: 'all 0.3s'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '0.75rem'
                      }}>
                        <div>
                          <strong style={{
                            fontSize: '1rem',
                            color: '#212529',
                            display: 'block',
                            marginBottom: '0.25rem'
                          }}>
                            {item.name}
                          </strong>
                          <span style={{
                            fontSize: '0.85rem',
                            color: '#6c757d'
                          }}>
                            PKR {item.price} each
                          </span>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          style={{
                            background: '#dc3545',
                            border: 'none',
                            color: 'white',
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '1.2rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.3s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#c82333'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#dc3545'}
                        >
                          ×
                        </button>
                      </div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          background: 'white',
                          padding: '0.4rem',
                          borderRadius: '8px',
                          border: '2px solid #dee2e6'
                        }}>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            style={{
                              background: '#f8f9fa',
                              border: 'none',
                              color: '#495057',
                              width: '36px',
                              height: '36px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '1.2rem',
                              fontWeight: 'bold',
                              transition: 'all 0.3s'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#dc3545';
                              e.currentTarget.style.color = 'white';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#f8f9fa';
                              e.currentTarget.style.color = '#495057';
                            }}
                          >
                            −
                          </button>
                          <span style={{
                            minWidth: '40px',
                            textAlign: 'center',
                            fontWeight: 'bold',
                            fontSize: '1.1rem'
                          }}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            style={{
                              background: '#f8f9fa',
                              border: 'none',
                              color: '#495057',
                              width: '36px',
                              height: '36px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '1.2rem',
                              fontWeight: 'bold',
                              transition: 'all 0.3s'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#28a745';
                              e.currentTarget.style.color = 'white';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#f8f9fa';
                              e.currentTarget.style.color = '#495057';
                            }}
                          >
                            +
                          </button>
                        </div>
                        <div style={{
                          fontSize: '1.25rem',
                          fontWeight: 'bold',
                          color: 'var(--color-primary)'
                        }}>
                          PKR {(item.price * item.quantity).toFixed(0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Subtotal */}
                <div style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--gradient-primary)',
                  color: 'white'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '600', fontSize: '0.9rem' }}>
                    <span>Subtotal</span>
                    <span>PKR {subtotalAmount.toFixed(0)}</span>
                  </div>
                  {discountPercent > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem', opacity: 0.85, fontSize: '0.85rem' }}>
                      <span>Discount ({discountPercent}%)</span>
                      <span>- PKR {discountAmount.toFixed(0)}</span>
                    </div>
                  )}
                  {isDelivery && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem', opacity: 0.85, fontSize: '0.85rem' }}>
                      <span>Delivery Charge</span>
                      <span>PKR {deliveryFee.toFixed(0)}</span>
                    </div>
                  )}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '0.5rem',
                    fontSize: '1.1rem',
                    fontWeight: 'bold'
                  }}>
                    <span>Total</span>
                    <span>PKR {grandTotalAmount.toFixed(0)}</span>
                  </div>
                </div>
                {/* Payment and Checkout Section */}
                <div style={{
                  padding: '1rem',
                  background: '#f8f9fa',
                  borderTop: '2px solid #e9ecef',
                  flexShrink: 0
                }}>
                  {/* Discount Percentage */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '0.4rem',
                      fontWeight: 'bold',
                      color: '#495057',
                      fontSize: '0.8rem'
                    }}>
                      🏷️ Discount Percentage (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={discountPercent || ''}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                        updateActiveCart({ discountPercent: value });
                      }}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        border: '2px solid #dee2e6',
                        borderRadius: '8px',
                        fontSize: '0.9rem',
                        background: 'white'
                      }}
                    />
                  </div>

                  {/* Special Instructions */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '0.4rem',
                      fontWeight: 'bold',
                      color: '#495057',
                      fontSize: '0.8rem'
                    }}>
                      📝 Special Instructions (Optional)
                    </label>
                    <textarea
                      value={specialInstructions}
                      onChange={(e) => setSpecialInstructions(e.target.value)}
                      placeholder="e.g., Extra spicy, No onions..."
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        border: '2px solid #dee2e6',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        background: 'white',
                        minHeight: '60px',
                        resize: 'vertical',
                        fontFamily: 'inherit'
                      }}
                    />
                  </div>

                  {!isDelivery ? (
                    <div style={{
                      padding: '1rem',
                      borderRadius: '12px',
                      background: '#fff4d8',
                      border: '2px solid #f59f00',
                      marginBottom: '1rem'
                    }}>
                      <strong>💡 Dine-In Order</strong>
                      <p style={{ marginTop: '0.5rem', color: '#7c2d12', fontSize: '0.85rem' }}>
                        Payment will be collected when the customer is ready to pay. Mark as paid from the Dine-In Orders page.
                      </p>
                    </div>
                  ) : (
                    <div style={{
                      padding: '1rem',
                      borderRadius: '12px',
                      background: '#ffffff',
                      border: '2px solid rgba(0,0,0,0.05)',
                      marginBottom: '1rem'
                    }}>
                      <strong>Payment Status:</strong>{' '}
                      <span style={{ color: deliveryPaymentType === 'cod' ? '#d9480f' : '#198754' }}>
                        {deliveryPaymentType === 'cod' ? 'Pending (COD - Rider will collect cash)' : 'Completed (Prepaid)'}
                      </span>
                      <p style={{ marginTop: '0.35rem', color: '#6c757d', fontSize: '0.85rem' }}>
                        Update status later from Delivery Management after rider submits cash.
                      </p>
                    </div>
                  )}

                  {checkoutError && (
                    <div style={{
                      background: '#fff5f5',
                      border: '1px solid #ffc9c9',
                      color: '#c92a2a',
                      padding: '0.75rem 1rem',
                      borderRadius: '10px',
                      marginBottom: '1rem',
                      fontWeight: '600'
                    }}>
                      {checkoutError}
                    </div>
                  )}

                  {/* Checkout Button */}
                  <button
                    onClick={handleCheckout}
                    disabled={!canSubmitOrder}
                    title={isSelectedTableOccupied ? `Table #${tableNumber} is already reserved. Please select a different table.` : undefined}
                    style={{
                      width: '100%',
                      padding: '0.85rem',
                      border: 'none',
                      borderRadius: '10px',
                      background: canSubmitOrder
                        ? 'var(--gradient-primary)'
                        : isSelectedTableOccupied
                          ? '#ffc107'
                          : 'var(--color-border)',
                      color: 'white',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      cursor: canSubmitOrder ? 'pointer' : 'not-allowed',
                      transition: 'all 0.3s',
                      boxShadow: canSubmitOrder ? 'var(--shadow-md)' : 'none',
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem'
                    }}
                    onMouseEnter={(e) => {
                      if (canSubmitOrder) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                        e.currentTarget.style.background = 'var(--color-primary-dark)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (canSubmitOrder) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        e.currentTarget.style.background = 'var(--gradient-primary)';
                      }
                    }}
                  >
                    {checkoutButtonLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default OrderSystem;