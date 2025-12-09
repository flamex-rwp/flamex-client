import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';
import { getOfflineOrders } from '../utils/offlineDB';
import { getOfflineOrdersCount } from '../utils/offlineDB';

dayjs.extend(relativeTime);

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DeliveryOrders = () => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' or 'completed'
  const [pendingOrders, setPendingOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const defaultStats = {
    pending_payments: { count: 0, total_amount: 0 },
    received_payments: { count: 0, total_amount: 0 },
    pending_deliveries: { count: 0, total_amount: 0 },
    completed_deliveries: { count: 0, total_amount: 0 },
    cod_pending: { count: 0, total_amount: 0 },
    cash_payments: { count: 0, total_amount: 0 },
    bank_payments: { count: 0, total_amount: 0 },
    total_orders: 0,
    total_revenue: 0,
    average_order_value: 0
  };
  
  // Define mergeStats outside component or use useCallback to make it stable
  const mergeStats = useCallback((incoming = {}) => ({
    ...defaultStats,
    ...incoming,
    pending_payments: { ...defaultStats.pending_payments, ...(incoming.pending_payments || {}) },
    received_payments: { ...defaultStats.received_payments, ...(incoming.received_payments || {}) },
    pending_deliveries: { ...defaultStats.pending_deliveries, ...(incoming.pending_deliveries || {}) },
    completed_deliveries: { ...defaultStats.completed_deliveries, ...(incoming.completed_deliveries || {}) },
    cod_pending: { ...defaultStats.cod_pending, ...(incoming.cod_pending || {}) },
    cash_payments: { ...defaultStats.cash_payments, ...(incoming.cash_payments || {}) },
    bank_payments: { ...defaultStats.bank_payments, ...(incoming.bank_payments || {}) }
  }), []);
  
  const [stats, setStats] = useState(() => ({ ...defaultStats }));
  const [paymentModal, setPaymentModal] = useState({
    open: false,
    order: null,
    paymentMethod: 'cash',
    amountTaken: ''
  });
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });
  const [offlineToastShown, setOfflineToastShown] = useState(false);

  const fetchOrders = useCallback(async (tab = null) => {
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
        const response = await ordersAPI.getDeliveryOrders(params);
        apiOrders = response.data.data || [];
      } catch (err) {
        console.warn('Failed to load delivery orders from API, using offline only:', err);
      }

      // Fetch offline orders
      const offlineOrdersData = await getOfflineOrders();
      const offlineOrders = offlineOrdersData
        .filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include delivery orders
          if (orderData.order_type === 'delivery' || orderData.orderType === 'delivery') {
            const uniqueOfflineId = `OFFLINE-${offlineOrder.id || index}-${offlineOrder.timestamp || Date.now()}`;
            return {
              ...orderData,
              id: uniqueOfflineId,
              offlineId: offlineOrder.id,
              order_number: orderData.order_number || orderData.orderNumber || null,
              orderStatus: orderData.orderStatus || orderData.order_status || 'pending',
              paymentStatus: orderData.paymentStatus || orderData.payment_status || 'pending',
              status: orderData.status || 'pending',
              offline: true,
              createdAt: orderData.created_at || orderData.createdAt || offlineOrder.timestamp,
              synced: false,
              items: orderData.items || orderData.orderItems || [],
              orderItems: orderData.orderItems || orderData.items || []
            };
          }
          return null;
        })
        .filter(Boolean);

      // Merge API and offline orders, remove duplicates
      const allOrders = [...apiOrders];
      const apiOrderNumbers = new Set(apiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean));
      
      offlineOrders.forEach(offlineOrder => {
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

      console.log('✅ Delivery orders fetched:', apiOrders.length, 'API orders,', offlineOrders.length, 'offline orders for', targetTab);

      if (targetTab === 'pending') {
        setPendingOrders(allOrders);
      } else {
        setCompletedOrders(allOrders);
      }
    } catch (err) {
      console.error('Failed to load delivery orders', err);
      setError(err.response?.data?.error || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFilter, startDate, endDate]);

  // Fetch both pending and completed orders (for counts)
  const fetchAllOrders = useCallback(async () => {
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
          ordersAPI.getDeliveryOrders({ ...params, status: 'pending' }),
          ordersAPI.getDeliveryOrders({ ...params, status: 'completed' })
        ]);
        pendingApiOrders = pendingResponse.data.data || [];
        completedApiOrders = completedResponse.data.data || [];
      } catch (err) {
        console.warn('Failed to load orders from API, using offline only:', err);
      }

      // Fetch offline orders
      const offlineOrdersData = await getOfflineOrders();
      const offlineOrders = offlineOrdersData
        .filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include delivery orders
          if (orderData.order_type === 'delivery' || orderData.orderType === 'delivery') {
            const uniqueOfflineId = `OFFLINE-${offlineOrder.id || index}-${offlineOrder.timestamp || Date.now()}`;
            return {
              ...orderData,
              id: uniqueOfflineId,
              offlineId: offlineOrder.id,
              order_number: orderData.order_number || orderData.orderNumber || null,
              orderStatus: orderData.orderStatus || orderData.order_status || 'pending',
              paymentStatus: orderData.paymentStatus || orderData.payment_status || 'pending',
              status: orderData.status || 'pending',
              offline: true,
              createdAt: orderData.created_at || orderData.createdAt || offlineOrder.timestamp,
              synced: false,
              items: orderData.items || orderData.orderItems || [],
              orderItems: orderData.orderItems || orderData.items || []
            };
          }
          return null;
        })
        .filter(Boolean);

      // Merge offline orders with pending API orders
      const allPendingOrders = [...pendingApiOrders];
      const apiOrderNumbers = new Set(pendingApiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean));
      
      offlineOrders.forEach(offlineOrder => {
        const orderNum = offlineOrder.order_number || offlineOrder.orderNumber;
        const exists = orderNum ? apiOrderNumbers.has(orderNum) : false;
        
        if (!exists) {
          allPendingOrders.push(offlineOrder);
        }
      });

      // Sort by creation date
      allPendingOrders.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at || 0);
        const dateB = new Date(b.createdAt || b.created_at || 0);
        return dateB - dateA;
      });

      setPendingOrders(allPendingOrders);
      setCompletedOrders(completedApiOrders);
    } catch (err) {
      console.error('Failed to load all orders', err);
    }
  }, [dateFilter, startDate, endDate]);

  // Fetch statistics
  const fetchStats = useCallback(async () => {
    try {
      const params = { filter: dateFilter };
      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }
      const response = await ordersAPI.getDeliveryStats(params);
      const data = response.data?.data || response.data || {};
      // Always merge with defaults to ensure all fields exist
      const merged = mergeStats(data);
      setStats(merged);
    } catch (err) {
      console.error('Failed to load stats:', err);
      // Fallback to defaults to avoid runtime errors when offline cache is missing fields
      setStats({ ...defaultStats });
    }
  }, [dateFilter, startDate, endDate, mergeStats]);

  useEffect(() => {
    fetchOrders();
    fetchStats();
    fetchAllOrders();
  }, [fetchOrders, fetchStats, fetchAllOrders]);

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

  // Reset filter to 'today' when switching tabs
  useEffect(() => {
    setDateFilter('today');
    setStartDate(null);
    setEndDate(null);
    setShowCustomRange(false);
  }, [activeTab]);

  const handleQuickFilter = (filterKey) => {
    if (filterKey === 'custom') {
      setShowCustomRange(!showCustomRange);
      if (!showCustomRange) {
        setDateFilter('custom');
      }
    } else {
      setDateFilter(filterKey);
      setStartDate(null);
      setEndDate(null);
      setShowCustomRange(false);
    }
  };

  const handleDateFilterChange = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    setDateFilter('custom');
    setShowCustomRange(true);
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
      if (!amountTaken || parseFloat(amountTaken) < parseFloat(order.total_amount)) {
        showError('Amount taken must be greater than or equal to total amount');
        return;
      }
    }

    setMarkingPaidId(order.id);
    try {
      const payload = {
        paymentMethod: paymentMethod
      };

      if (paymentMethod === 'cash') {
        const taken = parseFloat(amountTaken);
        payload.amountTaken = taken;
        payload.returnAmount = Math.max(0, taken - parseFloat(order.total_amount));
      }

      await ordersAPI.markAsPaid(order.id, payload);

      showSuccess(`Order #${order.order_number || order.id} marked as paid successfully`);
      closePaymentModal();

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

  const getDurationColor = (createdAt) => {
    const minutes = dayjs().diff(dayjs(createdAt), 'minute');
    if (minutes < 15) return '#28a745';
    if (minutes < 30) return '#ffc107';
    return '#dc3545';
  };

  const getOrderStatusColor = (status) => {
    const colors = {
      pending: { background: '#e2e3e5', color: '#383d41' },
      preparing: { background: '#fff3cd', color: '#856404' },
      out_for_delivery: { background: '#cfe2ff', color: '#084298' },
      delivered: { background: '#d4edda', color: '#155724' }
    };
    return colors[status] || colors.pending;
  };

  const getDeliveryStatusColor = (status) => {
    const colors = {
      pending: { background: '#e2e3e5', color: '#383d41' },
      preparing: { background: '#fff3cd', color: '#856404' },
      out_for_delivery: { background: '#cfe2ff', color: '#084298' },
      delivered: { background: '#d4edda', color: '#155724' }
    };
    return colors[status] || colors.pending;
  };

  const handleStatusUpdate = async (orderId, newStatus) => {
    setUpdatingStatusId(orderId);
    try {
      if (['out_for_delivery', 'delivered'].includes(newStatus)) {
        await ordersAPI.updateDeliveryStatus(orderId, newStatus);

        // If delivered, also mark order as completed to remove from pending list
        if (newStatus === 'delivered') {
          await ordersAPI.updateOrderStatus(orderId, 'completed');
        }
      } else {
        // pending, preparing
        await ordersAPI.updateOrderStatus(orderId, newStatus);
      }

      showSuccess(`Order status updated to ${newStatus.replace(/_/g, ' ')}`);
      await Promise.all([
        fetchAllOrders(),
        fetchStats()
      ]);
    } catch (err) {
      console.error('Failed to update order status', err);
      showError(err.response?.data?.error || 'Failed to update order status');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleCancelOrder = async (orderId) => {
    setConfirmModal({
      isOpen: true,
      title: 'Cancel Order',
      message: 'Are you sure you want to cancel this order? This action cannot be undone.',
      onConfirm: async () => {
        setCancellingOrderId(orderId);
        try {
          await ordersAPI.cancelOrder(orderId);
          showSuccess('Order cancelled successfully');
          await Promise.all([
            fetchAllOrders(),
            fetchStats()
          ]);
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
          await ordersAPI.revertPaymentStatus(orderId);
          showSuccess('Payment status reverted to pending successfully');
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
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem', color: '#2d3748', fontSize: '2rem', fontWeight: 'bold' }}>🚚 Delivery Orders</h1>

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
          {/* Pending Payments */}
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

          {/* Received Payments */}
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

          {/* Pending Deliveries */}
          <div style={{
            background: 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Pending Deliveries</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {safeStats.pending_deliveries?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.pending_deliveries?.total_amount ?? 0)}
            </div>
          </div>

          {/* Completed Deliveries */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Completed Deliveries</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {safeStats.completed_deliveries?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.completed_deliveries?.total_amount ?? 0)}
            </div>
          </div>

          {/* COD Pending */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>COD Pending</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {safeStats.cod_pending?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.cod_pending?.total_amount ?? 0)}
            </div>
          </div>

          {/* Cash Payments */}
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
              {safeStats.cash_payments?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.cash_payments?.total_amount ?? 0)}
            </div>
          </div>

          {/* Bank Payments */}
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
              {safeStats.bank_payments?.count ?? 0}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
              {formatCurrency(safeStats.bank_payments?.total_amount ?? 0)}
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

        {/* Date Filters - Same as DineInOrders */}
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
                  </h3>
                  <p style={{ margin: '0.5rem 0 0 0', color: '#6c757d', fontSize: '0.9rem' }}>
                    {dayjs(order.createdAt || order.created_at).format('MMM D, YYYY h:mm A')}
                  </p>
                  {activeTab === 'pending' && (
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', fontWeight: '600', color: getDurationColor(order.createdAt || order.created_at) }}>
                      ⏱️ Waiting: {getOrderDuration(order.createdAt || order.created_at)}
                    </p>
                  )}
                  {/* Customer Info */}
                  {(order.customer?.name || order.customer_name) && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', fontWeight: '600', color: '#2d3748' }}>
                        👤 {order.customer?.name || order.customer_name}
                      </p>
                      {(order.customer?.phone || order.customer_phone) && (
                        <p style={{ margin: '0.25rem 0', fontSize: '0.85rem', color: '#6c757d' }}>
                          📞 {order.customer?.phone || order.customer_phone}
                        </p>
                      )}
                      {(order.deliveryAddress || order.delivery_address) && (
                        <p style={{ margin: '0.25rem 0', fontSize: '0.85rem', color: '#6c757d' }}>
                          📍 {order.deliveryAddress || order.delivery_address}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Status Badges */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    {order.order_status && (
                      <div style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '20px',
                        background: getOrderStatusColor(order.order_status).background,
                        color: getOrderStatusColor(order.order_status).color,
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'capitalize'
                      }}>
                        Order: {(order.orderStatus || order.order_status).replace(/_/g, ' ')}
                      </div>
                    )}
                    {order.delivery_status && (
                      <div style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '20px',
                        background: getDeliveryStatusColor(order.delivery_status).background,
                        color: getDeliveryStatusColor(order.delivery_status).color,
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'capitalize'
                      }}>
                        Delivery: {(order.deliveryStatus || order.delivery_status).replace(/_/g, ' ')}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    color: 'var(--color-primary)'
                  }}>
                    {formatCurrency(order.totalAmount || order.total_amount)}
                  </div>
                  {(order.deliveryCharge || order.delivery_charge) > 0 && (
                    <div style={{ fontSize: '0.85rem', color: '#6c757d', marginTop: '0.25rem' }}>
                      Delivery: {formatCurrency(order.deliveryCharge || order.delivery_charge)}
                    </div>
                  )}
                  <div style={{
                    marginTop: '0.5rem',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '20px',
                    background: order.payment_status === 'completed' ? '#e6ffed' : '#fff4d8',
                    color: order.payment_status === 'completed' ? '#198754' : '#7c2d12',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    display: 'inline-block'
                  }}>
                    {(order.paymentStatus || order.payment_status) === 'completed' ? 'Paid' : 'Pending Payment'}
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

              {/* Delivery Notes */}
              {
                (order.deliveryNotes || order.delivery_notes) && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: '#fff4d8',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: '#7c2d12'
                  }}>
                    <strong>Notes:</strong> {order.deliveryNotes || order.delivery_notes}
                  </div>
                )
              }

              {/* Special Instructions */}
              {
                (order.specialInstructions || order.special_instructions) && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: '#fff3cd',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: '#856404',
                    fontWeight: '600'
                  }}>
                    ⚠️ <strong>Special Instructions:</strong> {order.specialInstructions || order.special_instructions}
                  </div>
                )
              }

              {activeTab === 'pending' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Order Status Dropdown - Allow any status change */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#495057', minWidth: '80px' }}>
                      Status:
                    </label>
                    <select
                      value={(() => {
                        const dStatus = order.deliveryStatus || order.delivery_status;
                        if (dStatus === 'out_for_delivery' || dStatus === 'delivered') return dStatus;
                        return order.orderStatus || order.order_status || 'pending';
                      })()}
                      onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                      disabled={updatingStatusId === order.id || order.offline}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        border: '2px solid #e2e8f0',
                        borderRadius: '6px',
                        background: order.offline ? '#f8f9fa' : 'white',
                        color: order.offline ? '#adb5bd' : '#495057',
                        fontWeight: '600',
                        cursor: (updatingStatusId === order.id || order.offline) ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem'
                      }}
                    >
                      <option value="pending">⏳ Pending</option>
                      <option value="preparing">👨‍🍳 Preparing</option>
                      <option value="out_for_delivery">🚚 Out for Delivery</option>
                      <option value="delivered">✅ Delivered</option>
                    </select>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => {
                        sessionStorage.setItem('orderToEdit', JSON.stringify({ id: order.id, orderType: 'delivery' }));
                        navigate('/manager/orders');
                      }}
                      disabled={order.offline}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        border: '2px solid #007bff',
                        borderRadius: '8px',
                        background: order.offline ? '#f8f9fa' : 'white',
                        color: order.offline ? '#adb5bd' : '#007bff',
                        fontWeight: 'bold',
                        cursor: order.offline ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem',
                        opacity: order.offline ? 0.6 : 1
                      }}
                    >
                      ✏️ Edit Order
                    </button>
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={cancellingOrderId === order.id || order.offline}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        border: '2px solid #dc3545',
                        borderRadius: '8px',
                        background: order.offline ? '#f8f9fa' : 'white',
                        color: order.offline ? '#adb5bd' : '#dc3545',
                        fontWeight: 'bold',
                        cursor: (cancellingOrderId === order.id || order.offline) ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem',
                        opacity: (cancellingOrderId === order.id || order.offline) ? 0.6 : 1
                      }}
                    >
                      {cancellingOrderId === order.id ? '...' : '❌ Cancel'}
                    </button>
                  </div>

                  {order.payment_status === 'pending' && (
                    <button
                      onClick={() => openPaymentModal(order)}
                      disabled={markingPaidId === order.id || order.offline}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        border: 'none',
                        borderRadius: '8px',
                        background: order.offline ? '#f8f9fa' : 'var(--gradient-primary)',
                        color: order.offline ? '#adb5bd' : 'white',
                        fontWeight: 'bold',
                        cursor: (markingPaidId === order.id || order.offline) ? 'not-allowed' : 'pointer',
                        fontSize: '1rem',
                        opacity: (markingPaidId === order.id || order.offline) ? 0.6 : 1
                      }}
                    >
                      {markingPaidId === order.id ? 'Processing...' : '💰 Mark as Paid'}
                    </button>
                  )}
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
                      value={(() => {
                        const dStatus = order.deliveryStatus || order.delivery_status;
                        if (dStatus === 'out_for_delivery' || dStatus === 'delivered') return dStatus;
                        // If order is completed but delivery isn't set, it might just be 'completed' which isn't an option?
                        // Assuming 'delivered' is the target state for completed delivery orders
                        return 'delivered';
                      })()}
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
                      <option value="out_for_delivery">🚚 Out for Delivery</option>
                      <option value="delivered">✅ Delivered</option>
                    </select>
                  </div>

                  {/* Payment Info */}
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
      )
      }

      {/* Payment Modal */}
      {
        paymentModal.open && paymentModal.order && (
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
              overflow: 'auto'
            }}>
              <h2 style={{ marginTop: 0, marginBottom: '1.5rem', color: '#2d3748' }}>
                Mark Order #{paymentModal.order.order_number || paymentModal.order.id} as Paid
              </h2>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
                  Payment Method <span style={{ color: '#dc3545' }}>*</span>
                </label>
                <select
                  value={paymentModal.paymentMethod}
                  onChange={(e) => setPaymentModal({ ...paymentModal, paymentMethod: e.target.value, amountTaken: '' })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '1rem'
                  }}
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>

              {paymentModal.paymentMethod === 'cash' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
                    Amount Taken <span style={{ color: '#dc3545' }}>*</span>
                  </label>
                  <input
                    type="number"
                    min={paymentModal.order.total_amount}
                    step="0.01"
                    value={paymentModal.amountTaken}
                    onChange={(e) => setPaymentModal({ ...paymentModal, amountTaken: e.target.value })}
                    placeholder={`Minimum: ${formatCurrency(paymentModal.order.total_amount)}`}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #dee2e6',
                      borderRadius: '8px',
                      fontSize: '1rem'
                    }}
                  />
                  {paymentModal.amountTaken && parseFloat(paymentModal.amountTaken) >= parseFloat(paymentModal.order.total_amount) && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#d4edda', borderRadius: '6px', color: '#155724', fontSize: '0.9rem' }}>
                      Return Amount: {formatCurrency(parseFloat(paymentModal.amountTaken) - parseFloat(paymentModal.order.total_amount))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
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
                    (paymentModal.paymentMethod === 'cash' && (!paymentModal.amountTaken || parseFloat(paymentModal.amountTaken) < parseFloat(paymentModal.order.total_amount)))
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
        )
      }

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.onConfirm || (() => { })}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
      />
    </div >
  );
};

export default DeliveryOrders;

