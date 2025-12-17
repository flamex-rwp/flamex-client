import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';
import CustomerManagement from './CustomerManagement';
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
  FaCog,
  FaSignOutAlt,
  FaBars
} from 'react-icons/fa';

const AdminPortal = ({ user, onLogout }) => {
  const { showSuccess, showError, showInfo } = useToast();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
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
  const [showChartCustomRange, setShowChartCustomRange] = useState(false);

  // User Management States
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'manager',
    email: '',
    phone: '',
    status: 'active'
  });

  // Category Management States
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });

  // Menu Item Management States
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState(null);
  const [menuForm, setMenuForm] = useState({
    name: '',
    category_id: '',
    price: '',
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

  const fetchDashboardStats = useCallback(async () => {
    try {
      // Build date range params based on chart filter
      const params = {};
      if (chartFilter === 'weekly') {
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay()); // Start of week (Sunday)
        weekStart.setHours(0, 0, 0, 0);
        params.startDate = getLocalDateString(weekStart);
        params.endDate = getLocalDateString(today);
      } else if (chartFilter === 'monthly') {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        params.startDate = getLocalDateString(monthStart);
        params.endDate = getLocalDateString(today);
      } else if (chartFilter === 'custom' && chartStartDate && chartEndDate) {
        params.startDate = chartStartDate;
        params.endDate = chartEndDate;
      }

      const [ordersRes, expensesRes] = await Promise.all([
        api.get('/api/orders', { params: { ...params, limit: 10000 } }),
        api.get('/api/expenses', { params: { ...params, limit: 10000 } })
      ]);

      // Extract data from paginated response structure
      // Response format: { success: true, message: '...', data: { orders: [...], total: X, page: Y } }
      const ordersData = ordersRes.data.data;
      const expensesData = expensesRes.data.data;

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
  }, [getLocalDateString, chartFilter, chartStartDate, chartEndDate]);

  useEffect(() => {
    fetchDashboardStats();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'categories') fetchCategories();
    if (activeTab === 'menu') {
      fetchCategories();
      fetchMenuItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchDashboardStats]);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/api/users');
      setUsers(response.data.data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsers([]);
      // Use formatted message from api interceptor
      showError('Error fetching users: ' + (err.formattedMessage || err.response?.data?.error || err.message));
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await api.get('/api/categories');
      setCategories(response.data.data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
      setCategories([]);
    }
  };

  const fetchMenuItems = async () => {
    try {
      const response = await api.get('/api/menu-items');
      const items = response.data.data || [];
      // Normalize availability field (ensure it's 0 or 1)
      const normalizedItems = items.map(item => ({
        ...item,
        available: item.available === 1 || item.available === true ? 1 : 0
      }));
      setMenuItems(normalizedItems);
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
        fullName: userForm.full_name,
        role: userForm.role,
        email: userForm.email || '',
        phone: userForm.phone || '',
        status: userForm.status
      };

      // Only include password if it's provided
      if (userForm.password) {
        payload.password = userForm.password;
      }

      if (editingUser) {
        await api.put(`/api/users/${editingUser.id}`, payload);
        showSuccess('User updated successfully');
      } else {
        await api.post('/api/users', payload);
        showSuccess('User created successfully');
      }
      setShowUserModal(false);
      setEditingUser(null);
      setUserForm({ username: '', password: '', full_name: '', role: 'manager', email: '', phone: '', status: 'active' });
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
          await api.delete(`/api/users/${id}`);
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
    setEditingUser(user);
    setUserForm({
      username: user.username,
      password: '',
      full_name: user.fullName || user.full_name,
      role: user.role,
      email: user.email || '',
      phone: user.phone || '',
      status: user.status
    });
    setShowUserModal(true);
  };

  // Category Management Functions
  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingCategory) {
        await api.put(`/api/categories/${editingCategory.id}`, categoryForm);
        showSuccess('Category updated successfully');
      } else {
        await api.post('/api/categories', categoryForm);
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
          await api.delete(`/api/categories/${id}`);
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

      // Transform field names to match backend schema (camelCase)
      const payload = {
        name: menuForm.name,
        categoryId: menuForm.category_id && menuForm.category_id !== '' ? parseInt(menuForm.category_id) : null,
        price: parseFloat(menuForm.price),
        description: menuForm.description || '',
        imageUrl: menuForm.image_url || '',
        available: menuForm.available === 1 || menuForm.available === true
      };

      if (editingMenuItem) {
        await api.put(`/api/menu-items/${editingMenuItem.id}`, payload);
        showSuccess('Menu item updated successfully');
      } else {
        await api.post('/api/menu-items', payload);
        showSuccess('Menu item created successfully');
      }
      setShowMenuModal(false);
      setEditingMenuItem(null);
      setMenuForm({ name: '', category_id: '', price: '', description: '', image_url: '', available: 1 });
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
          await api.delete(`/api/menu-items/${id}`);
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
      await api.post('/api/auth/logout', {});
      onLogout();
    } catch (err) {
      console.error('Logout error:', err);
      onLogout();
    }
  };



  // Chart Data Processing
  const getSalesTrendData = () => {
    let dateRange = [];
    const today = new Date();

    if (chartFilter === 'weekly') {
      // Last 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateRange.push(getLocalDateString(d));
      }
    } else if (chartFilter === 'monthly') {
      // Last 30 days
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateRange.push(getLocalDateString(d));
      }
    } else if (chartFilter === 'custom' && chartStartDate && chartEndDate) {
      // Custom range
      const start = new Date(chartStartDate);
      const end = new Date(chartEndDate);
      const current = new Date(start);
      while (current <= end) {
        dateRange.push(getLocalDateString(current));
        current.setDate(current.getDate() + 1);
      }
    } else {
      // Default to last 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateRange.push(getLocalDateString(d));
      }
    }

    return dateRange.map(date => {
      const dayOrders = recentOrders.filter(o => getLocalDateString(o.createdAt || o.created_at) === date);
      const daySales = dayOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount || o.total_amount || 0), 0);

      const dayExpensesList = recentExpenses.filter(e => getLocalDateString(e.expenseDate || e.createdAt || e.created_at) === date);
      const dayExpenses = dayExpensesList.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

      const dateObj = new Date(date);
      const label = chartFilter === 'monthly'
        ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : dateObj.toLocaleDateString('en-US', { weekday: 'short' });

      return {
        name: label,
        Sales: daySales,
        Expenses: dayExpenses
      };
    });
  };

  const getTopItemsData = () => {
    const itemMap = {};
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Filter orders from last 7 days only
    const recentOrdersLast7Days = recentOrders.filter(order => {
      const orderDate = new Date(order.createdAt || order.created_at);
      return orderDate >= sevenDaysAgo;
    });

    recentOrdersLast7Days.forEach(order => {
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

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
  };

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);
  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="admin-portal">
      {/* Mobile Header - Only visible on small screens */}
      <div className="admin-mobile-header">
        <div className="admin-mobile-logo">
          <img src="/logo.png" alt="Flamex" className="admin-logo-mobile" />
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
          <img src="/logo.png" alt="Flamex" className="admin-logo" />
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
                    setShowChartCustomRange(!showChartCustomRange);
                    if (!showChartCustomRange) {
                      setChartFilter('custom');
                    }
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
                      onChange={(e) => setChartStartDate(e.target.value)}
                      max={chartEndDate || new Date().toISOString().split('T')[0]}
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
                      onChange={(e) => setChartEndDate(e.target.value)}
                      min={chartStartDate}
                      max={new Date().toISOString().split('T')[0]}
                      style={{
                        padding: '0.5rem',
                        border: '2px solid #dee2e6',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                    />
                    <button
                      onClick={() => {
                        if (chartStartDate && chartEndDate) {
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
                  </div>
                )}
              </div>
            </div>

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
                <h3>Top Selling Items (Last 7 Days)</h3>
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
                  setUserForm({ username: '', password: '', full_name: '', role: 'manager', email: '', phone: '', status: 'active' });
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
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id}>
                      <td>{user.id}</td>
                      <td>{user.username}</td>
                      <td>{user.full_name}</td>
                      <td><span className={`role-badge ${user.role}`}>{user.role}</span></td>
                      <td>{user.email}</td>
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
                  {categories.map(cat => (
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
                  ))}
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
                  setMenuForm({ name: '', category_id: '', price: '', description: '', image_url: '', available: 1 });
                  setImageUrlError('');
                  setShowMenuModal(true);
                }}
              >
                Add New Menu Item
              </button>
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
                    <th>Available</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {menuItems.map(item => (
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
      </div>

      {/* User Modal */}
      {showUserModal && (
        <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
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
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    required={!editingUser}
                    placeholder={editingUser ? 'Leave blank to keep current' : ''}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Full Name *</label>
                <input
                  type="text"
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  required
                />
              </div>
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
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowUserModal(false)}>
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
              <div className="form-group">
                <label>Item Name *</label>
                <input
                  type="text"
                  value={menuForm.name}
                  onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })}
                  required
                />
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
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={menuForm.description}
                  onChange={(e) => setMenuForm({ ...menuForm, description: e.target.value })}
                  rows="3"
                />
              </div>
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
                    {menuForm.available === 1 ? '✅ Available' : '❌ Unavailable'}
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
                <button type="submit" className="btn-primary">
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
