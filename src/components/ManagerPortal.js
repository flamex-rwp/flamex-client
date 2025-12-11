import React, { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { authAPI, ordersAPI } from '../services/api';
import './ManagerPortal.css';
import OrderSystem from './OrderSystem';
import { Spinner } from './LoadingSkeleton';
import { getAllOrders } from '../utils/offlineDB';
import { 
  FaShoppingCart, 
  FaUtensils, 
  FaTruck, 
  FaChartLine, 
  FaChartBar, 
  FaHistory, 
  FaBox, 
  FaUsers, 
  FaMoneyBillWave,
  FaSignOutAlt,
  FaBars,
  FaTimes,
  FaChevronLeft,
  FaChevronRight
} from 'react-icons/fa';

// Lazy load heavy components
const OrderHistory = lazy(() => import('./OrderHistory'));
const ExpenseHistory = lazy(() => import('./ExpenseHistory'));
const DailySalesSummary = lazy(() => import('./DailySalesSummary'));
const ItemsSalesReport = lazy(() => import('./ItemsSalesReport'));
const DeliveryReports = lazy(() => import('./DeliveryReports'));
const DineInOrders = lazy(() => import('./DineInOrders'));
const DeliveryOrders = lazy(() => import('./DeliveryOrders'));
const CustomerManagement = lazy(() => import('./CustomerManagement'));

// Lazy load heavy components

function NavLink({ to, children, badgeCount = 0, onClick }) {
  const location = useLocation();
  const isActive =
    location.pathname === to ||
    (to === '/manager/orders' && (location.pathname === '/manager' || location.pathname === '/manager/'));
  const showBadge = Number(badgeCount) > 0;

  return (
    <Link to={to} onClick={onClick} className={`nav-link ${isActive ? 'active' : ''} ${showBadge ? 'has-badge' : ''}`}>
      {children}
      {showBadge && <span className="nav-badge">{badgeCount}</span>}
    </Link>
  );
}

const ManagerPortal = ({ user, onLogout }) => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navLinksRef = useRef(null);
  const [showScroll, setShowScroll] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [pendingBadges, setPendingBadges] = useState({ dineIn: 0, delivery: 0 });

  const handleLogout = async () => {
    try {
      await authAPI.logout();
      onLogout();
    } catch (err) {
      console.error('Logout error:', err);
      onLogout();
    }
  };

  // Check if current route is orders page
  const fullScreenRoutes = ['/manager', '/manager/', '/manager/orders'];
  const isFullScreen = fullScreenRoutes.includes(location.pathname);

  const updateScrollState = () => {
    const el = navLinksRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    setShowScroll(hasOverflow);
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  };

  const scrollByAmount = (delta) => {
    const el = navLinksRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  useEffect(() => {
    updateScrollState();
    const el = navLinksRef.current;
    const handleResize = () => updateScrollState();
    const handleScroll = () => updateScrollState();
    window.addEventListener('resize', handleResize);
    if (el) el.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (el) el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    // Re-evaluate on route change
    updateScrollState();
  }, [location.pathname]);

  const fetchPendingBadges = useCallback(async () => {
    let dineInCount = 0;
    let deliveryCount = 0;

    // Online stats (best effort)
    try {
      const dineRes = await ordersAPI.getDineInStats();
      const dineData = dineRes.data?.data || dineRes.data || {};
      dineInCount =
        dineData.pendingOrders ??
        dineData.pending_orders ??
        dineData.pending_payments?.count ??
        0;
    } catch (err) {
      console.warn('[ManagerPortal] Failed to fetch dine-in stats for badge:', err?.message || err);
    }

    try {
      const delRes = await ordersAPI.getDeliveryStats();
      const delData = delRes.data?.data || delRes.data || {};
      deliveryCount =
        delData.pending_deliveries?.count ??
        delData.pendingDeliveries ??
        delData.pending_orders ??
        delData.pending_payments?.count ??
        0;
    } catch (err) {
      console.warn('[ManagerPortal] Failed to fetch delivery stats for badge:', err?.message || err);
    }

    // Include offline pending orders (unsynced)
    try {
      const offlineOrders = await getAllOrders({ synced: false });
      offlineOrders.forEach((order) => {
        const orderTypeRaw = order.order_type || order.orderType;
        const normalizedType = orderTypeRaw === 'delivery' ? 'delivery' : 'dine_in';
        const orderStatus = order.orderStatus || order.order_status || order.status || 'pending';
        const paymentStatus = order.paymentStatus || order.payment_status || 'pending';
        const deliveryStatus = order.deliveryStatus || order.delivery_status || 'pending';
        const isCompleted =
          orderStatus === 'completed' ||
          paymentStatus === 'completed' ||
          deliveryStatus === 'delivered';

        if (!isCompleted) {
          if (normalizedType === 'delivery') {
            deliveryCount += 1;
          } else {
            dineInCount += 1;
          }
        }
      });
    } catch (err) {
      console.warn('[ManagerPortal] Failed to check offline pending orders for badge:', err?.message || err);
    }

    setPendingBadges({
      dineIn: Number(dineInCount) || 0,
      delivery: Number(deliveryCount) || 0,
    });
  }, []);

  useEffect(() => {
    fetchPendingBadges();
    const interval = setInterval(fetchPendingBadges, 15000);
    return () => clearInterval(interval);
  }, [fetchPendingBadges]);

  return (
    <div className="manager-portal">
      <nav className="navbar">
        <div className="nav-brand">
          <img src="/logo.png" alt="Flamex" className="nav-logo" />
          <div className="nav-brand-text">
            <h1 className="nav-title">Flamex</h1>
            <p className="nav-subtitle">POS System</p>
          </div>
        </div>
        <div className="nav-links-wrapper">
          {showScroll && (
            <button
              className="nav-scroll-btn"
              onClick={() => scrollByAmount(-160)}
              aria-label="Scroll left"
              disabled={atStart}
            >
              <FaChevronLeft />
            </button>
          )}
          <div className="nav-links" ref={navLinksRef}>
            <NavLink to="/manager/orders">
              <FaShoppingCart /> <span>Orders</span>
            </NavLink>
            <NavLink to="/manager/dine-in-orders" badgeCount={pendingBadges.dineIn}>
              <FaUtensils /> <span>Dine-In</span>
            </NavLink>
            <NavLink to="/manager/delivery-orders" badgeCount={pendingBadges.delivery}>
              <FaTruck /> <span>Delivery</span>
            </NavLink>
            <NavLink to="/manager/delivery-reports">
              <FaChartLine /> <span>Delivery Reports</span>
            </NavLink>
            <NavLink to="/manager/daily-summary">
              <FaChartBar /> <span>Summary</span>
            </NavLink>
            <NavLink to="/manager/order-history">
              <FaHistory /> <span>History</span>
            </NavLink>
            <NavLink to="/manager/items-sales">
              <FaBox /> <span>Items</span>
            </NavLink>
            <NavLink to="/manager/customers">
              <FaUsers /> <span>Customers</span>
            </NavLink>
            <NavLink to="/manager/expense-history">
              <FaMoneyBillWave /> <span>Expenses</span>
            </NavLink>
          </div>
          {showScroll && (
            <button
              className="nav-scroll-btn"
              onClick={() => scrollByAmount(160)}
              aria-label="Scroll right"
              disabled={atEnd}
            >
              <FaChevronRight />
            </button>
          )}
        </div>
        <div className="nav-right">
          {/* <div className="user-info">
            <div className="user-avatar">
              {user?.fullName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="user-details">
              <span className="user-name">{user?.fullName || 'User'}</span>
              <span className="user-role">{user?.role === 'manager' ? 'Manager' : 'Staff'}</span>
            </div>
          </div> */}
          <button className="logout-button" onClick={handleLogout}>
            <FaSignOutAlt /> <span>Logout</span>
          </button>
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <FaTimes /> : <FaBars />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="mobile-menu">
          <NavLink to="/manager/orders" onClick={() => setMobileMenuOpen(false)}>
            <FaShoppingCart /> <span>Orders</span>
          </NavLink>
          <NavLink to="/manager/dine-in-orders" badgeCount={pendingBadges.dineIn} onClick={() => setMobileMenuOpen(false)}>
            <FaUtensils /> <span>Dine-In Orders</span>
          </NavLink>
          <NavLink to="/manager/delivery-orders" badgeCount={pendingBadges.delivery} onClick={() => setMobileMenuOpen(false)}>
            <FaTruck /> <span>Delivery Orders</span>
          </NavLink>
          <NavLink to="/manager/delivery-reports" onClick={() => setMobileMenuOpen(false)}>
            <FaChartLine /> <span>Delivery Reports</span>
          </NavLink>
          <NavLink to="/manager/daily-summary" onClick={() => setMobileMenuOpen(false)}>
            <FaChartBar /> <span>Summary</span>
          </NavLink>
          <NavLink to="/manager/order-history" onClick={() => setMobileMenuOpen(false)}>
            <FaHistory /> <span>Order History</span>
          </NavLink>
          <NavLink to="/manager/items-sales" onClick={() => setMobileMenuOpen(false)}>
            <FaBox /> <span>Items Sales</span>
          </NavLink>
          <NavLink to="/manager/customers" onClick={() => setMobileMenuOpen(false)}>
            <FaUsers /> <span>Customers</span>
          </NavLink>
          <NavLink to="/manager/expense-history" onClick={() => setMobileMenuOpen(false)}>
            <FaMoneyBillWave /> <span>Expense History</span>
          </NavLink>
        </div>
      )}

      <main className={`main-content ${isFullScreen ? 'full-screen' : ''}`}>
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}><Spinner size="lg" /></div>}>
          <Routes>
            <Route path="/" element={<OrderSystem />} />
            <Route path="/orders" element={<OrderSystem />} />
            <Route path="/dine-in-orders" element={<DineInOrders />} />
            <Route path="/delivery-orders" element={<DeliveryOrders />} />
            <Route path="/delivery-reports" element={<DeliveryReports />} />
            <Route path="/daily-summary" element={<DailySalesSummary />} />
            <Route path="/order-history" element={<OrderHistory />} />
            <Route path="/items-sales" element={<ItemsSalesReport />} />
            <Route path="/customers" element={<CustomerManagement />} />
            <Route path="/expense-history" element={<ExpenseHistory />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

export default ManagerPortal;
