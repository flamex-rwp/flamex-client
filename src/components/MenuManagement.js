import React, { useState, useEffect } from 'react';
import { menuItemsAPI, categoriesAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';

const MenuManagement = () => {
  const { showSuccess, showError } = useToast();
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category_id: ''
  });
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });

  useEffect(() => {
    fetchMenuItems();
    fetchCategories();
  }, []);

  const fetchMenuItems = async () => {
    try {
      const response = await menuItemsAPI.getAll();
      setMenuItems(response.data);
    } catch (error) {
      console.error('Error fetching menu items:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await categoriesAPI.getAll();
      setCategories(response.data);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await menuItemsAPI.update(editingItem.id, formData);
        showSuccess('Menu item updated successfully');
      } else {
        await menuItemsAPI.create(formData);
        showSuccess('Menu item created successfully');
      }
      fetchMenuItems();
      resetForm();
    } catch (error) {
      console.error('Error saving menu item:', error);
      const errorMessage = error.formattedMessage ||
        error.response?.data?.message ||
        error.response?.data?.error ||
        'Failed to save menu item. Please try again.';
      showError(errorMessage);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || '',
      price: item.price,
      category_id: item.category_id || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Menu Item',
      message: 'Are you sure you want to delete this menu item?',
      onConfirm: async () => {
        try {
          await menuItemsAPI.delete(id);
          showSuccess('Menu item deleted successfully');
          fetchMenuItems();
        } catch (error) {
          console.error('Error deleting menu item:', error);
          const errorMessage = error.formattedMessage ||
            error.response?.data?.message ||
            error.response?.data?.error ||
            'Failed to delete menu item. Please try again.';
          showError(errorMessage);
        }
      },
      variant: 'danger'
    });
  };

  const resetForm = () => {
    setFormData({ name: '', description: '', price: '', category_id: '' });
    setEditingItem(null);
    setShowForm(false);
  };

  return (
    <div>
      <div className="card">
        <h2>Menu Management</h2>
        <button className="btn" onClick={() => setShowForm(true)}>
          Add Menu Item
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Name:</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Description:</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Price:</label>
              <input
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Category:</label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
              >
                <option value="">Select Category</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-success">
              {editingItem ? 'Update' : 'Add'} Menu Item
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h3>Menu Items</h3>
        <div className="grid grid-4">
          {menuItems.map(item => (
            <div key={item.id} className="menu-item">
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <p className="price">PKR {item.price}</p>
              <p style={{ fontSize: '0.8rem', color: '#a0aec0' }}>
                {item.category_name || 'Uncategorized'}
              </p>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                <button className="btn" onClick={() => handleEdit(item)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                  Edit
                </button>
                <button className="btn btn-danger" onClick={() => handleDelete(item.id)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
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

export default MenuManagement;
