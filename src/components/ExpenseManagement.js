import React, { useState } from 'react';
import { expensesAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.description.trim() || !formData.amount) return;

    try {
      await expensesAPI.create(formData);
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
    const newFormData = { ...formData, [field]: value };

    // Auto-calculate total amount if both quantity and unit_price are present
    if (newFormData.quantity && newFormData.unit_price) {
      newFormData.amount = (parseFloat(newFormData.quantity) * parseFloat(newFormData.unit_price)).toFixed(2);
    }

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
        <div className="card">
          <h3>Add New Expense</h3>
          <form onSubmit={handleSubmit}>
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
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
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
                value={formData.unit_price}
                onChange={(e) => handleQuantityOrPriceChange('unit_price', e.target.value)}
                placeholder="Enter unit price"
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
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
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
                <option value="cash">💵 Cash</option>
                <option value="bank_transfer">🏦 Bank Transfer</option>
              </select>
            </div>
            <button type="submit" className="btn btn-success">
              Add Expense
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancel
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ExpenseManagement;
