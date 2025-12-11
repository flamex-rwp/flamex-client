import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';
import { printReceipt } from './Receipt';
import { getOfflineOrders, getOfflineOrdersCount, updateOfflineOrder, addPendingOperation } from '../utils/offlineDB';
import { isOnline } from '../services/offlineSyncService';
import { useOffline } from '../contexts/OfflineContext';
import OfflineIndicator from './OfflineIndicator';

dayjs.extend(relativeTime);

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return '0';
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DineInOrders = () => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' or 'completed'
  const [pendingOrders, setPendingOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('today'); // 'today', 'yesterday', 'this_week', 'this_month', or 'custom'
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });
  const [stats, setStats] = useState({
    pending_payments: { count: 0, total_amount: 0 },
    received_payments: { count: 0, total_amount: 0 },
    cash_payments: { count: 0, total_amount: 0 },
    bank_payments: { count: 0, total_amount: 0 },
    total_orders: 0,
    total_revenue: 0,
    average_order_value: 0
  });
  const [paymentModal, setPaymentModal] = useState({
    open: false,
    order: null,
    paymentMethod: 'cash',
    amountTaken: ''
  });
  const [offlineToastShown, setOfflineToastShown] = useState(false);
  const { online } = useOffline();

  // Default stats and merge helper to prevent undefined accesses
  const defaultStats = useMemo(() => ({
    pending_payments: { count: 0, total_amount: 0 },
    received_payments: { count: 0, total_amount: 0 },
    cash_payments: { count: 0, total_amount: 0 },
    bank_payments: { count: 0, total_amount: 0 },
    total_orders: 0,
    total_revenue: 0,
    average_order_value: 0
  }), []);

  const mergeStats = useCallback((incoming = {}) => ({
    ...defaultStats,
    ...incoming,
    pending_payments: { ...defaultStats.pending_payments, ...(incoming.pending_payments || {}) },
    received_payments: { ...defaultStats.received_payments, ...(incoming.received_payments || {}) },
    cash_payments: { ...defaultStats.cash_payments, ...(incoming.cash_payments || {}) },
    bank_payments: { ...defaultStats.bank_payments, ...(incoming.bank_payments || {}) }
  }), [defaultStats]);

  // Fetch statistics for summary cards
  const fetchStats = useCallback(async () => {
    try {
      const params = { filter: dateFilter };
      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }

      const response = await ordersAPI.getDineInStats(params);
      const payload = response.data?.data || response.data || {};
      setStats(mergeStats({
        pending_payments: {
          count: payload.pendingOrders || 0,
          total_amount: payload.pendingRevenue || 0
        },
        received_payments: {
          count: payload.completedOrders || 0,
          total_amount: payload.completedRevenue || 0
        },
        total_orders: payload.totalOrders || 0,
        total_revenue: payload.totalRevenue || 0,
        average_order_value: payload.totalOrders > 0 ? (payload.totalRevenue / payload.totalOrders) : 0
      }));
    } catch (err) {
      console.error('Failed to load stats', err);
      // Set default stats if API fails
      setStats({ ...defaultStats });
    }
  }, [dateFilter, startDate, endDate, mergeStats, defaultStats]);

  const fetchOrders = useCallback(async (tab = null) => {
    // If tab is not specified, use activeTab. Otherwise fetch for the specified tab
    const targetTab = tab || activeTab;
    setLoading(true);
    setError('');
    try {
      const params = {
        status: targetTab,
        filter: dateFilter
      };

      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }

      // Fetch API orders
      let apiOrders = [];
      try {
        const response = await ordersAPI.getDineInOrders(params);
        apiOrders = response.data.data || [];
      } catch (err) {
        console.warn('Failed to load dine-in orders from API, using offline only:', err);
      }

      // Fetch offline orders
      const offlineOrdersData = await getOfflineOrders();
      const offlineOrders = offlineOrdersData
        .filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include dine-in orders (not delivery)
          if (orderData.order_type === 'dine_in' || orderData.orderType === 'dine_in' || !orderData.order_type) {
            // Use a unique negative ID for offline orders to avoid conflicts with API orders
            const uniqueOfflineId = `OFFLINE-${offlineOrder.id || index}-${offlineOrder.timestamp || Date.now()}`;
            return {
              ...orderData,
              id: uniqueOfflineId, // Unique ID for offline orders
              offlineId: offlineOrder.id, // Store original IndexedDB ID
              order_number: orderData.order_number || orderData.orderNumber || null,
              orderStatus: orderData.orderStatus || orderData.order_status || 'pending',
              paymentStatus: orderData.paymentStatus || orderData.payment_status || 'pending',
              status: orderData.status || 'pending',
              offline: true,
              offlineStatusUpdated: orderData.offlineStatusUpdated || false, // Track if status was updated offline
              createdAt: orderData.created_at || orderData.createdAt || offlineOrder.timestamp,
              synced: false,
              // Include items if available
              items: orderData.items || orderData.orderItems || [],
              orderItems: orderData.orderItems || orderData.items || []
            };
          }
          return null;
        })
        .filter(Boolean);

      // Merge API and offline orders, remove duplicates by checking order_number and timestamp
      const allOrders = [...apiOrders];
      const apiOrderNumbers = new Set(apiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean));
      
      offlineOrders.forEach(offlineOrder => {
        // Only check order_number for duplicates, not ID (since offline IDs are unique)
        const orderNum = offlineOrder.order_number || offlineOrder.orderNumber;
        const exists = orderNum ? apiOrderNumbers.has(orderNum) : false;
        
        if (!exists) {
          allOrders.push(offlineOrder);
        }
      });

      // Sort by creation date (newest first)
      allOrders.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at || 0);
        const dateB = new Date(b.createdAt || b.created_at || 0);
        return dateB - dateA;
      });

      console.log('✅ Orders fetched:', apiOrders.length, 'API orders,', offlineOrders.length, 'offline orders for', targetTab);

      if (targetTab === 'pending') {
        setPendingOrders(allOrders);
      } else {
        setCompletedOrders(allOrders);
      }
    } catch (err) {
      console.error('Failed to load dine-in orders', err);
      setError(err.response?.data?.error || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFilter, startDate, endDate]);

  // Fetch both pending and completed orders (for counts)
  const fetchAllOrders = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const params = { filter: dateFilter };
      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }

      // Fetch API orders in parallel
      let pendingApiOrders = [];
      let completedApiOrders = [];
      try {
        const [pendingResponse, completedResponse] = await Promise.all([
          ordersAPI.getDineInOrders({ ...params, status: 'pending' }),
          ordersAPI.getDineInOrders({ ...params, status: 'completed' })
        ]);
        pendingApiOrders = pendingResponse.data.data || [];
        completedApiOrders = completedResponse.data.data || [];
        
        // Normalize API orders: if paymentStatus is completed, ensure orderStatus is also completed
        const normalizeOrderStatus = (order) => {
          const normalized = { ...order };
          const paymentStatus = normalized.paymentStatus || normalized.payment_status || 'pending';
          const orderStatus = normalized.orderStatus || normalized.order_status || 'pending';
          
          // If payment is completed, ensure orderStatus is also completed
          if (paymentStatus === 'completed' && orderStatus !== 'completed' && orderStatus !== 'cancelled') {
            normalized.orderStatus = 'completed';
            normalized.order_status = 'completed';
            console.log(`[DineInOrders] Normalized API order ${normalized.id || normalized.orderNumber}: paymentStatus=completed but orderStatus was ${orderStatus}, setting to completed`);
          }
          
          return normalized;
        };
        
        pendingApiOrders = pendingApiOrders.map(normalizeOrderStatus);
        completedApiOrders = completedApiOrders.map(normalizeOrderStatus);
      } catch (err) {
        console.warn('Failed to load orders from API, using offline only:', err);
      }

      // Fetch offline orders
      const offlineOrdersData = await getOfflineOrders();
      const offlineOrders = offlineOrdersData
        .filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include dine-in orders
          if (orderData.order_type === 'dine_in' || orderData.orderType === 'dine_in' || !orderData.order_type) {
            const uniqueOfflineId = `OFFLINE-${offlineOrder.id || index}-${offlineOrder.timestamp || Date.now()}`;
            
            // Determine order status - check multiple fields and prioritize completed status
            const orderStatus = orderData.orderStatus || orderData.order_status || orderData.status || 'pending';
            const paymentStatus = orderData.paymentStatus || orderData.payment_status || 'pending';
            
            // If payment is completed or order status is completed, mark as completed
            const isCompleted = orderStatus === 'completed' || paymentStatus === 'completed' || 
                               orderData.offlineStatusUpdated === true;
            
            return {
              ...orderData,
              id: uniqueOfflineId,
              offlineId: offlineOrder.id,
              order_number: orderData.order_number || orderData.orderNumber || null,
              orderStatus: isCompleted ? 'completed' : orderStatus,
              paymentStatus: paymentStatus,
              status: isCompleted ? 'completed' : orderStatus,
              offline: true,
              createdAt: orderData.created_at || orderData.createdAt || offlineOrder.timestamp,
              synced: false,
              items: orderData.items || orderData.orderItems || [],
              orderItems: orderData.orderItems || orderData.items || [],
              offlineStatusUpdated: orderData.offlineStatusUpdated || false
            };
          }
          return null;
        })
        .filter(Boolean);

      // Separate offline orders into pending and completed
      const offlinePendingOrders = [];
      const offlineCompletedOrders = [];
      const apiOrderNumbers = new Set([
        ...pendingApiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean),
        ...completedApiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean)
      ]);
      
      offlineOrders.forEach(offlineOrder => {
        const orderNum = offlineOrder.order_number || offlineOrder.orderNumber;
        const exists = orderNum ? apiOrderNumbers.has(orderNum) : false;
        
        if (!exists) {
          // Check if order is completed based on status
          const isCompleted = offlineOrder.orderStatus === 'completed' || 
                            offlineOrder.paymentStatus === 'completed' ||
                            offlineOrder.status === 'completed' ||
                            offlineOrder.offlineStatusUpdated === true;
          
          if (isCompleted) {
            offlineCompletedOrders.push(offlineOrder);
          } else {
            offlinePendingOrders.push(offlineOrder);
          }
        }
      });

      // Merge API and offline orders
      const allPendingOrders = [...pendingApiOrders, ...offlinePendingOrders];
      const allCompletedOrders = [...completedApiOrders, ...offlineCompletedOrders];

      // Sort by creation date (newest first)
      allPendingOrders.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at || 0);
        const dateB = new Date(b.createdAt || b.created_at || 0);
        return dateB - dateA;
      });
      
      allCompletedOrders.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at || 0);
        const dateB = new Date(b.createdAt || b.created_at || 0);
        return dateB - dateA;
      });

      setPendingOrders(allPendingOrders);
      setCompletedOrders(allCompletedOrders);
    } catch (err) {
      console.error('Failed to load all orders', err);
      setError('Failed to load orders');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [dateFilter, startDate, endDate]);

  // Fetch data on component mount and when filters change
  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchAllOrders(),
        fetchStats()
      ]);
    };
    loadData();
  }, [fetchAllOrders, fetchStats]);

  // Show offline pending orders notice (PWA sync)
  useEffect(() => {
    const checkOffline = async () => {
      if (offlineToastShown) return;
      try {
        const count = await getOfflineOrdersCount();
        if (count > 0) {
          showError(`You have ${count} offline order(s) pending sync. Keep the app open to sync when online.`);
          setOfflineToastShown(true);
        }
      } catch (err) {
        console.warn('Failed to check offline orders count', err);
      }
    };
    checkOffline();
  }, [offlineToastShown, showError]);

  // When coming back online, refresh to reflect synced offline changes
  useEffect(() => {
    if (online) {
      // Small delay to allow sync to complete
      const timer = setTimeout(() => {
        fetchAllOrders();
        fetchStats();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [online, fetchAllOrders, fetchStats]);

  // Periodically refresh orders when online to catch synced changes
  // Use a longer interval (30 seconds) and don't show loading state for background refreshes
  useEffect(() => {
    if (!online) return;
    
    const interval = setInterval(() => {
      fetchAllOrders(false); // Don't show loading state for background refresh
      fetchStats();
    }, 30000); // Refresh every 30 seconds when online (reduced frequency)
    
    return () => clearInterval(interval);
  }, [online, fetchAllOrders, fetchStats]);

  // Reset filter to 'today' when switching tabs
  useEffect(() => {
    setDateFilter('today');
    setStartDate(null);
    setEndDate(null);
    setShowCustomRange(false);
  }, [activeTab]);

  const handleDateFilterChange = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    setDateFilter('custom');
    setShowCustomRange(false);
  };

  const handleQuickFilter = (filter) => {
    if (filter === 'custom') {
      setShowCustomRange(!showCustomRange);
      if (!showCustomRange) {
        setDateFilter('custom');
      } else {
        setDateFilter('today');
        setStartDate(null);
        setEndDate(null);
      }
    } else {
      setDateFilter(filter);
      setStartDate(null);
      setEndDate(null);
      setShowCustomRange(false);
    }
  };

  const openPaymentModal = (order) => {
    setPaymentModal({
      open: true,
      order,
      paymentMethod: 'cash',
      amountTaken: ''
    });
  };

  const closePaymentModal = () => {
    setPaymentModal({
      open: false,
      order: null,
      paymentMethod: 'cash',
      amountTaken: ''
    });
  };

  const handleMarkAsPaid = async () => {
    const { order, paymentMethod, amountTaken } = paymentModal;

    if (!paymentMethod) {
      showError('Please select a payment method');
      return;
    }

    if (paymentMethod === 'cash') {
      if (!amountTaken) {
        showError('Amount taken is required for cash payments');
        return;
      }
      // Allow partial payments - amountTaken can be less than total_amount
    }

    setMarkingPaidId(order.id);
    try {
      const payload = {
        paymentMethod: paymentMethod
      };

      if (paymentMethod === 'cash') {
        payload.amountTaken = parseFloat(amountTaken);
        payload.returnAmount = getReturnAmount();
      }

      const isOffline = order.offline;
      let updatedOrder = null;
      let orderItems = [];

      if (isOffline) {
        // Update offline order locally
        const newPaymentStatus = 'completed';
        const newOrderStatus = 'completed'; // Also update order status to completed when marked as paid
        const updatedData = {
          payment_method: paymentMethod,
          paymentMethod,
          amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
          return_amount: payload.returnAmount || 0,
          payment_status: newPaymentStatus,
          paymentStatus: newPaymentStatus,
          order_status: newOrderStatus,
          orderStatus: newOrderStatus
        };
        updatedOrder = await updateOfflineOrder(order.offlineId || order.id, updatedData);
        
        // Queue the payment status update for sync
        await addPendingOperation({
          type: 'mark_as_paid',
          endpoint: `/api/orders/${order.id}/mark-as-paid`,
          method: 'POST',
          data: payload,
          offlineId: order.offlineId || order.id
        });
        
        // Also queue the order status update to 'completed'
        await addPendingOperation({
          type: 'update_order_status',
          endpoint: `/api/orders/${order.id}/status`,
          method: 'PUT',
          data: { order_status: 'completed' },
          offlineId: order.offlineId || order.id
        });
        
        orderItems = order.orderItems || order.order_items || order.items || [];
        if (!Array.isArray(orderItems)) orderItems = [];
        if (!orderItems.length) {
          showError('No items found for this offline order. Cannot print receipt.');
          return;
        }
      } else {
        try {
          await ordersAPI.markAsPaid(order.id, payload);

          // Fetch updated order details for receipt
          const orderResponse = await ordersAPI.getById(order.id);
          // Handle wrapped response format {success, data: {...}}
          updatedOrder = orderResponse.data.data || orderResponse.data;

          if (!updatedOrder) {
            throw new Error('Failed to fetch order details');
          }

          // Get order items
          const itemsResponse = await ordersAPI.getOrderItems(order.id);
          // Handle wrapped response format {success, data: [...]}
          orderItems = itemsResponse.data.data || itemsResponse.data || [];
          orderItems = Array.isArray(orderItems) ? orderItems : [];

          if (!orderItems || orderItems.length === 0) {
            console.warn('No items found for order', order.id);
            // Use items from the order object if available
            const fallbackItems = order.items ? (Array.isArray(order.items) ? order.items : []) : [];
            if (fallbackItems.length === 0) {
              showError('No items found for this order. Cannot print receipt.');
              return;
            }
            orderItems = fallbackItems;
          }
        } catch (apiError) {
          // If API call fails (network error), fall back to offline mode
          if (!isOnline() || apiError.code === 'ERR_NETWORK') {
            console.warn('API call failed, saving offline:', apiError);
            const newPaymentStatus = 'completed';
            const newOrderStatus = 'completed';
            const updatedData = {
              payment_method: paymentMethod,
              paymentMethod,
              amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
              return_amount: payload.returnAmount || 0,
              payment_status: newPaymentStatus,
              paymentStatus: newPaymentStatus,
              order_status: newOrderStatus,
              orderStatus: newOrderStatus
            };
            
            // Extract the real offline ID (IndexedDB ID) for updating
            const realOfflineId = order.offlineId || (order.id?.startsWith('OFFLINE-') 
              ? order.id.replace(/^OFFLINE-/, '').split('-')[0] 
              : order.id);
            
            // Try to update offline order if it exists, otherwise create a pending operation
            try {
              // Update the order in IndexedDB with completed status
              updatedOrder = await updateOfflineOrder(realOfflineId, {
                ...updatedData,
                offlineStatusUpdated: true
              });
              console.log('[DineInOrders] Updated offline order in IndexedDB:', realOfflineId, updatedData);
            } catch (updateError) {
              console.warn('Could not update offline order, will queue for sync:', updateError);
            }
            
            // Queue operations for sync - use the real offline ID
            await addPendingOperation({
              type: 'mark_as_paid',
              endpoint: `/api/orders/${realOfflineId}/mark-as-paid`,
              method: 'POST',
              data: payload,
              offlineId: realOfflineId
            });
            
            await addPendingOperation({
              type: 'update_order_status',
              endpoint: `/api/orders/${realOfflineId}/status`,
              method: 'PUT',
              data: { order_status: 'completed' },
              offlineId: realOfflineId
            });
            
            orderItems = order.orderItems || order.order_items || order.items || [];
            if (!Array.isArray(orderItems)) orderItems = [];
            if (!orderItems.length) {
              showError('No items found for this order. Cannot print receipt.');
              return;
            }
          } else {
            // Re-throw if it's not a network error
            throw apiError;
          }
        }
      }

      // Calculate subtotal from items
      const subtotal = orderItems.reduce((sum, item) => {
        const itemPrice = parseFloat(item.price || item.item_price || 0);
        const itemQty = parseInt(item.quantity || 0);
        return sum + (itemPrice * itemQty);
      }, 0);

      // Get discount percentage from order
      const discountPercent = parseFloat(updatedOrder?.discount_percent || updatedOrder?.discountPercent || order.discount_percent || order.discountPercent || 0);
      
      // Calculate discount amount and total after discount
      const discountAmount = discountPercent > 0 ? (subtotal * discountPercent / 100) : 0;
      const subtotalAfterDiscount = subtotal - discountAmount;
      
      // Calculate total amount (use order total if available, otherwise use calculated total)
      const calculatedTotal = subtotalAfterDiscount;
      const totalAmount = parseFloat(updatedOrder?.total_amount || order.total_amount) || calculatedTotal;
      
      const returnAmount = paymentMethod === 'cash' && amountTaken
        ? Math.max(0, parseFloat(amountTaken) - totalAmount)
        : 0;

      // Prepare receipt data - ensure all required fields are present
      const receiptDataForPrint = {
        id: updatedOrder?.id || order.id,
        order_number: updatedOrder?.order_number || order.order_number,
        table_number: updatedOrder?.table_number || order.table_number,
        items: orderItems.map(item => ({
          name: item.menuItem?.name || item.item_name || item.name || 'Unknown Item',
          quantity: parseInt(item.quantity || 0),
          price: parseFloat(item.price || item.item_price || 0)
        })),
        subtotal: subtotal,
        total_amount: totalAmount,
        discount_percent: discountPercent,
        discountPercent: discountPercent,
        delivery_charge: 0,
        payment_method: paymentMethod,
        amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
        return_amount: returnAmount,
        payment_status: 'completed',
        order_type: 'dine_in',
        special_instructions: updatedOrder?.special_instructions || order.special_instructions || null,
        cashier_name: updatedOrder?.cashier_name || 'Cashier'
      };

      // Print customer receipt using JavaScript-controlled printing
      printReceipt(receiptDataForPrint, 'customer');

      // Show appropriate success message based on online/offline status
      const isOfflineOrder = order.offline;
        if (isOfflineOrder) {
          // Update local state immediately so UI reflects payment completion while offline
          const updatedLocal = {
            payment_status: 'completed',
            paymentStatus: 'completed',
            order_status: 'completed',
            orderStatus: 'completed',
            offlineStatusUpdated: true,
            payment_method: paymentMethod,
            amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
            return_amount: payload.returnAmount || 0
          };
          setPendingOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...updatedLocal } : o));
          setCompletedOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...updatedLocal } : o));
          showSuccess(`Order #${order.order_number || order.id} marked as paid and status updated to completed. Changes will sync when you are back online.`);
        } else {
          showSuccess(`Order #${order.order_number || order.id} marked as paid successfully`);
        }
        closePaymentModal();

        // Refresh both order lists and stats (uses cache when offline)
        await Promise.all([
          fetchAllOrders(),
          fetchStats()
        ]);
    } catch (err) {
      console.error('Failed to mark order as paid', err);
      showError(err.response?.data?.error || 'Failed to mark order as paid');
    } finally {
      setMarkingPaidId(null);
    }
  };

  const getReturnAmount = () => {
    if (paymentModal.paymentMethod !== 'cash' || !paymentModal.amountTaken) return 0;
    const total = parseFloat(paymentModal.order?.total_amount || 0);
    const taken = parseFloat(paymentModal.amountTaken || 0);
    // Allow negative values for partial payments (amount due)
    return taken - total;
  };

  // Calculate order duration
  const getOrderDuration = (createdAt) => {
    const now = dayjs();
    const created = dayjs(createdAt);
    const minutes = now.diff(created, 'minute');
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  // Get duration color based on time
  const getDurationColor = (createdAt) => {
    const minutes = dayjs().diff(dayjs(createdAt), 'minute');
    if (minutes < 15) return '#28a745';
    if (minutes < 30) return '#ffc107';
    return '#dc3545';
  };

  // Handle status update
  const handleStatusUpdate = async (orderId, newStatus) => {
    setUpdatingStatusId(orderId);
    try {
      const targetOrder = [...pendingOrders, ...completedOrders].find(o => o.id === orderId);
      
      // If offline, save to pending operations queue
      if (!isOnline()) {
        // Extract real order ID (remove OFFLINE- prefix if present)
        const realOrderId = orderId.startsWith('OFFLINE-') 
          ? targetOrder?.offlineId || orderId.replace(/^OFFLINE-.*?-/, '')
          : orderId;
        
        // Save to pending operations for sync when online
        await addPendingOperation({
          type: 'update_order_status',
          endpoint: `/api/orders/${realOrderId}/status`,
          method: 'PUT',
          data: { order_status: newStatus }
        });
        
        // Also update local offline order if it exists
        if (targetOrder?.offline) {
          await updateOfflineOrder(targetOrder.offlineId || realOrderId, {
            order_status: newStatus,
            orderStatus: newStatus
          });
        }
        
        showSuccess(`Status update saved offline. It will sync when you are back online.`);
        await fetchAllOrders();
        setUpdatingStatusId(null);
        return;
      }
      
      // Online: try API first
      if (targetOrder?.offline) {
          await updateOfflineOrder(targetOrder.offlineId || orderId, {
            order_status: newStatus,
            orderStatus: newStatus,
            offlineStatusUpdated: true // Mark that status was updated offline
          });
        showSuccess(`Offline order status updated to ${newStatus}`);
        await fetchAllOrders();
      } else {
        try {
          await ordersAPI.updateOrderStatus(orderId, newStatus);
          showSuccess(`Order status updated to ${newStatus}`);
          // Refresh orders and stats
          await Promise.all([
            fetchAllOrders(),
            fetchStats()
          ]);
        } catch (error) {
          // If API fails, save to pending operations
          if (!error.response) {
            await addPendingOperation({
              type: 'update_order_status',
              endpoint: `/api/orders/${orderId}/status`,
              method: 'PUT',
              data: { order_status: newStatus }
            });
            showSuccess(`Status update saved offline. It will sync when connection is restored.`);
            await fetchAllOrders();
          } else {
            throw error;
          }
        }
      }
    } catch (err) {
      console.error('Failed to update order status', err);
      showError(err.response?.data?.error || 'Failed to update order status');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  // Handle order cancellation
  const handleCancelOrder = async (orderId) => {
    setConfirmModal({
      isOpen: true,
      title: 'Cancel Order',
      message: 'Are you sure you want to cancel this order? This action cannot be undone.',
      onConfirm: async () => {
        setCancellingOrderId(orderId);
        try {
          const targetOrder = [...pendingOrders, ...completedOrders].find(o => o.id === orderId);
          if (targetOrder?.offline) {
            await updateOfflineOrder(targetOrder.offlineId || orderId, {
              order_status: 'cancelled',
              orderStatus: 'cancelled',
              status: 'cancelled'
            });
            showSuccess('Offline order cancelled locally');
            await fetchAllOrders();
          } else {
            await ordersAPI.cancelOrder(orderId);
            showSuccess('Order cancelled successfully');
            // Refresh both order lists and stats
            await Promise.all([
              fetchAllOrders(),
              fetchStats()
            ]);
          }
        } catch (err) {
          console.error('Failed to cancel order', err);
          showError(err.response?.data?.error || 'Failed to cancel order');
        } finally {
          setCancellingOrderId(null);
        }
      },
      variant: 'danger'
    });
  };

  // Handle revert payment
  const handleRevertPayment = async (orderId) => {
    setConfirmModal({
      isOpen: true,
      title: 'Revert Payment Status',
      message: 'Are you sure you want to revert the payment status? This will mark the order as pending payment again.',
      onConfirm: async () => {
        setMarkingPaidId(orderId);
        try {
          await ordersAPI.update(orderId, {
            paymentStatus: 'pending',
            amountTaken: null,
            returnAmount: null
          });
          showSuccess('Payment status reverted to pending successfully');
          // Refresh both order lists and stats
          await Promise.all([
            fetchAllOrders(),
            fetchStats()
          ]);
        } catch (err) {
          console.error('Failed to revert payment status', err);
          showError(err.response?.data?.error || 'Failed to revert payment status');
        } finally {
          setMarkingPaidId(null);
        }
      },
      variant: 'warning'
    });
  };

  const currentOrders = activeTab === 'pending' ? pendingOrders : completedOrders;
  const safeStats = stats || defaultStats;

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <OfflineIndicator />
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem', color: '#2d3748', fontSize: '2rem', fontWeight: 'bold' }}>🍽️ Dine-In Orders</h1>

        {/* Summary Cards */}
        <style>{`
          .summary-cards-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
          }
          @media (min-width: 1200px) {
            .summary-cards-grid {
              grid-template-columns: repeat(6, 1fr);
            }
          }
          @media (max-width: 768px) {
            .summary-cards-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }
          @media (max-width: 480px) {
            .summary-cards-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
        <div className="summary-cards-grid">
          <div style={{
            background: 'linear-gradient(135deg, #ffc107 0%, #ff9800 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Pending Payments</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {safeStats.pending_payments?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.pending_payments?.total_amount ?? 0)}
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Received Payments</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {safeStats.received_payments?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.received_payments?.total_amount ?? 0)}
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Orders</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {safeStats.total_orders ?? 0}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              Avg: {formatCurrency(safeStats.average_order_value ?? 0)}
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #6f42c1 0%, #5a32a3 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Revenue</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {formatCurrency(safeStats.total_revenue ?? 0)}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              Based on filter
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>💵 Cash Payments</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.cash_payments.count}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(stats.cash_payments.total_amount)}
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #fd7e14 0%, #e8590c 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>🏦 Bank Payments</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {stats.bank_payments.count}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(stats.bank_payments.total_amount)}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          borderBottom: '2px solid #e9ecef'
        }}>
          <button
            onClick={() => setActiveTab('pending')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'pending' ? '3px solid var(--color-primary)' : '3px solid transparent',
              color: activeTab === 'pending' ? 'var(--color-primary)' : '#6c757d',
              fontWeight: activeTab === 'pending' ? 'bold' : 'normal',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            ⏳ Pending ({pendingOrders.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'completed' ? '3px solid var(--color-primary)' : '3px solid transparent',
              color: activeTab === 'completed' ? 'var(--color-primary)' : '#6c757d',
              fontWeight: activeTab === 'completed' ? 'bold' : 'normal',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            ✅ Completed ({completedOrders.length})
          </button>
        </div>

        {/* Date Filters */}
        <div style={{
          background: 'white',
          padding: '1rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ marginBottom: '0.75rem', fontWeight: '600', color: '#495057' }}>
            Filter by Date
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'this_week', label: 'This Week' },
              { key: 'this_month', label: 'This Month' },
              { key: 'custom', label: 'Custom' }
            ].map(filter => (
              <button
                key={filter.key}
                onClick={() => handleQuickFilter(filter.key)}
                style={{
                  padding: '0.5rem 1rem',
                  border: (dateFilter === filter.key || (filter.key === 'custom' && showCustomRange)) ? '2px solid var(--color-primary)' : '2px solid #dee2e6',
                  borderRadius: '8px',
                  background: (dateFilter === filter.key || (filter.key === 'custom' && showCustomRange)) ? 'var(--gradient-primary)' : 'white',
                  color: (dateFilter === filter.key || (filter.key === 'custom' && showCustomRange)) ? 'white' : '#495057',
                  fontWeight: (dateFilter === filter.key || (filter.key === 'custom' && showCustomRange)) ? 'bold' : 'normal',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range Input */}
          {showCustomRange && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: '#f8f9fa',
              borderRadius: '8px',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-end',
              flexWrap: 'wrap'
            }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate || ''}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || dayjs().format('YYYY-MM-DD')}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate || ''}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={dayjs().format('YYYY-MM-DD')}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
              <button
                onClick={() => {
                  if (startDate && endDate && dayjs(startDate).isBefore(dayjs(endDate).add(1, 'day'))) {
                    handleDateFilterChange(startDate, endDate);
                  }
                }}
                disabled={!startDate || !endDate || dayjs(startDate).isAfter(dayjs(endDate))}
                style={{
                  padding: '0.5rem 1.5rem',
                  border: 'none',
                  borderRadius: '6px',
                  background: 'var(--gradient-primary)',
                  color: 'white',
                  fontWeight: 'bold',
                  cursor: (!startDate || !endDate || dayjs(startDate).isAfter(dayjs(endDate))) ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: (!startDate || !endDate || dayjs(startDate).isAfter(dayjs(endDate))) ? 0.5 : 1
                }}
              >
                Apply
              </button>
            </div>
          )}

          {/* Active Range Display */}
          {(dateFilter === 'custom' && startDate && endDate) && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: '#fff4d8',
              borderRadius: '6px',
              fontSize: '0.85rem',
              color: '#7c2d12',
              fontWeight: '600'
            }}>
              Active Range: {dayjs(startDate).format('MMM D, YYYY')} → {dayjs(endDate).format('MMM D, YYYY')}
            </div>
          )}
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6c757d' }}>
          Loading orders...
        </div>
      ) : error ? (
        <div style={{
          background: '#fff5f5',
          border: '1px solid #ffc9c9',
          color: '#c92a2a',
          padding: '1rem',
          borderRadius: '8px',
          marginBottom: '1rem'
        }}>
          {error}
        </div>
      ) : currentOrders.length === 0 ? (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#6c757d'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
            {activeTab === 'pending' ? '⏳' : '✅'}
          </div>
          <h3>No {activeTab} orders found</h3>
          <p>Try adjusting your date filters</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gap: '1rem'
        }}>
          {currentOrders.map(order => (
            <div
              key={order.id}
              style={{
                background: 'white',
                padding: '1.5rem',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                border: activeTab === 'pending' ? '2px solid #ffc107' : '2px solid #28a745'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1rem'
              }}>
                <div>
                  <h3 style={{ margin: 0, color: '#2d3748', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span>Order #{order.orderNumber || order.order_number || order.id}</span>
                    {order.offline && (
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        background: '#fff3cd',
                        color: '#856404',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        border: '1px solid #ffc107'
                      }}>
                        📴 Offline (Pending Sync)
                      </span>
                    )}
                    {order.table_number && (
                      <span style={{ fontSize: '0.9rem', color: '#6c757d', fontWeight: 'normal' }}>
                        • Table #{order.tableNumber || order.table_number}
                      </span>
                    )}
                  </h3>
                  <p style={{ margin: '0.5rem 0 0 0', color: '#6c757d', fontSize: '0.9rem' }}>
                    {dayjs(order.createdAt || order.created_at).format('MMM D, YYYY h:mm A')}
                  </p>
                  {activeTab === 'pending' && (
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', fontWeight: '600', color: getDurationColor(order.created_at) }}>
                      ⏱️ Waiting: {getOrderDuration(order.createdAt || order.created_at)}
                    </p>
                  )}
                  {order.order_status && (
                    <div style={{
                      marginTop: '0.5rem',
                      display: 'inline-block',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '20px',
                      background: (order.orderStatus || order.order_status) === 'ready' ? '#d4edda' : (order.orderStatus || order.order_status) === 'preparing' ? '#fff3cd' : '#e2e3e5',
                      color: (order.orderStatus || order.order_status) === 'ready' ? '#155724' : (order.orderStatus || order.order_status) === 'preparing' ? '#856404' : '#383d41',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'capitalize'
                    }}>
                      Status: {order.orderStatus || order.order_status}
                    </div>
                  )}
                  
                  {/* Offline Status Label - Show when status was updated offline */}
                  {((order.offline && (order.orderStatus || order.order_status)) || order.offlineStatusUpdated) && (
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.4rem 0.6rem',
                      background: '#fff4d8',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: '#7c2d12',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}>
                      <span>📴</span>
                      <span>
                        Status: {(() => {
                          const status = order.orderStatus || order.order_status || 'pending';
                          return status.replace(/_/g, ' ');
                        })()} - Offline Mode
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    color: 'var(--color-primary)'
                  }}>
                    {formatCurrency(order.totalAmount || order.total_amount)}
                  </div>
                  <div style={{
                    marginTop: '0.5rem',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '20px',
                    background: activeTab === 'pending' ? '#fff4d8' : '#e6ffed',
                    color: activeTab === 'pending' ? '#7c2d12' : '#198754',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    display: 'inline-block'
                  }}>
                    {activeTab === 'pending' ? 'Pending Payment' : 'Paid'}
                  </div>
                </div>
              </div>

              <div style={{
                background: '#f8f9fa',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#495057' }}>
                  Items:
                </div>
                <div style={{ color: '#6c757d', fontSize: '0.9rem' }}>
                  {(() => {
                    const items = order.orderItems || order.order_items || order.items || [];
                    if (items.length > 0) {
                      return items.map((item, idx) => (
                        <div key={idx}>
                          {item.quantity}x {item.menuItem?.name || item.menu_item?.name || item.item_name || item.name || 'Item'}
                        </div>
                      ));
                    } else {
                      return 'No items';
                    }
                  })()}
                </div>
              </div>

              {activeTab === 'pending' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Order Status Dropdown - Allow any status change */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#495057', minWidth: '80px' }}>
                      Status:
                    </label>
                    <select
                      value={order.orderStatus || order.order_status || 'pending'}
                      onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                      disabled={updatingStatusId === order.id}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        border: '2px solid #e2e8f0',
                        borderRadius: '6px',
                        background: 'white',
                        color: '#495057',
                        fontWeight: '600',
                        cursor: updatingStatusId === order.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem'
                      }}
                    >
                      <option value="pending">⏳ Pending</option>
                      <option value="preparing">👨‍🍳 Preparing</option>
                      <option value="ready">✅ Ready</option>
                    </select>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => navigate(`/manager/orders?edit=${order.id}`)}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        border: '2px solid #007bff',
                        borderRadius: '8px',
                        background: 'white',
                        color: '#007bff',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                      }}
                    >
                      ✏️ Edit Order
                    </button>
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={cancellingOrderId === order.id}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        border: '2px solid #dc3545',
                        borderRadius: '8px',
                        background: 'white',
                        color: '#dc3545',
                        fontWeight: 'bold',
                        cursor: cancellingOrderId === order.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem',
                        opacity: cancellingOrderId === order.id ? 0.6 : 1
                      }}
                    >
                      {cancellingOrderId === order.id ? '...' : '❌ Cancel'}
                    </button>
                  </div>

                  <button
                    onClick={() => openPaymentModal(order)}
                    disabled={markingPaidId === order.id}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: 'none',
                      borderRadius: '8px',
                      background: 'var(--gradient-primary)',
                      color: 'white',
                      fontWeight: 'bold',
                      cursor: markingPaidId === order.id ? 'not-allowed' : 'pointer',
                      fontSize: '1rem',
                      opacity: markingPaidId === order.id ? 0.6 : 1
                    }}
                  >
                    {markingPaidId === order.id ? 'Processing...' : '💰 Mark as Paid'}
                  </button>
                </div>
              )}

              {activeTab === 'completed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Order Status Dropdown for completed orders */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#495057', minWidth: '80px' }}>
                      Status:
                    </label>
                    <select
                      value={order.orderStatus || order.order_status || 'completed'}
                      onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                      disabled={updatingStatusId === order.id}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        border: '2px solid #e2e8f0',
                        borderRadius: '6px',
                        background: 'white',
                        color: '#495057',
                        fontWeight: '600',
                        cursor: updatingStatusId === order.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem'
                      }}
                    >
                      <option value="pending">⏳ Pending</option>
                      <option value="preparing">👨‍🍳 Preparing</option>
                      <option value="ready">✅ Ready</option>
                      <option value="completed">✅ Completed</option>
                    </select>
                  </div>

                  {order.payment_method && (
                    <div style={{
                      background: '#e6ffed',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                      color: '#198754'
                    }}>
                      <strong>Payment:</strong> {order.payment_method === 'cash' ? 'Cash' : 'Bank Transfer'}
                      {order.payment_method === 'cash' && order.amount_taken && (
                        <>
                          {' • Amount: '}{formatCurrency(order.amount_taken)}
                          {order.return_amount > 0 && (
                            <> • Change: {formatCurrency(order.return_amount)}</>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Revert Payment Button */}
                  {order.payment_status === 'completed' && (
                    <button
                      onClick={() => handleRevertPayment(order.id)}
                      disabled={markingPaidId === order.id}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        border: '2px solid #ffc107',
                        borderRadius: '8px',
                        background: 'white',
                        color: '#856404',
                        fontWeight: 'bold',
                        cursor: markingPaidId === order.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem',
                        opacity: markingPaidId === order.id ? 0.6 : 1
                      }}
                    >
                      {markingPaidId === order.id ? 'Processing...' : '↩️ Revert Payment'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal.open && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            padding: '2rem',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Mark Order as Paid</h2>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ marginBottom: '0.5rem', color: '#6c757d' }}>
                Order #{paymentModal.order.order_number || paymentModal.order.id}
                {paymentModal.order.table_number && (
                  <span style={{ marginLeft: '0.5rem' }}>• Table #{paymentModal.order.table_number}</span>
                )}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                Total: {formatCurrency(paymentModal.order.total_amount)}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '600',
                color: '#495057'
              }}>
                Payment Method *
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setPaymentModal({ ...paymentModal, paymentMethod: 'cash' })}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: paymentModal.paymentMethod === 'cash' ? '2px solid #28a745' : '2px solid #dee2e6',
                    borderRadius: '8px',
                    background: paymentModal.paymentMethod === 'cash' ? '#28a745' : 'white',
                    color: paymentModal.paymentMethod === 'cash' ? 'white' : '#495057',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  💵 Cash
                </button>
                <button
                  onClick={() => setPaymentModal({ ...paymentModal, paymentMethod: 'bank_transfer', amountTaken: '' })}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: paymentModal.paymentMethod === 'bank_transfer' ? '2px solid #007bff' : '2px solid #dee2e6',
                    borderRadius: '8px',
                    background: paymentModal.paymentMethod === 'bank_transfer' ? '#007bff' : 'white',
                    color: paymentModal.paymentMethod === 'bank_transfer' ? 'white' : '#495057',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  🏦 Bank Transfer
                </button>
              </div>
            </div>

            {paymentModal.paymentMethod === 'cash' && (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontWeight: '600',
                    color: '#495057'
                  }}>
                    Amount Received *
                  </label>
                  <input
                    type="number"
                    value={paymentModal.amountTaken}
                    onChange={(e) => setPaymentModal({ ...paymentModal, amountTaken: e.target.value })}
                    placeholder="Enter amount..."
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #dee2e6',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      fontWeight: 'bold'
                    }}
                  />
                </div>

                {paymentModal.amountTaken && parseFloat(paymentModal.amountTaken) >= parseFloat(paymentModal.order.total_amount) && (
                  <div style={{
                    background: '#e6ffed',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                    border: '2px solid #28a745'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span>Total:</span>
                      <strong>{formatCurrency(paymentModal.order.total_amount)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span>Received:</span>
                      <strong>{formatCurrency(paymentModal.amountTaken)}</strong>
                    </div>
                    {(() => {
                      const returnAmount = getReturnAmount();
                      const isNegative = returnAmount < 0;
                      return (
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          paddingTop: '0.5rem',
                          borderTop: `2px solid ${isNegative ? '#dc3545' : '#28a745'}`,
                          fontWeight: 'bold',
                          fontSize: '1.1rem',
                          color: isNegative ? '#dc3545' : '#28a745'
                        }}>
                          <span>{isNegative ? 'Amount Due:' : 'Change:'}</span>
                          <span>{formatCurrency(Math.abs(returnAmount))}</span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={closePaymentModal}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  border: '2px solid #dee2e6',
                  borderRadius: '8px',
                  background: 'white',
                  color: '#495057',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMarkAsPaid}
                disabled={
                  !paymentModal.paymentMethod ||
                  (paymentModal.paymentMethod === 'cash' && !paymentModal.amountTaken)
                }
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  border: 'none',
                  borderRadius: '8px',
                  background: 'var(--gradient-primary)',
                  color: 'white',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  opacity: (
                    !paymentModal.paymentMethod ||
                    (paymentModal.paymentMethod === 'cash' && (!paymentModal.amountTaken || parseFloat(paymentModal.amountTaken) < parseFloat(paymentModal.order.total_amount)))
                  ) ? 0.5 : 1
                }}
              >
                Mark as Paid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.onConfirm || (() => { })}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
      />
    </div>
  );
};

export default DineInOrders;