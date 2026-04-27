import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';
import { getOfflineOrders, getOfflineOrdersCount, addPendingOperation, updateOfflineOrder, mergePreservedOfflineStatus } from '../utils/offlineDB';
import { isOnline, syncPendingOperations } from '../services/offlineSyncService';
import { useOffline } from '../contexts/OfflineContext';
import OfflineIndicator from './OfflineIndicator';
import AppliedFiltersBanner from './AppliedFiltersBanner';
import ScreenLoading from './ScreenLoading';
import { getDateFilterBannerLabel, isCustomDateRangeApplied } from '../utils/dateFilterBanner';
import {
  readFilterSession,
  writeFilterSession,
  FILTER_STORAGE_KEYS,
  sanitizeDateFilter
} from '../utils/filterSessionPersistence';
import {
  FaTruck,
  FaClock,
  FaCheck,
  FaMoneyBillWave,
  FaUniversity,
  FaUndo,
  FaDollarSign,
  FaUserTie,
  FaEdit,
  FaTimes,
  FaExclamationTriangle,
  FaUser,
  FaPhone,
  FaMapMarkerAlt,
  FaCopy
} from 'react-icons/fa';
import { MdWifiOff } from 'react-icons/md';

// Custom Status Dropdown Component with Icons
const StatusDropdown = ({ value, onChange, disabled, options, style }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const selectedOption = options.find(opt => opt.value === value) || options[0];
  const IconComponent = selectedOption.icon;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flex: 1, ...style }}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '0.5rem',
          border: '2px solid #e2e8f0',
          borderRadius: '6px',
          background: 'white',
          color: '#495057',
          fontWeight: '600',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {IconComponent && <IconComponent />}
          {selectedOption.label}
        </span>
        <span style={{ fontSize: '0.75rem' }}>▼</span>
      </button>
      {isOpen && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '0.25rem',
            background: 'white',
            border: '2px solid #e2e8f0',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            overflow: 'hidden'
          }}
        >
          {options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange({ target: { value: option.value } });
                  setIsOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: 'none',
                  background: value === option.value ? '#f0f0f0' : 'white',
                  color: '#495057',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  if (value !== option.value) {
                    e.currentTarget.style.background = '#f8f9fa';
                  }
                }}
                onMouseLeave={(e) => {
                  if (value !== option.value) {
                    e.currentTarget.style.background = 'white';
                  }
                }}
              >
                {OptionIcon && <OptionIcon />}
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

dayjs.extend(relativeTime);

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DeliveryOrders = ({ basePath = '/manager' }) => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const initialScreenFilters = useMemo(() => {
    const s = readFilterSession(FILTER_STORAGE_KEYS.deliveryOrders);
    if (!s) {
      return {
        activeTab: 'pending',
        dateFilter: 'today',
        startDate: null,
        endDate: null,
        showCustomRange: false
      };
    }
    return {
      activeTab: s.activeTab === 'completed' ? 'completed' : 'pending',
      dateFilter: sanitizeDateFilter(s.dateFilter),
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      showCustomRange: Boolean(s.showCustomRange)
    };
  }, []);

  const [activeTab, setActiveTab] = useState(initialScreenFilters.activeTab); // 'pending' or 'completed'
  const [pendingOrders, setPendingOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedDeliveryOrdersOnceRef = useRef(false);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState(initialScreenFilters.dateFilter);
  const [startDate, setStartDate] = useState(initialScreenFilters.startDate);
  const [endDate, setEndDate] = useState(initialScreenFilters.endDate);
  const [showCustomRange, setShowCustomRange] = useState(initialScreenFilters.showCustomRange);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const { online } = useOffline();
  // Memoize defaultStats to prevent infinite loops - it's a constant value
  const defaultStats = useMemo(() => ({
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
  }), []);

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
  }), [defaultStats]);

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
  const hasInitialLoad = useRef(false);
  const isUpdatingStatus = useRef(false);
  
  // Use refs to always get the latest filter values (avoid stale closures)
  const dateFilterRef = useRef(dateFilter);
  const startDateRef = useRef(startDate);
  const endDateRef = useRef(endDate);
  
  // Update refs when values change
  useEffect(() => {
    dateFilterRef.current = dateFilter;
    startDateRef.current = startDate;
    endDateRef.current = endDate;
  }, [dateFilter, startDate, endDate]);

  useEffect(() => {
    writeFilterSession(FILTER_STORAGE_KEYS.deliveryOrders, {
      activeTab,
      dateFilter,
      startDate,
      endDate,
      showCustomRange
    });
  }, [activeTab, dateFilter, startDate, endDate, showCustomRange]);

  // Refresh orders + cards when switching tabs
  useEffect(() => {
    if (!hasInitialLoad.current) return;
    const run = async () => {
      try {
        await Promise.all([
          fetchOrders(activeTab),
          fetchStats(),
        ]);
      } catch (e) {
        // Silently handle
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchOrders = useCallback(async (tab = null) => {
    const targetTab = tab || activeTab;
    setLoading(true);
    setError('');
    try {
      // Always use the latest filter values from refs (not from closure)
      const currentDateFilter = dateFilterRef.current;
      const currentStartDate = startDateRef.current;
      const currentEndDate = endDateRef.current;
      
      // Build date params - ensure YYYY-MM-DD format and default to today
      // Use EXACT same logic as fetchStats and fetchAllOrders
      let finalStartDate = null;
      let finalEndDate = null;
      
      if (currentDateFilter && currentDateFilter !== 'custom') {
        // Use dateFilter if it's a quick filter (not custom)
        if (currentDateFilter === 'today') {
          finalStartDate = dayjs().format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (currentDateFilter === 'yesterday') {
          finalStartDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
          finalEndDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
        } else if (currentDateFilter === 'this_week') {
          finalStartDate = dayjs().startOf('week').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (currentDateFilter === 'this_month') {
          finalStartDate = dayjs().startOf('month').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        }
      } else if (currentDateFilter === 'custom' && currentStartDate && currentEndDate) {
        // Use custom dates only if custom filter is selected
        finalStartDate = currentStartDate;
        finalEndDate = currentEndDate;
      } else {
        // Default to today if no filter
        finalStartDate = dayjs().format('YYYY-MM-DD');
        finalEndDate = dayjs().format('YYYY-MM-DD');
      }
      
      const dateParams = {
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : null,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : null
      };

      const params = {
        orderType: 'delivery',
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : null,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : null
      };

      // Fetch API orders - ONLY when online
      // When offline, don't fetch API orders (even cached ones) - only show orders created offline
      let apiOrders = [];
      if (online) {
        try {
          const response = await ordersAPI.getDeliveryStats({
            filter: currentDateFilter,
            startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : undefined,
            endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : undefined,
            status: targetTab,
            useCache: false,
            disableCacheFallback: true,
          });
          const payload = response.data?.data ?? response.data ?? {};
          apiOrders = (payload.orders || []).map(o => ({ ...o, offline: o.offline === true ? true : false }));

          // Merge preserved offline status from IndexedDB into API orders
          // This ensures that orders with offline status updates don't revert to pending
          apiOrders = await mergePreservedOfflineStatus(apiOrders);
        } catch (err) {
          // Silently handle API errors
        }
      }

      // In Electron, skip offline orders - all orders are in SQLite
      const isElectron = typeof window !== 'undefined' && window.electronAPI;
      const offlineOrders = (isElectron || online) ? [] : (
        await getOfflineOrders()
      ).filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          const isDelivery = orderData.order_type === 'delivery' || orderData.orderType === 'delivery';

          if (isDelivery) {
            const uniqueOfflineId = `OFFLINE-${offlineOrder.id || index}-${offlineOrder.timestamp || Date.now()}`;

            const orderStatus = orderData.orderStatus || orderData.order_status || orderData.status || 'pending';
            const paymentStatus = orderData.paymentStatus || orderData.payment_status || 'pending';
            const deliveryStatus = orderData.deliveryStatus || orderData.delivery_status || 'pending';
            // Order is completed if:
            // 1. orderStatus is 'cancelled', OR
            // 2. BOTH paymentStatus is 'completed' AND deliveryStatus is 'delivered'
            const isCancelled = orderStatus === 'cancelled';
            const isPaid = paymentStatus === 'completed' || paymentStatus === 'paid';
            const isDelivered = deliveryStatus === 'delivered';
            const isCompleted = isCancelled || (isPaid && isDelivered);

            return {
              ...orderData,
              id: uniqueOfflineId,
              offlineId: offlineOrder.id,
              order_number: orderData.order_number || orderData.orderNumber || null,
              orderStatus: isCompleted ? 'completed' : orderStatus,
              paymentStatus: paymentStatus,
              deliveryStatus: deliveryStatus,
              delivery_status: deliveryStatus,
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

      // Filter offline orders by target tab (pending or completed)
      // For delivery orders, also check deliveryStatus - if 'delivered', it should be in completed tab
      const filteredOfflineOrders = offlineOrders.filter(offlineOrder => {
        const orderStatus = (offlineOrder.orderStatus || offlineOrder.order_status || 'pending').toLowerCase();
        const paymentStatus = (offlineOrder.paymentStatus || offlineOrder.payment_status || 'pending').toLowerCase();
        const deliveryStatus = (offlineOrder.deliveryStatus || offlineOrder.delivery_status || 'pending').toLowerCase();

        // Pending: paymentStatus is NOT 'completed'/'paid' (not yet paid)
        // Completed: paymentStatus is 'completed'/'paid' AND deliveryStatus is 'delivered' (or cancelled)
        const isCancelled = orderStatus === 'cancelled';
        const isPaid = paymentStatus === 'completed' || paymentStatus === 'paid';
        const isDelivered = deliveryStatus === 'delivered';
        // Completed = cancelled OR (paid AND delivered)
        const isCompleted = isCancelled || (isPaid && isDelivered);

        const matchesTab = targetTab === 'pending' ? !isCompleted : isCompleted;
        return matchesTab;
      });


      // Merge API and offline orders, remove duplicates
      // In Electron, skip offline orders entirely - all orders are in SQLite
      // isElectron already declared above (line 155)
      const allOrders = [...apiOrders];
      
      // Only merge offline orders if NOT in Electron and actually offline
      if (!isElectron && !online) {
        const apiOrderNumbers = new Set(apiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean));
        const apiOrderIds = new Set(apiOrders.map(o => o.id).filter(Boolean));

        // Merge offline orders (already checked isElectron above)
        {
          filteredOfflineOrders.forEach(offlineOrder => {
            const orderNum = offlineOrder.order_number || offlineOrder.orderNumber;
            const offlineId = offlineOrder.id;
            
            // Check for duplicates by order number OR by ID (for synced orders)
            const existsByNumber = orderNum ? apiOrderNumbers.has(orderNum) : false;
            const existsById = offlineId ? apiOrderIds.has(offlineId) : false;
            
            // Also check if offline order ID contains "OFFLINE-OFFLINE" (duplicate prefix issue)
            const hasDuplicatePrefix = offlineId && typeof offlineId === 'string' && offlineId.includes('OFFLINE-OFFLINE');
            
            if (!existsByNumber && !existsById && !hasDuplicatePrefix) {
              allOrders.push(offlineOrder);
            }
          });
        }
      }

      // Sort by creation date (newest first)
      allOrders.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at || 0);
        const dateB = new Date(b.createdAt || b.created_at || 0);
        return dateB - dateA;
      });

      if (targetTab === 'pending') {
        setPendingOrders(allOrders);
      } else {
        setCompletedOrders(allOrders);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load orders');
    } finally {
      setLoading(false);
      hasLoadedDeliveryOrdersOnceRef.current = true;
    }
  }, [activeTab, online]); // Remove dateFilter, startDate, endDate from dependencies - we use refs instead

  // Fetch both pending and completed orders (for counts)
  const fetchAllOrders = useCallback(async () => {
    try {
      // Always use the latest filter values from refs (not from closure)
      const currentDateFilter = dateFilterRef.current;
      const currentStartDate = startDateRef.current;
      const currentEndDate = endDateRef.current;
      
      // Build date params - ensure YYYY-MM-DD format and default to today
      // Use EXACT same logic as fetchStats
      let finalStartDate = null;
      let finalEndDate = null;
      
      if (currentDateFilter && currentDateFilter !== 'custom') {
        // Use dateFilter if it's a quick filter (not custom)
        if (currentDateFilter === 'today') {
          finalStartDate = dayjs().format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (currentDateFilter === 'yesterday') {
          finalStartDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
          finalEndDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
        } else if (currentDateFilter === 'this_week') {
          finalStartDate = dayjs().startOf('week').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (currentDateFilter === 'this_month') {
          finalStartDate = dayjs().startOf('month').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        }
      } else if (currentDateFilter === 'custom' && currentStartDate && currentEndDate) {
        // Use custom dates only if custom filter is selected
        finalStartDate = currentStartDate;
        finalEndDate = currentEndDate;
      } else {
        // Default to today if no filter
        finalStartDate = dayjs().format('YYYY-MM-DD');
        finalEndDate = dayjs().format('YYYY-MM-DD');
      }
      
      const params = {
        orderType: 'delivery',
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : null,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : null
      };

      // Fetch API orders in parallel - ONLY when online
      // When offline, don't fetch API orders (even cached ones) - only show orders created offline
      let pendingApiOrders = [];
      let completedApiOrders = [];
      if (online) {
        try {
          const [pendingRes, completedRes] = await Promise.all([
            ordersAPI.getDeliveryStats({
              filter: currentDateFilter,
              startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : undefined,
              endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : undefined,
              status: 'pending',
              useCache: false,
              disableCacheFallback: true,
            }),
            ordersAPI.getDeliveryStats({
              filter: currentDateFilter,
              startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : undefined,
              endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : undefined,
              status: 'completed',
              useCache: false,
              disableCacheFallback: true,
            }),
          ]);

          const pendingPayload = pendingRes.data?.data ?? pendingRes.data ?? {};
          const completedPayload = completedRes.data?.data ?? completedRes.data ?? {};

          pendingApiOrders = (pendingPayload.orders || []).map(o => ({ ...o, offline: o.offline === true ? true : false }));
          completedApiOrders = (completedPayload.orders || []).map(o => ({ ...o, offline: o.offline === true ? true : false }));

          // Merge preserved offline status from IndexedDB into API orders
          pendingApiOrders = await mergePreservedOfflineStatus(pendingApiOrders);
          completedApiOrders = await mergePreservedOfflineStatus(completedApiOrders);
        } catch (err) {
          // Silently handle API errors in offline mode
        }
      }

      // Fetch offline orders - ONLY when NOT in Electron and actually offline
      // In Electron, all orders are in SQLite, so skip IndexedDB offline orders
      const isElectron = typeof window !== 'undefined' && window.electronAPI;
      const offlineOrdersData = (isElectron || online) ? [] : await getOfflineOrders();
      const offlineOrders = offlineOrdersData
        .filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include delivery orders
          if (orderData.order_type === 'delivery' || orderData.orderType === 'delivery') {
            // Check if ID already has OFFLINE- prefix to avoid duplicate prefix (OFFLINE-OFFLINE)
            const existingId = offlineOrder.id || '';
            const uniqueOfflineId = (typeof existingId === 'string' && existingId.startsWith('OFFLINE-'))
              ? existingId.replace(/^OFFLINE-OFFLINE-/, 'OFFLINE-') // Fix duplicate prefix
              : `OFFLINE-${offlineOrder.id || index}-${offlineOrder.timestamp || Date.now()}`;

            // Determine order status - check multiple fields and preserve actual status
            const orderStatus = orderData.orderStatus || orderData.order_status || orderData.status || 'pending';
            const paymentStatus = orderData.paymentStatus || orderData.payment_status || 'pending';
            // For delivery orders, default deliveryStatus to 'pending' if not set
            const deliveryStatus = orderData.deliveryStatus || orderData.delivery_status || 'pending';

            // Only mark as completed if orderStatus is actually 'completed', 'cancelled' or delivery is delivered
            const isCompleted = orderStatus === 'completed' || orderStatus === 'cancelled' || deliveryStatus === 'delivered';

            return {
              ...orderData,
              id: uniqueOfflineId,
              offlineId: offlineOrder.id,
              order_number: orderData.order_number || orderData.orderNumber || null,
              orderStatus: isCompleted ? 'completed' : orderStatus, // Preserve actual status, only override if truly completed
              paymentStatus: paymentStatus,
              deliveryStatus: deliveryStatus, // Always set delivery status (defaults to 'pending' if not set)
              delivery_status: deliveryStatus,
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
          // For delivery orders, also check deliveryStatus - if 'delivered', it should be in completed
          const orderStatus = (offlineOrder.orderStatus || offlineOrder.order_status || 'pending').toLowerCase();
          const deliveryStatus = (offlineOrder.deliveryStatus || offlineOrder.delivery_status || 'pending').toLowerCase();

          // Pending: paymentStatus is NOT 'completed'/'paid' (not yet paid)
          // Completed: paymentStatus is 'completed'/'paid' AND deliveryStatus is 'delivered' (or cancelled)
          const paymentStatus = (offlineOrder.paymentStatus || offlineOrder.payment_status || 'pending').toLowerCase();
          const isCancelled = orderStatus === 'cancelled';
          const isPaid = paymentStatus === 'completed' || paymentStatus === 'paid';
          const isDelivered = deliveryStatus === 'delivered';
          // Completed = cancelled OR (paid AND delivered)
          const isCompleted = isCancelled || (isPaid && isDelivered);

          if (isCompleted) {
            offlineCompletedOrders.push(offlineOrder);
          } else {
            offlinePendingOrders.push(offlineOrder);
          }
        }
      });

      // Filter out duplicate offline orders (those with OFFLINE-OFFLINE prefix)
      const filterDuplicateOffline = (orders) => {
        return orders.filter(order => {
          const orderId = order.id || '';
          // Skip orders with duplicate OFFLINE-OFFLINE prefix
          if (typeof orderId === 'string' && orderId.includes('OFFLINE-OFFLINE')) {
            return false;
          }
          return true;
        });
      };

      // Merge API and offline orders, filtering duplicates
      const allPendingOrders = filterDuplicateOffline([...pendingApiOrders, ...offlinePendingOrders]);
      const allCompletedOrders = filterDuplicateOffline([...completedApiOrders, ...offlineCompletedOrders]);

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
      
      // Calculate stats immediately from the fresh orders we just set
      // This ensures stats are calculated from the exact same orders that are displayed
      calculateStatsFromOrders(allPendingOrders, allCompletedOrders);
    } catch (err) {
      // Silently handle errors
    }
  }, [online]); // Remove dateFilter, startDate, endDate from dependencies - we use refs instead

  // Fetch statistics - Calculate from displayed orders (pendingOrders + completedOrders)
  // Accept orders as parameter to ensure we use fresh data
  const calculateStatsFromOrders = useCallback((pendingOrdersList, completedOrdersList) => {
    // When online we rely on backend `/stats` for cards.
    if (online) return;
    // Calculate stats from the ACTUAL displayed orders (pendingOrders + completedOrders)
    // This ensures stats match exactly what the user sees
    const allDisplayedOrders = [...pendingOrdersList, ...completedOrdersList];
      
      // Initialize counters
      let totalOrders = allDisplayedOrders.length;
      let totalRevenue = 0;
      let cashOrders = 0;
      let cashRevenue = 0;
      let bankOrders = 0;
      let bankRevenue = 0;
      let pendingPaymentsCount = 0;
      let pendingPaymentsAmount = 0;
      let receivedPaymentsCount = 0;
      let receivedPaymentsAmount = 0;
      let pendingDeliveriesCount = 0;
      let pendingDeliveriesAmount = 0;
      let completedDeliveriesCount = 0;
      let completedDeliveriesAmount = 0;
      let codPendingCount = 0;
      let codPendingAmount = 0;
      
      // Calculate stats by checking each order's status
      allDisplayedOrders.forEach(order => {
        const amount = parseFloat(order.totalAmount || order.total_amount || 0);
        const orderStatus = (order.orderStatus || order.order_status || 'pending').toLowerCase();
        const deliveryStatus = (order.deliveryStatus || order.delivery_status || 'pending').toLowerCase();
        const paymentStatus = (order.paymentStatus || order.payment_status || 'pending').toLowerCase();
        const paymentMethod = (order.paymentMethod || order.payment_method || 'cash').toLowerCase();
        const status = (order.status || 'pending').toLowerCase();
        
        // Check if order is cancelled - exclude from revenue calculations
        const isCancelled = orderStatus === 'cancelled' || 
                           paymentStatus === 'cancelled' || 
                           status === 'cancelled';
        
        // Only count revenue for non-cancelled orders
        if (!isCancelled) {
          totalRevenue += amount;
        }
        
        // Check payment status - normalize it
        const normalizedPaymentStatus = (paymentStatus || 'pending').trim().toLowerCase();
        const isPaid = normalizedPaymentStatus === 'completed' || 
                       normalizedPaymentStatus === 'paid' ||
                       normalizedPaymentStatus === 'complete';
        const isNotPaid = !isPaid;
        
        // Check if order is completed (cancelled OR paid AND delivered)
        const isDelivered = deliveryStatus === 'delivered';
        const isOrderCompleted = isCancelled || (isPaid && isDelivered);
        
        // Payment Stats
        // Pending Payments: Orders where payment is NOT paid (exclude cancelled orders)
        if (isNotPaid && !isCancelled) {
          pendingPaymentsCount++;
          pendingPaymentsAmount += amount;
        }
        
        // Received Payments: Orders where payment IS paid (exclude cancelled orders)
        if (isPaid && !isCancelled) {
          receivedPaymentsCount++;
          receivedPaymentsAmount += amount;
        }
        
        // Delivery Stats
        // Pending Deliveries: Orders that are NOT completed (exclude cancelled from amount)
        if (!isOrderCompleted) {
          pendingDeliveriesCount++;
          if (!isCancelled) {
            pendingDeliveriesAmount += amount;
          }
        } else {
          // Completed Deliveries: Orders that ARE completed (exclude cancelled from count and amount)
          if (!isCancelled) {
            completedDeliveriesCount++;
            completedDeliveriesAmount += amount;
          }
        }
        
        // COD Pending: Cash orders that are NOT paid (exclude cancelled orders)
        if (paymentMethod === 'cash' && isNotPaid && !isCancelled) {
          codPendingCount++;
          codPendingAmount += amount;
        }
        
        // Payment Method Stats (exclude cancelled orders)
        if (!isCancelled) {
          if (paymentMethod === 'cash') {
            cashOrders++;
            cashRevenue += amount;
          } else if (paymentMethod === 'bank_transfer') {
            bankOrders++;
            bankRevenue += amount;
          }
        }
      });
      
      // Build stats object
      const data = {
        pending_payments: {
          count: pendingPaymentsCount,
          total_amount: pendingPaymentsAmount
        },
        received_payments: {
          count: receivedPaymentsCount,
          total_amount: receivedPaymentsAmount
        },
        pending_deliveries: {
          count: pendingDeliveriesCount,
          total_amount: pendingDeliveriesAmount
        },
        completed_deliveries: {
          count: completedDeliveriesCount,
          total_amount: completedDeliveriesAmount
        },
        cod_pending: {
          count: codPendingCount,
          total_amount: codPendingAmount
        },
        cash_payments: {
          count: cashOrders,
          total_amount: cashRevenue
        },
        bank_payments: {
          count: bankOrders,
          total_amount: bankRevenue
        },
        total_orders: totalOrders,
        total_revenue: totalRevenue,
        average_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0
      };
      
      // Always merge with defaults to ensure all fields exist
      const merged = mergeStats(data);
      
      setStats(merged);
  }, [mergeStats, defaultStats, online]);
  
  // Fetch statistics for summary cards
  const fetchStats = useCallback(async () => {
    try {
      const currentDateFilter = dateFilterRef.current;
      const currentStartDate = startDateRef.current;
      const currentEndDate = endDateRef.current;

      let finalStartDate = null;
      let finalEndDate = null;

      if (currentDateFilter && currentDateFilter !== 'custom') {
        if (currentDateFilter === 'today') {
          finalStartDate = dayjs().format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (currentDateFilter === 'yesterday') {
          finalStartDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
          finalEndDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
        } else if (currentDateFilter === 'this_week') {
          finalStartDate = dayjs().startOf('week').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (currentDateFilter === 'this_month') {
          finalStartDate = dayjs().startOf('month').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        }
      } else if (currentDateFilter === 'custom' && currentStartDate && currentEndDate) {
        finalStartDate = currentStartDate;
        finalEndDate = currentEndDate;
      } else {
        finalStartDate = dayjs().format('YYYY-MM-DD');
        finalEndDate = dayjs().format('YYYY-MM-DD');
      }

      if (!online) {
        // Offline: stats are derived from orders lists
        calculateStatsFromOrders(pendingOrders, completedOrders);
        return;
      }

      const response = await ordersAPI.getDeliveryStats({
        filter: currentDateFilter,
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : undefined,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : undefined,
        status: activeTab || 'pending',
      });

      const payload = response.data?.data ?? response.data ?? {};
      const tabStatus = (activeTab || 'pending').toLowerCase();
      const isPendingTab = tabStatus === 'pending';

      const count = isPendingTab ? (payload.pendingOrders || 0) : (payload.completedOrders || 0);
      const revenue = isPendingTab ? (payload.pendingRevenue || 0) : (payload.completedRevenue || 0);

      const merged = mergeStats({
        pending_payments: {
          count: isPendingTab ? (payload.pendingOrders || 0) : 0,
          total_amount: isPendingTab ? (payload.pendingRevenue || 0) : 0,
        },
        received_payments: {
          count: !isPendingTab ? (payload.completedOrders || 0) : 0,
          total_amount: !isPendingTab ? (payload.completedRevenue || 0) : 0,
        },
        // Delivery screen expects delivery stats cards; map them to the same backend counts/revenue.
        pending_deliveries: {
          count: isPendingTab ? (payload.pendingOrders || 0) : 0,
          total_amount: isPendingTab ? (payload.pendingRevenue || 0) : 0,
        },
        completed_deliveries: {
          count: !isPendingTab ? (payload.completedOrders || 0) : 0,
          total_amount: !isPendingTab ? (payload.completedRevenue || 0) : 0,
        },
        cash_payments: {
          count: payload.cashStats?.count || 0,
          total_amount: payload.cashStats?.revenue || 0,
        },
        bank_payments: {
          count: payload.bankStats?.count || 0,
          total_amount: payload.bankStats?.revenue || 0,
        },
        total_orders: count,
        total_revenue: revenue,
        average_order_value: count > 0 ? (revenue / count) : 0,
      });

      setStats(merged);
    } catch (err) {
      setStats({ ...defaultStats });
    }
  }, [activeTab, online, mergeStats, defaultStats, calculateStatsFromOrders, pendingOrders, completedOrders]);
  
  // Auto-recalculate stats whenever orders change
  useEffect(() => {
    // Only recalculate if we have orders (not on initial empty state)
    if (pendingOrders.length > 0 || completedOrders.length > 0) {
      calculateStatsFromOrders(pendingOrders, completedOrders);
    }
  }, [pendingOrders, completedOrders, calculateStatsFromOrders]);

  // Initial load - only once (handles React StrictMode double mount)
  useEffect(() => {
    const loadData = async () => {
      if (!hasInitialLoad.current) {
        hasInitialLoad.current = true;
        // Initialize refs with current values
        dateFilterRef.current = dateFilter;
        startDateRef.current = startDate;
        endDateRef.current = endDate;
      }
      // Fetch orders + stats
      await Promise.all([
        fetchOrders(),
        fetchAllOrders(),
        fetchStats()
      ]);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  // Reload data when filters change (but not on initial mount)
  const prevFiltersRef = useRef({ dateFilter: null, startDate: null, endDate: null });
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    // Skip on initial mount (handled by the initial load useEffect)
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      // Initialize prevFiltersRef with current values
      prevFiltersRef.current = { dateFilter, startDate, endDate };
      return;
    }

    if (!hasInitialLoad.current) return; // Skip if initial load hasn't happened yet

    // Check if filters actually changed
    const filtersChanged =
      prevFiltersRef.current.dateFilter !== dateFilter ||
      prevFiltersRef.current.startDate !== startDate ||
      prevFiltersRef.current.endDate !== endDate;

    if (!filtersChanged) {
      return;
    }

    // Update previous filter values immediately to prevent duplicate calls
    prevFiltersRef.current = { dateFilter, startDate, endDate };
    
    // Update refs IMMEDIATELY and SYNCHRONOUSLY so fetchAllOrders and fetchStats use the latest values
    dateFilterRef.current = dateFilter;
    startDateRef.current = startDate;
    endDateRef.current = endDate;
    
    // CRITICAL: Reset stats to defaults immediately to prevent showing stale data
    // This ensures users see that stats are being refreshed
    setStats({ ...defaultStats });

    const loadData = async () => {
      try {
        await Promise.all([
          fetchOrders(), // Update current tab orders
          fetchAllOrders(),
          fetchStats(),
        ]);
      } catch (error) {
        // Silently handle errors
      }
    };
    
    // No delay - refs are already updated synchronously above
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, startDate, endDate]); // Reload when filters change

  // Show offline pending orders notice (PWA sync) - ONLY for web app, NOT Electron
  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && window.electronAPI;
    // In Electron, all orders are in SQLite, so no need for offline sync notification
    if (isElectron) return;
    
    const checkOffline = async () => {
      if (offlineToastShown) return;
      try {
        const count = await getOfflineOrdersCount({ synced: false });
        if (count > 0 && online) {
          showError(`You have ${count} offline order(s) pending sync. Keep the app open to sync when online.`);
          setOfflineToastShown(true);
        }
      } catch (err) {
        // Silently handle errors
      }
    };
    if (online) {
      checkOffline();
    }
  }, [online, offlineToastShown, showError]);

  // When coming back online, sync offline orders first, then refresh from database
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    // Only trigger if online status actually changed from false to true
    if (online && !prevOnlineRef.current && hasInitialLoad.current && !isUpdatingStatus.current) {
      const syncAndRefresh = async () => {
        try {
          // First, sync pending operations (offline orders and updates) to the database
          const syncResult = await syncPendingOperations();

          // Only refresh orders from database if sync was successful (or no pending operations)
          if (syncResult && (syncResult.synced > 0 || syncResult.failed === 0)) {
            await Promise.all([
              fetchAllOrders(),
              fetchStats()
            ]);
          } else if (syncResult && syncResult.failed > 0) {
            // Still refresh to show current state
            await Promise.all([
              fetchAllOrders(),
              fetchStats()
            ]);
          }
        } catch (error) {
          // Even if sync fails, try to refresh orders to show current state
          try {
            await Promise.all([
              fetchAllOrders(),
              fetchStats()
            ]);
          } catch (refreshError) {
            // Silently handle errors
          }
        }
      };

      // Small delay to ensure network is stable
      const timer = setTimeout(syncAndRefresh, 1000);
      prevOnlineRef.current = online;
      return () => clearTimeout(timer);
    }
    prevOnlineRef.current = online;
  }, [online, fetchAllOrders, fetchStats]); // Include fetchAllOrders and fetchStats in deps

  // Removed periodic refresh - only refresh on user actions or when coming back online
  // This prevents bad UX from constant page reloading

  // Keep date filter when switching tabs (pending/completed).

  const handleQuickFilter = (filterKey) => {
    if (filterKey === 'custom') {
      setDateFilter('custom');
      setShowCustomRange(true);
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
    setShowCustomRange(false);
  };

  const resetDateFilter = useCallback(() => {
    setDateFilter('today');
    setStartDate(null);
    setEndDate(null);
    setShowCustomRange(false);
  }, []);

  const clearAppliedCustomRange = useCallback(() => {
    setDateFilter('custom');
    setStartDate(null);
    setEndDate(null);
    setShowCustomRange(true);
  }, []);

  const openPaymentModal = (order) => {
    const orderTotal = order.totalAmount || order.total_amount || 0;
    setPaymentModal({
      open: true,
      order,
      paymentMethod: 'cash',
      amountTaken: orderTotal.toString()
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
    
    console.log('💰 [DeliveryOrders] Mark as Paid - START:', {
      orderId: order.id,
      orderNumber: order.order_number || order.orderNumber,
      paymentMethod,
      amountTaken,
      totalAmount: order.totalAmount || order.total_amount,
      deliveryStatus: order.deliveryStatus || order.delivery_status
    });

    if (!paymentMethod) {
      showError('Please select a payment method');
      return;
    }

    if (paymentMethod === 'cash') {
      const orderTotal = order.totalAmount || order.total_amount || 0;
      if (!amountTaken || parseFloat(amountTaken) < parseFloat(orderTotal)) {
        showError('Amount taken must be greater than or equal to total amount');
        return;
      }
    }

    setMarkingPaidId(order.id);

    // Build payload outside try block so it's accessible in catch block
    const payload = {
      paymentMethod: paymentMethod
    };

    if (paymentMethod === 'cash') {
      const taken = parseFloat(amountTaken);
      const orderTotal = order.totalAmount || order.total_amount || 0;
      payload.amountTaken = taken;
      payload.returnAmount = Math.max(0, taken - parseFloat(orderTotal));
    }

    try {
      // Check if offline
      if (!isOnline() || order.offline) {
        // Extract the real offline ID (IndexedDB ID) for updating
        const realOfflineId = order.offlineId || (order.id?.startsWith('OFFLINE-')
          ? order.id.replace(/^OFFLINE-/, '').split('-')[0]
          : order.id);

        const updatedData = {
          payment_method: paymentMethod,
          paymentMethod,
          amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
          return_amount: payload.returnAmount || 0,
          payment_status: 'completed',
          paymentStatus: 'completed',
          // Keep existing statuses
          order_status: order.order_status,
          orderStatus: order.orderStatus,
          delivery_status: order.delivery_status,
          deliveryStatus: order.deliveryStatus,
          offlineStatusUpdated: true
        };

        // Update the order in IndexedDB with completed status
        try {
          await updateOfflineOrder(realOfflineId, updatedData);
        } catch (updateError) {
          // Silently handle update errors
        }

        // Queue operations for sync - use the real offline ID
        await addPendingOperation({
          type: 'mark_as_paid',
          endpoint: `/api/orders/${realOfflineId}/mark-as-paid`,
          method: 'POST',
          data: payload,
          offlineId: realOfflineId
        });

        // Only queue mark_as_paid, do NOT auto-complete order or delivery status

        // Update local state immediately - check if order should move to completed tab
        // For delivery orders, order is completed only if BOTH payment is completed AND delivery is delivered
        const deliveryStatus = order.deliveryStatus || order.delivery_status || 'pending';
        const isDelivered = deliveryStatus === 'delivered';
        const shouldBeCompleted = isDelivered; // Only completed if delivered
        
        const updatedOrder = { ...order, ...updatedData };
        
        if (shouldBeCompleted) {
          // Move to completed tab
          setPendingOrders(prev => prev.filter(o => o.id !== order.id));
          setCompletedOrders(prev => {
            const exists = prev.find(o => o.id === order.id);
            return exists ? prev.map(o => o.id === order.id ? updatedOrder : o) : [...prev, updatedOrder];
          });
        } else {
          // Stay in pending tab, just update payment status
          setPendingOrders(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
          setCompletedOrders(prev => prev.filter(o => o.id !== order.id));
        }

        showSuccess(`Order #${order.order_number || order.id} marked as paid. Changes will sync when you are back online.`);
        closePaymentModal();

        // Only refresh stats, not orders (already updated locally)
        fetchStats();

        // Dispatch event to refresh badges immediately
        window.dispatchEvent(new CustomEvent('orderUpdated', {
          detail: { orderType: 'delivery', orderId: order.id, action: 'markedPaid', offline: true }
        }));
      } else {
        // Online mode
        console.log('💰 [DeliveryOrders] Mark as Paid - Calling API...', { orderId: order.id, payload });
        await ordersAPI.markAsPaid(order.id, payload);
        console.log('💰 [DeliveryOrders] Mark as Paid - API call successful');
        
        // Verify by fetching the order from database
        try {
          const verifyResponse = await ordersAPI.getById(order.id);
          const verifiedOrder = verifyResponse?.data?.data || verifyResponse?.data;
          console.log('💰 [DeliveryOrders] Mark as Paid - Verified from database:', {
            orderId: verifiedOrder?.id,
            paymentStatus: verifiedOrder?.paymentStatus || verifiedOrder?.payment_status,
            deliveryStatus: verifiedOrder?.deliveryStatus || verifiedOrder?.delivery_status,
            orderStatus: verifiedOrder?.orderStatus || verifiedOrder?.order_status
          });
        } catch (verifyError) {
          console.warn('💰 [DeliveryOrders] Mark as Paid - Could not verify (non-critical):', verifyError.message);
        }

        // Update local state immediately - check if order should move to completed tab
        // For delivery orders, order is completed only if BOTH payment is completed AND delivery is delivered
        const deliveryStatus = order.deliveryStatus || order.delivery_status || 'pending';
        const isDelivered = deliveryStatus === 'delivered';
        const shouldBeCompleted = isDelivered; // Only completed if delivered
        
        const updatedOrder = {
          ...order,
          payment_status: 'completed',
          paymentStatus: 'completed',
          // Keep existing statuses
          order_status: order.order_status,
          orderStatus: order.orderStatus,
          delivery_status: order.delivery_status,
          deliveryStatus: order.deliveryStatus,
          payment_method: paymentMethod,
          amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
          return_amount: payload.returnAmount || 0
        };
        
        if (shouldBeCompleted) {
          // Move to completed tab
          setPendingOrders(prev => prev.filter(o => o.id !== order.id));
          setCompletedOrders(prev => {
            const exists = prev.find(o => o.id === order.id);
            return exists ? prev.map(o => o.id === order.id ? updatedOrder : o) : [...prev, updatedOrder];
          });
        } else {
          // Stay in pending tab, just update payment status
          setPendingOrders(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
          setCompletedOrders(prev => prev.filter(o => o.id !== order.id));
        }

        showSuccess(`Order #${order.order_number || order.id} marked as paid successfully`);
        closePaymentModal();

        // Only refresh stats, not orders (already updated locally)
        console.log('💰 [DeliveryOrders] Mark as Paid - Refetching stats...');
        fetchStats();
        console.log('💰 [DeliveryOrders] Mark as Paid - COMPLETE');

        // Dispatch event to refresh badges immediately
        window.dispatchEvent(new CustomEvent('orderUpdated', {
          detail: { orderType: 'delivery', orderId: order.id, action: 'markedPaid' }
        }));
      }
    } catch (err) {
      console.error('💰 [DeliveryOrders] Mark as Paid - ERROR:', err.message);
      // If online but API fails, fall back to offline mode
      if (err.code === 'ERR_NETWORK' || !isOnline()) {
        const realOfflineId = order.offlineId || (order.id?.startsWith('OFFLINE-')
          ? order.id.replace(/^OFFLINE-/, '').split('-')[0]
          : order.id);

        const updatedData = {
          payment_method: paymentMethod,
          paymentMethod,
          amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
          return_amount: payload.returnAmount || 0,
          payment_status: 'completed',
          paymentStatus: 'completed',
          // Keep existing statuses
          order_status: order.order_status,
          orderStatus: order.orderStatus,
          delivery_status: order.delivery_status,
          deliveryStatus: order.deliveryStatus,
          offlineStatusUpdated: true
        };

        try {
          await updateOfflineOrder(realOfflineId, updatedData);
          await addPendingOperation({
            type: 'mark_as_paid',
            endpoint: `/api/orders/${realOfflineId}/mark-as-paid`,
            method: 'POST',
            data: payload,
            offlineId: realOfflineId
          });
          // Only queue mark_as_paid, do NOT auto-complete

          // Update local state immediately - check if order should move to completed tab
          // For delivery orders, order is completed only if BOTH payment is completed AND delivery is delivered
          const deliveryStatus = order.deliveryStatus || order.delivery_status || 'pending';
          const isDelivered = deliveryStatus === 'delivered';
          const shouldBeCompleted = isDelivered; // Only completed if delivered
          
          const updatedOrder = { ...order, ...updatedData };
          
          if (shouldBeCompleted) {
            // Move to completed tab
            setPendingOrders(prev => prev.filter(o => o.id !== order.id));
            setCompletedOrders(prev => {
              const exists = prev.find(o => o.id === order.id);
              return exists ? prev.map(o => o.id === order.id ? updatedOrder : o) : [...prev, updatedOrder];
            });
          } else {
            // Stay in pending tab, just update payment status
            setPendingOrders(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
            setCompletedOrders(prev => prev.filter(o => o.id !== order.id));
          }

          showSuccess(`Order #${order.order_number || order.id} marked as paid offline. Changes will sync when connection is restored.`);
          closePaymentModal();
          // Only refresh stats, not orders (already updated locally)
          fetchStats();
        } catch (offlineErr) {
          showError('Failed to save offline. Please try again.');
        }
      } else {
        showError(err.formattedMessage || err.response?.data?.error || 'Failed to mark order as paid');
      }
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
    if (activeTab === 'completed') return;
    const isDelivered = newStatus === 'delivered';
    console.log('🚚 [DeliveryOrders] Status Update - START:', {
      orderId,
      newStatus,
      isDelivered,
      timestamp: new Date().toISOString()
    });
    setUpdatingStatusId(orderId);
    isUpdatingStatus.current = true;
    try {
      // Ensure orderId is a string
      const orderIdStr = String(orderId || '');
      if (!orderIdStr) {
        console.error('🚚 [DeliveryOrders] Status Update - ERROR: Invalid order ID');
        throw new Error('Invalid order ID');
      }

      const targetOrder = [...pendingOrders, ...completedOrders].find(o =>
        String(o.id) === String(orderId) || String(o.id) === orderIdStr || o.id === orderId
      );
      
      if (!targetOrder) {
        console.error('🚚 [DeliveryOrders] Status Update - ERROR: Order not found!', { orderId });
        throw new Error('Order not found');
      }
      
      console.log('🚚 [DeliveryOrders] Status Update - Order details:', {
        orderId: targetOrder.id,
        orderNumber: targetOrder.order_number || targetOrder.orderNumber,
        currentDeliveryStatus: targetOrder.deliveryStatus || targetOrder.delivery_status,
        currentOrderStatus: targetOrder.orderStatus || targetOrder.order_status,
        currentPaymentStatus: targetOrder.paymentStatus || targetOrder.payment_status,
        newStatus,
        isDelivered
      });

      // Update local state immediately for better UX (no page refresh)
      const updateLocalState = () => {
        // Helper function to match order IDs (handles string/number conversion and OFFLINE- prefix)
        const matchesOrderId = (o) => {
          const oId = String(o.id || '');
          const targetId = String(orderId || '');
          return oId === targetId || oId === String(orderId);
        };

        // Get fresh order from state to ensure we have latest data
        const currentOrder = [...pendingOrders, ...completedOrders].find(matchesOrderId) || targetOrder;
        
        const isDelivered = newStatus === 'delivered';
        // For delivery orders, always update deliveryStatus based on newStatus
        // If newStatus is a delivery status (out_for_delivery, delivered), use it
        // Otherwise, use newStatus for delivery status too (pending, preparing, ready)
        const deliveryStatuses = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
        const newDeliveryStatus = deliveryStatuses.includes(newStatus) ? newStatus : (currentOrder?.deliveryStatus || currentOrder?.delivery_status || 'pending');

        // If marking as delivered, automatically mark payment as paid
        const paymentStatus = isDelivered ? 'completed' : (currentOrder?.paymentStatus || currentOrder?.payment_status || 'pending');
        const payment_status = isDelivered ? 'completed' : (currentOrder?.payment_status || currentOrder?.paymentStatus || 'pending');

        const updatedOrder = {
          ...currentOrder,
          orderStatus: isDelivered ? 'completed' : newStatus,
          order_status: isDelivered ? 'completed' : newStatus,
          deliveryStatus: newDeliveryStatus,
          delivery_status: newDeliveryStatus,
          // Auto-mark payment as paid when delivered
          paymentStatus: paymentStatus,
          payment_status: payment_status
        };

        // Move order between tabs if needed
        // For delivery orders, completed means BOTH payment is completed AND delivery is delivered
        // Since we auto-mark payment as paid when delivered, check the updated payment status
        const isPaid = paymentStatus === 'completed' || paymentStatus === 'paid';
        const shouldBeCompleted = isDelivered && isPaid; // Both delivered AND paid (payment auto-marked when delivered)
        const isCurrentlyPending = activeTab === 'pending';

        if (shouldBeCompleted && isCurrentlyPending) {
          // Move from pending to completed
          setPendingOrders(prev => prev.filter(o => !matchesOrderId(o)));
          setCompletedOrders(prev => {
            const exists = prev.find(matchesOrderId);
            return exists ? prev.map(o => matchesOrderId(o) ? updatedOrder : o) : [...prev, updatedOrder];
          });
        } else if (!shouldBeCompleted && !isCurrentlyPending) {
          // Move from completed to pending
          setCompletedOrders(prev => prev.filter(o => !matchesOrderId(o)));
          setPendingOrders(prev => {
            const exists = prev.find(matchesOrderId);
            return exists ? prev.map(o => matchesOrderId(o) ? updatedOrder : o) : [...prev, updatedOrder];
          });
        } else {
          // Update in current tab
          if (activeTab === 'pending') {
            setPendingOrders(prev => prev.map(o => matchesOrderId(o) ? updatedOrder : o));
          } else {
            setCompletedOrders(prev => prev.map(o => matchesOrderId(o) ? updatedOrder : o));
          }
        }
      };

      // Electron with local SQL DB - always make direct API call
      try {
        // Extract real order ID (remove OFFLINE- prefix if present) for API call
        const realOrderId = orderIdStr.startsWith('OFFLINE-')
          ? (targetOrder?.offlineId || orderIdStr.replace(/^OFFLINE-.*?-/, ''))
          : orderIdStr;

        // Convert to number if it's a numeric string (for Electron API)
        const numericId = !isNaN(realOrderId) && !isNaN(parseInt(realOrderId)) ? parseInt(realOrderId) : realOrderId;

        // Update local state BEFORE API call for immediate UI feedback
        updateLocalState();

        // For delivery orders, always update delivery status
        const deliveryStatuses = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
        const isDeliveryStatus = deliveryStatuses.includes(newStatus);

        if (isDeliveryStatus) {
          // New backend endpoint: PUT /api/orders/:id/mark-delivered (no body)
          // Use it only for the terminal "delivered" transition.
          if (newStatus === 'delivered') {
            console.log('🚚 [DeliveryOrders] Status Update - Marking delivered via mark-delivered...', { id: numericId });
            await ordersAPI.markDelivered(numericId);
            console.log('🚚 [DeliveryOrders] Status Update - mark-delivered API call successful');
          } else {
          console.log('🚚 [DeliveryOrders] Status Update - Updating delivery status...', { id: numericId, deliveryStatus: newStatus });
          // Update delivery status for delivery orders
          const deliveryResponse = await ordersAPI.updateDeliveryStatus(numericId, newStatus);
          console.log('🚚 [DeliveryOrders] Status Update - Delivery status API call successful');

          // If delivered, also mark order as completed
          // Map delivery status to valid order status
          let mappedOrderStatus = newStatus;
          if (newStatus === 'out_for_delivery') {
            mappedOrderStatus = 'ready';
          } else if (newStatus === 'delivered') {
            mappedOrderStatus = 'completed';
          }

          console.log('🚚 [DeliveryOrders] Status Update - Updating order status...', { id: numericId, orderStatus: mappedOrderStatus });
          const orderStatusResponse = await ordersAPI.updateOrderStatus(numericId, mappedOrderStatus);
          console.log('🚚 [DeliveryOrders] Status Update - Order status API call successful');

          // If marking as delivered, automatically mark payment as paid
          if (newStatus === 'delivered') {
            try {
              const paymentMethod = targetOrder?.payment_method || targetOrder?.paymentMethod || 'cash';
              console.log('🚚 [DeliveryOrders] Status Update - Auto-marking payment as paid...', { id: numericId, paymentMethod });
              const paymentResponse = await ordersAPI.markAsPaid(numericId, { paymentMethod });
              console.log('🚚 [DeliveryOrders] Status Update - Payment marked as paid successfully');
            } catch (paymentError) {
              console.warn('🚚 [DeliveryOrders] Status Update - Failed to auto-mark payment (non-critical):', paymentError.message);
              // Don't fail the whole operation if payment update fails
            }
          }
          }
        } else {
          console.log('🚚 [DeliveryOrders] Status Update - Updating order status (non-delivery)...', { id: numericId, orderStatus: newStatus });
          // For non-delivery statuses, update order status
          const orderStatusResponse = await ordersAPI.updateOrderStatus(numericId, newStatus);
          console.log('🚚 [DeliveryOrders] Status Update - Order status API call successful');
          
          // Also update delivery status to match
          const deliveryResponse = await ordersAPI.updateDeliveryStatus(numericId, newStatus);
          console.log('🚚 [DeliveryOrders] Status Update - Delivery status API call successful');
        }
        
        // Verify by fetching the order from database
        try {
          const verifyResponse = await ordersAPI.getById(numericId);
          const verifiedOrder = verifyResponse?.data?.data || verifyResponse?.data;
          const expectedDeliveryStatus = isDeliveryStatus ? newStatus : newStatus;
          const expectedOrderStatus = isDeliveryStatus 
            ? (newStatus === 'delivered' ? 'completed' : (newStatus === 'out_for_delivery' ? 'ready' : newStatus))
            : newStatus;
          
          console.log('🚚 [DeliveryOrders] Status Update - Verified from database:', {
            orderId: verifiedOrder?.id,
            deliveryStatus: verifiedOrder?.deliveryStatus || verifiedOrder?.delivery_status,
            orderStatus: verifiedOrder?.orderStatus || verifiedOrder?.order_status,
            paymentStatus: verifiedOrder?.paymentStatus || verifiedOrder?.payment_status,
            expectedDeliveryStatus,
            expectedOrderStatus,
            deliveryMatch: (verifiedOrder?.deliveryStatus || verifiedOrder?.delivery_status) === expectedDeliveryStatus,
            orderMatch: (verifiedOrder?.orderStatus || verifiedOrder?.order_status) === expectedOrderStatus
          });
        } catch (verifyError) {
          console.warn('🚚 [DeliveryOrders] Status Update - Could not verify (non-critical):', verifyError.message);
        }

        showSuccess(`Order status updated to ${newStatus.replace(/_/g, ' ')}${newStatus === 'delivered' ? ' and payment marked as paid' : ''}`);
        // Only refresh stats, not orders - local state already updated
        console.log('🚚 [DeliveryOrders] Status Update - Refetching stats...');
        await fetchStats();
        console.log('🚚 [DeliveryOrders] Status Update - COMPLETE');
        
        // Dispatch event to refresh badges in ManagerPortal
        const finalPaymentStatus = newStatus === 'delivered' ? 'completed' : (targetOrder?.paymentStatus || targetOrder?.payment_status || 'pending');
        window.dispatchEvent(new CustomEvent('orderUpdated', {
          detail: { 
            orderType: 'delivery', 
            orderId: orderId, 
            action: 'statusUpdated',
            deliveryStatus: newStatus,
            paymentStatus: finalPaymentStatus,
            orderStatus: newStatus === 'delivered' ? 'completed' : newStatus
          }
        }));
      } catch (error) {
        console.error('🚚 [DeliveryOrders] Status Update - ERROR:', error.message);
          
          // Revert local state on error - use helper function to match IDs
          const matchesOrderId = (o) => {
            const oId = String(o.id || '');
            const targetId = String(orderId || '');
            return oId === targetId || oId === String(orderId);
          };
          
          const revertOrder = { ...targetOrder };
          if (activeTab === 'pending') {
            setPendingOrders(prev => prev.map(o => matchesOrderId(o) ? revertOrder : o));
          } else {
            setCompletedOrders(prev => prev.map(o => matchesOrderId(o) ? revertOrder : o));
          }

        throw error;
      }
    } catch (err) {
      console.error('🚚 [DeliveryOrders] Status Update - CRITICAL ERROR:', err.message);
      showError(err.formattedMessage || err.response?.data?.error || 'Failed to update order status');
    } finally {
      setUpdatingStatusId(null);
      isUpdatingStatus.current = false;
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
          const targetOrder = [...pendingOrders, ...completedOrders].find(o => o.id === orderId);

          // Update local state immediately (no page refresh)
          const updatedOrder = {
            ...targetOrder,
            order_status: 'cancelled',
            orderStatus: 'cancelled',
            status: 'cancelled',
            payment_status: 'cancelled',
            paymentStatus: 'cancelled',
            delivery_status: 'cancelled',
            deliveryStatus: 'cancelled'
          };

          // Move cancelled order into completed list so it is still visible
          setPendingOrders(prev => prev.filter(o => o.id !== orderId));
          setCompletedOrders(prev => {
            const exists = prev.find(o => o.id === orderId);
            return exists
              ? prev.map(o => (o.id === orderId ? updatedOrder : o))
              : [...prev, updatedOrder];
          });

          await ordersAPI.cancelOrder(orderId);
          showSuccess('Order cancelled successfully');

          // Only refresh stats, not orders (already updated locally)
          fetchStats();
        } catch (err) {
          showError(err.formattedMessage || err.response?.data?.error || 'Failed to cancel order');
          // Revert local state on error
          await fetchAllOrders();
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
          const targetOrder = [...pendingOrders, ...completedOrders].find(o => o.id === orderId);

          await ordersAPI.revertPaymentStatus(orderId);

          // Update local state immediately (no page refresh)
          const updatedOrder = {
            ...targetOrder,
            payment_status: 'pending',
            paymentStatus: 'pending',
            amount_taken: null,
            return_amount: null
          };

          // Move from completed to pending tab if needed
          setCompletedOrders(prev => prev.filter(o => o.id !== orderId));
          setPendingOrders(prev => {
            const exists = prev.find(o => o.id === orderId);
            return exists ? prev.map(o => o.id === orderId ? updatedOrder : o) : [...prev, updatedOrder];
          });

          showSuccess('Payment status reverted to pending successfully');
          // Only refresh stats, not orders (already updated locally)
          fetchStats();
        } catch (err) {
          showError(err.formattedMessage || err.response?.data?.error || 'Failed to revert payment status');
          // Revert local state on error
          await fetchAllOrders();
        } finally {
          setMarkingPaidId(null);
        }
      },
      variant: 'warning'
    });
  };

  const currentOrders = activeTab === 'pending' ? pendingOrders : completedOrders;
  // Ensure safeStats always has proper structure
  const safeStats = mergeStats(stats || {});

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <OfflineIndicator />
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem', color: '#2d3748', fontSize: '2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FaTruck /> Delivery Orders
        </h1>

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
          {/* <div style={{
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
          </div> */}

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
            <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <FaMoneyBillWave /> Cash Payments
            </div>
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <FaUniversity /> Bank Payments
            </div>
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
            <FaClock style={{ marginRight: '0.25rem' }} /> Pending ({pendingOrders.length})
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
            <FaCheck style={{ marginRight: '0.25rem' }} /> Completed ({completedOrders.length})
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

          <AppliedFiltersBanner
            items={
              isCustomDateRangeApplied(dateFilter, startDate, endDate)
                ? [
                    {
                      id: 'date',
                      label: getDateFilterBannerLabel(dateFilter, startDate, endDate, dayjs),
                      onRemove: clearAppliedCustomRange
                    }
                  ]
                : []
            }
          />
        </div>
      </div>

      {/* Orders List — show screen loading on every fetch/refetch */}
      {loading ? (
        <ScreenLoading label="Loading orders..." />
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
            {activeTab === 'pending' ? <FaClock /> : <FaCheck />}
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
                        <MdWifiOff style={{ marginRight: '0.25rem' }} /> Offline (Pending Sync)
                      </span>
                    )}
                  </h3>
                  <p style={{ margin: '0.5rem 0 0 0', color: '#6c757d', fontSize: '0.9rem' }}>
                    {dayjs(order.createdAt || order.created_at).format('MMM D, YYYY h:mm A')}
                  </p>
                  {activeTab === 'pending' && (
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', fontWeight: '600', color: getDurationColor(order.createdAt || order.created_at) }}>
                      <FaClock style={{ marginRight: '0.25rem' }} /> Waiting: {getOrderDuration(order.createdAt || order.created_at)}
                    </p>
                  )}
                  {/* Customer Info */}
                  {(order.customer?.name ||
                    order.customer_name ||
                    order.customerName ||
                    order.deliveryName) && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', fontWeight: '600', color: '#2d3748' }}>
                        <FaUser style={{ marginRight: '0.25rem' }} />{' '}
                        {order.customer?.name ||
                          order.customer_name ||
                          order.customerName ||
                          order.deliveryName}
                      </p>
                      {(() => {
                        const phone =
                          order.customer?.phone ||
                          order.customer_phone ||
                          order.customerPhone ||
                          order.deliveryPhone;
                        const address =
                          order.deliveryAddress ||
                          order.delivery_address ||
                          order.customer_address;
                        // Try to get notes and Google Maps link from order first, then fallback to customer's address
                        let notes = order.deliveryNotes || order.delivery_notes || '';
                        let googleLink = order.googleMapsLink || order.google_maps_link || '';

                        // If order doesn't have notes/googleLink, try to get from customer's address
                        if ((!notes || !googleLink) && order.customer?.addresses && Array.isArray(order.customer.addresses)) {
                          const matchingAddress = order.customer.addresses.find(addr =>
                            addr.address === address || addr.address?.toLowerCase() === address?.toLowerCase()
                          );
                          if (matchingAddress) {
                            if (!notes && matchingAddress.notes) notes = matchingAddress.notes;
                            if (!googleLink && matchingAddress.googleMapsLink) googleLink = matchingAddress.googleMapsLink;
                          }
                        }

                        const copyContainerId = `copy-container-${order.id || order.order_number || Math.random()}`;

                        const handleCopy = async () => {
                          // Get fresh values from order object to ensure we have the latest data
                          let currentNotes = order.deliveryNotes || order.delivery_notes || order.notes || '';
                          let currentGoogleLink = order.googleMapsLink || order.google_maps_link || '';

                          // Fallback to customer's address if order doesn't have it
                          if ((!currentNotes || !currentGoogleLink) && order.customer?.addresses && Array.isArray(order.customer.addresses)) {
                            const matchingAddress = order.customer.addresses.find(addr =>
                              addr.address === address || addr.address?.toLowerCase() === address?.toLowerCase()
                            );
                            if (matchingAddress) {
                              if (!currentNotes && matchingAddress.notes) currentNotes = matchingAddress.notes;
                              if (!currentGoogleLink && matchingAddress.googleMapsLink) currentGoogleLink = matchingAddress.googleMapsLink;
                            }
                          }

                          // Get customer name, delivery status, and amount
                          const customerName = order.customer?.name || order.customer_name || order.customerName || order.deliveryName || '';
                          const deliveryStatus = order.deliveryStatus || order.delivery_status || 'pending';
                          const totalAmount = order.totalAmount || order.total_amount || 0;

                          let copyText = '';
                          if (customerName) copyText += `Name: ${customerName}`;
                          if (phone) {
                            if (copyText) copyText += '\n';
                            copyText += `Phone Number: ${phone}`;
                          }
                          if (address) {
                            if (copyText) copyText += '\n';
                            copyText += `Location: ${address}`;
                          }
                          if (currentGoogleLink && currentGoogleLink.trim()) {
                            if (copyText) copyText += '\n';
                            copyText += `Map Link: ${currentGoogleLink}`;
                          }
                          if (deliveryStatus) {
                            if (copyText) copyText += '\n';
                            copyText += `Delivery Status: ${deliveryStatus.replace(/_/g, ' ')}`;
                          }
                          if (totalAmount) {
                            if (copyText) copyText += '\n';
                            copyText += `Amount: ${formatCurrency(totalAmount)}`;
                          }
                          if (currentNotes && currentNotes.trim()) {
                            if (copyText) copyText += '\n';
                            copyText += `Notes: ${currentNotes}`;
                          }

                          try {
                            await navigator.clipboard.writeText(copyText);
                            showSuccess('Order information copied to clipboard!');
                          } catch (err) {
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = copyText;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            showSuccess('Order information copied to clipboard!');
                          }
                        };

                        return (
                          <div
                            id={copyContainerId}
                            style={{ position: 'relative' }}
                            onMouseEnter={(e) => {
                              const container = e.currentTarget;
                              const phoneEl = container.querySelector('.copy-highlight-phone');
                              const addressEl = container.querySelector('.copy-highlight-address');
                              if (phoneEl) {
                                phoneEl.style.backgroundColor = '#fff3cd';
                              }
                              if (addressEl) {
                                addressEl.style.backgroundColor = '#fff3cd';
                              }
                            }}
                            onMouseLeave={(e) => {
                              const container = e.currentTarget;
                              const phoneEl = container.querySelector('.copy-highlight-phone');
                              const addressEl = container.querySelector('.copy-highlight-address');
                              if (phoneEl) {
                                phoneEl.style.backgroundColor = 'transparent';
                              }
                              if (addressEl) {
                                addressEl.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            {phone && (
                              <p
                                className="copy-highlight-phone"
                                style={{
                                  margin: '0.25rem 0',
                                  fontSize: '0.85rem',
                                  color: '#6c757d',
                                  padding: '0.25rem',
                                  borderRadius: '4px',
                                  transition: 'background-color 0.2s ease'
                                }}
                              >
                                <FaPhone style={{ marginRight: '0.25rem' }} /> {phone}
                              </p>
                            )}
                            {address && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' }}>
                                <p
                                  className="copy-highlight-address"
                                  style={{
                                    margin: 0,
                                    fontSize: '0.85rem',
                                    color: '#6c757d',
                                    flex: 1,
                                    padding: '0.25rem',
                                    borderRadius: '4px',
                                    transition: 'background-color 0.2s ease'
                                  }}
                                >
                                  <FaMapMarkerAlt style={{ marginRight: '0.25rem' }} /> {address}
                                </p>
                                <button
                                  onClick={handleCopy}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '0.25rem',
                                    fontSize: '1rem',
                                    color: '#495057',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'transform 0.2s ease'
                                  }}
                                  title="Copy order information (name, phone, location, map link, delivery status, amount)"
                                >
                                  <FaCopy />
                                </button>
                              </div>
                            )}
                            {notes && (
                              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6c757d' }}>
                                <strong>Notes:</strong> {notes}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {/* Status Badges */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    {(() => {
                      const orderStatus = order.orderStatus || order.order_status;
                      const deliveryStatus = order.deliveryStatus || order.delivery_status || 'pending';

                      // User requirement: "only show completed if status is delivered or out for delivery"
                      // If orderStatus claims "completed" but deliveryStatus is NOT completed/delivered,
                      // fallback to showing delivery status (e.g. Preparing, Ready)
                      let displayStatus = orderStatus;

                      if (orderStatus === 'completed') {
                        if (deliveryStatus && deliveryStatus !== 'delivered') {
                          displayStatus = deliveryStatus;
                        }
                      }

                      // For cancelled orders, we'll show a separate explicit badge below.
                      if (!displayStatus || displayStatus === 'cancelled') return null;

                      return (
                        <div
                          style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '20px',
                            background: getOrderStatusColor(displayStatus).background,
                            color: getOrderStatusColor(displayStatus).color,
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            textTransform: 'capitalize'
                          }}
                        >
                          {String(displayStatus).replace(/_/g, ' ')}
                        </div>
                      );
                    })()}
                    {(() => {
                      const deliveryStatus = order.deliveryStatus || order.delivery_status;
                      // Only show delivery status badge if it exists and is not 'delivered' (to avoid showing "Delivery: Delivered" incorrectly)
                      const orderStatus = order.orderStatus || order.order_status;
                      const resolvedOrderStatus = (() => {
                        if (!orderStatus) return undefined;
                        if (orderStatus === 'completed' && deliveryStatus && deliveryStatus !== 'delivered') return deliveryStatus;
                        return orderStatus;
                      })();

                      // Avoid duplicate badges when order status already reflects delivery status
                      if (
                        deliveryStatus &&
                        deliveryStatus !== 'delivered' &&
                        resolvedOrderStatus !== deliveryStatus
                      ) {
                        return (
                          <div style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '20px',
                            background: getDeliveryStatusColor(deliveryStatus).background,
                            color: getDeliveryStatusColor(deliveryStatus).color,
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            textTransform: 'capitalize'
                          }}>
                            {deliveryStatus.replace(/_/g, ' ')}
                          </div>
                        );
                      }
                      return null;
                    })()}
                    {/* Cancelled badge */}
                    {(() => {
                      const orderStatus = (order.orderStatus || order.order_status || '').toLowerCase();
                      if (orderStatus !== 'cancelled') return null;
                      return (
                        <div
                          style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '20px',
                            background: '#f8d7da',
                            color: '#721c24',
                            fontSize: '0.8rem',
                            fontWeight: '700',
                            textTransform: 'uppercase',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}
                        >
                          <FaTimes /> Cancelled
                        </div>
                      );
                    })()}
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
                    background: (() => {
                      const isCancelled = order.orderStatus === 'cancelled' || order.order_status === 'cancelled';
                      const isPaid = (order.paymentStatus || order.payment_status) === 'completed';
                      if (isCancelled) return '#fee2e2';
                      return isPaid ? '#e6ffed' : '#fff4d8';
                    })(),
                    color: (() => {
                      const isCancelled = order.orderStatus === 'cancelled' || order.order_status === 'cancelled';
                      const isPaid = (order.paymentStatus || order.payment_status) === 'completed';
                      if (isCancelled) return '#dc2626';
                      return isPaid ? '#198754' : '#7c2d12';
                    })(),
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    display: 'inline-block'
                  }}>
                    {(() => {
                      const isCancelled = order.orderStatus === 'cancelled' || order.order_status === 'cancelled';
                      const isPaid = (order.paymentStatus || order.payment_status) === 'completed';
                      if (isCancelled) {
                        return 'Cancelled';
                      }
                      return isPaid ? 'Paid' : 'Pending Payment';
                    })()}
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
                      return items.map((item, idx) => {
                        const reason =
                          item.reason ||
                          item.cancel_reason ||
                          item.cancellation_reason ||
                          item.note ||
                          item.notes;
                        return (
                          <div key={idx} style={{ marginBottom: reason ? '0.25rem' : 0 }}>
                            <div>
                              {item.quantity}x{' '}
                              {item.menuItem?.name ||
                                item.menu_item?.name ||
                                item.item_name ||
                                item.name ||
                                'Item'}
                            </div>
                            {reason && (
                              <div style={{ fontSize: '0.8rem', color: '#b02a37' }}>
                                <strong>Reason:</strong> {reason}
                              </div>
                            )}
                          </div>
                        );
                      });
                    } else {
                      return 'No items';
                    }
                  })()}
                </div>
              </div>

              {/* Delivery Notes */}
              {
                (order.deliveryNotes || order.delivery_notes || order.googleMapsLink || order.google_maps_link) && (
                  <div style={{
                    marginTop: '0.75rem',
                    marginBottom: '0.75rem',
                    padding: '0.75rem',
                    background: '#f1f3f5',
                    border: '1px solid #e9ecef',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: '#495057'
                  }}>
                    {order.deliveryNotes || order.delivery_notes ? (
                      <div style={{ marginBottom: order.googleMapsLink || order.google_maps_link ? '0.5rem' : '0' }}>
                        <strong>Notes:</strong> {order.deliveryNotes || order.delivery_notes}
                      </div>
                    ) : null}
                    {order.googleMapsLink || order.google_maps_link ? (
                      <div style={{ marginBottom: '0.25rem' }}>
                        <strong>Google Maps:</strong>{' '}
                        <a
                          href={order.googleMapsLink || order.google_maps_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#339af0', textDecoration: 'underline', wordBreak: 'break-all' }}
                        >
                          {order.googleMapsLink || order.google_maps_link}
                        </a>
                      </div>
                    ) : null}
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
                    <FaExclamationTriangle style={{ marginRight: '0.25rem' }} /> <strong>Special Instructions:</strong> {order.specialInstructions || order.special_instructions}
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
                    <StatusDropdown
                      value={(() => {
                        const dStatus = order.deliveryStatus || order.delivery_status;
                        if (dStatus === 'out_for_delivery' || dStatus === 'delivered') return dStatus;
                        return order.orderStatus || order.order_status || 'pending';
                      })()}
                      onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                      disabled={updatingStatusId === order.id}
                      options={[
                        { value: 'pending', label: 'Pending', icon: FaClock },
                        { value: 'preparing', label: 'Preparing', icon: FaUserTie },
                        { value: 'out_for_delivery', label: 'Out for Delivery', icon: FaTruck },
                        { value: 'delivered', label: 'Delivered', icon: FaCheck }
                      ]}
                    />
                  </div>

                  {/* Offline Status Label - Show when status was updated offline */}
                  {((order.offline && (order.orderStatus || order.order_status)) || order.offlineStatusUpdated) && (
                    <div style={{
                      padding: '0.4rem 0.6rem',
                      background: '#fff4d8',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: '#7c2d12',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      marginTop: '0.5rem'
                    }}>
                      <span><MdWifiOff /></span>
                      <span>
                        Status: {(() => {
                          const status = order.orderStatus || order.order_status || 'pending';
                          return status.replace(/_/g, ' ');
                        })()} - Offline Mode
                      </span>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                    {/* Mark as Paid Button - hidden when already paid */}
                    {(() => {
                      const orderStatus = (order.orderStatus || order.order_status || order.status || 'pending').toLowerCase();
                      const deliveryStatus = (order.deliveryStatus || order.delivery_status || '').toLowerCase();
                      const isCompleted = orderStatus === 'completed' || orderStatus === 'cancelled';
                      const isDelivered = deliveryStatus === 'delivered';

                      // Show the button whenever the order is still pending work (not delivered/completed),
                      // even if payment status is already marked as paid (backend can be inconsistent).
                      if (isCompleted || isDelivered) return null;

                      return (
                        <button
                          onClick={() => handleStatusUpdate(order.id, 'delivered')}
                          disabled={updatingStatusId === order.id || order.offline}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            border: 'none',
                            borderRadius: '8px',
                            background: (updatingStatusId === order.id || order.offline) ? '#6c757d' : 'var(--gradient-primary)',
                            color: 'white',
                            fontWeight: 'bold',
                            cursor: (updatingStatusId === order.id || order.offline) ? 'not-allowed' : 'pointer',
                            fontSize: '0.9rem',
                            opacity: (updatingStatusId === order.id || order.offline) ? 0.6 : 1,
                            transition: 'all 0.2s'
                          }}
                        >
                          {updatingStatusId === order.id
                            ? <><FaClock style={{ marginRight: '0.25rem' }} /> Processing...</>
                            : <><FaDollarSign style={{ marginRight: '0.25rem' }} /> Mark as Paid</>}
                        </button>
                      );
                    })()}
                    
                    {/* Mark as Delivered Button - Commented out (old conditional button) */}
                    {/* {(() => {
                      const deliveryStatus = order.deliveryStatus || order.delivery_status;
                      const orderStatus = order.orderStatus || order.order_status || 'pending';
                      const paymentStatus = order.paymentStatus || order.payment_status || 'pending';
                      
                      // Hide button for all statuses (pending, preparing, out_for_delivery, etc.)
                      // Don't show button if:
                      // - Already delivered
                      // - Order is completed or cancelled
                      // - Order status is preparing
                      // - Order status is pending
                      // - Order status is out_for_delivery
                      // - Payment is paid/completed
                      const isDelivered = deliveryStatus === 'delivered';
                      const isCompleted = orderStatus === 'completed' || orderStatus === 'cancelled';
                      const isPreparing = orderStatus === 'preparing';
                      const isPending = orderStatus === 'pending';
                      const isOutForDelivery = deliveryStatus === 'out_for_delivery' || orderStatus === 'out_for_delivery';
                      const isPaid = paymentStatus === 'paid' || paymentStatus === 'completed';
                      
                      // Hide button for all statuses
                      const shouldShowButton = false;
                      
                      return shouldShowButton ? (
                        <button
                          onClick={() => handleStatusUpdate(order.id, 'delivered')}
                          disabled={updatingStatusId === order.id}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            border: 'none',
                            borderRadius: '8px',
                            background: updatingStatusId === order.id ? '#6c757d' : 'var(--gradient-primary)',
                            color: 'white',
                            fontWeight: 'bold',
                            cursor: updatingStatusId === order.id ? 'not-allowed' : 'pointer',
                            fontSize: '0.9rem',
                            opacity: updatingStatusId === order.id ? 0.6 : 1,
                            transition: 'all 0.2s'
                          }}
                        >
                          {updatingStatusId === order.id ? <><FaClock style={{ marginRight: '0.25rem' }} /> Processing...</> : <><FaCheck style={{ marginRight: '0.25rem' }} /> Mark as Paid</>}
                        </button>
                      ) : null;
                    })()} */}
                    
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => {
                          sessionStorage.setItem('orderToEdit', JSON.stringify({
                            id: order.id,
                            orderType: 'delivery',
                            offline: order.offline || false,
                            offlineId: order.offlineId || null
                          }));
                          navigate(`${basePath}/orders`);
                        }}
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
                        <FaEdit style={{ marginRight: '0.25rem' }} /> Edit Order
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
                        {cancellingOrderId === order.id ? 'Processing...' : <><FaTimes style={{ marginRight: '0.25rem' }} /> Cancel</>}
                      </button>
                    </div>
                  </div>

                  {/* Mark as Paid Button - Commented out (conditional button that depended on payment_status) */}
                  {/* {order.payment_status === 'pending' && (
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
                      {markingPaidId === order.id ? 'Processing...' : <><FaDollarSign style={{ marginRight: '0.25rem' }} /> Mark as Paid</>}
                    </button>
                  )} */}
                </div>
              )}

              {activeTab === 'completed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Order Status - static (read-only) in Completed tab */}
                  {(() => {
                    const orderStatus = (order.orderStatus || order.order_status || '').toLowerCase();
                    const dStatus = (order.deliveryStatus || order.delivery_status || 'delivered').toLowerCase();
                    const displayStatus = orderStatus === 'cancelled' ? 'cancelled' : dStatus;
                    const colors = orderStatus === 'cancelled'
                      ? { background: '#f8d7da', color: '#721c24' }
                      : getDeliveryStatusColor(displayStatus);
                    return (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '10px' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#495057', minWidth: '80px' }}>
                          Status:
                        </label>
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '20px',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          textTransform: 'capitalize',
                          background: colors.background,
                          color: colors.color
                        }}>
                          {orderStatus === 'cancelled' ? <FaTimes /> : displayStatus === 'delivered' ? <FaCheck /> : displayStatus === 'out_for_delivery' ? <FaTruck /> : <FaClock />}
                          <span>{displayStatus.replace(/_/g, ' ')}</span>
                        </div>
                      </div>
                    );
                  })()}

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
                  {/* {order.payment_status === 'completed' && (
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
                      {markingPaidId === order.id ? 'Processing...' : <><FaUndo style={{ marginRight: '0.25rem' }} /> Revert Payment</>}
                    </button>
                  )} */}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ marginBottom: '0.5rem', color: '#6c757d' }}>
                  Order #{paymentModal.order.order_number || paymentModal.order.id}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                  Total: {formatCurrency(paymentModal.order.totalAmount || paymentModal.order.total_amount)}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
                  Payment Method <span style={{ color: '#dc3545' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => {
                      const orderTotal = paymentModal.order?.totalAmount || paymentModal.order?.total_amount || 0;
                      setPaymentModal({ ...paymentModal, paymentMethod: 'cash', amountTaken: orderTotal.toString() });
                    }}
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
                    <FaMoneyBillWave style={{ marginRight: '0.25rem' }} /> Cash
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
                    <FaUniversity style={{ marginRight: '0.25rem' }} /> Bank Transfer
                  </button>
                </div>
              </div>

              {paymentModal.paymentMethod === 'cash' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
                    Amount Taken <span style={{ color: '#dc3545' }}>*</span>
                  </label>
                  <input
                    type="number"
                    min={paymentModal.order.totalAmount || paymentModal.order.total_amount}
                    step="0.01"
                    value={paymentModal.amountTaken}
                    onChange={(e) => setPaymentModal({ ...paymentModal, amountTaken: e.target.value })}
                    placeholder={`Enter amount...`}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #dee2e6',
                      borderRadius: '8px',
                      fontSize: '1rem'
                    }}
                  />
                  {paymentModal.amountTaken && parseFloat(paymentModal.amountTaken) >= parseFloat(paymentModal.order.totalAmount || paymentModal.order.total_amount) && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#d4edda', borderRadius: '6px', color: '#155724', fontSize: '0.9rem' }}>
                      Return Amount: {formatCurrency(parseFloat(paymentModal.amountTaken) - parseFloat(paymentModal.order.totalAmount || paymentModal.order.total_amount))}
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
                    (paymentModal.paymentMethod === 'cash' && (!paymentModal.amountTaken || parseFloat(paymentModal.amountTaken) < parseFloat(paymentModal.order.totalAmount || paymentModal.order.total_amount)))
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
                      (paymentModal.paymentMethod === 'cash' && (!paymentModal.amountTaken || parseFloat(paymentModal.amountTaken) < parseFloat(paymentModal.order.totalAmount || paymentModal.order.total_amount)))
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
