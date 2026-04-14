import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';
import { printReceipt } from './Receipt';
import { getOfflineOrders, getOfflineOrdersCount, updateOfflineOrder, addPendingOperation } from '../utils/offlineDB';
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
  FaUtensils,
  FaClock,
  FaCheck,
  FaMoneyBillWave,
  FaUniversity,
  FaEdit,
  FaTimes,
  FaUndo,
  FaUser,
  FaExclamationTriangle,
  FaDollarSign,
  FaUserTie,
  FaWifi
} from 'react-icons/fa';
import { MdWifiOff } from 'react-icons/md';

// Helper function to get status icon
const getStatusIcon = (status) => {
  const statusLower = (status || 'pending').toLowerCase();
  if (statusLower === 'pending') return FaClock;
  if (statusLower === 'preparing') return FaUserTie;
  if (statusLower === 'ready') return FaCheck;
  if (statusLower === 'completed') return FaCheck;
  return FaClock;
};

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
  if (Number.isNaN(amount)) return '0';
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DineInOrders = ({ basePath = '/manager' }) => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const initialScreenFilters = useMemo(() => {
    const s = readFilterSession(FILTER_STORAGE_KEYS.dineInOrders);
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
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState(initialScreenFilters.dateFilter); // 'today', 'yesterday', 'this_week', 'this_month', or 'custom'
  const [startDate, setStartDate] = useState(initialScreenFilters.startDate);
  const [endDate, setEndDate] = useState(initialScreenFilters.endDate);
  const [showCustomRange, setShowCustomRange] = useState(initialScreenFilters.showCustomRange);
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
  const hasInitialLoad = useRef(false);
  const isUpdatingStatus = useRef(false);
  const isLoadingRef = useRef(false); // Track if currently loading to prevent concurrent loads
  const loadAttemptedRef = useRef(false); // Track if we've attempted to load (prevents double load in StrictMode)

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

  // Use refs to always get the latest filter values (avoid stale closures)
  // Initialize refs with current state values immediately - CRITICAL for initial load
  const dateFilterRef = useRef(dateFilter);
  const startDateRef = useRef(startDate);
  const endDateRef = useRef(endDate);
  
  // Update refs when values change - CRITICAL: This must run synchronously and BEFORE any fetch calls
  useEffect(() => {
    // Update refs immediately and synchronously
    dateFilterRef.current = dateFilter;
    startDateRef.current = startDate;
    endDateRef.current = endDate;
  }, [dateFilter, startDate, endDate]);

  useEffect(() => {
    writeFilterSession(FILTER_STORAGE_KEYS.dineInOrders, {
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

  // Fetch statistics for summary cards
  const fetchStats = useCallback(async () => {
    try {
      // Always use the latest filter values from refs (not from closure)
      const currentDateFilter = dateFilterRef.current;
      const currentStartDate = startDateRef.current;
      const currentEndDate = endDateRef.current;
      
      // Convert filter to date range - prioritize dateFilter over custom dates (same logic as fetchOrders)
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
        // Default to today if no filter is set
        finalStartDate = dayjs().format('YYYY-MM-DD');
        finalEndDate = dayjs().format('YYYY-MM-DD');
      }
      
      const params = { 
        filter: currentDateFilter,
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : undefined,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : undefined,
        status: activeTab || 'pending',
      };

      if (!online) {
        setStats({ ...defaultStats });
        return;
      }

      const response = await ordersAPI.getDineInStats(params);
      const payload = response.data?.data ?? response.data ?? {};
      const tabStatus = (activeTab || 'pending').toLowerCase();
      const isPendingTab = tabStatus === 'pending';
      
      const newStats = mergeStats({
        pending_payments: {
          count: isPendingTab ? (payload.pendingOrders || 0) : 0,
          total_amount: isPendingTab ? (payload.pendingRevenue || 0) : 0
        },
        received_payments: {
          count: !isPendingTab ? (payload.completedOrders || 0) : 0,
          total_amount: !isPendingTab ? (payload.completedRevenue || 0) : 0
        },
        total_orders: isPendingTab ? (payload.pendingOrders || 0) : (payload.completedOrders || 0),
        total_revenue: isPendingTab ? (payload.pendingRevenue || 0) : (payload.completedRevenue || 0),
        average_order_value: (isPendingTab ? (payload.pendingOrders || 0) : (payload.completedOrders || 0)) > 0
          ? ((isPendingTab ? (payload.pendingRevenue || 0) : (payload.completedRevenue || 0)) / (isPendingTab ? (payload.pendingOrders || 0) : (payload.completedOrders || 0)))
          : 0,
        cash_payments: {
          count: payload.cashStats?.count || 0,
          total_amount: payload.cashStats?.revenue || 0
        },
        bank_payments: {
          count: payload.bankStats?.count || 0,
          total_amount: payload.bankStats?.revenue || 0
        }
      });
      
      setStats(newStats);
    } catch (err) {
      // Set default stats if API fails
      setStats({ ...defaultStats });
    }
  }, [mergeStats, defaultStats, online, activeTab]); // Add activeTab so cards follow tab

  const isOfflineEffective = useCallback(() => {
    const browserOffline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    return !online || browserOffline;
  }, [online]);

  const fetchOrders = useCallback(async (tab = null) => {
    // If tab is not specified, use activeTab. Otherwise fetch for the specified tab
    const targetTab = tab || activeTab;
    setLoading(true);
    setError('');
    try {
      // Convert filter to date range - prioritize dateFilter over custom dates
      let finalStartDate = null;
      let finalEndDate = null;
      
      if (dateFilter && dateFilter !== 'custom') {
        // Use dateFilter if it's a quick filter (not custom)
        if (dateFilter === 'today') {
          finalStartDate = dayjs().format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (dateFilter === 'yesterday') {
          finalStartDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
          finalEndDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
        } else if (dateFilter === 'this_week') {
          finalStartDate = dayjs().startOf('week').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        } else if (dateFilter === 'this_month') {
          finalStartDate = dayjs().startOf('month').format('YYYY-MM-DD');
          finalEndDate = dayjs().format('YYYY-MM-DD');
        }
      } else if (dateFilter === 'custom' && startDate && endDate) {
        // Use custom dates only if custom filter is selected
        finalStartDate = startDate;
        finalEndDate = endDate;
      } else {
        // Custom without both dates: same as Delivery — effective range is today
        finalStartDate = dayjs().format('YYYY-MM-DD');
        finalEndDate = dayjs().format('YYYY-MM-DD');
      }
      
      const params = {
        status: targetTab,
        filter: dateFilter,
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : undefined,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : undefined
      };

      // Fetch API orders when online only (avoid stale cache offline)
      let apiOrders = [];
      if (online) {
        try {
          const response = await ordersAPI.getDineInStats({ ...params, useCache: false, disableCacheFallback: true });
          const payload = response.data?.data ?? response.data ?? {};
          apiOrders = (payload.orders || []).map(o => ({ ...o, offline: o.offline === true ? true : false }));
        } catch (err) {
          // Silently handle errors
        }
      }

      // Fetch offline orders only when offline; skip when online or in Electron to avoid stale data display
      // In Electron, all orders are in SQLite, so skip IndexedDB offline orders
      const isElectron = typeof window !== 'undefined' && window.electronAPI;
      const offlineOrders = (isElectron || online) ? [] : (
        await getOfflineOrders()
      ).filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include dine-in orders (not delivery)
          if (orderData.order_type === 'dine_in' || orderData.orderType === 'dine_in' || !orderData.order_type) {
            // Use the existing ID if it already starts with OFFLINE-, otherwise create a unique ID
            const existingId = offlineOrder.id || '';
            const uniqueOfflineId = (typeof existingId === 'string' && existingId.startsWith('OFFLINE-'))
              ? existingId
              : `OFFLINE-${existingId || index}-${offlineOrder.timestamp || Date.now()}`;
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

      // Filter offline orders by target tab
      const filteredOfflineOrders = offlineOrders.filter(o => {
        const isCompleted = o.orderStatus === 'completed' || o.orderStatus === 'cancelled' || o.paymentStatus === 'completed' || o.status === 'completed';
        if (targetTab === 'pending') {
          return !isCompleted;
        } else {
          return isCompleted;
        }
      });

      // Merge API and offline orders, remove duplicates by checking order_number and timestamp
      const allOrders = [...apiOrders];
      const apiOrderNumbers = new Set(apiOrders.map(o => o.order_number || o.orderNumber).filter(Boolean));

      filteredOfflineOrders.forEach(offlineOrder => {
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

      if (targetTab === 'pending') {
        setPendingOrders(allOrders);
      } else {
        setCompletedOrders(allOrders);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFilter, startDate, endDate, online]);

  // Fetch both pending and completed orders (for counts)
  const fetchAllOrders = useCallback(async (showLoading = true) => {
    // Prevent concurrent calls - but allow filter changes to proceed
    // CRITICAL: Only skip if we're showing loading AND already loading (prevents duplicate initial loads)
    // But allow filter changes (showLoading=false) to proceed even if loading
    if (isLoadingRef.current && hasInitialLoad.current && showLoading) {
      return;
    }

    // Set loading state BEFORE checking anything else
    if (showLoading) {
      isLoadingRef.current = true;
      setLoading(true);
    }

    // Always use the latest filter values from refs (not from closure)
    const currentDateFilter = dateFilterRef.current;
    const currentStartDate = startDateRef.current;
    const currentEndDate = endDateRef.current;

    try {
      // Convert filter to date range - prioritize dateFilter over custom dates
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
        finalStartDate = dayjs().format('YYYY-MM-DD');
        finalEndDate = dayjs().format('YYYY-MM-DD');
      }
      
      const params = { 
        filter: currentDateFilter,
        startDate: finalStartDate ? dayjs(finalStartDate).format('YYYY-MM-DD') : null,
        endDate: finalEndDate ? dayjs(finalEndDate).format('YYYY-MM-DD') : null
      };

      // Fetch API orders - CRITICAL: Fetch ALL orders (like getDineInStats does) and filter client-side
      // This ensures we get orders with status 'preparing' and 'ready' which should count as pending
      let pendingApiOrders = [];
      let completedApiOrders = [];
      if (online) {
        try {
          const [pendingRes, completedRes] = await Promise.all([
            ordersAPI.getDineInStats({ ...params, status: 'pending', useCache: false, disableCacheFallback: true }),
            ordersAPI.getDineInStats({ ...params, status: 'completed', useCache: false, disableCacheFallback: true }),
          ]);

          const pendingPayload = pendingRes.data?.data ?? pendingRes.data ?? {};
          const completedPayload = completedRes.data?.data ?? completedRes.data ?? {};

          pendingApiOrders = (pendingPayload.orders || []).map(o => ({ ...o, offline: o.offline === true ? true : false }));
          completedApiOrders = (completedPayload.orders || []).map(o => ({ ...o, offline: o.offline === true ? true : false }));
        } catch (err) {
          // Silently handle errors
        }
      }

      // Fetch offline orders only when offline; skip when online to avoid showing stale local orders
      const offlineOrders = online ? [] : (
        await getOfflineOrders()
      ).filter(offlineOrder => !offlineOrder.synced)
        .map((offlineOrder, index) => {
          const orderData = offlineOrder.data || offlineOrder;
          // Only include dine-in orders
          if (orderData.order_type === 'dine_in' || orderData.orderType === 'dine_in' || !orderData.order_type) {
            // Use the existing ID if it already starts with OFFLINE-, otherwise create a unique ID
            const existingId = offlineOrder.id || '';
            const uniqueOfflineId = (typeof existingId === 'string' && existingId.startsWith('OFFLINE-'))
              ? existingId
              : `OFFLINE-${existingId || index}-${offlineOrder.timestamp || Date.now()}`;

            // Determine order status - check multiple fields and prioritize completed status
            const orderStatus = orderData.orderStatus || orderData.order_status || orderData.status || 'pending';
            const paymentStatus = orderData.paymentStatus || orderData.payment_status || 'pending';

            // If payment is completed or order status is completed (or cancelled), mark as completed
            const isCompleted = orderStatus === 'completed' || orderStatus === 'cancelled' || paymentStatus === 'completed';

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
            offlineOrder.orderStatus === 'cancelled' ||
            offlineOrder.paymentStatus === 'completed' ||
            offlineOrder.status === 'completed';

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

      // Console log all fetched orders for debugging
      console.log('📦 [DineInOrders] fetchAllOrders - Fetched ALL orders', {
        filter: currentDateFilter,
        pendingCount: allPendingOrders.length,
        completedCount: allCompletedOrders.length,
        pendingOrders: allPendingOrders,
        completedOrders: allCompletedOrders,
      });

      setPendingOrders(allPendingOrders);
      setCompletedOrders(allCompletedOrders);
    } catch (err) {
      setError('Failed to load orders');
    } finally {
      // Always clear loading state and ref, regardless of showLoading flag
      isLoadingRef.current = false;
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [online]); // Remove dateFilter, startDate, endDate from dependencies - we use refs instead

  // Initial load - only once (handles React StrictMode double mount)
  useEffect(() => {
    // Prevent double loading in React StrictMode
    if (loadAttemptedRef.current) {
      // If we're skipping due to StrictMode remount, ensure loading is cleared
      setLoading(false);
      isLoadingRef.current = false;
      return;
    }
    
    // CRITICAL: Initialize refs BEFORE loading data to ensure fetchStats uses correct values
    dateFilterRef.current = dateFilter;
    startDateRef.current = startDate;
    endDateRef.current = endDate;
    
    loadAttemptedRef.current = true;

    const loadData = async () => {
      try {
        await Promise.all([
          fetchAllOrders(true),
          fetchStats()
        ]);
        hasInitialLoad.current = true;
      } catch (err) {
        setError('Failed to load orders');
      } finally {
        // Ensure loading is always cleared
        isLoadingRef.current = false;
        setLoading(false);
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  // Reload data when filters change (but not on initial mount)
  // Use a ref to track previous filter values to prevent unnecessary reloads
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

    // Prevent concurrent calls - if already loading, skip this update
    if (isLoadingRef.current) {
      return;
    }

    const loadData = async () => {
      // Ensure refs are definitely updated (safety check)
      dateFilterRef.current = dateFilter;
      startDateRef.current = startDate;
      endDateRef.current = endDate;
      
      try {
        // Force refetch with latest values - refs are already updated above
        // Call fetchStats FIRST to ensure it uses the latest refs
        await fetchStats();
        
        // CRITICAL: Call fetchAllOrders with showLoading=false to avoid the loading check skip
        // We already set isLoadingRef above, so we don't want to set it again
        isLoadingRef.current = false; // Reset first so fetchAllOrders can proceed
        await fetchAllOrders(false); // Pass false to avoid setting loading state again
      } catch (error) {
        // Silently handle errors
      } finally {
        isLoadingRef.current = false;
      }
    };
    
    // Execute immediately - refs are already updated synchronously above
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, startDate, endDate]); // Reload when filters change

  // Show offline pending orders notice (PWA sync) - Skip in Electron
  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && window.electronAPI;
    if (isElectron) return; // Skip offline sync notifications in Electron
    
    const checkOffline = async () => {
      if (offlineToastShown) return;
      try {
        const count = await getOfflineOrdersCount();
        if (count > 0) {
          showError(`You have ${count} offline order(s) pending sync. Keep the app open to sync when online.`);
          setOfflineToastShown(true);
        }
      } catch (err) {
        // Silently handle errors
      }
    };
    checkOffline();
  }, [offlineToastShown, showError]);

  // When coming back online, sync offline orders first, then refresh from database
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    // Only trigger if online status actually changed from false to true
    if (online && !prevOnlineRef.current && hasInitialLoad.current && !isUpdatingStatus.current && !isLoadingRef.current) {
      const syncAndRefresh = async () => {
        try {
          // First, sync pending operations (offline orders and updates) to the database
          const syncResult = await syncPendingOperations();

          // Only refresh orders from database if sync was successful (or no pending operations)
          if (syncResult && (syncResult.synced > 0 || syncResult.failed === 0)) {
            if (!isLoadingRef.current) {
              isLoadingRef.current = true;
              await Promise.all([
                fetchAllOrders(false), // Don't show loading state
                fetchStats()
              ]);
              isLoadingRef.current = false;
            }
            // After a successful sync, drop any remaining offline placeholders from view
            setPendingOrders(prev => prev.filter(o => !o.offline));
            setCompletedOrders(prev => prev.filter(o => !o.offline));
          } else if (syncResult && syncResult.failed > 0) {
            // Still refresh to show current state
            if (!isLoadingRef.current) {
              isLoadingRef.current = true;
              await Promise.all([
                fetchAllOrders(false),
                fetchStats()
              ]);
              isLoadingRef.current = false;
            }
          }
        } catch (error) {
          // Even if sync fails, try to refresh orders to show current state
          if (!isLoadingRef.current) {
            isLoadingRef.current = true;
            try {
              await Promise.all([
                fetchAllOrders(false),
                fetchStats()
              ]);
            } finally {
              isLoadingRef.current = false;
            }
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

  const handleDateFilterChange = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    setDateFilter('custom');
    setShowCustomRange(false);
  };

  const handleQuickFilter = (filter) => {
    if (filter === 'custom') {
      setDateFilter('custom');
      setShowCustomRange(true);
    } else {
      // Clear any loading state to prevent race conditions
      if (isLoadingRef.current) {
        isLoadingRef.current = false;
      }
      setDateFilter(filter);
      setStartDate(null);
      setEndDate(null);
      setShowCustomRange(false);
    }
  };

  const resetDateFilter = useCallback(() => {
    if (isLoadingRef.current) {
      isLoadingRef.current = false;
    }
    setDateFilter('today');
    setStartDate(null);
    setEndDate(null);
    setShowCustomRange(false);
  }, []);

  const clearAppliedCustomRange = useCallback(() => {
    if (isLoadingRef.current) {
      isLoadingRef.current = false;
    }
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
    
    console.log('💰 [DineInOrders] Mark as Paid - START:', {
      orderId: order.id,
      orderNumber: order.order_number || order.orderNumber,
      paymentMethod,
      amountTaken,
      totalAmount: order.totalAmount || order.total_amount
    });

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

      // Block marking paid offline for online-created orders
      if (isOfflineEffective() && !order.offline) {
        showError('This order was created online. Reconnect to mark it as paid.');
        setMarkingPaidId(null);
        return;
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
          console.log('💰 [DineInOrders] Mark as Paid - Calling API...', { orderId: order.id, payload });
          await ordersAPI.markAsPaid(order.id, payload);
          console.log('💰 [DineInOrders] Mark as Paid - API call successful');

          // Fetch updated order details for receipt and verification
          const orderResponse = await ordersAPI.getById(order.id);
          // Handle wrapped response format {success, data: {...}}
          updatedOrder = orderResponse.data.data || orderResponse.data;
          console.log('💰 [DineInOrders] Mark as Paid - Fetched updated order from database:', {
            orderId: updatedOrder?.id,
            paymentStatus: updatedOrder?.paymentStatus || updatedOrder?.payment_status,
            orderStatus: updatedOrder?.orderStatus || updatedOrder?.order_status,
            orderType: updatedOrder?.orderType || updatedOrder?.order_type
          });
          
          // Verify that orderStatus was set to 'completed' for dine-in orders
          if ((updatedOrder?.orderType || updatedOrder?.order_type) === 'dine_in') {
            const actualOrderStatus = updatedOrder?.orderStatus || updatedOrder?.order_status;
            if (actualOrderStatus !== 'completed') {
              console.warn('💰 [DineInOrders] Mark as Paid - WARNING: Order status not set to completed!', {
                expected: 'completed',
                actual: actualOrderStatus
              });
              // Force update order status to completed
              try {
                await ordersAPI.updateOrderStatus(order.id, 'completed');
                console.log('💰 [DineInOrders] Mark as Paid - Forced order status to completed');
                // Refetch to get updated order
                const recheckResponse = await ordersAPI.getById(order.id);
                updatedOrder = recheckResponse.data.data || recheckResponse.data;
              } catch (statusError) {
                console.error('💰 [DineInOrders] Mark as Paid - Failed to force order status:', statusError.message);
              }
            }
          }

          if (!updatedOrder) {
            throw new Error('Failed to fetch order details');
          }

          // Get order items
          const itemsResponse = await ordersAPI.getOrderItems(order.id);
          // Handle wrapped response format {success, data: [...]}
          orderItems = itemsResponse.data.data || itemsResponse.data || [];
          orderItems = Array.isArray(orderItems) ? orderItems : [];

          if (!orderItems || orderItems.length === 0) {
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
            console.error('💰 [DineInOrders] Mark as Paid - API call failed:', apiError.message);
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

            // Extract the real ID to use for pending sync (server ID if online-created, offline ID otherwise)
            const orderIdStr = typeof order.id === 'string' ? order.id : String(order.id || '');
            const realOfflineId = order.offlineId || (orderIdStr.startsWith('OFFLINE-')
              ? orderIdStr.replace(/^OFFLINE-/, '').split('-')[0]
              : orderIdStr);

            // Try to update offline order if it exists, otherwise create a pending operation
            try {
              // Update the order in IndexedDB with completed status (if it exists there)
              updatedOrder = await updateOfflineOrder(realOfflineId, {
                ...updatedData,
                offlineStatusUpdated: true
              });
            } catch (updateError) {
              // For online-created orders (no offline copy), just log
              updatedOrder = { ...order, ...updatedData };
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
      const totalAmount = parseFloat(updatedOrder?.total_amount || updatedOrder?.totalAmount || order.totalAmount || order.total_amount) || calculatedTotal;

      const returnAmount = paymentMethod === 'cash' && amountTaken
        ? parseFloat(amountTaken) - totalAmount
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

      // Update local state immediately so UI reflects payment completion (no page refresh)
      const updatedLocal = {
        ...order,
        payment_status: 'completed',
        paymentStatus: 'completed',
        order_status: 'completed',
        orderStatus: 'completed',
        offlineStatusUpdated: true,
        payment_method: paymentMethod,
        amount_taken: paymentMethod === 'cash' ? parseFloat(amountTaken) : null,
        return_amount: payload.returnAmount || 0
      };

      // Move order from pending to completed tab IMMEDIATELY
      setPendingOrders(prev => prev.filter(o => o.id !== order.id));
      setCompletedOrders(prev => {
        const exists = prev.find(o => o.id === order.id);
        return exists ? prev.map(o => o.id === order.id ? updatedLocal : o) : [...prev, updatedLocal];
      });

      // Free the table once paid/completed
      emitTableFreed(order);

      // Dispatch event to refresh badges immediately with updated status
      window.dispatchEvent(new CustomEvent('orderUpdated', {
        detail: { 
          orderType: 'dine_in', 
          orderId: order.id, 
          action: 'markedPaid',
          orderStatus: 'completed',
          paymentStatus: 'completed'
        }
      }));

      // Show appropriate success message based on online/offline status
      const isOfflineOrder = order.offline;
      if (isOfflineOrder) {
        showSuccess(`Order has been marked as paid and status updated to completed. Changes will sync when you are back online.`);
      } else {
        showSuccess(`Order has been marked as paid successfully`);
      }
      closePaymentModal();

      // Refresh stats and fetch all orders to ensure UI is in sync with database
      // This will refresh from database, but our updated filtering logic will keep paid orders in completed tab
      console.log('💰 [DineInOrders] Mark as Paid - Refetching stats and orders...');
      await Promise.all([
        fetchStats(),
        fetchAllOrders(false) // Refresh orders without showing loading state
      ]);
      console.log('💰 [DineInOrders] Mark as Paid - Stats and orders refreshed');
      
      // Dispatch another event after refresh to ensure badges are updated
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('orderUpdated', {
          detail: { 
            orderType: 'dine_in', 
            orderId: order.id, 
            action: 'markedPaid',
            orderStatus: 'completed',
            paymentStatus: 'completed'
          }
        }));
      }, 500);
      
      console.log('💰 [DineInOrders] Mark as Paid - COMPLETE');
    } catch (err) {
      console.error('💰 [DineInOrders] Mark as Paid - ERROR:', err.message);
      showError(err.formattedMessage || err.response?.data?.error || 'Failed to mark order as paid');
    } finally {
      setMarkingPaidId(null);
    }
  };

  const getReturnAmount = () => {
    if (paymentModal.paymentMethod !== 'cash' || !paymentModal.amountTaken) return 0;
    const total = parseFloat(paymentModal.order?.totalAmount || paymentModal.order?.total_amount || 0);
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

  const emitTableFreed = useCallback((orderObj) => {
    const tableNum = orderObj?.tableNumber || orderObj?.table_number;
    if (!tableNum) return;
    window.dispatchEvent(new CustomEvent('tableFreed', { detail: { tableNumber: tableNum } }));
  }, []);

  // Get duration color based on time
  const getDurationColor = (createdAt) => {
    const minutes = dayjs().diff(dayjs(createdAt), 'minute');
    if (minutes < 15) return '#28a745';
    if (minutes < 30) return '#ffc107';
    return '#dc3545';
  };

  // Handle status update
  const handleStatusUpdate = async (orderId, newStatus) => {
    if (activeTab === 'completed') return;
    console.log('🔄 [DineInOrders] Status Update - START:', {
      orderId,
      newStatus,
      timestamp: new Date().toISOString()
    });
    setUpdatingStatusId(orderId);
    isUpdatingStatus.current = true;
    try {
      const targetOrder = [...pendingOrders, ...completedOrders].find(o => o.id === orderId);
      const oldStatus = targetOrder?.orderStatus || targetOrder?.order_status || 'pending';
      
      if (!targetOrder) {
        console.error('🔄 [DineInOrders] Status Update - ERROR: Order not found!', { orderId });
        throw new Error('Order not found');
      }
      
      console.log('🔄 [DineInOrders] Status Update - Order details:', {
        orderId: targetOrder.id,
        orderNumber: targetOrder.order_number || targetOrder.orderNumber,
        oldStatus,
        newStatus
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
        const updatedOrder = { 
          ...currentOrder, 
          orderStatus: newStatus, 
          order_status: newStatus 
        };

        // Determine if order should move between tabs (completed and cancelled both go to Completed tab)
        const shouldBeInCompleted = newStatus === 'completed' || newStatus === 'cancelled';
        const currentlyInCompleted = activeTab === 'completed';

        // If order needs to move between tabs, update both states
        if (shouldBeInCompleted && !currentlyInCompleted) {
          // Move from pending to completed
          setPendingOrders(prev => prev.filter(o => !matchesOrderId(o)));
          setCompletedOrders(prev => {
            const exists = prev.find(matchesOrderId);
            return exists ? prev.map(o => matchesOrderId(o) ? updatedOrder : o) : [...prev, updatedOrder];
          });
        } else if (!shouldBeInCompleted && currentlyInCompleted) {
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
        const orderIdStr = typeof orderId === 'string' ? orderId : String(orderId);
        const realOrderId = orderIdStr.startsWith('OFFLINE-')
          ? (targetOrder?.offlineId || orderIdStr.replace(/^OFFLINE-.*?-/, ''))
          : orderIdStr;
        
        // Convert to number if it's a numeric string (for Electron API)
        const numericId = !isNaN(realOrderId) && !isNaN(parseInt(realOrderId)) ? parseInt(realOrderId) : realOrderId;
        
        // Update local state BEFORE API call for immediate UI feedback
        updateLocalState();
        
        // Make API call - use numeric ID for Electron
        console.log('🔄 [DineInOrders] Status Update - Calling API...', { id: numericId, status: newStatus });
        const apiResponse = await ordersAPI.updateOrderStatus(numericId, newStatus);
        console.log('🔄 [DineInOrders] Status Update - API call successful');
        
        // Verify by fetching the order from database
        try {
          const verifyResponse = await ordersAPI.getById(numericId);
          const verifiedOrder = verifyResponse?.data?.data || verifyResponse?.data;
          console.log('🔄 [DineInOrders] Status Update - Verified from database:', {
            orderId: verifiedOrder?.id,
            orderStatus: verifiedOrder?.orderStatus || verifiedOrder?.order_status,
            expectedStatus: newStatus,
            match: (verifiedOrder?.orderStatus || verifiedOrder?.order_status) === newStatus
          });
        } catch (verifyError) {
          console.warn('🔄 [DineInOrders] Status Update - Could not verify (non-critical):', verifyError.message);
        }
        
        showSuccess(`Order status updated to ${newStatus}`);

        // Free table if the order is now completed or cancelled
        if (newStatus === 'completed' || newStatus === 'cancelled') {
          emitTableFreed(targetOrder);
        }

        // Dispatch event to refresh badges immediately
        window.dispatchEvent(new CustomEvent('orderUpdated', {
          detail: { orderType: 'dine_in', orderId, newStatus }
        }));

        // Only refresh stats, not orders - local state already updated
        console.log('🔄 [DineInOrders] Status Update - Refetching stats...');
        fetchStats();
        console.log('🔄 [DineInOrders] Status Update - COMPLETE');
      } catch (error) {
        console.error('🔄 [DineInOrders] Status Update - ERROR:', error.message);
        
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
      console.error('🔄 [DineInOrders] Status Update - CRITICAL ERROR:', err.message);
      showError(err.formattedMessage || err.response?.data?.error || 'Failed to update order status');
    } finally {
      setUpdatingStatusId(null);
      isUpdatingStatus.current = false;
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

          // Update local state immediately (no page refresh)
          const updatedOrder = {
            ...targetOrder,
            order_status: 'cancelled',
            orderStatus: 'cancelled',
            status: 'cancelled',
            payment_status: 'cancelled',
            paymentStatus: 'cancelled'
          };

          // Move into completed list so user can still see it as cancelled
          setPendingOrders(prev => prev.filter(o => o.id !== orderId));
          setCompletedOrders(prev => {
            const exists = prev.find(o => o.id === orderId);
            if (exists) {
              return prev.map(o => (o.id === orderId ? updatedOrder : o));
            }
            return [...prev, updatedOrder];
          });

          if (targetOrder?.offline) {
            await updateOfflineOrder(targetOrder.offlineId || orderId, {
              order_status: 'cancelled',
              orderStatus: 'cancelled',
              status: 'cancelled',
              payment_status: 'cancelled',
              paymentStatus: 'cancelled'
            });
            showSuccess('Offline order cancelled locally');
          } else {
            await ordersAPI.cancelOrder(orderId);
            showSuccess('Order cancelled successfully');
          }

          // Free the table when order is cancelled
          emitTableFreed(targetOrder);

          // Dispatch event to refresh badges immediately
          window.dispatchEvent(new CustomEvent('orderUpdated', {
            detail: { orderType: 'dine_in', orderId, action: 'cancelled' }
          }));

          // Only refresh stats, not orders (already updated locally)
          fetchStats();
        } catch (err) {
          showError(err.formattedMessage || err.response?.data?.error || 'Failed to cancel order');
          // Revert local state on error
          await fetchAllOrders(false);
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

          await ordersAPI.update(orderId, {
            paymentStatus: 'pending',
            amountTaken: null,
            returnAmount: null
          });

          // Update local state immediately (no page refresh)
          const updatedOrder = {
            ...targetOrder,
            payment_status: 'pending',
            paymentStatus: 'pending',
            order_status: 'pending',
            orderStatus: 'pending',
            amount_taken: null,
            return_amount: null
          };

          // Move from completed to pending tab
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
          await fetchAllOrders(false);
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
        <h1 style={{ marginBottom: '1rem', color: '#2d3748', fontSize: '2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FaUtensils /> Dine-In Orders
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <FaMoneyBillWave /> Cash Payments
            </div>
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <FaUniversity /> Bank Payments
            </div>
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
              {/* Table badge at top for today's pending dine-in orders */}
              {activeTab === 'pending' && dateFilter === 'today' && (order.tableNumber || order.table_number) && (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '999px',
                    background: '#fff3cd',
                    color: '#856404',
                    fontSize: '0.8rem',
                    fontWeight: 600
                  }}
                >
                  Table #{order.tableNumber || order.table_number}
                </div>
              )}
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
                      <FaClock style={{ marginRight: '0.25rem' }} /> Waiting: {getOrderDuration(order.createdAt || order.created_at)}
                    </p>
                  )}
                  {order.order_status && (() => {
                    const status = order.orderStatus || order.order_status;
                    const StatusIcon = getStatusIcon(status);
                    return (
                      <div style={{
                        marginTop: '0.5rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '20px',
                        background: status === 'ready' ? '#d4edda' : status === 'preparing' ? '#fff3cd' : '#e2e3e5',
                        color: status === 'ready' ? '#155724' : status === 'preparing' ? '#856404' : '#383d41',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'capitalize'
                      }}>
                        <StatusIcon />
                        <span>Status: {status}</span>
                      </div>
                    );
                  })()}

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
                      <span><MdWifiOff /></span>
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
                  {(() => {
                    const isCancelled = order.orderStatus === 'cancelled' || order.order_status === 'cancelled' || 
                                       order.paymentStatus === 'cancelled' || order.payment_status === 'cancelled' ||
                                       order.status === 'cancelled';
                    const isPaid = order.paymentStatus === 'completed' || order.payment_status === 'completed';
                    if (isCancelled) {
                      return (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '20px',
                          background: '#fee2e2',
                          color: '#dc2626',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          display: 'inline-block'
                        }}>
                          Cancelled
                        </div>
                      );
                    }
                    return (
                      <div style={{
                        marginTop: '0.5rem',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '20px',
                        background: isPaid ? '#e6ffed' : '#fff4d8',
                        color: isPaid ? '#198754' : '#7c2d12',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        display: 'inline-block'
                      }}>
                        {isPaid ? 'Paid' : 'Pending Payment'}
                      </div>
                    );
                  })()}
                  {/* Display return amount if not zero */}
                  {(() => {
                    const returnAmt = order.returnAmount || order.return_amount || 0;
                    if (returnAmt !== 0) {
                      const isNegative = returnAmt < 0;
                      return (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.4rem 0.75rem',
                          borderRadius: '6px',
                          background: isNegative ? '#fee2e2' : '#d1fae5',
                          border: `1px solid ${isNegative ? '#dc2626' : '#10b981'}`,
                          color: isNegative ? '#dc2626' : '#10b981',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          display: 'inline-block'
                        }}>
                          {isNegative ? <><FaExclamationTriangle style={{ marginRight: '0.25rem' }} /> Restaurant Owed: </> : <><FaDollarSign style={{ marginRight: '0.25rem' }} /> Change Given: </>}
                          {formatCurrency(Math.abs(returnAmt))}
                        </div>
                      );
                    }
                    return null;
                  })()}
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

              {activeTab === 'pending' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Order Status Dropdown - Allow any status change */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#495057', minWidth: '80px' }}>
                      Status:
                    </label>
                    <select
                      value={(() => {
                        // Check all possible status fields to determine if cancelled
                        const orderStatus = order.orderStatus || order.order_status || 'pending';
                        const paymentStatus = order.paymentStatus || order.payment_status || 'pending';
                        const status = order.status || 'pending';
                        const isCancelled = orderStatus === 'cancelled' || paymentStatus === 'cancelled' || status === 'cancelled';
                        return isCancelled ? 'cancelled' : orderStatus;
                      })()}
                      onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                      disabled={updatingStatusId === order.id || 
                               (order.orderStatus === 'cancelled' || order.order_status === 'cancelled' ||
                                order.paymentStatus === 'cancelled' || order.payment_status === 'cancelled' ||
                                order.status === 'cancelled')}
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
                      <option value="pending">Pending</option>
                      <option value="preparing">Preparing</option>
                      <option value="ready">Ready</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => navigate(`${basePath}/orders?edit=${order.id}`)}
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
                      {cancellingOrderId === order.id ? 'Processing...' : <><FaTimes style={{ marginRight: '0.25rem' }} /> Cancel</>}
                    </button>
                  </div>

                  {(() => {
                    const isCancelled = order.orderStatus === 'cancelled' || order.order_status === 'cancelled';
                    const isPaid = (order.paymentStatus || order.payment_status) === 'completed';
                    const isServerOrder = order.offline !== true;
                    const offlineEffective = isOfflineEffective();
                    const disableMarkPaid = offlineEffective && isServerOrder;
                    const buttonTitle = disableMarkPaid
                      ? 'This order was created online. Reconnect to mark as paid.'
                      : undefined;
                    
                    // Don't show button if already paid or cancelled
                    if (isPaid || isCancelled) {
                      return null;
                    }
                    
                    return (
                      <button
                        onClick={() => openPaymentModal(order)}
                        disabled={markingPaidId === order.id || disableMarkPaid}
                        title={buttonTitle}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          border: 'none',
                          borderRadius: '8px',
                          background: 'var(--gradient-primary)',
                          color: 'white',
                          fontWeight: 'bold',
                          cursor: (markingPaidId === order.id || disableMarkPaid) ? 'not-allowed' : 'pointer',
                          fontSize: '1rem',
                          opacity: (markingPaidId === order.id || disableMarkPaid) ? 0.6 : 1
                        }}
                      >
                        {markingPaidId === order.id
                          ? 'Processing...'
                          : (disableMarkPaid ? <><FaDollarSign style={{ marginRight: '0.25rem' }} /> Mark as Paid (online only)</> : <><FaDollarSign style={{ marginRight: '0.25rem' }} /> Mark as Paid</>)}
                      </button>
                    );
                  })()}
                </div>
              )}

              {activeTab === 'completed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Order Status - static (read-only) in Completed tab */}
                  {(() => {
                    const orderStatus = order.orderStatus || order.order_status || 'completed';
                    const paymentStatus = order.paymentStatus || order.payment_status || 'pending';
                    const status = order.status || 'completed';
                    const isCancelled = orderStatus === 'cancelled' || paymentStatus === 'cancelled' || status === 'cancelled';
                    const displayStatus = isCancelled ? 'cancelled' : orderStatus;
                    const StatusIcon = getStatusIcon(displayStatus);
                    const badgeStyle = displayStatus === 'cancelled'
                      ? { background: '#fee2e2', color: '#dc2626' }
                      : displayStatus === 'ready' || displayStatus === 'completed'
                        ? { background: '#d4edda', color: '#155724' }
                        : displayStatus === 'preparing'
                          ? { background: '#fff3cd', color: '#856404' }
                          : { background: '#e2e3e5', color: '#383d41' };
                    return (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
                          ...badgeStyle
                        }}>
                          <StatusIcon />
                          <span>{displayStatus.replace(/_/g, ' ')}</span>
                        </div>
                      </div>
                    );
                  })()}

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
                          {' • Paid: '}{formatCurrency(order.amount_taken)}
                          {' • Total: '}{formatCurrency(order.total_amount)}
                          {(() => {
                            const amountTaken = parseFloat(order.amount_taken || 0);
                            const totalAmount = parseFloat(order.total_amount || 0);
                            const difference = amountTaken - totalAmount;

                            if (difference > 0) {
                              // Customer paid more than total - show change
                              return <> • Change: {formatCurrency(difference)}</>;
                            } else if (difference < 0) {
                              // Partial payment - show amount due
                              return <span style={{ color: '#dc3545', fontWeight: 'bold' }}> • Due: {formatCurrency(Math.abs(difference))}</span>;
                            }
                            // Exact payment - show nothing extra
                            return null;
                          })()}
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
                Total: {formatCurrency(paymentModal.order.totalAmount || paymentModal.order.total_amount)}
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

                {paymentModal.amountTaken && parseFloat(paymentModal.amountTaken) >= parseFloat(paymentModal.order.totalAmount || paymentModal.order.total_amount) && (
                  <div style={{
                    background: '#e6ffed',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                    border: '2px solid #28a745'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span>Total:</span>
                      <strong>{formatCurrency(paymentModal.order.totalAmount || paymentModal.order.total_amount)}</strong>
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
                    (paymentModal.paymentMethod === 'cash' && !paymentModal.amountTaken)
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