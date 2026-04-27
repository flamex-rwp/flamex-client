import React, { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { authAPI, ordersAPI } from '../services/api';
import { getPublicAssetUrl } from '../utils/publicAssetUrl';
import './ManagerPortal.css';
import OrderSystem from './OrderSystem';
import ScreenLoading from './ScreenLoading';
import {
  FaShoppingCart,
  FaUtensils,
  FaTruck,
  FaSignOutAlt,
  FaBars,
  FaTimes,
  FaChevronLeft,
  FaChevronRight,
  FaSync
} from 'react-icons/fa';

const DineInOrders = lazy(() => import('./DineInOrders'));
const DeliveryOrders = lazy(() => import('./DeliveryOrders'));

const STAFF_BASE = '/staff';

function NavLink({ to, children, badgeCount = 0, onClick }) {
  const location = useLocation();
  const isActive =
    location.pathname === to ||
    (to === `${STAFF_BASE}/orders` && (location.pathname === STAFF_BASE || location.pathname === `${STAFF_BASE}/`));
  const badgeNum = Number(badgeCount) || 0;
  const showBadge = badgeNum > 0;

  return (
    <Link to={to} onClick={onClick} className={`nav-link ${isActive ? 'active' : ''} ${showBadge ? 'has-badge' : ''}`}>
      {children}
      {showBadge && <span className="nav-badge">{badgeNum}</span>}
    </Link>
  );
}

const StaffPortal = ({ user, onLogout }) => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navLinksRef = useRef(null);
  const [showScroll, setShowScroll] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [pendingBadges, setPendingBadges] = useState({ dineIn: 0, delivery: 0 });
  const [nextSyncTime, setNextSyncTime] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const logoUrl = getPublicAssetUrl('logo.png');

  const handleLogout = async () => {
    try {
      await authAPI.logout();
      onLogout();
    } catch (err) {
      onLogout();
    }
  };

  const fullScreenRoutes = [STAFF_BASE, `${STAFF_BASE}/`, `${STAFF_BASE}/orders`];
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
    updateScrollState();
  }, [location.pathname]);

  const fetchPendingBadges = useCallback(async () => {
    let dineInCount = 0;
    let deliveryCount = 0;
    const today = new Date().toISOString().split('T')[0];

    try {
      const dineRes = await ordersAPI.getDineInStats({ filter: 'today', startDate: today, endDate: today, status: 'pending' });
      const dineData = dineRes.data?.data ?? dineRes.data ?? {};
      dineInCount = dineData.pendingOrders ?? 0;
    } catch (err) {}

    try {
      const delRes = await ordersAPI.getDeliveryStats({ filter: 'today', startDate: today, endDate: today, status: 'pending' });
      const delData = delRes.data?.data ?? delRes.data ?? {};
      deliveryCount = delData.pendingOrders ?? 0;
    } catch (err) {}

    setPendingBadges({
      dineIn: Number(dineInCount) || 0,
      delivery: Number(deliveryCount) || 0,
    });
  }, []);

  useEffect(() => {
    fetchPendingBadges();
    const interval = setInterval(fetchPendingBadges, 15000);
    const handleOrderCreated = () => setTimeout(() => fetchPendingBadges(), 500);
    window.addEventListener('orderCreated', handleOrderCreated);
    window.addEventListener('orderUpdated', handleOrderCreated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('orderCreated', handleOrderCreated);
      window.removeEventListener('orderUpdated', handleOrderCreated);
    };
  }, [fetchPendingBadges]);

  useEffect(() => {
    const fetchNextSyncTime = async () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        try {
          const response = await window.electronAPI.sync.getNextSyncTime();
          if (response.success) {
            setNextSyncTime(new Date(response.data.nextSyncTime));
          }
        } catch (error) {
          console.error('Error fetching next sync time:', error);
        }
      }
    };
    fetchNextSyncTime();
    const interval = setInterval(fetchNextSyncTime, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!nextSyncTime) return;
    const updateTimer = () => {
      const now = new Date();
      const diff = nextSyncTime.getTime() - now.getTime();
      if (diff <= 0 && typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.sync.getNextSyncTime().then((response) => {
          if (response.success) {
            setNextSyncTime(new Date(response.data.nextSyncTime));
          }
        });
      }
    };
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [nextSyncTime]);

  const formatTimeUntilSync = () => {
    if (!nextSyncTime) return '--:--:--';
    const now = new Date();
    const diff = nextSyncTime.getTime() - now.getTime();
    if (diff <= 0) return '00:00:00';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const handleSync = async () => {
    if (isSyncing || !window.electronAPI) return;
    setIsSyncing(true);
    setSyncStatus(null);
    try {
      const response = await window.electronAPI.sync.syncToCloud();
      if (response.success) {
        setSyncStatus({ type: 'success', message: response.message || 'Sync completed successfully' });
        const nextSyncResponse = await window.electronAPI.sync.getNextSyncTime();
        if (nextSyncResponse.success) {
          setNextSyncTime(new Date(nextSyncResponse.data.nextSyncTime));
        }
      } else {
        setSyncStatus({ type: 'error', message: response.message || 'Sync failed' });
      }
    } catch (error) {
      setSyncStatus({ type: 'error', message: error.message || 'Sync failed' });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  return (
    <div className="manager-portal">
      <nav className="navbar">
        <div className="nav-brand">
          <img src={logoUrl} alt="Flamex" className="nav-logo" />
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
            <NavLink to={`${STAFF_BASE}/orders`}>
              <FaShoppingCart /> <span>Orders</span>
            </NavLink>
            <NavLink to={`${STAFF_BASE}/dine-in-orders`} badgeCount={pendingBadges.dineIn}>
              <FaUtensils /> <span>Dine-In</span>
            </NavLink>
            <NavLink to={`${STAFF_BASE}/delivery-orders`} badgeCount={pendingBadges.delivery}>
              <FaTruck /> <span>Delivery</span>
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
          {typeof window !== 'undefined' && window.electronAPI && (
            <button
              className={`sync-button ${isSyncing ? 'syncing' : ''} ${syncStatus ? syncStatus.type : ''}`}
              onClick={handleSync}
              disabled={isSyncing}
              title={syncStatus ? syncStatus.message : 'Sync database to cloud'}
            >
              {isSyncing ? (
                <span>Processing...</span>
              ) : (
                <>
                  <FaSync />
                  <span>SYNC DB</span>
                  {nextSyncTime && (
                    <span className="sync-timer">{formatTimeUntilSync()}</span>
                  )}
                </>
              )}
            </button>
          )}
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

      {mobileMenuOpen && (
        <div className="mobile-menu">
          <NavLink to={`${STAFF_BASE}/orders`} onClick={() => setMobileMenuOpen(false)}>
            <FaShoppingCart /> <span>Orders</span>
          </NavLink>
          <NavLink to={`${STAFF_BASE}/dine-in-orders`} badgeCount={pendingBadges.dineIn} onClick={() => setMobileMenuOpen(false)}>
            <FaUtensils /> <span>Dine-In Orders</span>
          </NavLink>
          <NavLink to={`${STAFF_BASE}/delivery-orders`} badgeCount={pendingBadges.delivery} onClick={() => setMobileMenuOpen(false)}>
            <FaTruck /> <span>Delivery Orders</span>
          </NavLink>
        </div>
      )}

      <main className={`main-content ${isFullScreen ? 'full-screen' : ''}`}>
        <Suspense fallback={<ScreenLoading label="Loading..." />}>
          <Routes>
            <Route path="/" element={<OrderSystem basePath={STAFF_BASE} />} />
            <Route path="/orders" element={<OrderSystem basePath={STAFF_BASE} />} />
            <Route path="/dine-in-orders" element={<DineInOrders basePath={STAFF_BASE} />} />
            <Route path="/delivery-orders" element={<DeliveryOrders basePath={STAFF_BASE} />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

export default StaffPortal;
