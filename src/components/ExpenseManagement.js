import React, { useState } from 'react';
import { expensesAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { EXPENSE_CATEGORIES, expenseCategoryUsesUnits } from '../constants/expenseCategories';

const ExpenseManagement = () => {
  const { showSuccess, showError } = useToast();
  const [showForm, setShowForm] = useState(false);
  const getCurrentDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const [formData, setFormData] = useState({
    description: '',
    quantity: '1',
    unit: 'PCS',
    unit_price: '',
    amount: '',
    category: '',
    payment_method: 'cash',
    expense_date: getCurrentDate()
  });

  const usesUnits = expenseCategoryUsesUnits(formData.category);

  const normalizeFormForCategory = (nextFormData) => {
    const nextUsesUnits = expenseCategoryUsesUnits(nextFormData.category);
    const updated = { ...nextFormData };

    if (!nextUsesUnits) {
      // For non-item expenses (e.g., salaries/rent/utilities), treat it as a single amount.
      updated.quantity = '1';
      updated.unit = 'N/A';
      if (updated.unit_price) {
        updated.amount = Number.parseFloat(updated.unit_price || '0').toFixed(2);
      }
    } else {
      // For item-based expenses, keep unit defaults and calculate amount.
      if (!updated.quantity) updated.quantity = '1';
      if (!updated.unit) updated.unit = 'PCS';
      if (updated.quantity && updated.unit_price) {
        updated.amount = (parseFloat(updated.quantity) * parseFloat(updated.unit_price)).toFixed(2);
      }
    }

    return updated;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.description.trim() || !formData.amount) return;

    try {
      const payload = normalizeFormForCategory(formData);
      await expensesAPI.create(payload);
      setFormData({ description: '', quantity: '1', unit: 'PCS', unit_price: '', amount: '', category: '', payment_method: 'cash', expense_date: getCurrentDate() });
      setShowForm(false);
      showSuccess('Expense added successfully!');
    } catch (error) {
      console.error('Error adding expense:', error);
      const errorMessage = error.formattedMessage ||
        error.response?.data?.message ||
        error.response?.data?.error ||
        'Error adding expense. Please try again.';
      showError(errorMessage);
    }
  };

  const resetForm = () => {
    setFormData({ description: '', quantity: '1', unit: 'PCS', unit_price: '', amount: '', category: '', payment_method: 'cash', expense_date: getCurrentDate() });
    setShowForm(false);
  };

  const handleQuantityOrPriceChange = (field, value) => {
    const newFormData = normalizeFormForCategory({ ...formData, [field]: value });
    setFormData(newFormData);
  };

  const handleCategoryChange = (value) => {
    const newFormData = normalizeFormForCategory({ ...formData, category: value });
    setFormData(newFormData);
  };

  return (
    <div>
      <div className="card">
        <h2>Add Expense</h2>
        <button className="btn" onClick={() => setShowForm(true)}>
          Add New Expense
        </button>
      </div>

      {showForm && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            // Close when clicking the overlay, not when clicking inside the modal
            if (e.target === e.currentTarget) resetForm();
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
            className="card"
            style={{
              width: 'min(720px, 100%)',
              maxHeight: '85vh',
              overflow: 'auto',
              boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Add New Expense</h3>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                ✕ Close
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter expense description"
                  required
                />
              </div>
              {usesUnits && (
                <>
                  <div className="form-group">
                    <label>Quantity:</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formData.quantity}
                      onChange={(e) => handleQuantityOrPriceChange('quantity', e.target.value)}
                      placeholder="Enter quantity"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Unit:</label>
                    <select
                      value={formData.unit}
                      onChange={(e) => setFormData(normalizeFormForCategory({ ...formData, unit: e.target.value }))}
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
                <label>{usesUnits ? 'Unit Price:' : 'Amount:'}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.unit_price}
                  onChange={(e) => handleQuantityOrPriceChange('unit_price', e.target.value)}
                  placeholder={usesUnits ? 'Enter unit price' : 'Enter amount'}
                  required
                />
              </div>
              <div className="form-group">
                <label>Total Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="Total will be calculated automatically"
                  required
                  readOnly
                  style={{
                    backgroundColor: '#f0f0f0',
                    cursor: 'not-allowed'
                  }}
                />
              </div>
              <div className="form-group">
                <label>Date:</label>
                <input
                  type="date"
                  value={formData.expense_date}
                  onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
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
                  value={formData.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">Select Category</option>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Payment Method:</label>
                <select
                  value={formData.payment_method}
                  onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
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

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="submit" className="btn btn-success">
                  Add Expense
                </button>
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseManagement;
