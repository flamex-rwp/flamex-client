import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, expensesAPI, API_BASE_URL } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const DailySalesSummary = () => {
  const { showError } = useToast();
  const { online } = useOffline();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);

  const [orders, setOrders] = useState([]);
  const [expensesList, setExpensesList] = useState([]);

  const [orderStats, setOrderStats] = useState({
    dineIn: {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      completedOrders: 0,
      completedRevenue: 0,
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
      cashOrders: 0,
      cashRevenue: 0,
      bankOrders: 0,
      bankRevenue: 0
    }
  });

  const [expenses, setExpenses] = useState({
    total: 0,
    cash: 0,
    bank: 0,
    count: 0
  });

  const calculateOrderStats = useCallback((ordersData) => {
    const stats = {
      dineIn: {
        totalOrders: 0,
        totalRevenue: 0,
        avgOrderValue: 0,
        completedOrders: 0,
        completedRevenue: 0,
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
        cashOrders: 0,
        cashRevenue: 0,
        bankOrders: 0,
        bankRevenue: 0
      }
    };

    ordersData.forEach(order => {
      // Handle both camelCase and snake_case property names
      const amount = parseFloat(order.totalAmount || order.total_amount || 0);
      const orderStatus = order.orderStatus || order.order_status || 'pending';
      const orderType = order.orderType || order.order_type || 'dine_in';
      const paymentMethod = order.paymentMethod || order.payment_method || 'cash';
      const paymentStatus = order.paymentStatus || order.payment_status || 'pending';

      // Combined stats
      stats.combined.totalOrders += 1;
      stats.combined.totalRevenue += amount;

      if (paymentMethod === 'cash') {
        stats.combined.cashOrders += 1;
        stats.combined.cashRevenue += amount;
      } else if (paymentMethod === 'bank_transfer') {
        stats.combined.bankOrders += 1;
        stats.combined.bankRevenue += amount;
      }

      // Order type specific stats
      if (orderType === 'dine_in') {
        stats.dineIn.totalOrders += 1;
        stats.dineIn.totalRevenue += amount;

        if (paymentMethod === 'cash') {
          stats.dineIn.cashOrders += 1;
          stats.dineIn.cashRevenue += amount;
        } else if (paymentMethod === 'bank_transfer') {
          stats.dineIn.bankOrders += 1;
          stats.dineIn.bankRevenue += amount;
        }

        if (orderStatus === 'completed' || orderStatus === 'ready' || orderStatus === 'preparing') {
          stats.dineIn.completedOrders += 1;
          stats.dineIn.completedRevenue += amount;
        }

        if (paymentStatus === 'pending') {
          stats.dineIn.pendingPayments.count += 1;
          stats.dineIn.pendingPayments.total += amount;
        }
      }
      else if (orderType === 'delivery') {
        stats.delivery.totalOrders += 1;
        stats.delivery.totalRevenue += amount;

        if (paymentMethod === 'cash') {
          stats.delivery.cashOrders += 1;
          stats.delivery.cashRevenue += amount;
        } else if (paymentMethod === 'bank_transfer') {
          stats.delivery.bankOrders += 1;
          stats.delivery.bankRevenue += amount;
        }

        if (orderStatus === 'completed' || orderStatus === 'delivered') {
          stats.delivery.completedOrders += 1;
          stats.delivery.completedRevenue += amount;
        }

        if (paymentStatus === 'pending') {
          stats.delivery.pendingPayments.count += 1;
          stats.delivery.pendingPayments.total += amount;
        }
      }
    });

    // Calculate averages
    stats.dineIn.avgOrderValue = stats.dineIn.totalOrders > 0
      ? stats.dineIn.totalRevenue / stats.dineIn.totalOrders
      : 0;

    stats.delivery.avgOrderValue = stats.delivery.totalOrders > 0
      ? stats.delivery.totalRevenue / stats.delivery.totalOrders
      : 0;

    stats.combined.avgOrderValue = stats.combined.totalOrders > 0
      ? stats.combined.totalRevenue / stats.combined.totalOrders
      : 0;

    return stats;
  }, []);

  const calculateExpenses = useCallback((expensesData, dateRange) => {
    // Expenses should already be filtered by backend, but we'll do client-side filtering as backup
    let filteredExpenses = expensesData || [];

    // Use expenseDate if available, otherwise fall back to createdAt
    filteredExpenses = filteredExpenses.filter(e => {
      const expenseDateStr = e.expenseDate || e.expense_date || e.createdAt || e.created_at;
      if (!expenseDateStr) return false;

      const expenseDate = dayjs(expenseDateStr);

      if (dateRange === 'today') {
        return expenseDate.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
      } else if (dateRange === 'yesterday') {
        return expenseDate.format('YYYY-MM-DD') === dayjs().subtract(1, 'day').format('YYYY-MM-DD');
      } else if (dateRange === 'this_week') {
        const weekStart = dayjs().startOf('week');
        return expenseDate.isAfter(weekStart.subtract(1, 'day'));
      } else if (dateRange === 'this_month') {
        const monthStart = dayjs().startOf('month');
        return expenseDate.isAfter(monthStart.subtract(1, 'day'));
      } else if (startDate && endDate) {
        return expenseDate.isAfter(dayjs(startDate).subtract(1, 'day')) &&
          expenseDate.isBefore(dayjs(endDate).add(1, 'day'));
      }
      return true; // If no date filter, include all
    });

    // Calculate totals
    const totalExpenses = filteredExpenses.reduce((sum, e) =>
      sum + parseFloat(e.amount || 0), 0
    );

    const cashExpenses = filteredExpenses
      .filter(e => (e.paymentMethod || e.payment_method) === 'cash')
      .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    const bankExpenses = filteredExpenses
      .filter(e => (e.paymentMethod || e.payment_method) === 'bank_transfer')
      .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    return {
      total: totalExpenses,
      cash: cashExpenses,
      bank: bankExpenses,
      count: filteredExpenses.length
    };
  }, [startDate, endDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      // Build query parameters based on date filter
      const params = {};

      if (dateFilter === 'today') {
        const today = dayjs().format('YYYY-MM-DD');
        params.startDate = today;
        params.endDate = today;
        console.log('Today filter - Date range:', { startDate: params.startDate, endDate: params.endDate, today });
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
        params.startDate = startDate;
        params.endDate = endDate;
      }

      // Fetch orders and expenses in parallel
      // Increase limit to get all orders and expenses in date range
      const ordersParams = { ...params, limit: 1000 };
      const expensesParams = { ...params, limit: 1000 };
      const [ordersResponse, expensesResponse] = await Promise.all([
        ordersAPI.getAll(ordersParams),  // Use the correct endpoint with query params
        expensesAPI.getAll(expensesParams) // Pass date params to expenses API as well
      ]);

      // Handle orders data - Use the correct response structure
      // Axios returns the response in .data, and our API wraps response in success/data envelope
      const ordersPayload = ordersResponse.data;

      if (ordersPayload && ordersPayload.success && ordersPayload.data) {
        // API response format: { success: true, data: { orders: [...], total: ..., page: ... } }
        const ordersData = ordersPayload.data.orders || [];

        // Ensure we have an array
        const ordersArray = Array.isArray(ordersData) ? ordersData : [];

        // Backend should already filter by date correctly, but keep minimal client-side validation
        const filteredOrders = ordersArray.filter(order => {
          if (!params.startDate || !params.endDate) return true;
          const orderDate = dayjs(order.createdAt || order.created_at);
          const start = dayjs(params.startDate).startOf('day');
          const end = dayjs(params.endDate).endOf('day');
          // Check if order date is within range (inclusive of start and end days)
          const isAfterStart = orderDate.isAfter(start) || orderDate.isSame(start, 'day');
          const isBeforeEnd = orderDate.isBefore(end) || orderDate.isSame(end, 'day');
          return isAfterStart && isBeforeEnd;
        });

        setOrders(filteredOrders);

        // Calculate stats from orders
        const calculatedStats = calculateOrderStats(filteredOrders);
        setOrderStats(calculatedStats);
      } else {
        console.error('Orders API response unsuccessful:', ordersResponse);
        console.error('Orders payload:', ordersPayload);
        // Don't throw if we just got empty data format we didn't expect, try to graceful fail
        setOrders([]);
        setOrderStats({
          dineIn: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0, completedRevenue: 0, cashOrders: 0, cashRevenue: 0, bankOrders: 0, bankRevenue: 0, pendingPayments: { count: 0, total: 0 } },
          delivery: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0, completedRevenue: 0, cashOrders: 0, cashRevenue: 0, bankOrders: 0, bankRevenue: 0, pendingPayments: { count: 0, total: 0 } },
          combined: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, cashOrders: 0, cashRevenue: 0, bankOrders: 0, bankRevenue: 0 }
        });
      }

      // Handle expenses data
      const expensesPayload = expensesResponse.data;
      if (expensesPayload && (expensesPayload.success || Array.isArray(expensesPayload))) {
        // Extract expenses from response
        const expensesData = expensesPayload.data?.expenses || expensesPayload.data || expensesPayload.expenses || [];

        // Ensure we have an array
        const expensesArray = Array.isArray(expensesData) ? expensesData : [];

        setExpensesList(expensesArray);

        const calculatedExpenses = calculateExpenses(expensesArray, dateFilter);
        setExpenses(calculatedExpenses);
      } else {
        console.error('Expenses API response unsuccessful:', expensesResponse);
        // Graceful fallback
        setExpensesList([]);
        setExpenses({ total: 0, cash: 0, bank: 0, count: 0 });
      }
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
        setOrderStats({
          dineIn: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0, completedRevenue: 0, cashOrders: 0, cashRevenue: 0, bankOrders: 0, bankRevenue: 0, pendingPayments: { count: 0, total: 0 } },
          delivery: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0, completedRevenue: 0, cashOrders: 0, cashRevenue: 0, bankOrders: 0, bankRevenue: 0, pendingPayments: { count: 0, total: 0 } },
          combined: { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, cashOrders: 0, cashRevenue: 0, bankOrders: 0, bankRevenue: 0 }
        });
        setExpensesList([]);
        setExpenses({ total: 0, cash: 0, bank: 0, count: 0 });
        setError(''); // Clear error for network issues
      }
    } finally {
      setLoading(false);
    }
  }, [dateFilter, startDate, endDate, calculateOrderStats, calculateExpenses]);

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

  // Calculate derived metrics
  const netProfit = orderStats.combined.totalRevenue - expenses.total;
  const cashInHand = Math.max(0, orderStats.combined.cashRevenue - expenses.cash);
  const bankBalance = Math.max(0, orderStats.combined.bankRevenue - expenses.bank);
  const profitMargin = orderStats.combined.totalRevenue > 0
    ? ((netProfit / orderStats.combined.totalRevenue) * 100).toFixed(1)
    : 0;

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
  if (!online) {
    return <OfflineModal title="Daily Sales Summary - Offline" />;
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#1f2937' }}>
          📊 Sales Summary
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
            📄 Export PDF
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
                  fetchData();
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
            {formatCurrency(orderStats.combined.totalRevenue)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {orderStats.combined.totalOrders} orders
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>💵 Cash in Hand</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(cashInHand)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {orderStats.combined.cashOrders} cash orders
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>🏦 Bank Balance</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(bankBalance)}
          </div>
          <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            {orderStats.combined.bankOrders} bank orders
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
          <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>💸 Total Expenses</div>
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
            {formatCurrency(orderStats.combined.avgOrderValue)}
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
          📈 Breakdown by Order Type
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
              🍽️ Dine-In Orders
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
              🚚 Delivery Orders
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
          💳 Payment Method Breakdown
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <div style={{
            padding: '1.5rem',
            background: '#fff4d8',
            borderRadius: '10px',
            border: '2px solid #ffc107'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', color: '#856404', fontSize: '1.1rem', fontWeight: 'bold' }}>
              💵 Cash Payments
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
              🏦 Bank Transfer
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
          💸 Expenses Breakdown
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
              💵 Cash Expenses
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
              🏦 Bank Expenses
            </h3>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0c5460', marginBottom: '0.5rem' }}>
              {formatCurrency(expenses.bank)}
            </div>
          </div>
        </div>
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