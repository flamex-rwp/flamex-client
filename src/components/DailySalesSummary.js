import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ordersAPI, API_BASE_URL } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import ScreenLoading from './ScreenLoading';
import AppliedFiltersBanner from './AppliedFiltersBanner';
import { getDateFilterBannerLabel, isCustomDateRangeApplied } from '../utils/dateFilterBanner';
import {
  readFilterSession,
  writeFilterSession,
  FILTER_STORAGE_KEYS,
  sanitizeDateFilter
} from '../utils/filterSessionPersistence';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';
import {
  FaChartBar,
  FaMoneyBillWave,
  FaUniversity,
  FaFilePdf,
  FaChartLine,
  FaUtensils,
  FaTruck,
  FaCreditCard,
  FaDollarSign,
  FaUser,
  FaPhone,
  FaMapMarkerAlt
} from 'react-icons/fa';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const readAmount = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (typeof value === 'object' && value.amount != null) return Number(value.amount) || 0;
  return 0;
};

const readOrdersCount = (value) => {
  if (value == null) return 0;
  if (typeof value === 'object') {
    const orders = value.orders ?? value.count ?? value.totalOrders;
    return Number(orders) || 0;
  }
  return 0;
};

const normalizeV2ResponseData = (responseData) => {
  if (!responseData) return null;
  if (responseData.success && responseData.data) return responseData.data;
  if (responseData.data && (responseData.topSummary || responseData.orders)) return responseData;
  if (responseData.data && typeof responseData.data === 'object') return responseData.data;
  return responseData;
};

const EMPTY_ORDER_STATS = {
  dineIn: {
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    completedOrders: 0,
    completedRevenue: 0,
    cancelledOrders: 0,
    cancelledRevenue: 0,
    cashOrders: 0,
    cashRevenue: 0,
    bankOrders: 0,
    bankRevenue: 0,
    pendingPayments: { count: 0, total: 0 }
  },
  delivery: {
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    completedOrders: 0,
    completedRevenue: 0,
    cancelledOrders: 0,
    cancelledRevenue: 0,
    cashOrders: 0,
    cashRevenue: 0,
    bankOrders: 0,
    bankRevenue: 0,
    pendingPayments: { count: 0, total: 0 }
  },
  combined: {
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    completedOrders: 0,
    completedRevenue: 0,
    cancelledOrders: 0,
    cancelledRevenue: 0,
    cashOrders: 0,
    cashRevenue: 0,
    bankOrders: 0,
    bankRevenue: 0
  }
};

const DailySalesSummary = () => {
  const { showError } = useToast();
  const { online } = useOffline();
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const initialDateFilters = useMemo(() => {
    const s = readFilterSession(FILTER_STORAGE_KEYS.dailySalesSummary);
    if (!s) {
      return { dateFilter: 'today', startDate: null, endDate: null, showCustomRange: false };
    }
    return {
      dateFilter: sanitizeDateFilter(s.dateFilter),
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      showCustomRange: Boolean(s.showCustomRange)
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState(initialDateFilters.dateFilter);
  const [startDate, setStartDate] = useState(initialDateFilters.startDate);
  const [endDate, setEndDate] = useState(initialDateFilters.endDate);
  const [showCustomRange, setShowCustomRange] = useState(initialDateFilters.showCustomRange);

  const [orders, setOrders] = useState([]);

  const [orderStats, setOrderStats] = useState(EMPTY_ORDER_STATS);
  const [summaryTop, setSummaryTop] = useState({
    totalRevenueAmount: 0,
    totalRevenueOrders: 0,
    netProfitAmount: 0,
    marginPercent: 0,
    cashInHandsAmount: 0,
    cashInHandsOrders: 0,
    bankBalanceAmount: 0,
    bankBalanceOrders: 0,
    totalExpenseAmount: 0,
    averageOrderValueAmount: 0,
  });

  const [expenses, setExpenses] = useState({
    total: 0,
    cash: 0,
    bank: 0,
    count: 0
  });

  // Avoid full-page unmount "blink" when changing filters:
  // show full-screen loading only on the first load, and use an overlay afterwards.
  const hasLoadedOnceRef = useRef(false);
  const loadingMinDurationMs = 300;

  const fetchData = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    setError('');

    try {
      // Build query parameters based on date filter
      const params = {};

      if (dateFilter === 'today') {
        // Use business day date (4 AM boundary) only for logging / reference.
        // We still pass calendar dates to backend, and apply 4 AM logic client-side.
        const today = dayjs().format('YYYY-MM-DD');
        params.startDate = today;
        params.endDate = today;
        console.log('Today filter (business day 4AM) - Calendar range:', {
          startDate: params.startDate,
          endDate: params.endDate
        });
      } else if (dateFilter === 'yesterday') {
        const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
        params.startDate = yesterday;
        params.endDate = yesterday;
      } else if (dateFilter === 'this_week') {
        const weekStart = dayjs().startOf('week').format('YYYY-MM-DD');
        params.startDate = weekStart;
        params.endDate = dayjs().format('YYYY-MM-DD');
      } else if (dateFilter === 'this_month') {
        const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
        params.startDate = monthStart;
        params.endDate = dayjs().format('YYYY-MM-DD');
      } else if (dateFilter === 'custom' && startDate && endDate) {
        // Ensure dates are in YYYY-MM-DD format for IPC
        params.startDate = dayjs(startDate).format('YYYY-MM-DD');
        params.endDate = dayjs(endDate).format('YYYY-MM-DD');
      } else if (dateFilter === 'custom') {
        const t = dayjs().format('YYYY-MM-DD');
        params.startDate = t;
        params.endDate = t;
      }

      const summaryResponse = await ordersAPI.getOrderStatisticsV2(params);
      const summaryData = normalizeV2ResponseData(summaryResponse?.data);

      const topSummary = summaryData?.topSummary || {};
      const orderTypeBreakdown = summaryData?.orderTypeBreakdown || {};
      const paymentMethodBreakdown = summaryData?.paymentMethodBreakdown || {};
      const expensesBreakdown = summaryData?.expensesBreakdown || {};

      const safeDineIn = orderTypeBreakdown.dineIn || {};
      const safeDelivery = orderTypeBreakdown.delivery || {};
      const safeCash = paymentMethodBreakdown.cash || {};
      const safeBank = paymentMethodBreakdown.bank || {};

      const totalRevenueAmount = readAmount(topSummary.totalRevenue);
      const totalRevenueOrders = readOrdersCount(topSummary.totalRevenue);
      const netProfitAmount = readAmount(topSummary.netProfit);
      const marginPercent = Number(topSummary?.netProfit?.marginPercent) || 0;
      const cashInHandsAmount = readAmount(topSummary.cashInHands);
      const cashInHandsOrders = readOrdersCount(topSummary.cashInHands);
      const bankBalanceAmount = readAmount(topSummary.bankBalance);
      const bankBalanceOrders = readOrdersCount(topSummary.bankBalance);
      const totalExpenseAmount = readAmount(topSummary.totalExpense);
      const averageOrderValueAmount = readAmount(topSummary.averageOrderValue);

      setSummaryTop({
        totalRevenueAmount,
        totalRevenueOrders,
        netProfitAmount,
        marginPercent,
        cashInHandsAmount,
        cashInHandsOrders,
        bankBalanceAmount,
        bankBalanceOrders,
        totalExpenseAmount,
        averageOrderValueAmount,
      });

      const mapBreakdown = (b) => ({
        totalOrders: Number(b.totalOrders) || 0,
        totalRevenue: readAmount(b.totalRevenue),
        avgOrderValue: readAmount(b.avgOrderValue),
        completedOrders: Number(b.completedOrders) || 0,
        completedRevenue: readAmount(b.completedAmount ?? b.completedRevenue),
        cancelledOrders: Number(b.cancelledOrders) || 0,
        cancelledRevenue: readAmount(b.cancelledAmount ?? b.cancelledRevenue),
        cashOrders: Number(b.cashOrders) || 0,
        cashRevenue: readAmount(b.cashAmount ?? b.cashRevenue),
        bankOrders: Number(b.bankOrders) || 0,
        bankRevenue: readAmount(b.bankAmount ?? b.bankRevenue),
        pendingPayments: { count: 0, total: 0 },
      });

      setOrderStats({
        dineIn: mapBreakdown(safeDineIn),
        delivery: mapBreakdown(safeDelivery),
        combined: {
          totalOrders: totalRevenueOrders,
          totalRevenue: totalRevenueAmount,
          avgOrderValue: averageOrderValueAmount,
          completedOrders: totalRevenueOrders,
          completedRevenue: totalRevenueAmount,
          cancelledOrders: 0,
          cancelledRevenue: 0,
          cashOrders: Number(safeCash.orders) || 0,
          cashRevenue: readAmount(safeCash.amount),
          bankOrders: Number(safeBank.orders) || 0,
          bankRevenue: readAmount(safeBank.amount),
        },
      });

      setExpenses({
        total: readAmount(expensesBreakdown.totalExpenses),
        cash: readAmount(expensesBreakdown.cashExpenses),
        bank: readAmount(expensesBreakdown.bankExpenses),
        count: Number(expensesBreakdown.count) || 0,
      });

      const ordersArray = Array.isArray(summaryData?.orders) ? summaryData.orders : [];
      setOrders(ordersArray);
    } catch (err) {
      console.error('Failed to load summary data', err);

      // For network errors, don't show error toast - cache will handle it
      // Only show error for actual API errors (4xx, 5xx)
      if (err.response) {
        const errorMessage = err.formattedMessage || err.response?.data?.error || err.message || 'Failed to load summary data';
        setError(errorMessage);
        // Only show error toast for non-network errors (4xx, 5xx)
        if (err.response.status >= 400 && err.response.status < 500) {
          showError(errorMessage);
        }
      } else {
        // Network error - set empty data gracefully, don't show toast
      setOrders([]);
      setOrderStats(EMPTY_ORDER_STATS);
        setExpenses({ total: 0, cash: 0, bank: 0, count: 0 });
        setSummaryTop({
          totalRevenueAmount: 0,
          totalRevenueOrders: 0,
          netProfitAmount: 0,
          marginPercent: 0,
          cashInHandsAmount: 0,
          cashInHandsOrders: 0,
          bankBalanceAmount: 0,
          bankBalanceOrders: 0,
          totalExpenseAmount: 0,
          averageOrderValueAmount: 0,
        });
        setError(''); // Clear error for network issues
      }
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = loadingMinDurationMs - elapsed;
      if (remaining > 0) {
        setTimeout(() => setLoading(false), remaining);
      } else {
        setLoading(false);
      }
      hasLoadedOnceRef.current = true;
    }
  }, [dateFilter, startDate, endDate, showError]);

  useEffect(() => {
    // Log backend server URL being used
    console.log('📊 Sales Summary - Backend Server URL:', API_BASE_URL);
    console.log('📊 Sales Summary - Environment:', {
      apiUrl: API_BASE_URL,
      isLocalhost: API_BASE_URL.includes('localhost'),
      isDeployed: !API_BASE_URL.includes('localhost')
    });

    fetchData();
  }, [fetchData]);

  useEffect(() => {
    writeFilterSession(FILTER_STORAGE_KEYS.dailySalesSummary, {
      dateFilter,
      startDate,
      endDate,
      showCustomRange
    });
  }, [dateFilter, startDate, endDate, showCustomRange]);

  const handleQuickFilter = (filter) => {
    if (filter === 'custom') {
      setDateFilter('custom');
      setShowCustomRange(true);
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

  const clearAppliedCustomRange = useCallback(() => {
    setDateFilter('custom');
    setStartDate(null);
    setEndDate(null);
    setShowCustomRange(true);
  }, []);

  const getOrderStatusColor = (status) => {
    const colors = {
      pending: { background: '#e2e3e5', color: '#383d41' },
      preparing: { background: '#fff3cd', color: '#856404' },
      ready: { background: '#cfe2ff', color: '#084298' },
      out_for_delivery: { background: '#cfe2ff', color: '#084298' },
      delivered: { background: '#d4edda', color: '#155724' },
      completed: { background: '#d4edda', color: '#155724' },
      cancelled: { background: '#f8d7da', color: '#721c24' }
    };
    return colors[status] || colors.pending;
  };

  const getPaymentStatusColor = (status) => {
    return status === 'completed'
      ? { background: '#e6ffed', color: '#198754' }
      : { background: '#fff4d8', color: '#7c2d12' };
  };

  // Calculate derived metrics
  const netProfit = summaryTop.netProfitAmount;
  const cashInHand = summaryTop.cashInHandsAmount;
  const bankBalance = summaryTop.bankBalanceAmount;
  const profitMargin = Number(summaryTop.marginPercent || 0).toFixed(1);

  const getDateRangeText = () => {
    if (startDate && endDate) {
      return `${dayjs(startDate).format('MMM D, YYYY')} to ${dayjs(endDate).format('MMM D, YYYY')}`;
    } else if (dateFilter === 'today') {
      return dayjs().format('MMM D, YYYY');
    } else if (dateFilter === 'yesterday') {
      return dayjs().subtract(1, 'day').format('MMM D, YYYY');
    } else if (dateFilter === 'this_week') {
      const weekStart = dayjs().startOf('week');
      const weekEnd = dayjs().endOf('week');
      return `${weekStart.format('MMM D')} - ${weekEnd.format('MMM D, YYYY')}`;
    } else if (dateFilter === 'this_month') {
      return dayjs().format('MMMM YYYY');
    } else {
      return dayjs().format('MMMM D, YYYY');
    }
  };

  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;
      const margin = 15;
      const lineHeight = 7;
      const sectionSpacing = 10;

      // Helper function to add a new page if needed
      const checkPageBreak = (requiredSpace = 20) => {
        if (yPosition + requiredSpace > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }
      };

      // Header
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('SALES SUMMARY REPORT', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Flamex', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight * 2;

      // Date Range
      doc.setFontSize(10);
      doc.text(`Date Range: ${getDateRangeText()}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Generated: ${dayjs().format('MMMM D, YYYY h:mm A')}`, margin, yPosition);
      yPosition += sectionSpacing;

      // Draw a line
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      // Summary Section
      checkPageBreak(30);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('SUMMARY', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Orders: ${orderStats.combined.totalOrders}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Total Revenue: ${formatCurrency(orderStats.combined.totalRevenue)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Average Order Value: ${formatCurrency(orderStats.combined.avgOrderValue)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Net Profit: ${formatCurrency(netProfit)} (${profitMargin}% margin)`, margin, yPosition);
      yPosition += sectionSpacing;

      // Payment Breakdown
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('PAYMENT BREAKDOWN', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Cash Payments: ${formatCurrency(orderStats.combined.cashRevenue)} (${orderStats.combined.cashOrders} orders)`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Bank Transfer: ${formatCurrency(orderStats.combined.bankRevenue)} (${orderStats.combined.bankOrders} orders)`, margin, yPosition);
      yPosition += sectionSpacing;

      // Expenses
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('EXPENSES', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Expenses: ${formatCurrency(expenses.total)} (${expenses.count} expenses)`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Cash Expenses: ${formatCurrency(expenses.cash)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Bank Expenses: ${formatCurrency(expenses.bank)}`, margin, yPosition);
      yPosition += sectionSpacing;

      // Financial Summary
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('FINANCIAL SUMMARY', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Cash in Hand: ${formatCurrency(cashInHand)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Bank Balance: ${formatCurrency(bankBalance)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.setFont('helvetica', 'bold');
      doc.text(`Net Profit: ${formatCurrency(netProfit)}`, margin, yPosition);
      yPosition += sectionSpacing;

      // Order Type Breakdown
      checkPageBreak(40);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('ORDER TYPE BREAKDOWN', margin, yPosition);
      yPosition += lineHeight * 1.5;

      // Dine-In
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Dine-In Orders:', margin, yPosition);
      yPosition += lineHeight;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`  Orders: ${orderStats.dineIn.totalOrders || 0}`, margin + 5, yPosition);
      yPosition += lineHeight;
      doc.text(`  Revenue: ${formatCurrency(orderStats.dineIn.totalRevenue || 0)}`, margin + 5, yPosition);
      yPosition += lineHeight;
      doc.text(`  Cash: ${formatCurrency(orderStats.dineIn.cashRevenue || 0)} | Bank: ${formatCurrency(orderStats.dineIn.bankRevenue || 0)}`, margin + 5, yPosition);
      yPosition += lineHeight * 1.5;

      // Delivery
      checkPageBreak(30);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Delivery Orders:', margin, yPosition);
      yPosition += lineHeight;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`  Orders: ${orderStats.delivery.totalOrders || 0}`, margin + 5, yPosition);
      yPosition += lineHeight;
      doc.text(`  Revenue: ${formatCurrency(orderStats.delivery.totalRevenue || 0)}`, margin + 5, yPosition);
      yPosition += lineHeight;
      doc.text(`  Cash: ${formatCurrency(orderStats.delivery.cashRevenue || 0)} | Bank: ${formatCurrency(orderStats.delivery.bankRevenue || 0)}`, margin + 5, yPosition);
      yPosition += sectionSpacing;

      // Footer
      checkPageBreak(20);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Easypaisa: 03307072222', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;
      doc.text('Abdullah Saleem', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;
      doc.setFont('helvetica', 'bold');
      doc.text('THANK YOU!', pageWidth / 2, yPosition, { align: 'center' });

      // Generate filename
      const dateRange = getDateRangeText().replace(/\s+/g, '_').replace(/,/g, '');
      const filename = `Sales_Summary_${dateRange}_${dayjs().format('YYYY-MM-DD')}.pdf`;

      // Save the PDF
      doc.save(filename);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      showError(error.formattedMessage || error.message || 'Failed to export PDF. Please try again.');
    }
  };

  // Show offline modal if offline
  if (!online && !isElectron) {
    return <OfflineModal title="Daily Sales Summary - Offline" />;
  }

  if (loading) {
    return <ScreenLoading label="Loading sales summary..." />;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#1f2937' }}>
          <FaChartBar style={{ marginRight: '0.5rem' }} /> Sales Summary
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>
          Comprehensive overview of sales, expenses, and profitability for {getDateRangeText()}
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
          <button
            onClick={handleExportPDF}
            style={{
              padding: '0.5rem 1rem',
              border: '2px solid #28a745',
              borderRadius: '8px',
              background: '#28a745',
              color: 'white',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem',
              marginLeft: 'auto'
            }}
          >
            <FaFilePdf style={{ marginRight: '0.5rem' }} /> Export PDF
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

      {/* Summary Cards Grid */}
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

      {/* Primary Metrics */}
      <div className="summary-cards-grid">
        {/* Total Revenue */}
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Revenue</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(summaryTop.totalRevenueAmount)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {summaryTop.totalRevenueOrders} orders
          </div>
        </div>

        {/* Net Profit */}
        <div style={{
          background: netProfit >= 0
            ? 'linear-gradient(135deg, #28a745 0%, #1e7e34 100%)'
            : 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)',
          padding: '1.5rem',
          borderRadius: '12px',
          color: 'white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          minHeight: '140px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Net Profit</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(netProfit)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {profitMargin}% margin
          </div>
        </div>

        {/* Cash in Hand */}
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FaMoneyBillWave /> Cash in Hand</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(cashInHand)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {summaryTop.cashInHandsOrders} orders
          </div>
        </div>

        {/* Bank Balance */}
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FaUniversity /> Bank Balance</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(bankBalance)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {summaryTop.bankBalanceOrders} orders
          </div>
        </div>

        {/* Total Expenses */}
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FaDollarSign /> Total Expenses</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(expenses.total)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {expenses.count} expenses
          </div>
        </div>

        {/* Average Order Value */}
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Average Order Value</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(summaryTop.averageOrderValueAmount)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            Per order
          </div>
        </div>
      </div>

      {/* Breakdown by Order Type */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1f2937' }}>
          <FaChartLine style={{ marginRight: '0.5rem' }} /> Breakdown by Order Type
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          {/* Dine-In Stats */}
          <div style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
            borderRadius: '10px',
            border: '2px solid #2196f3'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#1976d2', fontSize: '1.2rem', fontWeight: 'bold' }}>
              <FaUtensils style={{ marginRight: '0.5rem' }} /> Dine-In Orders
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Total Orders:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.dineIn.totalOrders || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Total Revenue:</span>
                <span style={{ fontWeight: '600' }}>{formatCurrency(orderStats.dineIn.totalRevenue || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Avg Order Value:</span>
                <span style={{ fontWeight: '600' }}>{formatCurrency(orderStats.dineIn.avgOrderValue || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Cash Orders:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.dineIn.cashOrders || 0} ({formatCurrency(orderStats.dineIn.cashRevenue || 0)})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Bank Orders:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.dineIn.bankOrders || 0} ({formatCurrency(orderStats.dineIn.bankRevenue || 0)})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Completed:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.dineIn.completedOrders || 0} ({formatCurrency(orderStats.dineIn.completedRevenue || 0)})</span>
              </div>
            </div>
          </div>

          {/* Delivery Stats */}
          <div style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)',
            borderRadius: '10px',
            border: '2px solid #ff9800'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#f57c00', fontSize: '1.2rem', fontWeight: 'bold' }}>
              <FaTruck style={{ marginRight: '0.5rem' }} /> Delivery Orders
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Total Orders:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.delivery.totalOrders || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Total Revenue:</span>
                <span style={{ fontWeight: '600' }}>{formatCurrency(orderStats.delivery.totalRevenue || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Avg Order Value:</span>
                <span style={{ fontWeight: '600' }}>{formatCurrency(orderStats.delivery.avgOrderValue || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Cash Orders:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.delivery.cashOrders || 0} ({formatCurrency(orderStats.delivery.cashRevenue || 0)})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Bank Orders:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.delivery.bankOrders || 0} ({formatCurrency(orderStats.delivery.bankRevenue || 0)})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#666' }}>Completed:</span>
                <span style={{ fontWeight: '600' }}>{orderStats.delivery.completedOrders || 0} ({formatCurrency(orderStats.delivery.completedRevenue || 0)})</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Method Breakdown */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1f2937' }}>
          <FaCreditCard style={{ marginRight: '0.5rem' }} /> Payment Method Breakdown
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <div style={{
            padding: '1.5rem',
            background: '#fff4d8',
            borderRadius: '10px',
            border: '2px solid #ffc107'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', color: '#856404', fontSize: '1.1rem', fontWeight: 'bold' }}>
              <FaMoneyBillWave style={{ marginRight: '0.5rem' }} /> Cash Payments
            </h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#856404', marginBottom: '0.5rem' }}>
              {formatCurrency(orderStats.combined.cashRevenue || 0)}
            </div>
            <div style={{ color: '#666', fontSize: '0.9rem' }}>
              {orderStats.combined.cashOrders || 0} orders
            </div>
          </div>
          <div style={{
            padding: '1.5rem',
            background: '#e7f3ff',
            borderRadius: '10px',
            border: '2px solid #17a2b8'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', color: '#0c5460', fontSize: '1.1rem', fontWeight: 'bold' }}>
              <FaUniversity style={{ marginRight: '0.5rem' }} /> Bank Transfer
            </h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0c5460', marginBottom: '0.5rem' }}>
              {formatCurrency(orderStats.combined.bankRevenue || 0)}
            </div>
            <div style={{ color: '#666', fontSize: '0.9rem' }}>
              {orderStats.combined.bankOrders || 0} orders
            </div>
          </div>
        </div>
      </div>

      {/* Expenses Breakdown */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1f2937' }}>
          <FaDollarSign style={{ marginRight: '0.5rem' }} /> Expenses Breakdown
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <div style={{
            padding: '1.5rem',
            background: '#ffebee',
            borderRadius: '10px',
            border: '2px solid #f44336'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', color: '#c62828', fontSize: '1.1rem', fontWeight: 'bold' }}>
              Total Expenses
            </h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#c62828', marginBottom: '0.5rem' }}>
              {formatCurrency(expenses.total)}
            </div>
            <div style={{ color: '#666', fontSize: '0.9rem' }}>
              {expenses.count} expenses
            </div>
          </div>
          <div style={{
            padding: '1.5rem',
            background: '#fff4d8',
            borderRadius: '10px',
            border: '2px solid #ffc107'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', color: '#856404', fontSize: '1.1rem', fontWeight: 'bold' }}>
              <FaMoneyBillWave style={{ marginRight: '0.5rem' }} /> Cash Expenses
            </h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#856404', marginBottom: '0.5rem' }}>
              {formatCurrency(expenses.cash)}
            </div>
          </div>
          <div style={{
            padding: '1.5rem',
            background: '#e7f3ff',
            borderRadius: '10px',
            border: '2px solid #17a2b8'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', color: '#0c5460', fontSize: '1.1rem', fontWeight: 'bold' }}>
              <FaUniversity style={{ marginRight: '0.5rem' }} /> Bank Expenses
            </h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0c5460', marginBottom: '0.5rem' }}>
              {formatCurrency(expenses.bank)}
            </div>
          </div>
        </div>
      </div>

      {/* Orders List (matches history view for quick inspection) */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', color: '#1f2937' }}>
          Orders ({orders.length})
        </h2>

        {orders.length === 0 ? (
          <div style={{ padding: '1rem', color: '#6b7280' }}>No orders for the selected range.</div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {orders.map(order => {
              const orderType = order.order_type || order.orderType;
              const orderStatus = (order.order_status || order.orderStatus || '').toLowerCase();
              const paymentStatus = (order.payment_status || order.paymentStatus || '').toLowerCase();
              const deliveryStatus = (order.delivery_status || order.deliveryStatus || '').toLowerCase();
              const paymentMethod = order.payment_method || order.paymentMethod;
              const items = order.items || order.orderItems || order.order_items;

              return (
                <div key={order.id} style={{
                  padding: '1rem',
                  borderRadius: '10px',
                  border: orderType === 'delivery' ? '2px solid #dc3545' : '2px solid #28a745',
                  background: '#f8f9fa'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: 0, color: '#2d3748' }}>
                        Order #{order.order_number || order.orderNumber || order.id}{' '}
                        <span style={{ fontWeight: 400, color: '#6b7280' }}>
                          ({orderType === 'delivery' ? 'Delivery' : 'Dine-In'})
                        </span>
                      </h3>
                      <div style={{ color: '#6b7280', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                        {dayjs(order.created_at || order.createdAt).format('MMM D, YYYY h:mm A')}
                      </div>

                      {orderType === 'dine_in' && (order.table_number || order.tableNumber) && (
                        <div style={{ marginTop: '0.25rem', fontWeight: 600, color: '#2d3748' }}>
                          <FaUtensils style={{ marginRight: '0.35rem' }} />
                          Table #{order.table_number || order.tableNumber}
                        </div>
                      )}

                      {orderType === 'delivery' && (
                        <div style={{ marginTop: '0.35rem', color: '#2d3748' }}>
                          {(order.customer_name || order.customer?.name) && (
                            <div style={{ fontWeight: 600 }}>
                              <FaUser style={{ marginRight: '0.35rem' }} />
                              {order.customer_name || order.customer?.name}
                            </div>
                          )}
                          {(order.customer_phone || order.customer?.phone) && (
                            <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                              <FaPhone style={{ marginRight: '0.35rem' }} />
                              {order.customer_phone || order.customer?.phone}
                            </div>
                          )}
                          {order.delivery_address && (
                            <div style={{ color: '#6b7280', fontSize: '0.9rem', marginTop: '0.15rem' }}>
                              <FaMapMarkerAlt style={{ marginRight: '0.35rem' }} />
                              {order.delivery_address}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {orderStatus && (
                          <div style={{
                            padding: '0.25rem 0.7rem',
                            borderRadius: '14px',
                            background: getOrderStatusColor(orderStatus).background,
                            color: getOrderStatusColor(orderStatus).color,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            textTransform: 'capitalize'
                          }}>
                            Order: {orderStatus.replace(/_/g, ' ')}
                          </div>
                        )}
                        {deliveryStatus && orderType === 'delivery' && (
                          <div style={{
                            padding: '0.25rem 0.7rem',
                            borderRadius: '14px',
                            background: getOrderStatusColor(deliveryStatus).background,
                            color: getOrderStatusColor(deliveryStatus).color,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            textTransform: 'capitalize'
                          }}>
                            Delivery: {deliveryStatus.replace(/_/g, ' ')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: '200px' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                        {formatCurrency(order.total_amount || order.totalAmount)}
                      </div>
                      {(order.delivery_charge || order.deliveryCharge) > 0 && (
                        <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                          Delivery: {formatCurrency(order.delivery_charge || order.deliveryCharge)}
                        </div>
                      )}
                      <div style={{
                        marginTop: '0.35rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        lineHeight: 1.1,
                        ...(() => {
                          const isCancelled = orderStatus === 'cancelled' || paymentStatus === 'cancelled';
                          if (isCancelled) {
                            return { background: '#fee2e2', color: '#dc2626' };
                          }
                          return getPaymentStatusColor(paymentStatus);
                        })()
                      }}>
                        {(() => {
                          const isPaymentCancelled = paymentStatus === 'cancelled';
                          const isOrderCancelled = orderStatus === 'cancelled';
                          const isCancelled = isOrderCancelled || isPaymentCancelled;
                          const isPaid = paymentStatus === 'completed';
                          if (isCancelled) {
                            return isPaymentCancelled ? 'Payment Cancelled' : 'Cancelled';
                          }
                          return isPaid ? 'Paid' : 'Pending';
                        })()}
                      </div>
                      {paymentMethod && (
                        <div style={{ marginTop: '0.2rem', fontSize: '0.9rem', color: '#6b7280' }}>
                          {paymentMethod === 'cash' ? 'Cash' : 'Bank Transfer'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb',
                    color: '#4b5563',
                    fontSize: '0.9rem'
                  }}>
                    <strong>Items:</strong>{' '}
                    {Array.isArray(items) && items.length > 0
                      ? items.map(i => `${i.menuItem?.name || i.name || i.item_name || 'Item'} (x${i.quantity || 1})`).join(', ')
                      : (typeof items === 'string' ? items : 'No items')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
    </div>
  );
};

export default DailySalesSummary;
