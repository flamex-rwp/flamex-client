import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { expensesAPI, ordersAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import ConfirmationModal from './ConfirmationModal';
import AppliedFiltersBanner from './AppliedFiltersBanner';
import ScreenLoading from './ScreenLoading';
import { getDateFilterBannerLabel, isCustomDateRangeApplied } from '../utils/dateFilterBanner';
import {
  readFilterSession,
  writeFilterSession,
  FILTER_STORAGE_KEYS,
  sanitizeDateFilter
} from '../utils/filterSessionPersistence';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';
import { EXPENSE_CATEGORIES, expenseCategoryUsesUnits, getExpenseCategoryOptions, isValidExpenseCategory } from '../constants/expenseCategories';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import {
  FaDollarSign,
  FaMoneyBillWave,
  FaUniversity,
  FaFilePdf,
  FaEdit,
  FaTrash
} from 'react-icons/fa';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const getExpenseDisplayDate = (expense) => {
  const dateField =
    expense?.expenseDate ||
    expense?.expense_date ||
    expense?.createdAt ||
    expense?.created_at;
  return dateField ? dayjs(dateField) : null;
};

const getOrderTotal = (order) =>
  parseFloat(order?.totalAmount ?? order?.total_amount ?? 0) || 0;

const getExpenseAmount = (expense) => parseFloat(expense?.amount ?? 0) || 0;

const safeRatio = (numerator, denominator) => {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
};

const PIE_COLORS = ['#2F80ED', '#27AE60', '#F2C94C', '#F2994A', '#EB5757', '#9B51E0', '#56CCF2', '#6FCF97'];

const ExpenseHistory = ({ readOnly = false }) => {
  const { showSuccess, showError } = useToast();
  const { online } = useOffline();
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const initialDateFilters = useMemo(() => {
    const s = readFilterSession(FILTER_STORAGE_KEYS.expenseHistory);
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

  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedExpensesOnceRef = useRef(false);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState(initialDateFilters.dateFilter);
  const [startDate, setStartDate] = useState(initialDateFilters.startDate);
  const [endDate, setEndDate] = useState(initialDateFilters.endDate);
  const [showCustomRange, setShowCustomRange] = useState(initialDateFilters.showCustomRange);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editDescription, setEditDescription] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [editUnit, setEditUnit] = useState('PCS');
  const [editUnitPrice, setEditUnitPrice] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash');
  const [revenueTotal, setRevenueTotal] = useState(0);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });

  // Add expense form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [newExpense, setNewExpense] = useState({
    description: '',
    quantity: '1',
    unit: 'PCS',
    unit_price: '',
    amount: '',
    category: '',
    payment_method: 'cash',
    expense_date: new Date().toISOString().split('T')[0]
  });

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { filter: dateFilter };
      if (dateFilter === 'custom' && startDate && endDate) {
        params.startDate = startDate;
        params.endDate = endDate;
      } else if (dateFilter === 'custom') {
        const t = dayjs().format('YYYY-MM-DD');
        params.startDate = t;
        params.endDate = t;
      } else if (startDate && endDate) {
        params.startDate = startDate;
        params.endDate = endDate;
      }

      const response = await expensesAPI.getAll(params);

      // Backend/IPC may return:
      // - [...] (array)
      // - { expenses: [...] }
      // - { success: true, data: { expenses: [...], pagination: {...} } }
      // - { success: true, data: [...] }
      const responseData = response?.data ?? {};
      const unwrapped = responseData?.data ?? responseData;
      const expensesData = Array.isArray(unwrapped)
        ? unwrapped
        : (unwrapped?.expenses || unwrapped?.data || []);

      // Ensure we have an array before sorting
      const expensesArray = Array.isArray(expensesData) ? expensesData : [];

      // Sort expenses by date in descending order (newest first)
      const sortedExpenses = [...expensesArray].sort((a, b) => {
        const aDate = new Date(a?.expenseDate || a?.expense_date || a?.createdAt || a?.created_at || 0);
        const bDate = new Date(b?.expenseDate || b?.expense_date || b?.createdAt || b?.created_at || 0);
        return bDate - aDate;
      });
      setExpenses(sortedExpenses);
    } catch (err) {
      console.error('Failed to load expenses', err);
      // Check if this was a cached response that failed to parse
      if (err.isCached) {
        // Cached response should have been handled, but if we're here, there might be a format issue
        const responseData = err?.data?.data ?? err?.data ?? {};
        const unwrapped = responseData?.data ?? responseData;
        const expensesData = Array.isArray(unwrapped)
          ? unwrapped
          : (unwrapped?.expenses || unwrapped?.data || []);
        const expensesArray = Array.isArray(expensesData) ? expensesData : [];
        setExpenses(expensesArray);
        setError('');
      } else if (err.response) {
        // Server returned an error response
        setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load expenses');
      } else {
        // Network error - check if we have any cached data to show
        // The cache should have been served by the API interceptor, but if we're here, no cache was available
        setExpenses([]);
        // Only show error if we're online (offline is expected, online means server issue)
        if (navigator.onLine) {
          setError('Failed to load expenses. Please check your connection.');
        } else {
          setError('No cached expenses available. Please connect to the internet to load expenses.');
        }
      }
    } finally {
      setLoading(false);
      hasLoadedExpensesOnceRef.current = true;
    }
  }, [dateFilter, startDate, endDate]);

  const fetchRevenueForRange = useCallback(async () => {
    setRevenueLoading(true);
    try {
      const params = { filter: dateFilter };
      if (dateFilter === 'custom' && startDate && endDate) {
        params.startDate = startDate;
        params.endDate = endDate;
      } else if (dateFilter === 'custom') {
        const t = dayjs().format('YYYY-MM-DD');
        params.startDate = t;
        params.endDate = t;
      } else if (startDate && endDate) {
        params.startDate = startDate;
        params.endDate = endDate;
      }
      const ordersRes = await ordersAPI.getAll({ ...params, limit: 10000 });
      const ordersData = ordersRes.data?.data || ordersRes.data || [];
      const orders = Array.isArray(ordersData) ? ordersData : (ordersData?.orders || ordersData?.data || []);
      const total = orders.reduce((sum, o) => sum + getOrderTotal(o), 0);
      setRevenueTotal(total);
    } catch (err) {
      console.error('Failed to load revenue for expense range', err);
      setRevenueTotal(0);
    } finally {
      setRevenueLoading(false);
    }
  }, [dateFilter, startDate, endDate]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  useEffect(() => {
    fetchRevenueForRange();
  }, [fetchRevenueForRange]);

  useEffect(() => {
    writeFilterSession(FILTER_STORAGE_KEYS.expenseHistory, {
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

  const handleDelete = async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Expense',
      message: 'Are you sure you want to delete this expense?',
      onConfirm: async () => {
        try {
          await expensesAPI.delete(id);
          showSuccess('Expense deleted successfully!');
          fetchExpenses();
        } catch (error) {
          console.error('Error deleting expense:', error);
          showError(error.formattedMessage || error.response?.data?.error || 'Failed to delete expense. Please try again.');
        }
      },
      variant: 'danger'
    });
  };

  // Calculate stats
  const totalExpenses = expenses.reduce((total, expense) => total + getExpenseAmount(expense), 0);
  const cashExpenses = expenses.filter(e => (e.paymentMethod || e.payment_method) === 'cash').reduce((total, expense) => total + parseFloat(expense.amount || 0), 0);
  const bankExpenses = expenses.filter(e => (e.paymentMethod || e.payment_method) === 'bank_transfer').reduce((total, expense) => total + parseFloat(expense.amount || 0), 0);
  const expenseCount = expenses.length;
  const averageExpense = expenseCount > 0 ? totalExpenses / expenseCount : 0;
  const expenseVsRevenue = safeRatio(totalExpenses, revenueTotal);

  // Group by category
  const categoryBreakdown = expenses.reduce((acc, expense) => {
    const category = expense.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = { count: 0, total: 0 };
    }
    acc[category].count += 1;
    acc[category].total += parseFloat(expense.amount || 0);
    return acc;
  }, {});

  const categoryChartData = Object.entries(categoryBreakdown)
    .map(([name, data]) => ({ name, value: data.total }))
    .sort((a, b) => b.value - a.value);

  const normalizeExpenseForCategory = (expenseDraft) => {
    const nextUsesUnits = expenseCategoryUsesUnits(expenseDraft.category);
    const updated = { ...expenseDraft };

    if (!nextUsesUnits) {
      updated.quantity = '1';
      updated.unit = 'N/A';
      if (updated.unit_price !== '') {
        updated.amount = Number.parseFloat(updated.unit_price || '0').toFixed(2);
      }
    } else {
      if (!updated.quantity) updated.quantity = '1';
      if (!updated.unit) updated.unit = 'PCS';
      if (updated.quantity && updated.unit_price) {
        updated.amount = (parseFloat(updated.quantity) * parseFloat(updated.unit_price)).toFixed(2);
      }
    }

    return updated;
  };

  const newUsesUnits = expenseCategoryUsesUnits(newExpense.category);
  const editUsesUnits = expenseCategoryUsesUnits(editCategory);

  const handleNewExpenseQuantityOrPrice = (field, value) => {
    const updatedExpense = normalizeExpenseForCategory({ ...newExpense, [field]: value });
    setNewExpense(updatedExpense);
  };

  const handleNewExpenseCategoryChange = (value) => {
    setNewExpense(normalizeExpenseForCategory({ ...newExpense, category: value }));
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!newExpense.description.trim() || !newExpense.amount) {
      showError('Please fill in all required fields');
      return;
    }
    if (!isValidExpenseCategory(newExpense.category)) {
      showError('Please select a valid expense category');
      return;
    }

    try {
      const normalized = normalizeExpenseForCategory(newExpense);
      // Transform payload to match backend schema
      const payload = {
        description: normalized.description.trim(),
        amount: parseFloat(normalized.amount),
        category: normalized.category || '',
        paymentMethod: normalized.payment_method, // Convert to camelCase
        quantity: parseFloat(normalized.quantity) || 1,
        unit: normalized.unit || 'PCS',
        unitPrice: normalized.unit_price ? parseFloat(normalized.unit_price) : undefined, // Convert to camelCase
        expenseDate: normalized.expense_date ? new Date(normalized.expense_date).toISOString() : undefined // Convert to camelCase and ISO format
      };

      await expensesAPI.create(payload);
      showSuccess('Expense added successfully!');
      setNewExpense({
        description: '',
        quantity: '1',
        unit: 'PCS',
        unit_price: '',
        amount: '',
        category: '',
        payment_method: 'cash',
        expense_date: new Date().toISOString().split('T')[0]
      });
      setShowAddForm(false);
      await fetchExpenses();
    } catch (error) {
      console.error('Error adding expense:', error);
      const errorMsg = error.formattedMessage || error.response?.data?.error || 'Failed to add expense. Please try again.';
      showError(errorMsg);
    }
  };

  const cancelAddExpense = () => {
    setNewExpense({
      description: '',
      quantity: '1',
      unit: 'PCS',
      unit_price: '',
      amount: '',
      category: '',
      payment_method: 'cash',
      expense_date: new Date().toISOString().split('T')[0]
    });
    setShowAddForm(false);
  };

  // Export PDF function
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;
      const margin = 15;
      const lineHeight = 7;
      const sectionSpacing = 10;

      const checkPageBreak = (requiredSpace = 20) => {
        if (yPosition + requiredSpace > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }
      };

      // Header
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('EXPENSES REPORT', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Flamex', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight * 2;

      // Date Range
      doc.setFontSize(10);
      let filterText = `Date: ${dateFilter}`;
      if (dateFilter === 'custom' && startDate && endDate) {
        filterText = `Date Range: ${dayjs(startDate).format('MMM D, YYYY')} - ${dayjs(endDate).format('MMM D, YYYY')}`;
      } else if (dateFilter === 'today') {
        filterText = `Date: ${dayjs().format('MMM D, YYYY')}`;
      }
      doc.text(filterText, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Generated: ${dayjs().format('MMMM D, YYYY h:mm A')}`, margin, yPosition);
      yPosition += sectionSpacing * 2;

      // Summary
      checkPageBreak(40);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('SUMMARY', margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Expenses: ${expenseCount}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Total Amount: ${formatCurrency(totalExpenses)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Average Expense: ${formatCurrency(averageExpense)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Cash Expenses: ${formatCurrency(cashExpenses)}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Bank Expenses: ${formatCurrency(bankExpenses)}`, margin, yPosition);
      yPosition += sectionSpacing * 2;

      // Category Breakdown
      if (Object.keys(categoryBreakdown).length > 0) {
        checkPageBreak(30);
        doc.setLineWidth(0.5);
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += sectionSpacing;

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('CATEGORY BREAKDOWN', margin, yPosition);
        yPosition += lineHeight * 1.5;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        Object.entries(categoryBreakdown).forEach(([category, data]) => {
          checkPageBreak(15);
          doc.text(`${category}: ${data.count} expenses - ${formatCurrency(data.total)}`, margin + 5, yPosition);
          yPosition += lineHeight;
        });
        yPosition += sectionSpacing * 2;
      }

      // Expenses List
      checkPageBreak(30);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('EXPENSES', margin, yPosition);
      yPosition += lineHeight * 2;

      if (expenses.length === 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('No expenses found for the selected date range.', margin, yPosition);
      } else {
        expenses.forEach((expense, index) => {
          checkPageBreak(40);

          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(expense.description || 'No description', margin, yPosition);
          yPosition += lineHeight;

          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          const expDate = getExpenseDisplayDate(expense);
          doc.text(`Date: ${(expDate || dayjs()).format('MMM D, YYYY h:mm A')}`, margin + 5, yPosition);
          yPosition += lineHeight;
          if (expense.category) {
            doc.text(`Category: ${expense.category}`, margin + 5, yPosition);
            yPosition += lineHeight;
          }
          if (expense.quantity && expense.unit) {
            doc.text(`Quantity: ${expense.quantity} ${expense.unit}`, margin + 5, yPosition);
            yPosition += lineHeight;
          }
          if (expense.unit_price) {
            doc.text(`Unit Price: ${formatCurrency(expense.unit_price)}`, margin + 5, yPosition);
            yPosition += lineHeight;
          }
          doc.setFont('helvetica', 'bold');
          doc.text(`Amount: ${formatCurrency(expense.amount)} (${expense.payment_method === 'cash' ? 'Cash' : 'Bank Transfer'})`, margin + 5, yPosition);
          yPosition += sectionSpacing;

          if (index < expenses.length - 1) {
            doc.setLineWidth(0.3);
            doc.line(margin, yPosition, pageWidth - margin, yPosition);
            yPosition += sectionSpacing;
          }
        });
      }

      // Footer
      checkPageBreak(20);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionSpacing;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Easypaisa: 03307072222', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;
      // doc.text('Abdullah Saleem', pageWidth / 2, yPosition, { align: 'center' });
      // yPosition += lineHeight;
      doc.setFont('helvetica', 'bold');
      doc.text('THANK YOU!', pageWidth / 2, yPosition, { align: 'center' });

      const dateRange = dateFilter === 'custom' && startDate && endDate
        ? `${dayjs(startDate).format('YYYY-MM-DD')}_to_${dayjs(endDate).format('YYYY-MM-DD')}`
        : dateFilter;
      const filename = `Expenses_${dateRange}_${dayjs().format('YYYY-MM-DD')}.pdf`;

      doc.save(filename);
      showSuccess(`PDF exported successfully with ${expenses.length} expenses`);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      showError('Failed to export PDF. Please try again.');
    }
  };


  const startEditExpense = (expense) => {
    setEditingExpenseId(expense.id);
    setEditDescription(expense.description);
    setEditQuantity(expense.quantity || 1);
    setEditUnit(expense.unit || 'PCS');
    setEditUnitPrice(expense.unit_price || expense.amount);
    setEditAmount(expense.amount);
    setEditCategory(expense.category || '');
    setEditPaymentMethod(expense.payment_method || 'cash');
  };

  const cancelEdit = () => {
    setEditingExpenseId(null);
    setEditDescription('');
    setEditQuantity('');
    setEditUnit('PCS');
    setEditUnitPrice('');
    setEditAmount('');
    setEditCategory('');
    setEditPaymentMethod('cash');
  };

  const handleEditQuantityOrPrice = (field, value) => {
    const next = normalizeExpenseForCategory({
      category: editCategory,
      quantity: field === 'quantity' ? value : editQuantity,
      unit: editUnit,
      unit_price: field === 'unit_price' ? value : editUnitPrice,
      amount: editAmount,
    });

    setEditQuantity(next.quantity);
    setEditUnit(next.unit);
    setEditUnitPrice(next.unit_price);
    setEditAmount(next.amount);
  };

  const handleEditCategoryChange = (value) => {
    const next = normalizeExpenseForCategory({
      category: value,
      quantity: editQuantity,
      unit: editUnit,
      unit_price: editUnitPrice,
      amount: editAmount,
    });

    setEditCategory(value);
    setEditQuantity(next.quantity);
    setEditUnit(next.unit);
    setEditUnitPrice(next.unit_price);
    setEditAmount(next.amount);
  };

  const saveExpenseEdit = async (expenseId) => {
    if (!editDescription || !editAmount) {
      showError('Please fill in description and amount');
      return;
    }
    if (!isValidExpenseCategory(editCategory)) {
      showError('Please select a valid expense category');
      return;
    }

    try {
      const normalized = normalizeExpenseForCategory({
        category: editCategory,
        quantity: editQuantity,
        unit: editUnit,
        unit_price: editUnitPrice,
        amount: editAmount,
      });
      // Transform payload to match backend schema (same as creation)
      const payload = {
        description: editDescription.trim(),
        amount: parseFloat(normalized.amount),
        category: normalized.category || '',
        paymentMethod: editPaymentMethod, // Convert to camelCase
        quantity: parseFloat(normalized.quantity) || 1,
        unit: normalized.unit || 'PCS',
        unitPrice: normalized.unit_price ? parseFloat(normalized.unit_price) : undefined // Convert to camelCase
      };

      await expensesAPI.update(expenseId, payload);
      showSuccess('Expense updated successfully!');
      setEditingExpenseId(null);
      setEditDescription('');
      setEditQuantity('');
      setEditUnit('PCS');
      setEditUnitPrice('');
      setEditAmount('');
      setEditCategory('');
      setEditPaymentMethod('cash');
      await fetchExpenses();
    } catch (error) {
      console.error('Error updating expense:', error);
      const errorMsg = error.formattedMessage || error.response?.data?.error || 'Failed to update expense. Please try again.';
      showError(errorMsg);
    }
  };

  // Show offline modal if offline
  if (!online && !isElectron) {
    return <OfflineModal title="Expense History - Offline" />;
  }

  if (loading) {
    return <ScreenLoading label="Loading expenses..." />;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, color: '#2d3748', fontSize: '2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FaDollarSign /> Expense Management</h1>
            <div style={{ marginTop: '0.25rem', color: '#6c757d', fontSize: '0.95rem' }}>
              Tracks operational costs for the selected period.
            </div>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--color-primary)',
                color: 'white',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              ➕ Add Expense
            </button>
          )}
        </div>

        <details style={{
          background: 'white',
          padding: '1rem 1.25rem',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          border: '1px solid #eef2f7',
          marginBottom: '1.25rem'
        }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#2d3748' }}>Expense Categories</summary>
          <div style={{ marginTop: '0.75rem', color: '#495057' }}>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.7 }}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <li key={cat}>{cat}</li>
              ))}
            </ul>
            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#6c757d' }}>
              Tip: Record salary payments as expenses under <strong>Staff salaries</strong> on the date they are paid.
            </div>
          </div>
        </details>

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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Expenses</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{expenseCount}</div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{formatCurrency(totalExpenses)}</div>
          </div>

          {/* Total Amount */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Total Amount</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{formatCurrency(totalExpenses)}</div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{formatCurrency(averageExpense)} avg</div>
          </div>

          {/* Expense vs Revenue */}
          <div style={{
            background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)',
            padding: '1.5rem',
            borderRadius: '12px',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Expense vs Revenue</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {revenueLoading ? '...' : (expenseVsRevenue === null ? '—' : `${(expenseVsRevenue * 100).toFixed(1)}%`)}
            </div>
            <div style={{ fontSize: '0.95rem', opacity: 0.9 }}>
              Revenue: {revenueLoading ? 'Loading...' : formatCurrency(revenueTotal)}
            </div>
          </div>

          {/* Cash Expenses */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FaMoneyBillWave /> Cash Expenses</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {expenses.filter(e => (e.paymentMethod || e.payment_method) === 'cash').length}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{formatCurrency(cashExpenses)}</div>
          </div>

          {/* Bank Expenses */}
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FaUniversity /> Bank Expenses</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {expenses.filter(e => (e.paymentMethod || e.payment_method) === 'bank_transfer').length}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{formatCurrency(bankExpenses)}</div>
          </div>
        </div>

        {/* Category breakdown chart */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#2d3748', fontSize: '1.2rem', fontWeight: '700' }}>Expense by Category</h3>
            <div style={{ color: '#6c757d', fontSize: '0.9rem' }}>Top categories for the selected period.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: '1.5rem', marginTop: '1rem' }}>
            <div style={{ height: '260px' }}>
              {categoryChartData.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c757d' }}>
                  No category data for this period.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Pie
                      data={categoryChartData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {categoryChartData.map((entry, index) => (
                        <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div>
              <div style={{ border: '1px solid #eef2f7', borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.75rem', padding: '0.75rem 1rem', background: '#f8fafc', fontWeight: 700, color: '#334155' }}>
                  <div>Category</div>
                  <div style={{ textAlign: 'right' }}>Total</div>
                  <div style={{ textAlign: 'right' }}>%</div>
                </div>
                {categoryChartData.slice(0, 8).map((row, idx) => {
                  const pct = totalExpenses > 0 ? (row.value / totalExpenses) * 100 : 0;
                  return (
                    <div key={row.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.75rem', padding: '0.75rem 1rem', borderTop: '1px solid #eef2f7', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 9999, background: PIE_COLORS[idx % PIE_COLORS.length], flex: '0 0 10px' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }}>{row.name}</span>
                      </div>
                      <div style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(row.value)}</div>
                      <div style={{ textAlign: 'right', color: '#64748b' }}>{pct.toFixed(1)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Date Filters */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#2d3748', fontSize: '1.2rem', fontWeight: '600' }}>Date Filters</h3>

            {/* Quick Filters */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {['today', 'yesterday', 'this_week', 'this_month', 'custom'].map(filter => (
                <button
                  type="button"
                  key={filter}
                  onClick={() => handleQuickFilter(filter)}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: `2px solid ${dateFilter === filter ? 'var(--color-primary)' : '#e2e8f0'}`,
                    background: dateFilter === filter ? 'var(--color-primary)' : 'white',
                    color: dateFilter === filter ? 'white' : '#495057',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    textTransform: 'capitalize'
                  }}
                >
                  {filter.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* Custom Date Range */}
            {showCustomRange && (
              <div style={{
                padding: '1rem',
                background: '#f8f9fa',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: '600', color: '#495057' }}>
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate || ''}
                      onChange={(e) => setStartDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: '2px solid #e2e8f0',
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
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: '2px solid #e2e8f0',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDateFilterChange(startDate, endDate)}
                    disabled={!startDate || !endDate}
                    style={{
                      padding: '0.5rem 1.5rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: (!startDate || !endDate) ? '#6c757d' : 'var(--color-primary)',
                      color: 'white',
                      fontWeight: '600',
                      cursor: (!startDate || !endDate) ? 'not-allowed' : 'pointer',
                      fontSize: '0.9rem',
                      opacity: (!startDate || !endDate) ? 0.5 : 1
                    }}
                  >
                    Apply
                  </button>
                </div>
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

            {/* Export PDF Button */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={handleExportPDF}
                disabled={expenses.length === 0}
                style={{
                  padding: '0.5rem 1rem',
                  border: '2px solid #28a745',
                  borderRadius: '8px',
                  background: expenses.length === 0 ? '#6c757d' : '#28a745',
                  color: 'white',
                  fontWeight: '600',
                  cursor: expenses.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: expenses.length === 0 ? 0.5 : 1
                }}
              >
                <FaFilePdf style={{ marginRight: '0.5rem' }} /> Export PDF ({expenses.length} expenses)
              </button>
            </div>
          </div>
        </div>

        {/* Add Expense Modal */}
        {!readOnly && showAddForm && (
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) cancelAddExpense();
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.25rem',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                width: 'min(860px, 100%)',
                maxHeight: '85vh',
                overflow: 'auto',
                background: 'white',
                padding: '1.5rem',
                borderRadius: '12px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
                border: '2px solid #28a745',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem' }}>
                <h3 style={{ margin: 0, color: '#28a745', fontSize: '1.5rem', fontWeight: 'bold' }}>Add New Expense</h3>
                <button
                  type="button"
                  onClick={cancelAddExpense}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: 'white',
                    color: '#495057',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  ✕ Close
                </button>
              </div>

              <form onSubmit={handleAddExpense}>
                <div className="form-group">
                  <label>Description:</label>
                  <input
                    type="text"
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                    placeholder="Enter expense description"
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '1rem'
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Category:</label>
                  <select
                    value={newExpense.category}
                    onChange={(e) => handleNewExpenseCategoryChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      background: 'white'
                    }}
                  >
                    <option value="">Select Category</option>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                {newUsesUnits && (
                  <>
                    <div className="form-group">
                      <label>Quantity:</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={newExpense.quantity}
                        onChange={(e) => handleNewExpenseQuantityOrPrice('quantity', e.target.value)}
                        placeholder="Enter quantity"
                        required
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          border: '2px solid #e2e8f0',
                          borderRadius: '8px',
                          fontSize: '1rem'
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Unit:</label>
                      <select
                        value={newExpense.unit}
                        onChange={(e) => setNewExpense(normalizeExpenseForCategory({ ...newExpense, unit: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          border: '2px solid #e2e8f0',
                          borderRadius: '8px',
                          fontSize: '1rem',
                          background: 'white'
                        }}
                        required
                      >
                        <option value="PCS">PCS (Pieces)</option>
                        <option value="KG">KG (Kilograms)</option>
                        <option value="G">G (Grams)</option>
                        <option value="L">L (Liters)</option>
                        <option value="ML">ML (Milliliters)</option>
                        <option value="BOX">BOX (Boxes)</option>
                        <option value="PACK">PACK (Packs)</option>
                        <option value="BAG">BAG (Bags)</option>
                        <option value="DOZEN">DOZEN (Dozens)</option>
                        <option value="OTHER">OTHER</option>
                      </select>
                    </div>
                  </>
                )}
                <div className="form-group">
                  <label>{newUsesUnits ? 'Unit Price:' : 'Amount:'}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newExpense.unit_price}
                    onChange={(e) => handleNewExpenseQuantityOrPrice('unit_price', e.target.value)}
                    placeholder={newUsesUnits ? 'Enter unit price' : 'Enter amount'}
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '1rem'
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Total Amount:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newExpense.amount}
                    readOnly
                    placeholder="Total will be calculated automatically"
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      backgroundColor: '#f0f0f0',
                      cursor: 'not-allowed'
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Date:</label>
                  <input
                    type="date"
                    value={newExpense.expense_date}
                    onChange={(e) => setNewExpense({ ...newExpense, expense_date: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      background: 'white'
                    }}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Payment Method:</label>
                  <select
                    value={newExpense.payment_method}
                    onChange={(e) => setNewExpense({ ...newExpense, payment_method: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      background: 'white'
                    }}
                  >
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      padding: '0.75rem 1.5rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#28a745',
                      color: 'white',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '1rem'
                    }}
                  >
                    ✓ Add Expense
                  </button>
                  <button
                    type="button"
                    onClick={cancelAddExpense}
                    style={{
                      flex: 1,
                      padding: '0.75rem 1.5rem',
                      borderRadius: '8px',
                      border: '2px solid #e2e8f0',
                      background: 'white',
                      color: '#495057',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '1rem'
                    }}
                  >
                    ✕ Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Expenses Table */}
        {error ? (
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
        ) : expenses.length === 0 ? (
          <div style={{
            background: 'white',
            padding: '3rem',
            borderRadius: '12px',
            textAlign: 'center',
            color: '#6c757d'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}><FaDollarSign /></div>
            <h3>No expenses found</h3>
            <p>Try adjusting your date filters</p>
          </div>
        ) : (
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Date</th>
                  <th style={{ width: 340 }}>Description</th>
                  <th style={{ width: 200 }}>Category</th>
                  <th style={{ textAlign: 'center', width: 110 }}>Qty</th>
                  <th style={{ textAlign: 'center', width: 90 }}>Unit</th>
                  <th style={{ textAlign: 'right', width: 140 }}>Unit Price</th>
                  <th style={{ textAlign: 'right', width: 150 }}>Amount</th>
                  <th style={{ textAlign: 'center', width: 140 }}>Payment</th>
                  {!readOnly && <th style={{ textAlign: 'center', width: 180 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => (
                  <tr key={expense.id}>
                    <td style={{ color: '#495057' }}>
                      {(getExpenseDisplayDate(expense) || dayjs()).format('MMM D, YYYY')}
                    </td>
                    <td>
                      {editingExpenseId === expense.id ? (
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.4rem',
                            border: '2px solid #3498db',
                            borderRadius: '4px',
                            fontSize: '0.9rem'
                          }}
                        />
                      ) : (
                        <span
                          className="cell-truncate"
                          style={{ maxWidth: 340, fontWeight: '600', color: '#2d3748' }}
                          title={expense.description || ''}
                        >
                          {expense.description}
                        </span>
                      )}
                    </td>
                    <td style={{ color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
                        <select
                          value={editCategory}
                          onChange={(e) => handleEditCategoryChange(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.4rem',
                            border: '2px solid #3498db',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                            background: 'white'
                          }}
                        >
                          <option value="">Select Category</option>
                          {getExpenseCategoryOptions(editCategory).map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="cell-truncate"
                          style={{ maxWidth: 200 }}
                          title={expense.category || 'Uncategorized'}
                        >
                          {expense.category || 'Uncategorized'}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
                        editUsesUnits ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editQuantity}
                            onChange={(e) => handleEditQuantityOrPrice('quantity', e.target.value)}
                            style={{
                              width: '80px',
                              padding: '0.4rem',
                              border: '2px solid #3498db',
                              borderRadius: '4px',
                              fontSize: '0.9rem'
                            }}
                          />
                        ) : (
                          <span style={{ color: '#6c757d' }}>—</span>
                        )
                      ) : (
                        parseFloat(expense.quantity || 1).toFixed(2)
                      )}
                    </td>
                    <td style={{ textAlign: 'center', color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
                        editUsesUnits ? (
                          <select
                            value={editUnit}
                            onChange={(e) => setEditUnit(e.target.value)}
                            style={{
                              padding: '0.4rem',
                              border: '2px solid #3498db',
                              borderRadius: '4px',
                              fontSize: '0.9rem'
                            }}
                          >
                            <option value="PCS">PCS</option>
                            <option value="KG">KG</option>
                            <option value="G">G</option>
                            <option value="L">L</option>
                            <option value="ML">ML</option>
                            <option value="BOX">BOX</option>
                            <option value="PACK">PACK</option>
                            <option value="BAG">BAG</option>
                            <option value="DOZEN">DOZEN</option>
                            <option value="OTHER">OTHER</option>
                          </select>
                        ) : (
                          <span style={{ color: '#6c757d' }}>—</span>
                        )
                      ) : (
                        expense.unit || 'PCS'
                      )}
                    </td>
                    <td style={{ textAlign: 'right', color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editUnitPrice}
                          onChange={(e) => handleEditQuantityOrPrice('unit_price', e.target.value)}
                          style={{
                            width: '100px',
                            padding: '0.4rem',
                            border: '2px solid #3498db',
                            borderRadius: '4px',
                            fontSize: '0.9rem'
                          }}
                        />
                      ) : (
                        formatCurrency(expense.unitPrice || expense.unit_price || expense.amount)
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '600', color: '#2d3748' }}>
                      {editingExpenseId === expense.id ? (
                        <input
                          type="number"
                          value={editAmount}
                          readOnly
                          style={{
                            width: '100px',
                            padding: '0.4rem',
                            border: '2px solid #95a5a6',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                            backgroundColor: '#f0f0f0',
                            cursor: 'not-allowed'
                          }}
                        />
                      ) : (
                        formatCurrency(expense.amount)
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editingExpenseId === expense.id ? (
                        <select
                          value={editPaymentMethod}
                          onChange={(e) => setEditPaymentMethod(e.target.value)}
                          style={{
                            padding: '0.5rem',
                            border: '2px solid #3498db',
                            borderRadius: '4px',
                            fontSize: '0.9rem'
                          }}
                        >
                          <option value="cash">Cash</option>
                          <option value="bank_transfer">Bank Transfer</option>
                        </select>
                      ) : (
                        <span style={{
                          color: (expense.paymentMethod || expense.payment_method) === 'cash' ? '#27ae60' : '#3498db',
                          fontWeight: 'bold'
                        }}>
                          {(expense.paymentMethod || expense.payment_method) === 'cash' ? <><FaMoneyBillWave style={{ marginRight: '0.25rem' }} /> Cash</> : <><FaUniversity style={{ marginRight: '0.25rem' }} /> Bank Transfer</>}
                        </span>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="table-actions-cell" style={{ textAlign: 'center' }}>
                        {editingExpenseId === expense.id ? (
                          <div className="table-action-buttons">
                            <button
                              type="button"
                              className="btn-edit"
                              onClick={() => saveExpenseEdit(expense.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-delete"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="table-action-buttons">
                            <button
                              type="button"
                              className="btn-edit"
                              onClick={() => startEditExpense(expense)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-delete"
                              onClick={() => handleDelete(expense.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8f9fa', fontWeight: 'bold' }}>
                  <td colSpan={!readOnly ? 6 : 7} style={{ color: '#2d3748', textAlign: 'right' }}>TOTAL</td>
                  <td style={{ textAlign: 'right', color: '#2d3748' }}>{formatCurrency(totalExpenses)}</td>
                  <td colSpan={!readOnly ? 2 : 1}></td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        )}
      </div>

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

export default ExpenseHistory;

