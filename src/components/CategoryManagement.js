import React, { useState, useEffect } from 'react';
import { categoriesAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';

const CategoryManagement = () => {
  const { showSuccess, showError } = useToast();
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });

  useEffect(() => {
    fetchCategories();
  }, []);

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
    if (!categoryName.trim()) return;

    try {
      await categoriesAPI.create({ name: categoryName });
      showSuccess('Category created successfully');
      fetchCategories();
      setCategoryName('');
      setShowForm(false);
    } catch (error) {
      console.error('Error creating category:', error);
      const errorMessage = error.formattedMessage ||
        error.response?.data?.message ||
        error.response?.data?.error ||
        'Failed to create category. Please try again.';
      showError(errorMessage);
    }
  };

  const handleDelete = async (id) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category?',
      onConfirm: async () => {
        try {
          await categoriesAPI.delete(id);
          showSuccess('Category deleted successfully');
          fetchCategories();
        } catch (error) {
          console.error('Error deleting category:', error);
          const errorMessage = error.formattedMessage ||
            error.response?.data?.message ||
            error.response?.data?.error ||
            'Failed to delete category. Please try again.';
          showError(errorMessage);
        }
      },
      variant: 'danger'
    });
  };

  return (
    <div>
      <div className="card">
        <h2>Category Management</h2>
        <button className="btn" onClick={() => setShowForm(true)}>
          Add Category
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>Add New Category</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Category Name:</label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Enter category name"
                required
              />
            </div>
            <button type="submit" className="btn btn-success">
              Add Category
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowForm(false);
                setCategoryName('');
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h3>Categories</h3>
        <div className="grid grid-2">
          {categories.map(category => (
            <div key={category.id} className="menu-item">
              <h3>{category.name}</h3>
              <p>Created: {new Date(category.created_at).toLocaleDateString()}</p>
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(category.id)}
              >
                Delete
              </button>
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

export default CategoryManagement;
