import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ordersAPI, expensesAPI, usersAPI, categoriesAPI, menuItemsAPI, authAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { getPublicAssetUrl } from '../utils/publicAssetUrl';
import ConfirmationModal from './ConfirmationModal';
import CustomerManagement from './CustomerManagement';
import ExpenseHistory from './ExpenseHistory';
import ScreenLoading from './ScreenLoading';
import './AdminPortal.css';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';
import {
  FaTachometerAlt,
  FaUsers,
  FaTags,
  FaUtensils,
  FaUserFriends,
  FaMoneyBillWave,
  FaCog,
  FaSignOutAlt,
  FaBars,
  FaEye,
  FaEyeSlash,
  FaTimes
} from 'react-icons/fa';

const AdminPortal = ({ user, onLogout }) => {
  const { showSuccess, showError, showInfo } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [screenLoading, setScreenLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [fullMenuItems, setFullMenuItems] = useState([]);
  const [stats, setStats] = useState({
    totalSales: 0,
    todaySales: 0,
    totalOrders: 0,
    todayOrders: 0,
    totalExpenses: 0,
    todayExpenses: 0
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [chartFilter, setChartFilter] = useState('weekly'); // 'weekly', 'monthly', 'custom'
  const [chartStartDate, setChartStartDate] = useState(null);
  const [chartEndDate, setChartEndDate] = useState(null);
  const [chartCustomApplied, setChartCustomApplied] = useState(false);
  const [appliedChartStartDate, setAppliedChartStartDate] = useState(null);
  const [appliedChartEndDate, setAppliedChartEndDate] = useState(null);
  const [showChartCustomRange, setShowChartCustomRange] = useState(false);
  const logoUrl = getPublicAssetUrl('logo.png');

  // User Management States
  const [showUserModal, setShowUserModal] = useState(false);
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'manager',
    email: '',
    phone: '',
    monthly_salary: '',
    status: 'active'
  });

  // Category Management States
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [categorySearchQuery, setCategorySearchQuery] = useState('');

  const displayedCategories = (() => {
    const q = categorySearchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((cat) => {
      const id = String(cat?.id ?? '');
      const name = String(cat?.name ?? '').toLowerCase();
      const desc = String(cat?.description ?? '').toLowerCase();
      return id.includes(q) || name.includes(q) || desc.includes(q);
    });
  })();

  // Menu Item Management States
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState(null);
  const [menuForm, setMenuForm] = useState({
    name: '',
    category_id: '',
    price: '',
    product_price: '',
    description: '',
    image_url: '',
    available: 1
  });
  const [imageUrlError, setImageUrlError] = useState('');

  // Confirmation Modal States
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });

  // Helper function to get local date string (YYYY-MM-DD) without timezone conversion
  const getLocalDateString = useCallback((date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const getChartRange = useCallback(() => {
    const today = new Date();
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    if (chartFilter === 'weekly') {
      const start = new Date(today);
      start.setDate(today.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return {
        mode: 'weekly',
        start,
        end,
        startDate: getLocalDateString(start),
        endDate: getLocalDateString(today),
      };
    }

    if (chartFilter === 'monthly') {
      const start = new Date(today);
      start.setDate(today.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return {
        mode: 'monthly',
        start,
        end,
        startDate: getLocalDateString(start),
        endDate: getLocalDateString(today),
      };
    }

    if (
      chartFilter === 'custom' &&
      chartCustomApplied &&
      appliedChartStartDate &&
      appliedChartEndDate
    ) {
      const start = new Date(appliedChartStartDate);
      const endCustom = new Date(appliedChartEndDate);
      start.setHours(0, 0, 0, 0);
      endCustom.setHours(23, 59, 59, 999);
      return {
        mode: 'custom',
        start,
        end: endCustom,
        startDate: appliedChartStartDate,
        endDate: appliedChartEndDate,
      };
    }

    if (chartFilter === 'custom' && chartStartDate && chartEndDate) {
      const start = new Date(chartStartDate);
      const endCustom = new Date(chartEndDate);
      start.setHours(0, 0, 0, 0);
      endCustom.setHours(23, 59, 59, 999);
      return {
        mode: 'custom',
        start,
        end: endCustom,
        startDate: chartStartDate,
        endDate: chartEndDate,
      };
    }

    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return {
      mode: 'weekly',
      start,
      end,
      startDate: getLocalDateString(start),
      endDate: getLocalDateString(today),
    };
  }, [
    appliedChartEndDate,
    appliedChartStartDate,
    chartCustomApplied,
    chartEndDate,
    chartFilter,
    chartStartDate,
    getLocalDateString,
  ]);

  const fetchDashboardStats = useCallback(async () => {
    try {
      const range = getChartRange();
      const params = range?.startDate && range?.endDate ? { startDate: range.startDate, endDate: range.endDate } : {};

      const [ordersRes, expensesRes] = await Promise.all([
        ordersAPI.getAll({ ...params, limit: 10000 }),
        expensesAPI.getAll({ ...params, limit: 10000 })
      ]);

      // Extract data from IPC response structure
      // IPC response format: { data: [...] } or { data: { success: true, data: [...] } }
      const ordersData = ordersRes.data?.data || ordersRes.data || [];
      const expensesData = expensesRes.data?.data || expensesRes.data || [];

      // Handle both paginated and direct array responses
      const orders = Array.isArray(ordersData) ? ordersData : (ordersData?.orders || ordersData?.data || []);
      const expenses = Array.isArray(expensesData) ? expensesData : (expensesData?.expenses || expensesData?.data || []);

      const today = new Date();
      const todayString = getLocalDateString(today);

      const todayOrders = orders.filter(o => {
        const orderDateString = getLocalDateString(o.createdAt || o.created_at);
        return orderDateString === todayString;
      });

      const todayExpenses = expenses.filter(e => {
        const expenseDateString = getLocalDateString(e.expenseDate || e.createdAt || e.created_at);
        return expenseDateString === todayString;
      });

      setStats({
        totalSales: orders.reduce((sum, o) => sum + parseFloat(o.totalAmount || o.total_amount || 0), 0),
        todaySales: todayOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount || o.total_amount || 0), 0),
        totalOrders: orders.length,
        todayOrders: todayOrders.length,
        totalExpenses: expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0),
        todayExpenses: todayExpenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0)
      });

      setRecentOrders(orders);
      setRecentExpenses(expenses);
    } catch (err) {
      console.error('Error fetching stats:', err);
      // Set default values if fetch fails
      setStats({
        totalSales: 0,
        todaySales: 0,
        totalOrders: 0,
        todayOrders: 0,
        totalExpenses: 0,
        todayExpenses: 0
      });
    }
  }, [getChartRange, getLocalDateString]);

  const [searchQuery, setSearchQuery] = useState('');
  
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();

    // If no search query, show all menu items
    if (!q) {
      setMenuItems(fullMenuItems);
      return;
    }

    const filteredItems = fullMenuItems.filter((item) => {
      const id = String(item?.id ?? '');
      const name = String(item?.name ?? '').toLowerCase();
      const categoryName = String(item?.category?.name || item?.category_name || '').toLowerCase();

      return (
        id.includes(q) ||
        name.includes(q) ||
        categoryName.includes(q)
      );
    });

    // Always keep displayed items in descending order by ID
    const sortedFiltered = [...filteredItems].sort((a, b) => (b?.id ?? 0) - (a?.id ?? 0));
    setMenuItems(sortedFiltered);
  }, [searchQuery, fullMenuItems]);


  
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setScreenLoading(true);
      try {
        await fetchDashboardStats();
        if (activeTab === 'users') await fetchUsers();
        if (activeTab === 'categories') await fetchCategories();
        if (activeTab === 'menu') {
          await fetchCategories();
          await fetchMenuItems();
        }
      } finally {
        if (!cancelled) setScreenLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchDashboardStats]);

  const fetchUsers = async () => {
    try {
      const response = await usersAPI.getAll();
      // IPC/axios responses can be either an array or an object wrapper like:
      // { success: true, data: [...] } or { users: [...] }
      const usersData = response?.data?.data ?? response?.data ?? [];
      const normalizedUsers = Array.isArray(usersData)
        ? usersData
        : (usersData?.users || usersData?.data || []);
      setUsers(Array.isArray(normalizedUsers) ? normalizedUsers : []);
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsers([]);
      showError('Error fetching users: ' + (err.formattedMessage || err.response?.data?.error || err.message || 'Unknown error'));
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await categoriesAPI.getAll();
      // API may return wrapper: { success: true, data: [...] }
      // Also, if the browser returns 304 Not Modified, axios may give an empty body.
      const raw = response?.data?.data ?? response?.data ?? [];
      const list = Array.isArray(raw) ? raw : (raw?.categories || raw?.data || []);
      const normalized = Array.isArray(list) ? list : [];
      // sort data in descending order based on id
      const sortedData = [...normalized].sort((a, b) => (b?.id ?? 0) - (a?.id ?? 0));
      setCategories(sortedData);
    } catch (err) {
      console.error('Error fetching categories:', err);
      setCategories([]);
    }
  };

  const fetchMenuItems = async () => {
    try {
      const response = await menuItemsAPI.getAll();
      // API may return wrapper: { success: true, data: [...] }
      // Also, if the browser returns 304 Not Modified, axios may give an empty body.
      const raw = response?.data?.data ?? response?.data ?? [];
      const items = Array.isArray(raw) ? raw : (raw?.menuItems || raw?.items || raw?.data || []);
      // Normalize availability field (ensure it's 0 or 1)
      const normalizedItems = (Array.isArray(items) ? items : []).map(item => ({
        ...item,
        available: item.available === 1 || item.available === true ? 1 : 0
      }));
      // Always keep menu items in descending order by ID (newest/highest ID on top)
      const sortedItems = [...normalizedItems].sort((a, b) => (b?.id ?? 0) - (a?.id ?? 0));
      setMenuItems(sortedItems);
      setFullMenuItems(sortedItems);
    } catch (err) {
      console.error('Error fetching menu items:', err);
      setMenuItems([]);
    }
  };

  // User Management Functions
  const handleUserSubmit = async (e) => {
    e.preventDefault();
    try {
      // Transform payload to match backend schema (camelCase)
      const payload = {
        username: userForm.username,
        // If full name is not provided, fall back to username
        fullName: userForm.full_name || userForm.username,
        role: userForm.role,
        email: userForm.email || '',
        phone: userForm.phone || '',
        status: userForm.status,
        monthlySalary: userForm.monthly_salary === '' ? null : parseFloat(userForm.monthly_salary)
      };

      // Only include password if it's provided
      if (userForm.password) {
        payload.password = userForm.password;
      }

      if (editingUser) {
        await usersAPI.update(editingUser.id, payload);
        showSuccess('User updated successfully');
      } else {
        await usersAPI.create(payload);
        showSuccess('User created successfully');
      }
      setShowUserModal(false);
      setShowUserPassword(false);
      setEditingUser(null);
      setUserForm({ username: '', password: '', full_name: '', role: 'manager', email: '', phone: '', monthly_salary: '', status: 'active' });
      fetchUsers();
    } catch (err) {
      showError(err.formattedMessage || err.response?.data?.error || err.message || 'Operation failed');
    }
  };

  const handleDeleteUser = async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete User',
      message: 'Are you sure you want to delete this user?',
      onConfirm: async () => {
        try {
          await usersAPI.delete(id);
          showSuccess('User deleted successfully');
          fetchUsers();
        } catch (err) {
          showError(err.formattedMessage || err.response?.data?.error || err.message || 'Operation failed');
        }
      },
      variant: 'danger'
    });
  };

  const openEditUser = (user) => {
    setShowUserPassword(false);
    setEditingUser(user);
    setUserForm({
      username: user.username,
      password: '',
      // Preserve existing full name if present, otherwise fall back to username
      full_name: user.fullName || user.full_name || user.username,
      role: user.role,
      email: user.email || '',
      phone: user.phone || '',
      monthly_salary: (user.monthlySalary ?? user.monthly_salary ?? '') === null ? '' : String(user.monthlySalary ?? user.monthly_salary ?? ''),
      status: user.status
    });
    setShowUserModal(true);
  };

  // Category Management Functions
  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingCategory) {
        await categoriesAPI.update(editingCategory.id, categoryForm);
        showSuccess('Category updated successfully');
      } else {
        await categoriesAPI.create(categoryForm);
        showSuccess('Category created successfully');
      }
      setShowCategoryModal(false);
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '' });
      fetchCategories();
    } catch (err) {
      showError(err.formattedMessage || err.response?.data?.error || err.message || 'Operation failed');
    }
  };

  const handleDeleteCategory = async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category?',
      onConfirm: async () => {
        try {
          await categoriesAPI.delete(id);
          showSuccess('Category deleted successfully');
          fetchCategories();
        } catch (err) {
          showError(err.formattedMessage || err.response?.data?.error || err.message || 'Operation failed');
        }
      },
      variant: 'danger'
    });
  };

  // Menu Item Management Functions
  const handleMenuSubmit = async (e) => {
    e.preventDefault();
    try {
      // Prevent submission if there's an image URL error
      if (imageUrlError) {
        showError(`Cannot submit: ${imageUrlError}`);
        return;
      }

      // Validate image URL if provided
      if (menuForm.image_url && menuForm.image_url.trim() !== '') {
        try {
          // Validate URL format
          const url = new URL(menuForm.image_url.trim());
          // Check if it's http or https
          if (!['http:', 'https:'].includes(url.protocol)) {
            setImageUrlError('URL must start with http:// or https://');
            showError('Invalid Image URL: URL must start with http:// or https://');
            return;
          }
        } catch (urlError) {
          setImageUrlError('Invalid URL format. Please enter a valid URL (e.g., https://example.com/image.jpg)');
          showError('Invalid Image URL: Please provide a valid URL format (e.g., https://example.com/image.jpg)');
          return;
        }
      }

      const productPriceRaw = String(menuForm.product_price ?? '').trim();
      let productPrice = null;
      if (productPriceRaw !== '') {
        const parsed = parseInt(productPriceRaw, 10);
        if (Number.isNaN(parsed)) {
          showError('Product price must be a whole number (or leave empty).');
          return;
        }
        productPrice = parsed;
      }

      // Transform field names to match backend schema (camelCase)
      const payload = {
        name: menuForm.name,
        categoryId: menuForm.category_id && menuForm.category_id !== '' ? parseInt(menuForm.category_id) : null,
        price: parseFloat(menuForm.price),
        productPrice,
        description: menuForm.description || '',
        imageUrl: menuForm.image_url || '',
        available: menuForm.available === 1 || menuForm.available === true
      };

      if (editingMenuItem) {
        await menuItemsAPI.update(editingMenuItem.id, payload);
        showSuccess('Menu item updated successfully');
      } else {
        await menuItemsAPI.create(payload);
        showSuccess('Menu item created successfully');
      }
      setShowMenuModal(false);
      setEditingMenuItem(null);
      setMenuForm({ name: '', category_id: '', price: '', product_price: '', description: '', image_url: '', available: 1 });
      setImageUrlError('');
      fetchMenuItems();
    } catch (err) {
      console.error('Menu item error:', err.response?.data);

      // Extract detailed error message from response
      let errorMessage = 'Error: ' + (err.response?.data?.error || err.response?.data?.message || err.message);

      // Check if it's a validation error with specific field errors
      if (err.response?.status === 400) {
        const errorData = err.response?.data;

        // Check for field-specific errors array (from Zod validation)
        if (errorData?.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
          // Find imageUrl/image_url specific error
          const imageError = errorData.errors.find(e =>
            (e.field && (e.field.includes('imageUrl') || e.field.includes('image_url'))) ||
            (e.message && (e.message.toLowerCase().includes('image') || e.message.toLowerCase().includes('url')))
          );

          if (imageError) {
            errorMessage = `Invalid Image URL: ${imageError.message || 'Please provide a valid image link (e.g., https://example.com/image.jpg)'}`;
          } else {
            // Show all validation errors
            const fieldErrors = errorData.errors
              .map(e => {
                const fieldName = e.field ? e.field.replace(/body\./g, '').replace(/\./g, ' ') : '';
                return fieldName ? `${fieldName}: ${e.message || e}` : (e.message || String(e));
              })
              .filter(Boolean)
              .join(', ');
            errorMessage = `Validation Error: ${fieldErrors}`;
          }
        }
        // Check for single error message mentioning image
        else if (errorData?.error || errorData?.message) {
          const errorText = (errorData.error || errorData.message || '').toLowerCase();
          if (errorText.includes('image') || errorText.includes('imageurl') || errorText.includes('image_url') || errorText.includes('url')) {
            errorMessage = 'Invalid Image URL: Please provide a valid image link (e.g., https://example.com/image.jpg)';
          }
        }
      }

      showError(errorMessage);
    }
  };

  const handleDeleteMenuItem = async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Menu Item',
      message: 'Are you sure you want to delete this menu item?',
      onConfirm: async () => {
        try {
          await menuItemsAPI.delete(id);
          showSuccess('Menu item deleted successfully');
          fetchMenuItems();
        } catch (err) {
          showError(err.formattedMessage || err.response?.data?.error || err.message || 'Operation failed');
        }
      },
      variant: 'danger'
    });
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
      onLogout();
    } catch (err) {
      console.error('Logout error:', err);
      onLogout();
    }
  };



  // Chart Data Processing
  const getSalesTrendData = () => {
    let dateRange = [];
    const range = getChartRange();
    const current = new Date(range.start);
    current.setHours(0, 0, 0, 0);
    const end = new Date(range.end);
    end.setHours(0, 0, 0, 0);
    while (current <= end) {
      dateRange.push(getLocalDateString(current));
      current.setDate(current.getDate() + 1);
    }

    return dateRange.map(date => {
      const dayOrders = recentOrders.filter(o => getLocalDateString(o.createdAt || o.created_at) === date);
      const daySales = dayOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount || o.total_amount || 0), 0);

      const dayExpensesList = recentExpenses.filter(e => getLocalDateString(e.expenseDate || e.createdAt || e.created_at) === date);
      const dayExpenses = dayExpensesList.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

      const dateObj = new Date(date);
      const label = chartFilter === 'weekly'
        ? dateObj.toLocaleDateString('en-US', { weekday: 'short' })
        : chartFilter === 'monthly'
        ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      return {
        name: label,
        Sales: daySales,
        Expenses: dayExpenses
      };
    });
  };

  const getTopItemsData = () => {
    const itemMap = {};
    const range = getChartRange();

    // Filter orders within selected range
    const filteredOrders = recentOrders.filter(order => {
      const orderDate = new Date(order.createdAt || order.created_at);
      return Number.isFinite(orderDate.getTime()) && orderDate >= range.start && orderDate <= range.end;
    });

    filteredOrders.forEach(order => {
      const items = order.orderItems || order.order_items || [];
      if (Array.isArray(items)) {
        items.forEach(item => {
          const name = item.menuItem?.name || item.name || item.menu_item_name || 'Unknown';
          const quantity = parseInt(item.quantity || 0);

          if (name && quantity) {
            itemMap[name] = (itemMap[name] || 0) + quantity;
          }
        });
      }
    });

    return Object.entries(itemMap)
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  };

  const salesTrendData = getSalesTrendData();
  const topItemsData = getTopItemsData();

  const isOrderCancelled = useCallback((order) => {
    const orderStatus = String(order?.orderStatus ?? order?.order_status ?? '').trim().toLowerCase();
    const paymentStatus = String(order?.paymentStatus ?? order?.payment_status ?? '').trim().toLowerCase();
    const status = String(order?.status ?? '').trim().toLowerCase();
    return orderStatus === 'cancelled' || paymentStatus === 'cancelled' || status === 'cancelled';
  }, []);

  const getReport = useCallback(() => {
    const range = getChartRange();
    const from = range.start;
    const to = range.end;

    const inRange = (recentOrders || [])
      .filter((o) => {
        const d = new Date(o.createdAt || o.created_at);
        return Number.isFinite(d.getTime()) && d >= from && d <= to;
      })
      .filter((o) => !isOrderCancelled(o));

    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      name: `${String(h).padStart(2, '0')}:00`,
      Sales: 0,
      Orders: 0,
    }));

    const typeAgg = {
      dine_in: { key: 'dine_in', label: 'Dine-in', sales: 0, orders: 0 },
      delivery: { key: 'delivery', label: 'Delivery', sales: 0, orders: 0 },
      takeaway: { key: 'takeaway', label: 'Takeaway', sales: 0, orders: 0 },
    };

    for (const o of inRange) {
      const created = new Date(o.createdAt || o.created_at);
      const hr = created.getHours();
      const amt = parseFloat(o.totalAmount || o.total_amount || 0) || 0;

      if (hourly[hr]) {
        hourly[hr].Sales += amt;
        hourly[hr].Orders += 1;
      }

      const rawType = String(o.orderType || o.order_type || '').trim().toLowerCase();
      const table = String(o.tableNumber || o.table_number || '').trim();
      const normalizedType = rawType === 'delivery' ? 'delivery' : 'dine_in';
      const isTakeaway = normalizedType === 'dine_in' && !table;
      const bucket = isTakeaway ? 'takeaway' : normalizedType;

      typeAgg[bucket].sales += amt;
      typeAgg[bucket].orders += 1;
    }

    const peakBySales = hourly.reduce(
      (best, cur) => (cur.Sales > best.Sales ? cur : best),
      hourly[0]
    );
    const peakByOrders = hourly.reduce(
      (best, cur) => (cur.Orders > best.Orders ? cur : best),
      hourly[0]
    );

    const typeSplit = Object.values(typeAgg)
      .filter((t) => t.orders > 0)
      .map((t) => ({
        name: t.label,
        sales: t.sales,
        orders: t.orders,
      }))
      .sort((a, b) => b.sales - a.sales);

    const totalSales = inRange.reduce((sum, o) => sum + (parseFloat(o.totalAmount || o.total_amount || 0) || 0), 0);
    const totalOrders = inRange.length;

    const takeaways = typeAgg.takeaway.orders;
    const delivery = typeAgg.delivery.orders;
    const dineIn = typeAgg.dine_in.orders;

    const insights = [];
    if (totalOrders > 0) {
      if (peakBySales.Sales > 0) insights.push(`Peak sales hour: ${peakBySales.name}`);
      if (peakByOrders.Orders > 0) insights.push(`Busiest hour: ${peakByOrders.name}`);
      if (delivery > 0) insights.push(`Delivery share: ${Math.round((delivery / totalOrders) * 100)}%`);
      if (takeaways > 0) insights.push(`Takeaway share: ${Math.round((takeaways / totalOrders) * 100)}%`);
      if (dineIn > 0) insights.push(`Dine-in share: ${Math.round((dineIn / totalOrders) * 100)}%`);
    }

    return {
      from,
      to,
      orders: inRange,
      totalSales,
      totalOrders,
      hourly,
      peakBySales,
      peakByOrders,
      typeSplit,
      insights,
    };
  }, [getChartRange, recentOrders, isOrderCancelled]);

  const report = getReport();

  const chartCustomDraftComplete = Boolean(chartStartDate && chartEndDate);
  const chartCustomDirty =
    chartCustomApplied &&
    chartCustomDraftComplete &&
    (chartStartDate !== appliedChartStartDate || chartEndDate !== appliedChartEndDate);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
    const path = tab === 'dashboard' ? '/admin/dashboard' : `/admin/${tab}`;
    if (location.pathname !== path) {
      navigate(path, { replace: false });
    }
  };

  const routeTab = useMemo(() => {
    const p = (location.pathname || '').replace(/\/+$/, '');
    const seg = p.startsWith('/admin') ? p.split('/')[2] : null;
    if (!seg || seg === '') return 'dashboard';
    // Only allow known tabs
    const allowed = new Set(['dashboard', 'users', 'categories', 'menu', 'customers', 'expenses', 'settings']);
    return allowed.has(seg) ? seg : 'dashboard';
  }, [location.pathname]);

  // Keep state in sync when user uses back/forward or lands on a deep link.
  useEffect(() => {
    if (activeTab !== routeTab) {
      setActiveTab(routeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTab]);

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);
  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="admin-portal">
      {/* Mobile Header - Only visible on small screens */}
      <div className="admin-mobile-header">
        <div className="admin-mobile-logo">
          <img src={logoUrl} alt="Flamex" className="admin-logo-mobile" />
          <span className="admin-mobile-title">Admin Portal</span>
        </div>
        <button
          className="admin-menu-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          <FaBars />
        </button>
      </div>

      {isSidebarOpen && <div className="admin-overlay" onClick={closeSidebar} />}

      <div className={`admin-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="admin-header">
          <img src={logoUrl} alt="Flamex" className="admin-logo" />
          <h2>Admin Portal</h2>
          <p className="user-info">{user.fullName}</p>
        </div>

        <nav className="admin-nav">
          <button
            className={activeTab === 'dashboard' ? 'active' : ''}
            onClick={() => handleTabChange('dashboard')}
          >
            <FaTachometerAlt /> <span>Dashboard</span>
          </button>
          <button
            className={activeTab === 'users' ? 'active' : ''}
            onClick={() => handleTabChange('users')}
          >
            <FaUsers /> <span>User Management</span>
          </button>
          <button
            className={activeTab === 'categories' ? 'active' : ''}
            onClick={() => handleTabChange('categories')}
          >
            <FaTags /> <span>Categories</span>
          </button>
          <button
            className={activeTab === 'menu' ? 'active' : ''}
            onClick={() => handleTabChange('menu')}
          >
            <FaUtensils /> <span>Menu Items</span>
          </button>
          <button
            className={activeTab === 'customers' ? 'active' : ''}
            onClick={() => handleTabChange('customers')}
          >
            <FaUserFriends /> <span>Customers</span>
          </button>
          <button
            className={activeTab === 'expenses' ? 'active' : ''}
            onClick={() => handleTabChange('expenses')}
          >
            <FaMoneyBillWave /> <span>Expenses</span>
          </button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => handleTabChange('settings')}
          >
            <FaCog /> <span>Settings</span>
          </button>
        </nav>

        <button className="logout-btn" onClick={handleLogout}>
          <FaSignOutAlt /> <span>Logout</span>
        </button>
      </div>

      <div className="admin-content">
        {screenLoading ? (
          <ScreenLoading label="Loading..." />
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <div className="dashboard-tab">
                <h1>Dashboard Overview</h1>
                <div className="stats-grid">
                  <div className="stat-card">
                    <h3>Today's Sales</h3>
                    <p className="stat-value">PKR {stats.todaySales.toFixed(2)}</p>
                    <span className="stat-label">{stats.todayOrders} orders</span>
                  </div>
                  <div className="stat-card">
                    <h3>Total Sales</h3>
                    <p className="stat-value">PKR {stats.totalSales.toFixed(2)}</p>
                    <span className="stat-label">{stats.totalOrders} orders</span>
                  </div>
                  <div className="stat-card">
                    <h3>Today's Expenses</h3>
                    <p className="stat-value">PKR {stats.todayExpenses.toFixed(2)}</p>
                  </div>
                  <div className="stat-card">
                    <h3>Total Expenses</h3>
                    <p className="stat-value">PKR {stats.totalExpenses.toFixed(2)}</p>
                  </div>
                </div>

                {/* Chart Filters */}
                <div style={{
                  background: 'white',
                  padding: '1rem',
                  borderRadius: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  marginBottom: '1.5rem'
                }}>
                  <div style={{ marginBottom: '0.75rem', fontWeight: '600', color: '#495057' }}>
                    Filter Charts
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      onClick={() => {
                        setChartFilter('weekly');
                        setChartStartDate(null);
                    setChartEndDate(null);
                    setChartCustomApplied(false);
                    setAppliedChartStartDate(null);
                    setAppliedChartEndDate(null);
                    setShowChartCustomRange(false);
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    border: chartFilter === 'weekly' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                    borderRadius: '8px',
                    background: chartFilter === 'weekly' ? 'var(--gradient-primary)' : 'white',
                    color: chartFilter === 'weekly' ? 'white' : '#495057',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  Weekly
                </button>
                <button
                  onClick={() => {
                    setChartFilter('monthly');
                    setChartStartDate(null);
                    setChartEndDate(null);
                    setChartCustomApplied(false);
                    setAppliedChartStartDate(null);
                    setAppliedChartEndDate(null);
                    setShowChartCustomRange(false);
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    border: chartFilter === 'monthly' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                    borderRadius: '8px',
                    background: chartFilter === 'monthly' ? 'var(--gradient-primary)' : 'white',
                    color: chartFilter === 'monthly' ? 'white' : '#495057',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  Monthly
                </button>
                <button
                  onClick={() => {
                    setChartFilter('custom');
                    setShowChartCustomRange(true);
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    border: (chartFilter === 'custom' || showChartCustomRange) ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
                    borderRadius: '8px',
                    background: (chartFilter === 'custom' || showChartCustomRange) ? 'var(--gradient-primary)' : 'white',
                    color: (chartFilter === 'custom' || showChartCustomRange) ? 'white' : '#495057',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  Custom
                </button>
                {showChartCustomRange && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginLeft: '1rem' }}>
                    <input
                      type="date"
                      value={chartStartDate || ''}
                      onChange={(e) => setChartStartDate(e.target.value || null)}
                      max={chartEndDate || new Date().toISOString().split('T')[0]}
                      placeholder="mm/dd/yyyy"
                      style={{
                        padding: '0.5rem',
                        border: '2px solid #dee2e6',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    />
                    <span>to</span>
                    <input
                      type="date"
                      value={chartEndDate || ''}
                      onChange={(e) => setChartEndDate(e.target.value || null)}
                      min={chartStartDate || undefined}
                      max={new Date().toISOString().split('T')[0]}
                      placeholder="mm/dd/yyyy"
                      style={{
                        padding: '0.5rem',
                        border: '2px solid #dee2e6',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    />
                    {(!chartCustomApplied || chartCustomDirty) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (chartStartDate && chartEndDate) {
                            setAppliedChartStartDate(chartStartDate);
                            setAppliedChartEndDate(chartEndDate);
                            setChartCustomApplied(true);
                            fetchDashboardStats();
                          }
                        }}
                        disabled={!chartStartDate || !chartEndDate}
                        style={{
                          padding: '0.5rem 1rem',
                          border: 'none',
                          borderRadius: '6px',
                          background: 'var(--gradient-primary)',
                          color: 'white',
                          fontWeight: 'bold',
                          cursor: (!chartStartDate || !chartEndDate) ? 'not-allowed' : 'pointer',
                          fontSize: '0.9rem',
                          opacity: (!chartStartDate || !chartEndDate) ? 0.5 : 1
                        }}
                      >
                        Apply
                      </button>
                    )}
                    {chartCustomApplied && (
                      <button
                        type="button"
                        onClick={() => {
                          setChartStartDate(null);
                          setChartEndDate(null);
                          setChartCustomApplied(false);
                          setAppliedChartStartDate(null);
                          setAppliedChartEndDate(null);
                          fetchDashboardStats();
                        }}
                        style={{
                          padding: '0.5rem 1rem',
                          border: 'none',
                          borderRadius: '6px',
                          background: 'var(--gradient-primary)',
                          color: 'white',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          fontSize: '0.9rem'
                        }}
                      >
                        Remove filter
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {user?.role === 'admin' && (
              <div className="weekly-report">
                <div className="weekly-report-header">
                  <div>
                    <h2>Report</h2>
                    <div className="weekly-report-subtitle">
                      {chartFilter === 'weekly'
                        ? 'Last 7 days (including today)'
                        : chartFilter === 'monthly'
                        ? 'Last 30 days (including today)'
                        : '(Custom Range)'}
                    </div>
                  </div>
                  <div className="weekly-report-kpis">
                    <div className="weekly-kpi">
                      <div className="weekly-kpi-label">Sales</div>
                      <div className="weekly-kpi-value">PKR {report.totalSales.toFixed(2)}</div>
                    </div>
                    <div className="weekly-kpi">
                      <div className="weekly-kpi-label">Orders</div>
                      <div className="weekly-kpi-value">{report.totalOrders}</div>
                    </div>
                    <div className="weekly-kpi">
                      <div className="weekly-kpi-label">Peak hour (sales)</div>
                      <div className="weekly-kpi-value">{report.peakBySales?.name || '—'}</div>
                    </div>
                  </div>
                </div>

                <div className="weekly-report-grid">
                  <div className="chart-container">
                    <h3>Hourly Sales</h3>
                    <div className="chart-wrapper">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={report.hourly} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" interval={2} axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} />
                          <Tooltip />
                          <Bar dataKey="Sales" fill="#6366f1" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="chart-container">
                    <h3>Order Type Split</h3>
                    <div className="weekly-split">
                      {report.typeSplit.length === 0 ? (
                        <div className="weekly-empty">No orders in this range.</div>
                      ) : (
                        <div className="weekly-split-list">
                          {report.typeSplit.map((t) => (
                            <div key={t.name} className="weekly-split-row">
                              <div className="weekly-split-name">{t.name}</div>
                              <div className="weekly-split-meta">
                                <span className="weekly-split-orders">{t.orders} orders</span>
                                <span className="weekly-split-sales">PKR {t.sales.toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {report.insights.length > 0 && (
                        <div className="weekly-insights">
                          <div className="weekly-insights-title">Takeaways</div>
                          <ul className="weekly-insights-list">
                            {report.insights.slice(0, 4).map((txt) => (
                              <li key={txt}>{txt}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="charts-row">
              <div className="chart-container">
                <h3>Sales vs Expenses {chartFilter === 'weekly' ? '(Last 7 Days)' : chartFilter === 'monthly' ? '(Last 30 Days)' : '(Custom Range)'}</h3>
                <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={salesTrendData}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="Sales" stroke="#8884d8" fillOpacity={1} fill="url(#colorSales)" />
                      <Area type="monotone" dataKey="Expenses" stroke="#82ca9d" fillOpacity={1} fill="url(#colorExpenses)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="chart-container">
                <h3>Top Selling Items {chartFilter === 'weekly' ? '(Last 7 Days)' : chartFilter === 'monthly' ? '(Last 30 Days)' : '(Custom Range)'}</h3>
                <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topItemsData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar dataKey="quantity" fill="#ff7f50" radius={[0, 4, 4, 0]}>
                        {topItemsData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#ff7f50' : '#ffa07a'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="users-tab">
            <div className="tab-header">
              <h1>User Management</h1>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditingUser(null);
                  setUserForm({ username: '', password: '', full_name: '', role: 'manager', email: '', phone: '', monthly_salary: '', status: 'active' });
                  setShowUserModal(true);
                }}
              >
                Add New User
              </button>
            </div>

            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Username</th>
                    <th>Full Name</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Monthly salary</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(users) ? users : []).map(user => (
                    <tr key={user.id}>
                      <td>{user.id}</td>
                      <td>{user.username}</td>
                      <td>{user.fullName || user.full_name || user.username}</td>
                      <td><span className={`role-badge ${user.role}`}>{user.role}</span></td>
                      <td>{user.email}</td>
                      <td>{(user.monthlySalary ?? user.monthly_salary) ? `PKR ${Number(user.monthlySalary ?? user.monthly_salary).toLocaleString()}` : '—'}</td>
                      <td><span className={`status-badge ${user.status}`}>{user.status}</span></td>
                      <td>
                        <button className="btn-edit" onClick={() => openEditUser(user)}>Edit</button>
                        <button className="btn-delete" onClick={() => handleDeleteUser(user.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="categories-tab">
            <div className="tab-header">
              <h1>Category Management</h1>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryForm({ name: '', description: '' });
                  setShowCategoryModal(true);
                }}
              >
                Add New Category
              </button>
            </div>

            {/* Search */}
            <div style={{
              background: 'white',
              padding: '1.5rem',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              marginBottom: '1.5rem'
            }}>
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
                  Search Categories
                </label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div
                    style={{
                      position: 'relative',
                      flex: '1',
                      minWidth: '250px'
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Search by ID, name, or description"
                      value={categorySearchQuery}
                      onChange={(e) => setCategorySearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '0.75rem',
                        paddingRight: categorySearchQuery.trim() ? '2.5rem' : '0.75rem',
                        border: '2px solid #dee2e6',
                        borderRadius: '8px',
                        fontSize: '0.95rem'
                      }}
                    />
                    {categorySearchQuery.trim() !== '' && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => setCategorySearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: '6px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '32px',
                          height: '32px',
                          padding: 0,
                          border: 'none',
                          borderRadius: '6px',
                          background: 'transparent',
                          color: '#6c757d',
                          cursor: 'pointer'
                        }}
                      >
                        <FaTimes size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>
                    Showing {displayedCategories.length} of {categories.length}
                  </div>
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCategories.length > 0 ? (
                    displayedCategories.map(cat => (
                      <tr key={cat.id}>
                        <td>{cat.id}</td>
                        <td>{cat.name}</td>
                        <td>{cat.description}</td>
                        <td>
                          <button className="btn-edit" onClick={() => {
                            setEditingCategory(cat);
                            setCategoryForm({ name: cat.name, description: cat.description });
                            setShowCategoryModal(true);
                          }}>Edit</button>
                          <button className="btn-delete" onClick={() => handleDeleteCategory(cat.id)}>Delete</button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: '#6c757d', padding: '1rem' }}>
                        No categories match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'menu' && (
          <div className="menu-tab">
            <div className="tab-header">
              <h1>Menu Item Management</h1>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditingMenuItem(null);
                  setMenuForm({ name: '', category_id: '', price: '', product_price: '', description: '', image_url: '', available: 1 });
                  setImageUrlError('');
                  setShowMenuModal(true);
                }}
              >
                Add New Menu Item
              </button>
            </div>
            

  
    {/* Search Filters */}
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            marginBottom: '1.5rem'
          }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
                Search Menu Items
              </label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search by ID, Name or Category"
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    flex: '1',
                    minWidth: '250px',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '0.95rem'
                  }}
                />
                <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>
                  {searchQuery && `Matching by ID, Name or Category`}
                </div>
              </div>
            </div>
          </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Image</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Product price</th>
                    <th>Available</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  { menuItems.map(item => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>
                        {(item.imageUrl || item.image_url) ? (
                          <img
                            src={item.imageUrl || item.image_url}
                            alt={item.name}
                            style={{
                              width: '50px',
                              height: '50px',
                              objectFit: 'cover',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0'
                            }}
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.parentElement.innerHTML = '<span style="color: #6c757d; font-size: 1.5rem;">📷</span>';
                            }}
                          />
                        ) : (
                          <span style={{ color: '#6c757d', fontSize: '1.5rem' }}>📷</span>
                        )}
                      </td>
                      <td>{item.name}</td>
                      <td>{item.category?.name || item.category_name || 'N/A'}</td>
                      <td>PKR {parseFloat(item.price).toFixed(2)}</td>
                      <td>
                        {item.productPrice != null && item.productPrice !== ''
                          ? `PKR ${Number(item.productPrice)}`
                          : (item.product_price != null && item.product_price !== ''
                            ? `PKR ${Number(item.product_price)}`
                            : '—')}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${item.available ? 'active' : 'inactive'}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontWeight: '600'
                          }}
                        >
                          {item.available ? '✅ Yes' : '❌ No'}
                        </span>
                      </td>
                      <td>
                        <button className="btn-edit" onClick={() => {
                          setEditingMenuItem(item);
                          setMenuForm({
                            name: item.name,
                            category_id: item.categoryId || item.category_id || '',  // Handle both formats
                            price: item.price,
                            product_price:
                              item.productPrice != null && item.productPrice !== ''
                                ? String(item.productPrice)
                                : (item.product_price != null && item.product_price !== '' ? String(item.product_price) : ''),
                            description: item.description || '',
                            image_url: item.imageUrl || item.image_url || '',  // Handle both formats
                            available: item.available === 1 || item.available === true ? 1 : 0
                          });
                          setImageUrlError(''); // Clear any previous errors
                          setShowMenuModal(true);
                        }}>Edit</button>
                        <button className="btn-delete" onClick={() => handleDeleteMenuItem(item.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'customers' && (
          <CustomerManagement />
        )}

        {activeTab === 'expenses' && (
          <ExpenseHistory />
        )}

        {activeTab === 'settings' && (
          <div className="settings-tab">
            <h1>System Settings</h1>
            <div className="settings-section">
              <h3>Business Information</h3>
              <p>Configure business details, receipts, and system preferences here.</p>
              <button className="btn-primary" onClick={() => showInfo('Settings management coming soon!')}>
                Edit Settings
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* User Modal */}
      {showUserModal && (
        <div className="modal-overlay" onClick={() => { setShowUserModal(false); setShowUserPassword(false); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingUser ? 'Edit User' : 'Add New User'}</h2>
            <form onSubmit={handleUserSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Username *</label>
                  <input
                    type="text"
                    value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Password {!editingUser && '*'}</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showUserPassword ? 'text' : 'password'}
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      required={!editingUser}
                      placeholder={editingUser ? 'Leave blank to keep current' : ''}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowUserPassword(!showUserPassword)}
                      aria-label={showUserPassword ? 'Hide password' : 'Show password'}
                    >
                      {showUserPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>
              </div>
              {/* Full name field removed from UI; backend fullName is derived from username or existing data */}
              <div className="form-row">
                <div className="form-group">
                  <label>Role *</label>
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                    required
                  >
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Status *</label>
                  <select
                    value={userForm.status}
                    onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}
                    required
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="text"
                    value={userForm.phone}
                    onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Monthly salary (optional)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={userForm.monthly_salary}
                    onChange={(e) => setUserForm({ ...userForm, monthly_salary: e.target.value })}
                    placeholder="e.g. 50000"
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowUserModal(false); setShowUserPassword(false); }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingUser ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCategory ? 'Edit Category' : 'Add New Category'}</h2>
            <form onSubmit={handleCategorySubmit}>
              <div className="form-group">
                <label>Category Name *</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  rows="3"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCategoryModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingCategory ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Menu Item Modal */}
      {showMenuModal && (
        <div className="modal-overlay" onClick={() => setShowMenuModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingMenuItem ? 'Edit Menu Item' : 'Add New Menu Item'}</h2>
            <form onSubmit={handleMenuSubmit}>
              {/* add limit of 100 characters to the item name */}
              <div className="form-group">
                <label>Item Name *</label>
                <input
                  type="text"
                  value={menuForm.name}
                  onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })}
                  required
                />
                {menuForm.name && menuForm.name.length > 100 && (
                  <div style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem',
                    background: '#fff5f5',
                    border: '1px solid #ffc9c9',
                    borderRadius: '6px',
                    color: '#c92a2a',
                    fontSize: '0.875rem'
                  }}>
                    ⚠️ Item name must be less than 100 characters
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Category *</label>
                  <select
                    value={menuForm.category_id}
                    onChange={(e) => setMenuForm({ ...menuForm, category_id: e.target.value })}
                    required
                  >
                    <option value="">Select Category</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={menuForm.price}
                    onChange={(e) => setMenuForm({ ...menuForm, price: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Product price (optional)</label>
                  <input
                    type="number"
                    step="1"
                    value={menuForm.product_price}
                    onChange={(e) => setMenuForm({ ...menuForm, product_price: e.target.value })}
                    placeholder="Whole PKR amount"
                  />
                </div>
              </div>
              <div className="form-group">
                {/* add limit of 1000 characters to the description */}
                <label>Description</label>
                <textarea
                  value={menuForm.description}
                  onChange={(e) => setMenuForm({ ...menuForm, description: e.target.value })}
                  rows="3"
                />
                {menuForm.description && menuForm.description.length > 1000 && (
                  <div style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem',
                    background: '#fff5f5',
                    border: '1px solid #ffc9c9',
                    borderRadius: '6px',
                    color: '#c92a2a',
                    fontSize: '0.875rem'
                  }}>
                    ⚠️ Description must be less than 1000 characters
                  </div>
                )}
              </div>
              {/* add limit of 100 characters to the image url */}
              <div className="form-group">
                <label>Image URL</label>
                <input
                  type="text"
                  value={menuForm.image_url}
                  onChange={(e) => {
                    const urlValue = e.target.value;
                    setMenuForm({ ...menuForm, image_url: urlValue });

                    // Validate URL format in real-time
                    if (urlValue && urlValue.trim() !== '') {
                      try {
                        const url = new URL(urlValue.trim());
                        if (!['http:', 'https:'].includes(url.protocol)) {
                          setImageUrlError('URL must start with http:// or https://');
                        } else {
                          setImageUrlError('');
                        }
                      } catch {
                        setImageUrlError('Invalid URL format. Please enter a valid URL (e.g., https://example.com/image.jpg)');
                      }
                    } else {
                      setImageUrlError('');
                    }
                  }}
                  placeholder="https://example.com/image.jpg"
                  style={{
                    borderColor: imageUrlError ? '#dc3545' : undefined
                  }}
                />
                {imageUrlError && (
                  <div style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem',
                    background: '#fff5f5',
                    border: '1px solid #ffc9c9',
                    borderRadius: '6px',
                    color: '#c92a2a',
                    fontSize: '0.875rem'
                  }}>
                    ⚠️ {imageUrlError}
                  </div>
                )}
                {menuForm.image_url && !imageUrlError && (
                  <div style={{
                    marginTop: '0.5rem',
                    width: '100%',
                    height: '150px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '2px solid #e2e8f0',
                    background: '#f8f9fa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <img
                      src={menuForm.image_url}
                      alt="Preview"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '<div style="color: #dc3545; padding: 1rem; font-weight: 600;">⚠️ Image failed to load. URL may be invalid or image not accessible.</div>';
                        setImageUrlError('Image failed to load. Please verify the URL is correct and accessible.');
                      }}
                      onLoad={() => {
                        // Clear any previous error when image loads successfully
                        if (imageUrlError && imageUrlError.includes('failed to load')) {
                          setImageUrlError('');
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="form-group" style={{
                padding: '1rem',
                background: menuForm.available === 1 ? '#e6ffed' : '#fff4d8',
                borderRadius: '8px',
                border: `2px solid ${menuForm.available === 1 ? '#198754' : '#f59e0b'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <label style={{
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: menuForm.available === 1 ? '#198754' : '#7c2d12',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  margin: 0
                }}>
                  <input
                    type="checkbox"
                    checked={menuForm.available === 1}
                    onChange={(e) => setMenuForm({ ...menuForm, available: e.target.checked ? 1 : 0 })}
                    style={{
                      width: '20px',
                      height: '20px',
                      cursor: 'pointer'
                    }}
                  />
                  <span>
                    {menuForm.available === 1 ? 'Available' : 'Unavailable'}
                  </span>
                </label>
                <div style={{
                  fontSize: '0.85rem',
                  color: menuForm.available === 1 ? '#198754' : '#7c2d12'
                }}>
                  {menuForm.available === 1
                    ? 'Item will be visible on manager side'
                    : 'Item will be hidden on manager side'}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowMenuModal(false)}>
                  Cancel
                </button>
                {/* If the item name or description is too long, disable button and button ui become gray button and with no pointer cursor on it */}
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={
                    (menuForm.name && menuForm.name.length > 100) ||
                    (menuForm.description && menuForm.description.length > 1000)
                  }
                  style={{
                    cursor:
                      (menuForm.name && menuForm.name.length > 100) ||
                      (menuForm.description && menuForm.description.length > 1000)
                        ? 'not-allowed'
                        : 'pointer'
                  }}
                >
                  {editingMenuItem ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
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

export default AdminPortal;
