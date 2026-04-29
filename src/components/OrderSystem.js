import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { menuItemsAPI, ordersAPI, API_BASE_URL } from '../services/api';
import { printReceipt } from './Receipt';
import OfflineIndicator from './OfflineIndicator';
import { customerAPI } from '../services/customerAPI';
import { saveOfflineOrder, cacheMenuItems, getCachedMenuItems, getCachedTableAvailability, getOfflineOrderById, updateOfflineOrder, addPendingOperation, getAllOrders, cacheTableAvailability } from '../utils/offlineDB';
import { isOnline } from '../utils/offlineSync';
import { useToast } from '../contexts/ToastContext';
import { keyboardShortcuts } from '../utils/keyboardShortcuts';
import EmptyState from './EmptyState';
import CustomerAddressSelector from './CustomerAddressSelector';
import { Spinner } from './LoadingSkeleton';
import {
  FaUtensils,
  FaSearch,
  FaShoppingCart,
  FaSave,
  FaTruck,
  FaClipboard,
  FaExclamationTriangle,
  FaTag,
  FaStickyNote,
  FaLightbulb
} from 'react-icons/fa';

const createCartTemplate = (id, name = `Cart ${id}`) => ({
  id,
  name,
  items: [],
  paymentMethod: 'cash',
  amountTaken: '',
  specialInstructions: '',
  orderType: 'dine_in',
  tableNumber: '',
  autoTableNumber: false,
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

function getPosCartStorageKey() {
  try {
    const rawUser = localStorage.getItem('user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      const userId = parsed?.id ?? parsed?.userId ?? parsed?._id;
      if (userId !== null && userId !== undefined && String(userId).trim() !== '') {
        return `pos:carts:${String(userId)}`;
      }
    }
  } catch (e) {
    // ignore
  }
  return 'pos:carts:anonymous';
}

function computeNextCartIdFromList(cartsArr) {
  const maxId = (Array.isArray(cartsArr) ? cartsArr : [])
    .map(c => Number(c?.id) || 0)
    .reduce((acc, id) => Math.max(acc, id), 0);
  return Math.max(1, maxId + 1);
}

/** Sync read so first paint matches sessionStorage (avoids cart panel flash on remount). */
function readPersistedCartStateFromSession() {
  try {
    const key = getPosCartStorageKey();
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const storedCarts = parsed?.carts;
    const storedActiveCartId = parsed?.activeCartId;
    const storedNextCartId = parsed?.nextCartId;
    if (!Array.isArray(storedCarts) || storedCarts.length === 0) return null;

    const normalizedCarts = storedCarts
      .filter(c => c && typeof c === 'object')
      .map((c, idx) => ({
        ...createCartTemplate(Number(c.id) || (idx + 1), c.name || `Cart ${Number(c.id) || (idx + 1)}`),
        ...c,
        id: Number(c.id) || (idx + 1),
        items: Array.isArray(c.items) ? c.items : [],
      }));

    const fallbackActiveId = normalizedCarts[0]?.id || 1;
    const desiredActiveId = Number(storedActiveCartId) || fallbackActiveId;
    const finalActiveId = normalizedCarts.some(c => c.id === desiredActiveId) ? desiredActiveId : fallbackActiveId;
    const computedNext = computeNextCartIdFromList(normalizedCarts);
    const safeNext = Number(storedNextCartId) || computedNext;

    return {
      carts: normalizedCarts,
      activeCartId: finalActiveId,
      nextCartId: Math.max(computedNext, safeNext),
    };
  } catch (e) {
    try {
      sessionStorage.removeItem(getPosCartStorageKey());
    } catch (_) {
      // ignore
    }
    return null;
  }
}

function getInitialCartSlice() {
  const p = readPersistedCartStateFromSession();
  if (p) return p;
  return {
    carts: [createCartTemplate(1, 'Cart 1')],
    activeCartId: 1,
    nextCartId: 2,
  };
}

/** Survives OrderSystem unmount when navigating away from POS routes (same SPA session). */
let lastMenuItemsSnapshot = null;

const OrderSystem = ({ basePath = '/manager' }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showSuccess, showError, showInfo } = useToast();
  const [menuItems, setMenuItems] = useState(() => lastMenuItemsSnapshot ?? []);
  const [menuInitialLoading, setMenuInitialLoading] = useState(
    () => !((lastMenuItemsSnapshot?.length) > 0)
  );

  // Helper function to get initials for fallback image
  const getInitials = (name) => {
    if (!name) return '';
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  // Helper to normalize image list for an item (supports single or multiple images)
  const getItemImages = (item) => {
    if (!item) return [];

    // Prefer explicit images array fields if present
    if (Array.isArray(item.images) && item.images.length > 0) {
      return item.images
        .filter(Boolean)
        .map(img => (typeof img === 'string' ? img : img.url || img.imageUrl || img.path))
        .filter(Boolean);
    }

    if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
      return item.imageUrls.filter(Boolean);
    }

    if (item.gallery && Array.isArray(item.gallery) && item.gallery.length > 0) {
      return item.gallery.filter(Boolean);
    }

    // Fallback to single imageUrl if available
    if (item.imageUrl) {
      return [item.imageUrl];
    }

    return [];
  };

  // Add these missing state variables
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const searchDebounceRef = useRef(null);

  const initialCartSliceRef = useRef(null);
  if (initialCartSliceRef.current === null) {
    initialCartSliceRef.current = getInitialCartSlice();
  }
  const initialCartSlice = initialCartSliceRef.current;
  const [carts, setCarts] = useState(initialCartSlice.carts);
  const [activeCartId, setActiveCartId] = useState(initialCartSlice.activeCartId);
  const [nextCartId, setNextCartId] = useState(initialCartSlice.nextCartId);
  const [checkoutError, setCheckoutError] = useState('');
  const checkoutSubmittingRef = useRef(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editLoadError, setEditLoadError] = useState('');
  const [occupiedTables, setOccupiedTables] = useState([]);
  const [phoneSuggestions, setPhoneSuggestions] = useState([]);
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [phoneSearchLoading, setPhoneSearchLoading] = useState(false);
  const [nameSearchLoading, setNameSearchLoading] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [selectedItemImageIndex, setSelectedItemImageIndex] = useState(0);
  const reserveTableRef = useRef(null);
  const releaseTableRef = useRef(null);
  const updateCustomerDebounceRef = useRef(null);
  const cartPersistDebounceRef = useRef(null);

  const getCartStorageKey = useCallback(() => getPosCartStorageKey(), []);

  const clearPersistedCartState = useCallback(() => {
    try {
      const key = getCartStorageKey();
      sessionStorage.removeItem(key);
    } catch (e) {}
  }, [getCartStorageKey]);

  // Persist carts to sessionStorage (session-only, per user)
  useEffect(() => {
    const key = getCartStorageKey();

    if (cartPersistDebounceRef.current) {
      clearTimeout(cartPersistDebounceRef.current);
    }

    cartPersistDebounceRef.current = setTimeout(() => {
      try {
        const payload = JSON.stringify({ carts, activeCartId, nextCartId });
        sessionStorage.setItem(key, payload);
      } catch (e) {
        // Ignore quota / serialization errors.
      }
    }, 250);

    return () => {
      if (cartPersistDebounceRef.current) {
        clearTimeout(cartPersistDebounceRef.current);
      }
    };
  }, [carts, activeCartId, nextCartId, getCartStorageKey]);

  // Cart tabs horizontal scrolling helper (when there are many carts)
  const cartTabsScrollRef = useRef(null);
  const [showCartTabsRightArrow, setShowCartTabsRightArrow] = useState(false);
  const updateCartTabsRightArrow = useCallback(() => {
    const el = cartTabsScrollRef.current;
    if (!el) return;
    const hasMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 5;
    setShowCartTabsRightArrow(hasMore);
  }, []);
  const scrollCartTabsRight = useCallback(() => {
    const el = cartTabsScrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: Math.max(200, el.clientWidth * 0.8),
      behavior: 'smooth'
    });
  }, []);

  const activeCart = carts.find(c => c.id === activeCartId) || carts[0];
  const cart = activeCart.items;
  const amountTaken = activeCart.amountTaken;
  const specialInstructions = activeCart.specialInstructions;
  const orderType = activeCart.orderType || 'dine_in';
  const tableNumber = activeCart.tableNumber || '';
  const autoTableNumber = !!activeCart.autoTableNumber;
  const deliveryName = activeCart.deliveryName || '';
  const deliveryPhone = activeCart.deliveryPhone || '';
  const deliveryBackupPhone = activeCart.deliveryBackupPhone || '';
  // Ensure deliveryAddress is always a string (handle object case from CustomerAddressSelector)
  const deliveryAddress = typeof activeCart.deliveryAddress === 'string' 
    ? activeCart.deliveryAddress 
    : (typeof activeCart.deliveryAddress === 'object' && activeCart.deliveryAddress?.address 
      ? activeCart.deliveryAddress.address 
      : '');
  const deliveryNotes = activeCart.deliveryNotes || '';
  const googleMapsLink = activeCart.googleMapsLink || '';
  const deliveryCharge = activeCart.deliveryCharge === 0 ? '0' : (activeCart.deliveryCharge || '');
  const deliveryPaymentType = activeCart.deliveryPaymentType || 'cod';
  const discountPercent = activeCart.discountPercent || 0;
  const isDelivery = orderType === 'delivery';
  const parsedDeliveryCharge = deliveryCharge === '' ? 0 : (parseFloat(deliveryCharge) || 0);

  const getLocalDateKey = useCallback((value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

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
            orderNumber: t.orderNumber || t.order_number,
            createdAt: t.createdAt || t.created_at || t.orderDate || t.order_date || null,
          }));

          // Only treat tables as occupied if the pending dine-in order is from today (local time)
          const todayKey = getLocalDateKey(new Date());
          const withOrderDates = await Promise.all(
            normalizedTables.map(async (t) => {
              const alreadyHasDateKey = getLocalDateKey(t.createdAt);
              if (alreadyHasDateKey) return t;

              const id = t.orderId || t.id;
              if (!id) return t;

              try {
                const orderRes = await ordersAPI.getById(id);
                const order = orderRes.data?.data ?? orderRes.data ?? {};
                const created = order.createdAt || order.created_at || order.orderDate || order.order_date || null;
                return { ...t, createdAt: created };
              } catch (e) {
                // If we can't fetch the order date, be conservative and keep it occupied
                return t;
              }
            })
          );

          const filteredTables = withOrderDates.filter((t) => {
            const key = getLocalDateKey(t.createdAt);
            return key && key === todayKey;
          });

          setOccupiedTables(filteredTables);
          // Persist latest server state to offline cache so going offline reflects reality
          try {
            await cacheTableAvailability(filteredTables);
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
  }, [isDelivery, getLocalDateKey]);

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



  const updateActiveCart = useCallback((updates) => {
    setCarts(prevCarts =>
      prevCarts.map(c =>
        c.id === activeCartId ? { ...c, ...updates } : c
      )
    );
  }, [activeCartId]);

  const setSpecialInstructions = (instructions) => {
    updateActiveCart({ specialInstructions: instructions });
  };

  // Auto-select first available table when switching to dine-in
  useEffect(() => {
    if (isDelivery || editingOrder) return; // Don't auto-select if delivery or editing existing order

    // If "takeaway" is selected manually, never auto-switch it.
    // If it was auto-selected (because all tables were full), allow auto-switching
    // when a table becomes available again.
    if (tableNumber === 'takeaway' && !autoTableNumber) return;

    // If a numeric table is already selected and available, keep it
    if (tableNumber) {
      const tableNum = parseInt(tableNumber);
      if (!isNaN(tableNum)) {
        const isOccupied = occupiedTables.some(t => {
          const occupiedTableNum = t.tableNumber || t.table_number;
          if (occupiedTableNum === null || occupiedTableNum === undefined) return false;
          return String(occupiedTableNum) === String(tableNum);
        });
        if (!isOccupied) {
          return; // Current table is available, keep it
        }
      }
    }
    
    // Find first available table (1-9)
    const allTables = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const availableTable = allTables.find(tableNum => {
      return !occupiedTables.some(t => {
        const occupiedTableNum = t.tableNumber || t.table_number;
        if (occupiedTableNum === null || occupiedTableNum === undefined) return false;
        return String(occupiedTableNum) === String(tableNum);
      });
    });
    
    // Select first available table, or "takeaway" if all are occupied
    if (availableTable !== undefined) {
      updateActiveCart({ tableNumber: availableTable.toString(), autoTableNumber: true });
    } else {
      updateActiveCart({ tableNumber: 'takeaway', autoTableNumber: true });
    }
  }, [isDelivery, occupiedTables, editingOrder, tableNumber, autoTableNumber, updateActiveCart]); // Re-run when order type or occupied tables change

  useEffect(() => {
    // Re-check if the cart tabs row overflows whenever carts change.
    updateCartTabsRightArrow();
  }, [carts.length, activeCartId, updateCartTabsRightArrow]);

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

  // Debounced function to update customer data when fields change
  const updateCustomerData = useCallback(async () => {
    if (!selectedCustomer || !selectedCustomer.id) return;
    
    const customerIdStr = String(selectedCustomer.id ?? '');
    const isOfflineId = typeof selectedCustomer.id === 'string' && customerIdStr.startsWith('OFFLINE-');
    
    // Don't update if offline customer
    if (isOfflineId) return;
    
    try {
      const updateData = {};
      
      // Update customer fields if they've changed
      if (deliveryName.trim() && deliveryName.trim() !== selectedCustomer.name) {
        updateData.name = deliveryName.trim();
      }
      if (deliveryPhone.trim() && deliveryPhone.trim().replace(/\s+/g, '') !== selectedCustomer.phone?.replace(/\s+/g, '')) {
        updateData.phone = deliveryPhone.trim().replace(/\s+/g, '');
      }
      if (deliveryBackupPhone.trim() !== (selectedCustomer.backupPhone || selectedCustomer.backup_phone || '')) {
        updateData.backupPhone = deliveryBackupPhone.trim() || undefined;
      }
      if (deliveryNotes.trim() !== (selectedCustomer.notes || '')) {
        updateData.notes = deliveryNotes.trim() || undefined;
      }
      if (googleMapsLink.trim() && googleMapsLink.trim() !== (selectedCustomer.googleLink || selectedCustomer.google_link || '')) {
        updateData.googleLink = googleMapsLink.trim();
      }
      
      // Only update if there are changes
      if (Object.keys(updateData).length > 0) {
        await customerAPI.update(selectedCustomer.id, updateData);
        
        // Reload customer to get updated data
        const response = await customerAPI.getById(selectedCustomer.id);
        const updatedCustomer = response.data?.data || response.data;
        setSelectedCustomer(updatedCustomer);
      }
      
      // Also update address if address changed and has googleMapsLink
      const safeDeliveryAddress = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
      const safeGoogleMapsLink = typeof googleMapsLink === 'string' ? googleMapsLink.trim() : '';
      if (safeDeliveryAddress && safeGoogleMapsLink) {
        const customerResponse = await customerAPI.getById(selectedCustomer.id);
        const customer = customerResponse.data?.data || customerResponse.data;
        if (customer && customer.addresses && customer.addresses.length > 0) {
          const matchingAddress = customer.addresses.find(addr => 
            addr.address && addr.address.trim().toLowerCase() === safeDeliveryAddress.toLowerCase()
          );
          
          if (matchingAddress && (!matchingAddress.googleMapsLink || !matchingAddress.google_maps_link)) {
            try {
              await customerAPI.updateAddress(matchingAddress.id, {
                googleMapsLink: googleMapsLink.trim()
              });
            } catch (updateErr) {
              console.warn('Failed to update customer address with Google Maps link:', updateErr);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Failed to update customer data:', err);
      // Don't show error to user - this is a background update
    }
  }, [selectedCustomer, deliveryName, deliveryPhone, deliveryBackupPhone, deliveryNotes, googleMapsLink, deliveryAddress]);

  const handleDeliveryFieldChange = (field, value) => {
    updateActiveCart({ [field]: value });
    setCheckoutError('');
    
    // Debounce customer update when fields change (only if customer is selected)
    if (selectedCustomer && selectedCustomer.id) {
      if (updateCustomerDebounceRef.current) {
        clearTimeout(updateCustomerDebounceRef.current);
      }
      updateCustomerDebounceRef.current = setTimeout(() => {
        updateCustomerData();
      }, 2000); // Wait 2 seconds after user stops typing
    }
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

    // Any direct user selection should disable "auto table" behavior for takeaway.
    updateActiveCart({ tableNumber: value, autoTableNumber: false });
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

  const DELIVERY_NOTES_MAX_LENGTH = 300;

  const normalizeLikelyUrl = (raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(www\.|maps\.|google\.)/i.test(s)) return `https://${s}`;
    return s;
  };

  const isValidGoogleMapsLink = (raw) => {
    const normalized = normalizeLikelyUrl(raw);
    if (!normalized) return true; // optional field
    try {
      const url = new URL(normalized);
      if (!(url.protocol === 'http:' || url.protocol === 'https:')) return false;

      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();
      const isAllowedHost =
        host === 'goo.gl' ||
        host.endsWith('.goo.gl') ||
        host === 'maps.app.goo.gl' ||
        host === 'google.com' ||
        host.endsWith('.google.com');

      if (!isAllowedHost) return false;
      // For google.com links, expect a maps path or typical maps redirect params
      if (host.includes('google.com')) {
        const hasMapsPath = path.includes('/maps') || path.startsWith('/maps');
        const hasMapsQuery = url.searchParams.has('q') || url.searchParams.has('query') || url.searchParams.has('destination');
        if (!hasMapsPath && !hasMapsQuery) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const validateDeliveryFields = () => {
    const safeDeliveryName = typeof deliveryName === 'string' ? deliveryName.trim() : '';
    const safeDeliveryPhone = typeof deliveryPhone === 'string' ? deliveryPhone.trim() : '';
    const safeDeliveryAddress = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
    const safeDeliveryNotes = typeof deliveryNotes === 'string' ? deliveryNotes : '';
    const safeGoogleMapsLink = typeof googleMapsLink === 'string' ? googleMapsLink.trim() : '';
    
    if (!safeDeliveryName) {
      return 'Delivery customer name is required.';
    }
    if (!safeDeliveryPhone) {
      return 'Phone number is required.';
    }
    // Check length first
    const cleanedPhone = safeDeliveryPhone.replace(/\s+/g, '').replace(/[^0-9]/g, '');
    if (cleanedPhone.length > 11) {
      return 'Phone number must be maximum 11 digits (e.g., 03001234567).';
    }
    if (!phoneIsValid(safeDeliveryPhone)) {
      return 'Enter a valid phone number (10-11 digits starting with 0 or 3, e.g., 03001234567).';
    }
    if (!safeDeliveryAddress) {
      return 'Delivery address is required.';
    }
    if (safeDeliveryNotes.length > DELIVERY_NOTES_MAX_LENGTH) {
      return `Notes / Instructions must be ${DELIVERY_NOTES_MAX_LENGTH} characters or less.`;
    }
    if (safeGoogleMapsLink && !isValidGoogleMapsLink(safeGoogleMapsLink)) {
      return 'Please paste a valid Google Maps link (starting with http/https).';
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
    // Don't clear selectedCustomer when editing - let the update function handle it
    // Only clear address if no customer is selected
    if (!selectedCustomer) {
      handleDeliveryFieldChange('deliveryAddress', '');
    }
  };

  // Handle name search for suggestions
  const handleNameSearch = useCallback(async (nameValue) => {
    const trimmedName = nameValue.trim();
    if (trimmedName.length < 1) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      setSelectedCustomer(null);
      return;
    }

    setNameSearchLoading(true);
    try {
      let customers = [];

      // Check if offline - use cached customers
      if (!isOnline()) {
        const { getCachedCustomers } = await import('../utils/offlineDB');
        const cachedCustomers = await getCachedCustomers();
        // Filter customers by name (case-insensitive partial match)
        const normalizedSearch = trimmedName.toLowerCase();
        customers = cachedCustomers.filter(c => {
          const customerName = (c.name || '').toLowerCase();
          return customerName.includes(normalizedSearch);
        }).slice(0, 10);
      } else {
        // Online - use API (search by name or phone)
        try {
          const response = await customerAPI.search(trimmedName);
          customers = response.data?.data || response.data || [];

          // Filter to prioritize name matches
          const normalizedSearch = trimmedName.toLowerCase();
          customers = customers.filter(c => {
            const customerName = (c.name || '').toLowerCase();
            return customerName.includes(normalizedSearch);
          }).slice(0, 10);

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
            const normalizedSearch = trimmedName.toLowerCase();
            customers = cachedCustomers.filter(c => {
              const customerName = (c.name || '').toLowerCase();
              return customerName.includes(normalizedSearch);
            }).slice(0, 10);
          } else {
            throw apiErr;
          }
        }
      }

      setNameSuggestions(Array.isArray(customers) ? customers : []);
      setShowNameSuggestions(true);
    } catch (err) {
      console.error('Failed to search customers by name:', err);
      setNameSuggestions([]);
    } finally {
      setNameSearchLoading(false);
    }
  }, []);

  // Handle name input change
  const handleNameChange = (value) => {
    handleDeliveryFieldChange('deliveryName', value);
    handleNameSearch(value);
    // Don't clear selectedCustomer when editing - let the update function handle it
    // Only clear address if no customer is selected
    if (!selectedCustomer) {
      handleDeliveryFieldChange('deliveryAddress', '');
    }
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

        // Set Google Maps link from customer's google_link or first address's googleMapsLink
        const customerMapsLink = fullCustomer.googleLink || fullCustomer.google_link;
        const addressMapsLink = fullCustomer.addresses && fullCustomer.addresses.length > 0
          ? (fullCustomer.addresses[0].googleMapsLink || fullCustomer.addresses[0].google_maps_link)
          : null;
        const mapsLink = customerMapsLink || addressMapsLink;
        if (mapsLink) {
          updateActiveCart({ googleMapsLink: mapsLink });
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

        // Set Google Maps link from customer's google_link or first address's googleMapsLink
        const customerMapsLink = customer.googleLink || customer.google_link;
        const addressMapsLink = customer.addresses && customer.addresses.length > 0
          ? (customer.addresses[0].googleMapsLink || customer.addresses[0].google_maps_link)
          : null;
        const mapsLink = customerMapsLink || addressMapsLink;
        if (mapsLink) {
          updateActiveCart({ googleMapsLink: mapsLink });
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

      // Set Google Maps link from customer's google_link or first address's googleMapsLink
      const customerMapsLink = customer.googleLink || customer.google_link;
      const addressMapsLink = customer.addresses && customer.addresses.length > 0
        ? (customer.addresses[0].googleMapsLink || customer.addresses[0].google_maps_link)
        : null;
      const mapsLink = customerMapsLink || addressMapsLink;
      if (mapsLink) {
        updateActiveCart({ googleMapsLink: mapsLink });
      }
    }
  }, [updateActiveCart]);

  const normalizeCustomerName = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  };

  const normalizeCustomerPhone = (value) => {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  };

  const normalizeCustomerAddress = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ');
  };

  const autoCreateCustomerRef = useRef({
    lastKey: '',
    inFlight: false,
  });

  const ensureDeliveryCustomer = async () => {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

    const name = (typeof deliveryName === 'string' ? deliveryName.trim() : '') || 'Delivery Customer';
    const phoneRaw = typeof deliveryPhone === 'string' ? deliveryPhone.trim() : '';
    const phone = normalizeCustomerPhone(phoneRaw);
    const backup = (typeof deliveryBackupPhone === 'string' ? deliveryBackupPhone.trim() : '').replace(/\s+/g, '') || '';
    const address = normalizeCustomerAddress(typeof deliveryAddress === 'string' ? deliveryAddress : '');
    const notes = (typeof deliveryNotes === 'string' ? deliveryNotes.trim() : '') || '';
    const mapsLink = (typeof googleMapsLink === 'string' ? googleMapsLink.trim() : '') || '';

    if (!phone) {
      throw new Error('Customer phone is required');
    }

    const normName = normalizeCustomerName(name);
    const normPhone = phone;

    const hasAddress = !!address;
    const online = isElectron ? true : await isOnline();

    // OFFLINE: use cached customers keyed by (name + phone)
    if (!online) {
      try {
        const { getCachedCustomers, saveCustomer, addPendingOperation } = await import('../utils/offlineDB');
        const cachedCustomers = await getCachedCustomers();

        const existingCustomer = cachedCustomers.find(c => {
          return normalizeCustomerPhone(String(c.phone || '')) === normPhone &&
            normalizeCustomerName(String(c.name || '')) === normName;
        });

        if (existingCustomer) {
          if (hasAddress) {
            const existingAddresses = Array.isArray(existingCustomer.addresses) ? existingCustomer.addresses : [];
            const addressExists = existingAddresses.some(addr =>
              normalizeCustomerAddress(String(addr?.address || '')) === address
            );

            // Legacy address field match
            const legacyAddress = normalizeCustomerAddress(String(existingCustomer.address || ''));
            const legacyMatches = legacyAddress && legacyAddress === address;

            if (!addressExists && !legacyMatches) {
              // Update cached customer to include the new address in-memory
              const newAddr = { address, isDefault: existingAddresses.length === 0, googleMapsLink: mapsLink || null };
              const updatedCustomer = {
                ...existingCustomer,
                address: existingCustomer.address || address,
                addresses: [...existingAddresses, newAddr],
              };
              await saveCustomer(updatedCustomer);

              // Queue address update for sync
              await addPendingOperation({
                type: 'update_customer_address',
                endpoint: `/api/customers/${existingCustomer.id}/addresses`,
                method: 'POST',
                data: { address, googleMapsLink: mapsLink || undefined }
              });
            }
          }

          return existingCustomer.id;
        }

        // Create offline customer (new because (name+phone) doesn't match)
        const offlineCustomerId = `OFFLINE-CUSTOMER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newCustomer = {
          id: offlineCustomerId,
          phone,
          name: name || 'Delivery Customer',
          backupPhone: backup || null,
          addresses: hasAddress ? [{ address, isDefault: true, googleMapsLink: mapsLink || null }] : [],
          address: hasAddress ? address : '',
          notes: notes || null,
          googleLink: mapsLink || null,
          synced: false,
          createdAt: new Date().toISOString()
        };

        await saveCustomer(newCustomer);

        // Queue customer creation for sync
        await addPendingOperation({
          type: 'create_customer',
          endpoint: '/api/customers',
          method: 'POST',
          data: {
            phone,
            name: name || undefined,
            address: hasAddress ? address : undefined,
            backupPhone: backup || undefined,
            notes: notes || undefined,
            googleLink: mapsLink || undefined,
            googleMapsLink: mapsLink || undefined,
          },
          offlineId: offlineCustomerId
        });

        return offlineCustomerId;
      } catch (offlineErr) {
        console.error('Failed to handle customer offline:', offlineErr);
        return `OFFLINE-CUSTOMER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
    }

    // ONLINE: match by (name + phone). If match, update/add address; else create new.
    try {
      let candidates = [];
      try {
        const res = await customerAPI.searchByPhone(phone, 25);
        candidates = res.data?.data || res.data || [];
      } catch (searchErr) {
        candidates = [];
      }

      const match = Array.isArray(candidates) ? candidates.find(c => {
        return normalizeCustomerPhone(String(c.phone || '')) === normPhone &&
          normalizeCustomerName(String(c.name || '')) === normName;
      }) : null;

      if (match && match.id) {
        // Same (name + phone) -> reuse, but update address if different
        if (hasAddress) {
          const legacyAddress = normalizeCustomerAddress(String(match.address || ''));
          const addresses = Array.isArray(match.addresses) ? match.addresses : [];
          const addressExists = addresses.some(a => normalizeCustomerAddress(String(a?.address || '')) === address);
          const legacyMatches = legacyAddress && legacyAddress === address;

          if (!addressExists && !legacyMatches) {
            // Electron currently persists legacy customer.address via update; HTTP can also accept this field.
            try {
              await customerAPI.update(match.id, { address });
            } catch (updateErr) {
              // If update fails, ignore; order can still proceed.
            }
          }
        }

        // Also update non-identity fields (backup/notes/maps) if provided
        const updateData = {};
        if (backup) updateData.backupPhone = backup;
        if (notes) updateData.notes = notes;
        if (mapsLink) updateData.googleLink = mapsLink;
        if (Object.keys(updateData).length > 0) {
          try {
            await customerAPI.update(match.id, updateData);
          } catch (e) {}
        }

        return match.id;
      }

      // Not found by (name+phone) => create a NEW customer
      const createPayload = {
        phone,
        name,
        backupPhone: backup || undefined,
        address: hasAddress ? address : undefined,
        notes: notes || undefined,
        googleLink: mapsLink || undefined,
        googleMapsLink: mapsLink || undefined,
      };

      const createRes = await customerAPI.create(createPayload);
      const created = createRes.data?.data || createRes.data;
      const createdId = created?.id;
      if (!createdId) {
        throw new Error('Customer create failed');
      }

      // If Electron create didn't persist google_link, update it
      if (mapsLink) {
        try {
          await customerAPI.update(createdId, { googleLink: mapsLink });
        } catch (e) {}
      }

      return createdId;
    } catch (err) {
      console.error('Failed to ensure delivery customer:', err);
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      throw new Error(errorMsg || 'Unable to process customer information');
    }
  };

  const autoEnsureDeliveryCustomer = useCallback(async () => {
    // Only auto-create when user is manually typing (no selected customer yet)
    if (selectedCustomer && selectedCustomer.id) return;

    const nameRaw = typeof deliveryName === 'string' ? deliveryName : '';
    const phoneRaw = typeof deliveryPhone === 'string' ? deliveryPhone : '';
    const addressRaw = typeof deliveryAddress === 'string' ? deliveryAddress : '';

    const name = nameRaw.trim();
    const phone = phoneRaw.trim();
    const address = normalizeCustomerAddress(addressRaw);

    if (!name || !phone || !address) return;
    if (!phoneIsValid(phone)) return;

    const key = `${normalizeCustomerName(name)}|${normalizeCustomerPhone(phone)}|${address}`;
    if (autoCreateCustomerRef.current.inFlight) return;
    if (autoCreateCustomerRef.current.lastKey === key) return;

    autoCreateCustomerRef.current.inFlight = true;
    try {
      // Create or locate customer using existing checkout helper (will be updated to name+phone matching)
      const customerId = await ensureDeliveryCustomer();
      if (!customerId) return;

      // Load full customer and set it as selected so addresses & updates work immediately
      try {
        const res = await customerAPI.getById(customerId);
        const fullCustomer = res.data?.data || res.data;
        if (fullCustomer) {
          setSelectedCustomer(fullCustomer);
        } else {
          setSelectedCustomer({ id: customerId, name, phone, address });
        }
      } catch (err) {
        setSelectedCustomer({ id: customerId, name, phone, address });
      }

      autoCreateCustomerRef.current.lastKey = key;
    } catch (err) {
      // Silent: user can still place order and ensureDeliveryCustomer will run again
    } finally {
      autoCreateCustomerRef.current.inFlight = false;
    }
  }, [selectedCustomer, deliveryName, deliveryPhone, deliveryAddress, ensureDeliveryCustomer]);

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

        orderDetails = orderRes.data?.data ?? orderRes.data ?? {};
        itemDetails = (itemsRes.data?.data ?? itemsRes.data ?? []).map(item => ({
          id: item.menuItemId || item.menu_item_id,
          name: item.itemName || item.name || item.item_name,
          price: Number(item.price) || 0,
          quantity: item.quantity || 1
        }));
      }

      if (!orderDetails || !orderDetails.id) {
        setEditLoadError('Order not found.');
        setEditingOrder(null);
        setEditLoading(false);
        return;
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

  const getNextAvailableCartId = useCallback((existingCarts) => {
    const used = new Set((existingCarts || []).map(c => c.id));
    let id = 1;
    while (used.has(id)) id += 1;
    return id;
  }, []);

  const addNewCart = () => {
    const id = getNextAvailableCartId(carts);
    const newCart = createCartTemplate(id, `Cart ${id}`);
    setCarts([...carts, newCart]);
    setActiveCartId(id);
    setNextCartId(getNextAvailableCartId([...carts, newCart]));
  };

  const removeCart = (cartId) => {
    if (carts.length === 1) {
      setCarts([createCartTemplate(1, 'Cart 1')]);
      setActiveCartId(1);
      return;
    }

    const newCarts = carts.filter(c => c.id !== cartId);
    setCarts(newCarts);
    setNextCartId(getNextAvailableCartId(newCarts));

    if (cartId === activeCartId) {
      setActiveCartId(newCarts[0].id);
    }
  };

  const switchToCart = (cartId) => {
    setActiveCartId(cartId);
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const hadSnapshot = (lastMenuItemsSnapshot?.length ?? 0) > 0;

      if (!hadSnapshot) {
        const cached = await getCachedMenuItems();
        if (cancelled) return;
        if (cached.length > 0) {
          lastMenuItemsSnapshot = cached;
          setMenuItems(cached);
          setMenuInitialLoading(false);
        }
      } else {
        setMenuInitialLoading(false);
      }

      try {
        const response = await menuItemsAPI.getAll();
        if (cancelled) return;
        const items = Array.isArray(response.data) ? response.data : (response.data?.data || []);
        lastMenuItemsSnapshot = items;
        setMenuItems(items);
        await cacheMenuItems(items);
      } catch (error) {
        console.error('Error fetching menu items:', error);
        if (cancelled) return;
        const cached = await getCachedMenuItems();
        if (cached.length > 0) {
          lastMenuItemsSnapshot = cached;
          setMenuItems(cached);
        }
      } finally {
        if (!cancelled) {
          setMenuInitialLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
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

    if (checkoutSubmittingRef.current) return;
    checkoutSubmittingRef.current = true;
    setCheckoutSubmitting(true);

    try {
      const subtotal = subtotalAmount; // Use memoized value
      const deliveryChargeValue = deliveryFee; // Use memoized value
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
            deliveryAddress: typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '',
            deliveryNotes: typeof deliveryNotes === 'string' ? deliveryNotes.trim() : undefined,
            googleMapsLink: typeof googleMapsLink === 'string' ? googleMapsLink.trim() : undefined,
            deliveryCharge: deliveryChargeValue
          }),
          ...(!isDelivery && {
            tableNumber: tableNumber || undefined
          }),
          specialInstructions: typeof specialInstructions === 'string' ? specialInstructions.trim() : undefined,
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
            showSuccess(`Order has been updated successfully!`);
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
                const message = error.formattedMessage || error.response?.data?.error || error.message || 'Failed to update order. Please try again.';
                setCheckoutError(message);
                return;
              }
            } else {
              const message = error.formattedMessage || error.response?.data?.error || error.message || 'Failed to update order. Please try again.';
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
            deliveryAddress: typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '',
            deliveryNotes: typeof deliveryNotes === 'string' ? deliveryNotes.trim() : undefined,
            googleMapsLink: typeof googleMapsLink === 'string' ? googleMapsLink.trim() : undefined,
            deliveryCharge: deliveryChargeValue
          }),
          ...(!isDelivery && {
            tableNumber: tableNumber || undefined
          }),
          specialInstructions: typeof specialInstructions === 'string' ? specialInstructions.trim() : undefined,
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
              deliveryAddress: orderData.deliveryAddress && typeof orderData.deliveryAddress === 'string' && orderData.deliveryAddress.trim() !== '' ? orderData.deliveryAddress : undefined,
              deliveryNotes: orderData.deliveryNotes && typeof orderData.deliveryNotes === 'string' && orderData.deliveryNotes.trim() !== '' ? orderData.deliveryNotes : undefined,
              googleMapsLink: orderData.googleMapsLink && typeof orderData.googleMapsLink === 'string' && orderData.googleMapsLink.trim() !== '' ? orderData.googleMapsLink : undefined,
              specialInstructions: orderData.specialInstructions && typeof orderData.specialInstructions === 'string' && orderData.specialInstructions.trim() !== '' ? orderData.specialInstructions : undefined,
            };

            console.log('Creating order with cleaned data:', cleanedOrderData);
            const response = await ordersAPI.create(cleanedOrderData);
            orderId = response.data.data?.id;
            orderNumber = response.data.data?.orderNumber || response.data.data?.order_number;

            if (!orderId) {
              throw new Error('Order was created but no ID was returned from server');
            }

            showSuccess(`Order #${orderNumber || orderId} created successfully!`);

                // Update customer with Google Maps link and stats if delivery order
            if (isDelivery && customerId) {
              try {
                // Update customer's google_link field if provided
                const safeGoogleMapsLink = typeof googleMapsLink === 'string' ? googleMapsLink.trim() : '';
                if (safeGoogleMapsLink) {
                  try {
                    await customerAPI.update(customerId, {
                      googleLink: safeGoogleMapsLink
                    });
                  } catch (updateErr) {
                    console.warn('Failed to update customer google_link:', updateErr);
                  }
                }

                // Update customer address with Google Maps link if provided
                const customerResponse = await customerAPI.getById(customerId);
                const customer = customerResponse.data?.data || customerResponse.data;
                const safeDeliveryAddress = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
                if (customer && customer.addresses && customer.addresses.length > 0) {
                  // Find the address that matches the delivery address
                  const matchingAddress = customer.addresses.find(addr => 
                    addr.address && addr.address.trim().toLowerCase() === safeDeliveryAddress.toLowerCase()
                  );
                  
                  if (matchingAddress && (!matchingAddress.googleMapsLink || !matchingAddress.google_maps_link)) {
                    // Update the address with the Google Maps link
                    try {
                      await customerAPI.updateAddress(matchingAddress.id, {
                        googleMapsLink: safeGoogleMapsLink
                      });
                    } catch (updateErr) {
                      console.warn('Failed to update customer address with Google Maps link:', updateErr);
                    }
                  } else if (!matchingAddress && safeDeliveryAddress) {
                    // Create a new address with the Google Maps link
                    try {
                      await customerAPI.createAddress(customerId, {
                        address: safeDeliveryAddress,
                        googleMapsLink: safeGoogleMapsLink,
                        isDefault: false
                      });
                    } catch (createErr) {
                      console.warn('Failed to create customer address with Google Maps link:', createErr);
                    }
                  }
                }
              } catch (err) {
                console.warn('Failed to update customer details:', err);
                // Don't fail the order creation if this fails
              }
            }

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
              // showInfo('Order saved offline. It will sync when you are back online.');

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
          // showInfo('Order saved offline. It will sync when you are back online.');

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
        special_instructions: typeof specialInstructions === 'string' ? specialInstructions : '',
        offline: isOffline,
        order_type: orderType,
        customer_name: isDelivery ? (typeof deliveryName === 'string' ? deliveryName.trim() : '') : null,
        customer_phone: isDelivery ? (typeof deliveryPhone === 'string' ? deliveryPhone.trim() : '') : null,
        customer_address: isDelivery ? (typeof deliveryAddress === 'string' ? deliveryAddress : '') : null,
        delivery_notes: isDelivery ? (typeof deliveryNotes === 'string' ? deliveryNotes : '') : '',
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
      clearPersistedCartState();

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
      showError(error.formattedMessage || error.message || 'Error during checkout. Please try again.');
      setCheckoutError(error.formattedMessage || 'An unexpected error occurred. Please try again.');
    } finally {
      checkoutSubmittingRef.current = false;
      setCheckoutSubmitting(false);
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
    // Don't filter by availability - show all items (available and unavailable)
    // Only filter by category and search term
    const filtered = menuItems.filter(item => {
      const matchesCategory = selectedCategory ? item.category?.name === selectedCategory : true;
      const matchesSearch = debouncedSearchTerm
        ? item.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        : true;
      return matchesCategory && matchesSearch;
    });
    
    // Log filtering for debugging
    if (menuItems.length > 0) {
      console.log('🍽️ [OrderSystem] Filtering items:', {
        totalItems: menuItems.length,
        selectedCategory: selectedCategory || 'All',
        searchTerm: debouncedSearchTerm || 'None',
        filteredCount: filtered.length,
        availableItems: menuItems.filter(i => i.available === 1 || i.available === true).length,
        unavailableItems: menuItems.filter(i => !(i.available === 1 || i.available === true)).length,
        categories: [...new Set(menuItems.map(i => i.category?.name).filter(Boolean))]
      });
    }
    
    return filtered;
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
    (typeof deliveryName === 'string' ? deliveryName.trim() : '') &&
    phoneIsValid(deliveryPhone) &&
    (typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '')
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
    ? (isDelivery ? <><FaSave style={{ marginRight: '0.25rem' }} /> Update Delivery Order</> : <><FaSave style={{ marginRight: '0.25rem' }} /> Update Order</>)
    : (isDelivery ? <><FaTruck style={{ marginRight: '0.25rem' }} /> Create Delivery Order</> : <><FaUtensils style={{ marginRight: '0.25rem' }} /> Create Dine-In Order</>);

  const canSubmitOrderBase = cart.length > 0 && deliveryFormComplete && !editLoading && !isSelectedTableOccupied;
  const canSubmitOrder = canSubmitOrderBase && !checkoutSubmitting;

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

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (updateCustomerDebounceRef.current) {
        clearTimeout(updateCustomerDebounceRef.current);
      }
    };
  }, []);


  return (
    <>
      <OfflineIndicator />

      <div style={{
        position: 'fixed',
        top: '110px',
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
                placeholder="Search menu items..."
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
                  border: '3px solid',
                  borderColor: selectedCategory === '' ? 'var(--color-primary)' : 'var(--color-border)',
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
                    border: '3px solid',
                    borderColor: selectedCategory === category ? 'var(--color-primary)' : 'var(--color-border)',
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
            position: 'relative',
            overflowY: 'auto',
            padding: '1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: '1rem',
            alignContent: 'start'
          }}>
            {menuInitialLoading && menuItems.length === 0 ? (
              <div style={{
                gridColumn: '1 / -1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '3rem',
                gap: '1rem',
                color: '#6c757d'
              }}>
                <Spinner size="lg" />
                <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>Loading menu…</div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '3rem',
                color: '#6c757d'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}><FaSearch /></div>
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
                  onClick={() => {
                    setSelectedMenuItem(item);
                    setSelectedItemImageIndex(0);
                    setIsItemModalOpen(true);
                  }}
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
                    minHeight: '300px',
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
                        src={item.imageUrl?.startsWith('http') ? item.imageUrl : (API_BASE_URL !== 'IPC' ? `${API_BASE_URL}${item.imageUrl}` : item.imageUrl)}
                        alt={item.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'center'
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
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
                    marginTop: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      color: 'var(--color-primary)'
                    }}>
                      PKR {parseFloat(item.price).toFixed(2)}
                    </div>
                    <button
                      disabled={!(item.available === 1 || item.available === true)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.available === 1 || item.available === true) addToCart(item);
                      }}
                      style={{
                        background: (item.available === 1 || item.available === true) ? 'var(--gradient-primary)' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.6rem 0.8rem',
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        cursor: (item.available === 1 || item.available === true) ? 'pointer' : 'not-allowed',
                        opacity: (item.available === 1 || item.available === true) ? 1 : 0.7,
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.35rem',
                        width: '100%',
                        marginTop: '0.15rem'
                      }}
                      onMouseEnter={(e) => {
                        if (item.available === 1 || item.available === true) e.currentTarget.style.transform = 'scale(1.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                    >
                      <span>{(item.available === 1 || item.available === true) ? 'Add to Cart' : 'Unavailable'}</span>
                      {(item.available === 1 || item.available === true) && <span style={{ fontSize: '0.9rem' }}>+</span>}
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
          <div style={{ position: 'relative' }}>
            <div
              ref={cartTabsScrollRef}
              onScroll={updateCartTabsRightArrow}
              style={{
                background: 'var(--gradient-primary)',
                display: 'flex',
                alignItems: 'flex-end',
                overflowX: 'auto',
                overflowY: 'hidden',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                padding: '0.5rem 56px 0 0.5rem',
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
                    <span style={{ flexShrink: 0 }}><FaShoppingCart /></span>
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
                      type="button"
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
                type="button"
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

            {showCartTabsRightArrow && (
              <button
                type="button"
                onClick={scrollCartTabsRight}
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: '0.25rem',
                  transform: 'translateY(-50%)',
                  zIndex: 2,
                  background: 'rgba(255,255,255,0.35)',
                  border: 'none',
                  color: 'white',
                  width: '44px',
                  height: '44px',
                  borderRadius: '999px',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.55)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.35)';
                }}
                aria-label="Scroll carts to the right"
                title="Scroll carts to the right"
              >
                <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>›</span>
              </button>
            )}
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
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem'
                }}>
                  <Spinner size="sm" />
                  <div>Loading order details...</div>
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
                        <FaExclamationTriangle style={{ marginRight: '0.25rem' }} /> This table has a pending order
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Delivery Details</h3>
                    <p style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>
                      Capture customer info directly on the ticket.
                    </p>
                  </div>
                  <button
                    disabled={!deliveryFormComplete}
                    onClick={() => {
                      if (!deliveryFormComplete) return;
                      const formattedText = `Full Name: ${deliveryName || 'N/A'}
Phone: ${deliveryPhone || 'N/A'}
Backup Phone: ${deliveryBackupPhone || 'N/A'}
Address: ${deliveryAddress || 'N/A'}
Notes / Instructions: ${deliveryNotes || 'N/A'}
Google Maps Link: ${googleMapsLink || 'N/A'}
Payment Status: ${deliveryPaymentType === 'cod' ? 'COD (Pending)' : 'Prepaid (Paid)'}
Subtotal: PKR ${subtotalAmount.toFixed(0)}
Delivery Charge: PKR ${deliveryFee.toFixed(0)}
Total: PKR ${grandTotalAmount.toFixed(0)}`;
                      navigator.clipboard.writeText(formattedText).then(() => {
                        showSuccess('Delivery details copied to clipboard!');
                      }).catch(() => {
                        showError('Failed to copy to clipboard');
                      });
                    }}
                    style={{
                      background: deliveryFormComplete ? 'var(--gradient-primary)' : '#e9ecef',
                      color: deliveryFormComplete ? 'white' : '#adb5bd',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.5rem 1rem',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: deliveryFormComplete ? 'pointer' : 'not-allowed',
                      opacity: deliveryFormComplete ? 1 : 0.7,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                      if (!deliveryFormComplete) return;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      if (!deliveryFormComplete) return;
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title={deliveryFormComplete ? 'Copy all delivery details' : 'Fill required fields to enable copy'}
                  >
                    <span><FaClipboard /></span>
                    <span>Copy</span>
                  </button>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem'
                }}>
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontWeight: 600 }}>
                      Full Name*
                      <input
                        type="text"
                        value={deliveryName}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleNameChange(val);
                        }}
                        onFocus={() => {
                          if (deliveryName.trim().length >= 1) {
                            setShowNameSuggestions(true);
                            // Trigger search if there's already text
                            if (deliveryName.trim().length >= 1) {
                              handleNameSearch(deliveryName);
                            }
                          }
                        }}
                        onBlur={(e) => {
                          // Don't hide if clicking inside the suggestions dropdown
                          const relatedTarget = e.relatedTarget || document.activeElement;
                          const suggestionsContainer = e.currentTarget.parentElement?.querySelector('[data-name-suggestions]');
                          if (suggestionsContainer && suggestionsContainer.contains(relatedTarget)) {
                            return;
                          }
                          // Delay hiding suggestions to allow click
                          setTimeout(() => setShowNameSuggestions(false), 200);
                        }}
                        placeholder="Start typing customer name..."
                        style={{
                          width: '100%',
                          marginTop: '0.35rem',
                          padding: '0.85rem',
                          borderRadius: '10px',
                          border: '2px solid #e2e8f0'
                        }}
                      />
                    </label>
                    {showNameSuggestions && nameSuggestions.length > 0 && (
                      <div
                        data-name-suggestions
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
                        {nameSuggestions.map((customer) => (
                          <div
                            key={customer.id || customer.phone}
                            onClick={() => {
                              handleCustomerSelect(customer);
                              setShowNameSuggestions(false);
                            }}
                            style={{
                              padding: '0.75rem 1rem',
                              cursor: 'pointer',
                              borderBottom: '1px solid #f1f3f5',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#f8f9fa';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'white';
                            }}
                          >
                            <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                              {customer.name || 'Unnamed Customer'}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>
                              {customer.phone}
                              {customer.backupPhone || customer.backup_phone ? ` • ${customer.backupPhone || customer.backup_phone}` : ''}
                            </div>
                            {customer.address && (
                              <div style={{ fontSize: '0.8rem', color: '#868e96', marginTop: '0.25rem' }}>
                                {customer.address.slice(0, 60)}
                                {customer.address.length > 60 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {nameSearchLoading && (
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
                        fontSize: '0.85rem',
                        color: '#6c757d'
                      }}>
                        Searching...
                      </div>
                    )}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontWeight: 600 }}>
                      Phone*
                      <input
                        onWheel={(e) => e.target.blur()}
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={deliveryPhone}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^[0-9]+$/.test(val)) {
                            handlePhoneChange(val);
                          }
                        }}
                        onKeyPress={(e) => {
                          if (!/[0-9]/.test(e.key)) {
                            e.preventDefault();
                          }
                        }}
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
                      onWheel={(e) => e.target.blur()}
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={deliveryBackupPhone}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^[0-9]+$/.test(val)) {
                          handleDeliveryFieldChange('deliveryBackupPhone', val);
                        }
                      }}
                      onKeyPress={(e) => {
                        if (!/[0-9]/.test(e.key)) {
                          e.preventDefault();
                        }
                      }}
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
                      onBlur={() => {
                        // If user typed delivery info manually (no selection), auto-create the customer
                        autoEnsureDeliveryCustomer();
                      }}
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
                    onChange={(e) => {
                      const nextRaw = e.target.value ?? '';
                      const next = String(nextRaw).slice(0, DELIVERY_NOTES_MAX_LENGTH);
                      handleDeliveryFieldChange('deliveryNotes', next);
                    }}
                    placeholder="Gate 2, call when outside, etc."
                    rows="3"
                    style={{
                      width: '100%',
                      marginTop: '0.35rem',
                      padding: '0.85rem',
                      borderRadius: '10px',
                      border: (typeof deliveryNotes === 'string' && deliveryNotes.length > DELIVERY_NOTES_MAX_LENGTH) ? '2px solid #dc3545' : '2px solid #e2e8f0',
                      resize: 'vertical'
                    }}
                  />
                  <small style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '0.25rem',
                    color: (typeof deliveryNotes === 'string' && deliveryNotes.length > DELIVERY_NOTES_MAX_LENGTH) ? '#dc3545' : '#6c757d',
                    fontSize: '0.85rem'
                  }}>
                    <span>
                      {(typeof deliveryNotes === 'string' && deliveryNotes.length > DELIVERY_NOTES_MAX_LENGTH)
                        ? `Notes are too long. Max ${DELIVERY_NOTES_MAX_LENGTH} characters.`
                        : 'Optional. Keep it short for the rider.'}
                    </span>
                    <span style={{ marginLeft: '0.75rem', whiteSpace: 'nowrap' }}>
                      {(typeof deliveryNotes === 'string' ? deliveryNotes.length : 0)}/{DELIVERY_NOTES_MAX_LENGTH}
                    </span>
                  </small>
                </label>

                  <label style={{ fontWeight: 600 }}>
                  Google Maps Link
                  <input
                    type="url"
                    value={googleMapsLink}
                    onChange={(e) => {
                      handleDeliveryFieldChange('googleMapsLink', e.target.value);
                      // Also update customer's google_link immediately if customer is selected
                      if (selectedCustomer && selectedCustomer.id) {
                        // Clear previous debounce
                        if (updateCustomerDebounceRef.current) {
                          clearTimeout(updateCustomerDebounceRef.current);
                        }
                        // Update immediately for Google Maps link (shorter delay)
                        updateCustomerDebounceRef.current = setTimeout(() => {
                          updateCustomerData();
                        }, 1000); // 1 second delay for Google Maps link
                      }
                    }}
                    onBlur={(e) => {
                      const normalized = normalizeLikelyUrl(e.target.value);
                      if (normalized !== e.target.value) {
                        handleDeliveryFieldChange('googleMapsLink', normalized);
                      }
                    }}
                    placeholder="https://maps.google.com/..."
                    style={{
                      width: '100%',
                      marginTop: '0.35rem',
                      padding: '0.85rem',
                      borderRadius: '10px',
                      border: (typeof googleMapsLink === 'string' && googleMapsLink.trim() && !isValidGoogleMapsLink(googleMapsLink)) ? '2px solid #dc3545' : '2px solid #e2e8f0',
                      fontSize: '0.9rem'
                    }}
                  />
                  <small style={{ display: 'block', marginTop: '0.25rem', color: '#6c757d', fontSize: '0.85rem' }}>
                    {(typeof googleMapsLink === 'string' && googleMapsLink.trim() && !isValidGoogleMapsLink(googleMapsLink))
                      ? 'Invalid link. Paste a Google Maps URL (e.g., maps.google.com, google.com/maps, maps.app.goo.gl).'
                      : 'Paste the Google Maps link for the delivery address. This will be saved to the customer’s profile automatically.'}
                  </small>
                </label>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                      Delivery Charge (PKR)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={deliveryCharge}
                      onWheel={(e) => e.target.blur()}
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
                  icon={<FaShoppingCart />}
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
                      <FaTag style={{ marginRight: '0.25rem' }} /> Discount Percentage (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={discountPercent || ''}
                      onWheel={(e) => e.target.blur()}
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
                      <FaStickyNote style={{ marginRight: '0.25rem' }} /> Special Instructions (Optional)
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
                      <strong><FaLightbulb style={{ marginRight: '0.25rem' }} /> Dine-In Order</strong>
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
                    type="button"
                    onClick={handleCheckout}
                    disabled={!canSubmitOrder}
                    aria-busy={checkoutSubmitting}
                    title={isSelectedTableOccupied ? `Table #${tableNumber} is already reserved. Please select a different table.` : undefined}
                    style={{
                      width: '100%',
                      padding: '0.85rem',
                      border: 'none',
                      borderRadius: '10px',
                      background: checkoutSubmitting
                        ? 'var(--gradient-primary)'
                        : canSubmitOrderBase
                          ? 'var(--gradient-primary)'
                          : isSelectedTableOccupied
                            ? '#ffc107'
                            : 'var(--color-border)',
                      color: 'white',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      cursor: checkoutSubmitting ? 'wait' : canSubmitOrderBase ? 'pointer' : 'not-allowed',
                      transition: 'all 0.3s',
                      boxShadow: canSubmitOrderBase && !checkoutSubmitting ? 'var(--shadow-md)' : checkoutSubmitting ? 'var(--shadow-md)' : 'none',
                      opacity: checkoutSubmitting ? 0.92 : 1,
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem'
                    }}
                    onMouseEnter={(e) => {
                      if (canSubmitOrderBase && !checkoutSubmitting) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                        e.currentTarget.style.background = 'var(--color-primary-dark)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (canSubmitOrderBase && !checkoutSubmitting) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        e.currentTarget.style.background = 'var(--gradient-primary)';
                      }
                    }}
                  >
                    {checkoutSubmitting ? (
                      <>
                        <Spinner size="sm" />
                        <span>Processing…</span>
                      </>
                    ) : (
                      checkoutButtonLabel
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Item Detail Modal */}
      {isItemModalOpen && selectedMenuItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            setIsItemModalOpen(false);
            setSelectedMenuItem(null);
            setSelectedItemImageIndex(0);
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '16px',
              maxWidth: '900px',
              width: '95%',
              height: '80vh',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'row',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left: Image / Slider */}
            <div
              style={{
                flex: 1.1,
                background: '#fff',
                position: 'relative',
                minHeight: 0,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {(() => {
                const images = getItemImages(selectedMenuItem);
                const hasImages = images.length > 0;
                const currentImage = hasImages
                  ? images[Math.max(0, Math.min(selectedItemImageIndex, images.length - 1))]
                  : null;

                const resolveImageUrl = (url) => {
                  if (!url) return null;
                  if (url.startsWith('http')) return url;
                  return API_BASE_URL !== 'IPC' ? `${API_BASE_URL}${url}` : url;
                };

                return (
                  <>
                    <div
                      style={{
                        flex: 1,
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#fff',
                      }}
                    >
                      {currentImage ? (
                        <img
                          src={resolveImageUrl(currentImage)}
                          alt={selectedMenuItem.name}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain',
                          }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background:
                              'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            padding: '1.5rem',
                            textAlign: 'center',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '3rem',
                              fontWeight: 700,
                              marginBottom: '0.5rem',
                            }}
                          >
                            {getInitials(selectedMenuItem.name)}
                          </div>
                          <div
                            style={{
                              fontSize: '1rem',
                              fontWeight: 500,
                              opacity: 0.9,
                              maxWidth: '90%',
                              lineHeight: 1.4,
                            }}
                          >
                            {selectedMenuItem.name}
                          </div>
                        </div>
                      )}

                      {/* Slider controls */}
                      {hasImages && images.length > 1 && (
                        <>
                          <button
                            onClick={() =>
                              setSelectedItemImageIndex((prev) =>
                                prev === 0 ? images.length - 1 : prev - 1
                              )
                            }
                            style={{
                              position: 'absolute',
                              left: '10px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: 'rgba(0,0,0,0.6)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '999px',
                              width: '36px',
                              height: '36px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1.2rem',
                            }}
                          >
                            ‹
                          </button>
                          <button
                            onClick={() =>
                              setSelectedItemImageIndex((prev) =>
                                prev === images.length - 1 ? 0 : prev + 1
                              )
                            }
                            style={{
                              position: 'absolute',
                              right: '10px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: 'rgba(0,0,0,0.6)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '999px',
                              width: '36px',
                              height: '36px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1.2rem',
                            }}
                          >
                            ›
                          </button>
                        </>
                      )}
                    </div>

                    {/* Thumbnails */}
                    {hasImages && images.length > 1 && (
                      <div
                        style={{
                          padding: '0.5rem 0.75rem 0.75rem',
                          display: 'flex',
                          gap: '0.4rem',
                          overflowX: 'auto',
                          background: '#050505',
                        }}
                      >
                        {images.map((img, index) => (
                          <button
                            key={`${img}-${index}`}
                            onClick={() => setSelectedItemImageIndex(index)}
                            style={{
                              border:
                                index === selectedItemImageIndex
                                  ? '2px solid #f8f9fa'
                                  : '2px solid transparent',
                              padding: 0,
                              borderRadius: '8px',
                              overflow: 'hidden',
                              cursor: 'pointer',
                              background: 'transparent',
                              minWidth: '64px',
                              height: '48px',
                            }}
                          >
                            <img
                              src={resolveImageUrl(img)}
                              alt=""
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                              }}
                              onError={(e) => {
                                e.target.style.display = 'none';
                              }}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Right: Details */}
            <div
              style={{
                flex: 1,
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                position: 'relative',
                height: '100%',
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
              {/* Close button */}
              <button
                onClick={() => {
                  setIsItemModalOpen(false);
                  setSelectedMenuItem(null);
                  setSelectedItemImageIndex(0);
                }}
                style={{
                  position: 'sticky',
                  top: '0.75rem',
                  alignSelf: 'flex-end',
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#6c757d',
                  zIndex: 1,
                }}
              >
                ×
              </button>

              <div
                style={{
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 600,
                  color: 'var(--color-primary)',
                }}
              >
                {selectedMenuItem.category?.name || 'Menu Item'}
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  color: '#212529',
                }}
              >
                {selectedMenuItem.name}
              </h2>

              <div
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                }}
              >
                PKR {parseFloat(selectedMenuItem.price || 0).toFixed(2)}
              </div>

              {selectedMenuItem.description && (
                <p
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.9rem',
                    color: '#495057',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {selectedMenuItem.description}
                </p>
              )}

              {/* Extra info */}
              <div
                style={{
                  marginTop: '0.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  fontSize: '0.85rem',
                  color: '#6c757d',
                }}
              >
                {selectedMenuItem.code && (
                  <div>
                    <strong style={{ color: '#495057' }}>Code:</strong>{' '}
                    {selectedMenuItem.code}
                  </div>
                )}
                {typeof selectedMenuItem.available !== 'undefined' && (
                  <div>
                    <strong style={{ color: '#495057' }}>Availability:</strong>{' '}
                    <span
                      style={{
                        color:
                          selectedMenuItem.available === 1 ||
                          selectedMenuItem.available === true
                            ? '#198754'
                            : '#dc3545',
                        fontWeight: 600,
                      }}
                    >
                      {selectedMenuItem.available === 1 ||
                      selectedMenuItem.available === true
                        ? 'Available'
                        : 'Unavailable'}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ flex: 1 }} />

              {/* Actions */}
              <button
                disabled={!(selectedMenuItem.available === 1 || selectedMenuItem.available === true)}
                onClick={() => {
                  if (selectedMenuItem.available === 1 || selectedMenuItem.available === true) {
                    addToCart(selectedMenuItem);
                    setIsItemModalOpen(false);
                    setSelectedMenuItem(null);
                    setSelectedItemImageIndex(0);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  border: 'none',
                  borderRadius: '12px',
                  background: (selectedMenuItem.available === 1 || selectedMenuItem.available === true) ? 'var(--gradient-primary)' : '#ccc',
                  color: 'white',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: (selectedMenuItem.available === 1 || selectedMenuItem.available === true) ? 'pointer' : 'not-allowed',
                  opacity: (selectedMenuItem.available === 1 || selectedMenuItem.available === true) ? 1 : 0.7,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: 'var(--shadow-md)',
                  marginTop: '0.75rem',
                }}
                onMouseEnter={(e) => {
                  if (selectedMenuItem.available === 1 || selectedMenuItem.available === true) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                }}
              >
                <span>{(selectedMenuItem.available === 1 || selectedMenuItem.available === true) ? 'Add to Cart' : 'Unavailable'}</span>
                {(selectedMenuItem.available === 1 || selectedMenuItem.available === true) && <span style={{ fontSize: '1.1rem' }}>+</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OrderSystem;