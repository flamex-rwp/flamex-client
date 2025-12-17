import React, { useState, useEffect, useCallback } from 'react';
import { expensesAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import ConfirmationModal from './ConfirmationModal';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (Number.isNaN(amount)) return 'PKR 0';
  return `PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const ExpenseHistory = ({ readOnly = false }) => {
  const { showSuccess, showError } = useToast();
  const { online } = useOffline();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editDescription, setEditDescription] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [editUnit, setEditUnit] = useState('PCS');
  const [editUnitPrice, setEditUnitPrice] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash');
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
      if (startDate && endDate) {
        params.start = startDate;
        params.end = endDate;
      }

      const response = await expensesAPI.getAll(params);

      // Handle paginated response format: {success, data: {expenses: [...], pagination: {...}}}
      const responseData = response.data.data || response.data;
      const expensesData = responseData.expenses || responseData;

      // Ensure we have an array before sorting
      const expensesArray = Array.isArray(expensesData) ? expensesData : [];

      // Sort expenses by date in descending order (newest first)
      const sortedExpenses = expensesArray.sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );
      setExpenses(sortedExpenses);
    } catch (err) {
      console.error('Failed to load expenses', err);
      // Check if this was a cached response that failed to parse
      if (err.isCached) {
        // Cached response should have been handled, but if we're here, there might be a format issue
        const responseData = err.data?.data || err.data;
        const expensesData = responseData?.expenses || responseData;
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
    }
  }, [dateFilter, startDate, endDate]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

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
  const totalExpenses = expenses.reduce((total, expense) => total + parseFloat(expense.amount || 0), 0);
  const cashExpenses = expenses.filter(e => (e.paymentMethod || e.payment_method) === 'cash').reduce((total, expense) => total + parseFloat(expense.amount || 0), 0);
  const bankExpenses = expenses.filter(e => (e.paymentMethod || e.payment_method) === 'bank_transfer').reduce((total, expense) => total + parseFloat(expense.amount || 0), 0);
  const expenseCount = expenses.length;
  const averageExpense = expenseCount > 0 ? totalExpenses / expenseCount : 0;

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

  const handleNewExpenseQuantityOrPrice = (field, value) => {
    const updatedExpense = { ...newExpense, [field]: value };

    // Auto-calculate total amount if both quantity and unit_price are present
    if (updatedExpense.quantity && updatedExpense.unit_price) {
      updatedExpense.amount = (parseFloat(updatedExpense.quantity) * parseFloat(updatedExpense.unit_price)).toFixed(2);
    }

    setNewExpense(updatedExpense);
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!newExpense.description.trim() || !newExpense.amount) {
      showError('Please fill in all required fields');
      return;
    }

    try {
      // Transform payload to match backend schema
      const payload = {
        description: newExpense.description.trim(),
        amount: parseFloat(newExpense.amount),
        category: newExpense.category || '',
        paymentMethod: newExpense.payment_method, // Convert to camelCase
        quantity: parseFloat(newExpense.quantity) || 1,
        unit: newExpense.unit || 'PCS',
        unitPrice: newExpense.unit_price ? parseFloat(newExpense.unit_price) : undefined, // Convert to camelCase
        expenseDate: newExpense.expense_date ? new Date(newExpense.expense_date).toISOString() : undefined // Convert to camelCase and ISO format
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
          doc.text(`Date: ${dayjs(expense.created_at).format('MMM D, YYYY h:mm A')}`, margin + 5, yPosition);
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
      doc.text('Abdullah Saleem', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += lineHeight;
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
    if (field === 'quantity') {
      setEditQuantity(value);
    } else if (field === 'unit_price') {
      setEditUnitPrice(value);
    }

    // Auto-calculate total amount
    const qty = field === 'quantity' ? value : editQuantity;
    const price = field === 'unit_price' ? value : editUnitPrice;

    if (qty && price) {
      setEditAmount((parseFloat(qty) * parseFloat(price)).toFixed(2));
    }
  };

  const saveExpenseEdit = async (expenseId) => {
    if (!editDescription || !editAmount) {
      showError('Please fill in description and amount');
      return;
    }

    try {
      // Transform payload to match backend schema (same as creation)
      const payload = {
        description: editDescription.trim(),
        amount: parseFloat(editAmount),
        category: editCategory || '',
        paymentMethod: editPaymentMethod, // Convert to camelCase
        quantity: parseFloat(editQuantity) || 1,
        unit: editUnit || 'PCS',
        unitPrice: editUnitPrice ? parseFloat(editUnitPrice) : undefined // Convert to camelCase
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
  if (!online) {
    return <OfflineModal title="Expense History - Offline" />;
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6c757d' }}>
          Loading expenses...
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, color: '#2d3748', fontSize: '2rem', fontWeight: 'bold' }}>💸 Expense History</h1>
          {!readOnly && (
            <button
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>💵 Cash Expenses</div>
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
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>🏦 Bank Expenses</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {expenses.filter(e => (e.paymentMethod || e.payment_method) === 'bank_transfer').length}
            </div>
            <div style={{ fontSize: '1.1rem', opacity: 0.9 }}>{formatCurrency(bankExpenses)}</div>
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
                {(startDate && endDate) && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#6c757d' }}>
                    Active Range: {dayjs(startDate).format('MMM D, YYYY')} - {dayjs(endDate).format('MMM D, YYYY')}
                  </div>
                )}
              </div>
            )}

            {/* Export PDF Button */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
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
                📄 Export PDF ({expenses.length} expenses)
              </button>
            </div>
          </div>
        </div>

        {/* Add Expense Form */}
        {!readOnly && showAddForm && (
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            border: '2px solid #28a745',
            marginBottom: '2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, color: '#28a745', fontSize: '1.5rem', fontWeight: 'bold' }}>Add New Expense</h3>
              <button
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
                  onChange={(e) => setNewExpense({ ...newExpense, unit: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    background: 'white'
                  }}
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
              <div className="form-group">
                <label>Unit Price:</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newExpense.unit_price}
                  onChange={(e) => handleNewExpenseQuantityOrPrice('unit_price', e.target.value)}
                  placeholder="Enter unit price"
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
                <label>Category:</label>
                <select
                  value={newExpense.category}
                  onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
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
                  <option value="Food & Beverages">Food & Beverages</option>
                  <option value="Supplies">Supplies</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Rent">Rent</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Other">Other</option>
                </select>
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
                  <option value="cash">💵 Cash</option>
                  <option value="bank_transfer">🏦 Bank Transfer</option>
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
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💸</div>
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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '1rem', fontWeight: '600', color: '#495057' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '1rem', fontWeight: '600', color: '#495057' }}>Description</th>
                  <th style={{ textAlign: 'left', padding: '1rem', fontWeight: '600', color: '#495057' }}>Category</th>
                  <th style={{ textAlign: 'center', padding: '1rem', fontWeight: '600', color: '#495057' }}>Quantity</th>
                  <th style={{ textAlign: 'center', padding: '1rem', fontWeight: '600', color: '#495057' }}>Unit</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontWeight: '600', color: '#495057' }}>Unit Price</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontWeight: '600', color: '#495057' }}>Amount</th>
                  <th style={{ textAlign: 'center', padding: '1rem', fontWeight: '600', color: '#495057' }}>Payment</th>
                  {!readOnly && <th style={{ textAlign: 'center', padding: '1rem', fontWeight: '600', color: '#495057' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => (
                  <tr key={expense.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '1rem', color: '#495057' }}>{dayjs(expense.created_at).format('MMM D, YYYY')}</td>
                    <td style={{ padding: '1rem' }}>
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
                        <span style={{ fontWeight: '600', color: '#2d3748' }}>{expense.description}</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem', color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
                        <input
                          type="text"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.4rem',
                            border: '2px solid #3498db',
                            borderRadius: '4px',
                            fontSize: '0.9rem'
                          }}
                        />
                      ) : (
                        expense.category || 'Uncategorized'
                      )}
                    </td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
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
                        parseFloat(expense.quantity || 1).toFixed(2)
                      )}
                    </td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#495057' }}>
                      {editingExpenseId === expense.id ? (
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
                        expense.unit || 'PCS'
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '1rem', color: '#495057' }}>
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
                    <td style={{ textAlign: 'right', padding: '1rem', fontWeight: '600', color: '#2d3748' }}>
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
                    <td style={{ textAlign: 'center', padding: '1rem' }}>
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
                          <option value="cash">💵 Cash</option>
                          <option value="bank_transfer">🏦 Bank Transfer</option>
                        </select>
                      ) : (
                        <span style={{
                          color: (expense.paymentMethod || expense.payment_method) === 'cash' ? '#27ae60' : '#3498db',
                          fontWeight: 'bold'
                        }}>
                          {(expense.paymentMethod || expense.payment_method) === 'cash' ? '💵 Cash' : '🏦 Bank Transfer'}
                        </span>
                      )}
                    </td>
                    {!readOnly && (
                      <td style={{ textAlign: 'center', padding: '1rem' }}>
                        {editingExpenseId === expense.id ? (
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            <button
                              className="btn btn-success"
                              onClick={() => saveExpenseEdit(expense.id)}
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                            >
                              ✓ Save
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={cancelEdit}
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            <button
                              className="btn btn-primary"
                              onClick={() => startEditExpense(expense)}
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={() => handleDelete(expense.id)}
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                            >
                              🗑️ Delete
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
                  <td colSpan={!readOnly ? 6 : 7} style={{ padding: '1rem', color: '#2d3748', textAlign: 'right' }}>TOTAL</td>
                  <td style={{ textAlign: 'right', padding: '1rem', color: '#2d3748' }}>{formatCurrency(totalExpenses)}</td>
                  <td colSpan={!readOnly ? 2 : 1}></td>
                </tr>
              </tfoot>
            </table>
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
