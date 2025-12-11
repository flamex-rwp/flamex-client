import React, { useState, useEffect, useCallback } from 'react';
import { reportsAPI, ordersAPI } from '../services/api';
import dayjs from 'dayjs';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DeliveryReports = () => {
  const { showError } = useToast();
  const { online } = useOffline();
  const [activeTab, setActiveTab] = useState('overview');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [loading, setLoading] = useState({
    overview: false,
    areas: false,
    cod: false,
    stats: false
  });
  const [error, setError] = useState('');

  // Overview data
  const [overview, setOverview] = useState(null);
  const [deliveryStats, setDeliveryStats] = useState({
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
  });

  // Area analysis
  const [areas, setAreas] = useState([]);

  // COD data
  const [codStatus, setCodStatus] = useState('pending');
  const [codOrders, setCodOrders] = useState([]);
  const [selectedCod, setSelectedCod] = useState([]);

  // Get date range for API calls
  const getDateRange = useCallback(() => {
    let start, end;

    if (dateFilter === 'today') {
      start = dayjs().format('YYYY-MM-DD');
      end = dayjs().format('YYYY-MM-DD');
    } else if (dateFilter === 'yesterday') {
      start = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
      end = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    } else if (dateFilter === 'this_week') {
      start = dayjs().startOf('week').format('YYYY-MM-DD');
      end = dayjs().format('YYYY-MM-DD');
    } else if (dateFilter === 'this_month') {
      start = dayjs().startOf('month').format('YYYY-MM-DD');
      end = dayjs().format('YYYY-MM-DD');
    } else if (dateFilter === 'custom' && startDate && endDate) {
      start = startDate;
      end = endDate;
    } else {
      // Default to today
      start = dayjs().format('YYYY-MM-DD');
      end = dayjs().format('YYYY-MM-DD');
    }

    return { start, end };
  }, [dateFilter, startDate, endDate]);

  const fetchOverview = useCallback(async () => {
    // Don't fetch if offline
    if (!online) {
      return;
    }
    setLoading(prev => ({ ...prev, overview: true }));
    setError('');
    try {
      const { start, end } = getDateRange();
      const response = await reportsAPI.getOverview({ start, end });
      // Handle wrapped response: {success, message, data: {...}}
      const reportData = response.data.data || response.data || {};
      setOverview(reportData);
    } catch (err) {
      // Don't show error if offline
      if (!online) {
        return;
      }
      console.error('Failed to load overview report', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load overview report');
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to load overview report');
    } finally {
      setLoading(prev => ({ ...prev, overview: false }));
    }
  }, [getDateRange, showError, online]);

  const fetchDeliveryStats = useCallback(async () => {
    // Don't fetch if offline
    if (!online) {
      return;
    }
    setLoading(prev => ({ ...prev, stats: true }));
    try {
      const params = { filter: dateFilter };
      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }
      const response = await ordersAPI.getDeliveryStats(params);
      // Handle wrapped response: {success, message, data: {...}}
      const statsData = response.data.data || response.data || {};
      // Merge with defaults to ensure all fields exist
      setDeliveryStats({
        pending_payments: { count: 0, total_amount: 0, ...(statsData.pending_payments || {}) },
        received_payments: { count: 0, total_amount: 0, ...(statsData.received_payments || {}) },
        pending_deliveries: { count: 0, total_amount: 0, ...(statsData.pending_deliveries || {}) },
        completed_deliveries: { count: 0, total_amount: 0, ...(statsData.completed_deliveries || {}) },
        cod_pending: { count: 0, total_amount: 0, ...(statsData.cod_pending || {}) },
        cash_payments: { count: 0, total_amount: 0, ...(statsData.cash_payments || {}) },
        bank_payments: { count: 0, total_amount: 0, ...(statsData.bank_payments || {}) },
        total_orders: statsData.total_orders || 0,
        total_revenue: statsData.total_revenue || 0,
        average_order_value: statsData.average_order_value || 0
      });
    } catch (err) {
      // Don't show error if offline
      if (!online) {
        return;
      }
      console.error('Failed to load delivery stats', err);
      // Use default stats on error
      setDeliveryStats({
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
      });
    } finally {
      setLoading(prev => ({ ...prev, stats: false }));
    }
  }, [dateFilter, startDate, endDate, online]);

  const fetchAreas = useCallback(async () => {
    // Don't fetch if offline
    if (!online) {
      return;
    }
    setLoading(prev => ({ ...prev, areas: true }));
    setError('');
    try {
      const { start, end } = getDateRange();
      const response = await reportsAPI.getAreaAnalysis({ start, end });
      // Handle wrapped response: {success, message, data: [...]}
      const areasData = response.data.data || response.data || [];
      setAreas(Array.isArray(areasData) ? areasData : []);
    } catch (err) {
      // Don't show error if offline
      if (!online) {
        return;
      }
      console.error('Failed to load area analysis', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load area analysis');
    } finally {
      setLoading(prev => ({ ...prev, areas: false }));
    }
  }, [getDateRange, online]);

  const fetchCodOrders = useCallback(async (statusOverride) => {
    // Don't fetch if offline
    if (!online) {
      return;
    }
    const status = statusOverride || codStatus;
    setLoading(prev => ({ ...prev, cod: true }));
    setError('');
    try {
      const { start, end } = getDateRange();
      const response = await reportsAPI.getPendingCOD({
        status,
        start,
        end
      });
      // Handle wrapped response: {success, message, data: {orders: [...], totals: {...}}}
      const codData = response.data.data || response.data || { orders: [], totals: {} };
      setCodOrders(codData);
      setSelectedCod([]);
    } catch (err) {
      // Don't show error if offline
      if (!online) {
        return;
      }
      console.error('Failed to load COD list', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load COD list');
    } finally {
      setLoading(prev => ({ ...prev, cod: false }));
    }
  }, [codStatus, getDateRange, online]);

  // Fetch data when tab or date filter changes
  useEffect(() => {
    // Don't fetch if offline
    if (!online) {
      return;
    }
    fetchOverview();
    fetchDeliveryStats();
    if (activeTab === 'areas') {
      fetchAreas();
    } else if (activeTab === 'cod') {
      fetchCodOrders();
    }
  }, [activeTab, dateFilter, startDate, endDate, fetchOverview, fetchDeliveryStats, fetchAreas, fetchCodOrders, online]);

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

  const handleDateFilterChange = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    setDateFilter('custom');
    setShowCustomRange(false);
  };

  const toggleCodSelection = (orderId) => {
    setSelectedCod(prev => {
      if (prev.includes(orderId)) {
        return prev.filter(id => id !== orderId);
      }
      return [...prev, orderId];
    });
  };

  const handleBulkCollect = async () => {
    if (selectedCod.length === 0) return;
    try {
      setLoading(prev => ({ ...prev, cod: true }));
      // NOTE: Backend API endpoint /api/reports/mark-cod-collected does not exist yet
      // await reportsAPI.markCodCollected(selectedCod);
      console.warn('⚠️ Mark COD collected API not implemented on backend');
      showError('This feature is not yet implemented on the backend');
      // await fetchCodOrders();
      // await fetchDeliveryStats();
    } catch (err) {
      console.error('Failed to mark COD as collected', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to mark COD as collected');
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to mark COD as collected');
    } finally {
      setLoading(prev => ({ ...prev, cod: false }));
    }
  };

  const overviewSummary = overview?.summary || {
    total_orders: 0,
    total_revenue: 0,
    avg_order_value: 0,
    delivery_revenue: 0
  };

  // Map API response structure to UI expectation
  const rawBreakdown = overview?.paymentBreakdown || {};
  const paymentBreakdown = {
    cod: rawBreakdown.cash?.total || 0,
    prepaid: rawBreakdown.bank?.total || 0
  };

  const trendData = overview?.trend || [];

  // Show offline modal if offline
  if (!online) {
    return <OfflineModal title="Delivery Reports - Offline" />;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#1f2937' }}>
          🚚 Delivery Reports
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>
          Comprehensive delivery analytics, area analysis, and COD management
        </p>
      </div>

      {/* Date Filters */}
      <div style={{
        background: 'white',
        padding: '1rem',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ marginBottom: '0.75rem', fontWeight: '600', color: '#495057' }}>
          Filter by Date
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: showCustomRange ? '1rem' : 0 }}>
          <button
            onClick={() => handleQuickFilter('today')}
            style={{
              padding: '0.5rem 1rem',
              border: dateFilter === 'today' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
              borderRadius: '8px',
              background: dateFilter === 'today' ? 'var(--gradient-primary)' : 'white',
              color: dateFilter === 'today' ? 'white' : '#495057',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Today
          </button>
          <button
            onClick={() => handleQuickFilter('yesterday')}
            style={{
              padding: '0.5rem 1rem',
              border: dateFilter === 'yesterday' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
              borderRadius: '8px',
              background: dateFilter === 'yesterday' ? 'var(--gradient-primary)' : 'white',
              color: dateFilter === 'yesterday' ? 'white' : '#495057',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Yesterday
          </button>
          <button
            onClick={() => handleQuickFilter('this_week')}
            style={{
              padding: '0.5rem 1rem',
              border: dateFilter === 'this_week' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
              borderRadius: '8px',
              background: dateFilter === 'this_week' ? 'var(--gradient-primary)' : 'white',
              color: dateFilter === 'this_week' ? 'white' : '#495057',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            This Week
          </button>
          <button
            onClick={() => handleQuickFilter('this_month')}
            style={{
              padding: '0.5rem 1rem',
              border: dateFilter === 'this_month' ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
              borderRadius: '8px',
              background: dateFilter === 'this_month' ? 'var(--gradient-primary)' : 'white',
              color: dateFilter === 'this_month' ? 'white' : '#495057',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            This Month
          </button>
          <button
            onClick={() => handleQuickFilter('custom')}
            style={{
              padding: '0.5rem 1rem',
              border: (dateFilter === 'custom' || showCustomRange) ? '2px solid var(--color-primary)' : '2px solid #e2e8f0',
              borderRadius: '8px',
              background: (dateFilter === 'custom' || showCustomRange) ? 'var(--gradient-primary)' : 'white',
              color: (dateFilter === 'custom' || showCustomRange) ? 'white' : '#495057',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Custom
          </button>
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
            color: '#856404',
            fontWeight: '600'
          }}>
            📅 Active Range: {dayjs(startDate).format('MMM D, YYYY')} - {dayjs(endDate).format('MMM D, YYYY')}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '2rem',
        borderBottom: '2px solid #e2e8f0'
      }}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderBottom: activeTab === 'overview' ? '3px solid var(--color-primary)' : '3px solid transparent',
            background: 'transparent',
            color: activeTab === 'overview' ? 'var(--color-primary)' : '#6b7280',
            fontWeight: activeTab === 'overview' ? 'bold' : '600',
            cursor: 'pointer',
            fontSize: '1rem',
            marginBottom: '-2px'
          }}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('areas')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderBottom: activeTab === 'areas' ? '3px solid var(--color-primary)' : '3px solid transparent',
            background: 'transparent',
            color: activeTab === 'areas' ? 'var(--color-primary)' : '#6b7280',
            fontWeight: activeTab === 'areas' ? 'bold' : '600',
            cursor: 'pointer',
            fontSize: '1rem',
            marginBottom: '-2px'
          }}
        >
          Area Analysis
        </button>
        <button
          onClick={() => setActiveTab('cod')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderBottom: activeTab === 'cod' ? '3px solid var(--color-primary)' : '3px solid transparent',
            background: 'transparent',
            color: activeTab === 'cod' ? 'var(--color-primary)' : '#6b7280',
            fontWeight: activeTab === 'cod' ? 'bold' : '600',
            cursor: 'pointer',
            fontSize: '1rem',
            marginBottom: '-2px'
          }}
        >
          COD Collection
        </button>
      </div>

      {error && (
        <div style={{
          padding: '1rem',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '8px',
          color: '#c33',
          marginBottom: '1rem'
        }}>
          {error}
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          {loading.overview || loading.stats ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
          ) : (
            <>
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
                {/* Total Orders */}
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
                    {deliveryStats.total_orders || deliveryStats.totalOrders || overviewSummary.totalOrders || overviewSummary.total_orders}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                    {formatCurrency(deliveryStats.total_revenue || deliveryStats.totalRevenue || overviewSummary.totalRevenue || overviewSummary.total_revenue)}
                  </div>
                </div>

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
                    {deliveryStats.pending_payments?.count || 0}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                    {formatCurrency(deliveryStats.pending_payments?.total_amount || 0)}
                  </div>
                </div>

                {/* Received Payments */}
                <div style={{
                  background: 'linear-gradient(135deg, #28a745 0%, #1e7e34 100%)',
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
                    {deliveryStats.received_payments?.count || 0}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                    {formatCurrency(deliveryStats.received_payments?.total_amount || 0)}
                  </div>
                </div>

                {/* Pending Deliveries */}
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
                  <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Pending Deliveries</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {deliveryStats.pending_deliveries?.count || 0}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                    {formatCurrency(deliveryStats.pending_deliveries?.total_amount || 0)}
                  </div>
                </div>

                {/* Completed Deliveries */}
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
                  <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Completed Deliveries</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {deliveryStats.completed_deliveries?.count || 0}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                    {formatCurrency(deliveryStats.completed_deliveries?.total_amount || 0)}
                  </div>
                </div>

                {/* Average Order Value */}
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
                  <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Avg Order Value</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {formatCurrency(deliveryStats.average_order_value || deliveryStats.averageOrderValue || overviewSummary.averageOrderValue || overviewSummary.avg_order_value)}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                    Per order
                  </div>
                </div>
              </div>

              {/* Payment Breakdown & Daily Trend */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1.5rem',
                marginBottom: '2rem'
              }}>
                {/* Payment Breakdown */}
                <div style={{
                  background: 'white',
                  padding: '1.5rem',
                  borderRadius: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937' }}>
                    💳 Payment Breakdown
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: '#fff4d8', borderRadius: '8px' }}>
                      <span style={{ fontWeight: '600', color: '#856404' }}>COD (Cash)</span>
                      <strong style={{ fontSize: '1.1rem', color: '#856404' }}>
                        {formatCurrency(paymentBreakdown.cod)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: '#e7f3ff', borderRadius: '8px' }}>
                      <span style={{ fontWeight: '600', color: '#0c5460' }}>Prepaid (Bank)</span>
                      <strong style={{ fontSize: '1.1rem', color: '#0c5460' }}>
                        {formatCurrency(paymentBreakdown.prepaid)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: '#f0f0f0', borderRadius: '8px', borderTop: '2px solid #dee2e6' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>Total</span>
                      <strong style={{ fontSize: '1.2rem' }}>
                        {formatCurrency(paymentBreakdown.cod + paymentBreakdown.prepaid)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Daily Trend */}
                <div style={{
                  background: 'white',
                  padding: '1.5rem',
                  borderRadius: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937' }}>
                    📈 Daily Trend
                  </h3>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {trendData.length === 0 ? (
                      <p style={{ color: '#6b7280', textAlign: 'center', padding: '1rem' }}>No orders in this range.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {trendData.map(row => (
                          <div key={row.date} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.75rem',
                            background: '#f8f9fa',
                            borderRadius: '6px'
                          }}>
                            <span style={{ fontWeight: '600', color: '#495057' }}>
                              {dayjs(row.date).format('MMM D')}
                            </span>
                            <span style={{ color: '#6b7280' }}>{row.orders} orders</span>
                            <strong style={{ color: '#1f2937' }}>
                              {formatCurrency(row.revenue || 0)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Area Analysis Tab */}
      {activeTab === 'areas' && (
        <div>
          {loading.areas ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>Loading area analysis...</div>
          ) : (
            <div style={{
              background: 'white',
              padding: '1.5rem',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.5rem', fontWeight: 'bold', color: '#1f2937' }}>
                📍 Area Analysis
              </h3>
              {areas.length === 0 ? (
                <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
                  No delivery orders found in this range.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold', color: '#495057' }}>Area</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold', color: '#495057' }}>Orders</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold', color: '#495057' }}>Revenue</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold', color: '#495057' }}>Avg Order Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areas.map((area, index) => (
                        <tr key={area.area || index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.75rem', fontWeight: '600', color: '#1f2937' }}>{area.area || 'Unknown'}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: '#495057' }}>{area.totalOrders || area.orders || 0}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#1f2937' }}>
                            {formatCurrency(area.totalRevenue || area.revenue || 0)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: '#6b7280' }}>
                            {formatCurrency(area.averageOrderValue || area.avg_order_value || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* COD Collection Tab */}
      {activeTab === 'cod' && (
        <div>
          <div style={{
            background: 'white',
            padding: '1rem',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            marginBottom: '1.5rem',
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '600' }}>
              Status:
              <select
                value={codStatus}
                onChange={(e) => {
                  setCodStatus(e.target.value);
                  fetchCodOrders(e.target.value);
                }}
                style={{
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '2px solid #dee2e6',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="pending">Pending</option>
                <option value="completed">Collected</option>
                <option value="all">All</option>
              </select>
            </label>
            <button
              onClick={() => fetchCodOrders()}
              disabled={loading.cod}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '2px solid #6c757d',
                background: 'white',
                color: '#6c757d',
                fontWeight: '600',
                cursor: loading.cod ? 'not-allowed' : 'pointer',
                opacity: loading.cod ? 0.5 : 1
              }}
            >
              Refresh
            </button>
            <button
              onClick={handleBulkCollect}
              disabled={selectedCod.length === 0 || loading.cod}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: selectedCod.length > 0 ? '#28a745' : '#6c757d',
                color: 'white',
                fontWeight: '600',
                cursor: (selectedCod.length === 0 || loading.cod) ? 'not-allowed' : 'pointer',
                opacity: (selectedCod.length === 0 || loading.cod) ? 0.5 : 1
              }}
            >
              Mark Selected Collected ({selectedCod.length})
            </button>
            <div style={{ marginLeft: 'auto', fontSize: '0.9rem', color: '#6b7280' }}>
              <strong>Pending:</strong> {formatCurrency(codOrders?.totals?.pendingAmount || 0)} ·
              <strong> Collected:</strong> {formatCurrency(codOrders?.totals?.collectedAmount || 0)}
            </div>
          </div>

          {loading.cod ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>Loading COD data...</div>
          ) : (
            <div style={{
              background: 'white',
              padding: '1.5rem',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              {(codOrders?.orders || []).length === 0 ? (
                <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
                  No COD orders found for this filter.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold', color: '#495057' }}></th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold', color: '#495057' }}>Order</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold', color: '#495057' }}>Customer</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold', color: '#495057' }}>Amount</th>
                        <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold', color: '#495057' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(codOrders?.orders || []).map(order => (
                        <tr key={order.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.75rem' }}>
                            {order.payment_status === 'pending' && (
                              <input
                                type="checkbox"
                                checked={selectedCod.includes(order.id)}
                                onChange={() => toggleCodSelection(order.id)}
                                style={{ cursor: 'pointer' }}
                              />
                            )}
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            <strong style={{ color: '#1f2937' }}>#{order.orderNumber || order.order_number || order.id}</strong>
                            <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: '0.25rem' }}>
                              {dayjs(order.createdAt || order.created_at).format('MMM D, h:mm A')}
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            <div style={{ fontWeight: '600', color: '#1f2937' }}>{order.customerName || order.customer_name || 'Walk-in'}</div>
                            <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>{order.customerPhone || order.customer_phone || '-'}</div>
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#1f2937' }}>
                            {formatCurrency(order.totalAmount || order.total_amount || 0)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                            <span style={{
                              padding: '0.25rem 0.75rem',
                              borderRadius: '20px',
                              background: (order.paymentStatus || order.payment_status) === 'completed' ? '#e6ffed' : '#fff4d8',
                              color: (order.paymentStatus || order.payment_status) === 'completed' ? '#198754' : '#7c2d12',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              textTransform: 'capitalize'
                            }}>
                              {(order.paymentStatus || order.payment_status) === 'completed' ? 'Collected' : 'Pending'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DeliveryReports;
