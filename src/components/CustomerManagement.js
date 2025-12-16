import React, { useState, useEffect, useCallback, useRef } from 'react';
import { customerAPI } from '../services/customerAPI';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import ConfirmationModal from './ConfirmationModal';
import CustomerAddressModal from './CustomerAddressModal';
import './AdminPortal.css';

const CustomerManagement = () => {
  const { showSuccess, showError } = useToast();
  const { online } = useOffline();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('all'); // 'all', 'phone', 'name', 'address'
  const debounceTimerRef = useRef(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    backupPhone: '',
    address: '',
    notes: ''
  });
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    variant: 'danger'
  });
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [selectedCustomerForAddress, setSelectedCustomerForAddress] = useState(null);
  const [customerAddresses, setCustomerAddresses] = useState([]);
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      let response;
      if (searchQuery.trim().length >= 2) {
        // Use search endpoint
        response = await customerAPI.search(searchQuery);
        const data = response.data.data || response.data || [];
        const customersList = Array.isArray(data) ? data : [];
        // Ensure addresses are included - fetch full data if missing
        const customersWithAddresses = await Promise.all(
          customersList.map(async (customer) => {
            if (!customer.addresses || customer.addresses.length === 0) {
              try {
                const fullResponse = await customerAPI.getById(customer.id);
                const fullCustomer = fullResponse.data?.data || fullResponse.data || customer;
                return { ...customer, addresses: fullCustomer.addresses || [] };
              } catch {
                return customer;
              }
            }
            return customer;
          })
        );
        setCustomers(customersWithAddresses);
      } else {
        // Use list endpoint
        response = await customerAPI.list(1, 50);
        const data = response.data.data || response.data || {};
        const customersList = Array.isArray(data.customers) ? data.customers : [];
        // Ensure addresses are included
        const customersWithAddresses = await Promise.all(
          customersList.map(async (customer) => {
            if (!customer.addresses || customer.addresses.length === 0) {
              try {
                const fullResponse = await customerAPI.getById(customer.id);
                const fullCustomer = fullResponse.data?.data || fullResponse.data || customer;
                return { ...customer, addresses: fullCustomer.addresses || [] };
              } catch {
                return customer;
              }
            }
            return customer;
          })
        );
        setCustomers(customersWithAddresses);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
      // Don't show error for network errors when offline - cache will handle it
      if (err.response) {
        showError('Failed to load customers: ' + (err.response?.data?.error || err.message));
      }
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, showError]);

  useEffect(() => {
    // Debounce search
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchCustomers();
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, fetchCustomers]);

  // Initial fetch on mount
  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleCreateCustomer = async () => {
    try {
      if (!customerForm.name || !customerForm.phone || !customerForm.address) {
        showError('Name, phone, and address are required');
        return;
      }

      if (editingCustomer) {
        // Check if address is new (not in existing addresses)
        const isNewAddress = !customerAddresses.some(addr => addr.address === customerForm.address);

        // Update customer
        await customerAPI.update(editingCustomer.id, {
          name: customerForm.name,
          phone: customerForm.phone,
          backupPhone: customerForm.backupPhone,
          notes: customerForm.notes
        });

        // If it's a new address, add it
        if (isNewAddress && customerForm.address.trim()) {
          try {
            await customerAPI.createAddress(editingCustomer.id, {
              address: customerForm.address.trim(),
              isDefault: customerAddresses.length === 0, // Set as default if no addresses exist
              notes: customerForm.notes || undefined
            });
          } catch (addrErr) {
            console.warn('Failed to add new address:', addrErr);
            // Continue even if address creation fails
          }
        }

        showSuccess('Customer updated successfully');
      } else {
        await customerAPI.create(customerForm);
        showSuccess('Customer created successfully');
      }

      setShowCustomerModal(false);
      setEditingCustomer(null);
      setCustomerForm({ name: '', phone: '', backupPhone: '', address: '', notes: '' });
      setCustomerAddresses([]);
      setAddressSearchQuery('');
      fetchCustomers();
    } catch (err) {
      showError('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteCustomer = (customer) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Customer',
      message: `Are you sure you want to delete customer "${customer.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await customerAPI.delete(customer.id);
          showSuccess('Customer deleted successfully');
          fetchCustomers();
        } catch (err) {
          showError('Error: ' + (err.response?.data?.error || err.message));
        }
      },
      variant: 'danger'
    });
  };

  const loadCustomerAddresses = useCallback(async (customerId) => {
    try {
      const response = await customerAPI.getAddresses(customerId);
      const addressData = response.data?.data || response.data || [];
      return Array.isArray(addressData) ? addressData : [];
    } catch (err) {
      console.error('Failed to load addresses:', err);
      return [];
    }
  }, []);

  const handleEditCustomer = async (customer) => {
    setEditingCustomer(customer);

    // Load addresses for this customer
    const addresses = await loadCustomerAddresses(customer.id);
    setCustomerAddresses(addresses);

    // Get default address or first address
    const defaultAddress = addresses.find(addr => addr.isDefault) || addresses[0];
    const displayAddress = defaultAddress?.address || customer.address || '';

    setCustomerForm({
      name: customer.name || '',
      phone: customer.phone || '',
      backupPhone: customer.backupPhone || customer.backup_phone || '',
      address: displayAddress,
      notes: customer.notes || ''
    });
    setShowCustomerModal(true);
  };

  const handleOpenAddressModal = async (customer) => {
    setSelectedCustomerForAddress(customer);
    setShowAddressModal(true);
  };

  const handleAddressUpdate = async () => {
    if (editingCustomer) {
      // Reload addresses for editing customer
      const addresses = await loadCustomerAddresses(editingCustomer.id);
      setCustomerAddresses(addresses);
      const defaultAddress = addresses.find(addr => addr.isDefault) || addresses[0];
      if (defaultAddress) {
        setCustomerForm({ ...customerForm, address: defaultAddress.address });
      }
    }
    // Refresh customer list
    fetchCustomers();
  };

  const handleAddNew = () => {
    setEditingCustomer(null);
    setCustomerForm({ name: '', phone: '', backupPhone: '', address: '', notes: '' });
    setShowCustomerModal(true);
  };

  // Show offline modal if offline
  if (!online) {
    return <OfflineModal title="Customer Management - Offline" />;
  }

  return (
    <div className="users-tab">
      <div className="tab-header">
        <h1>Customer Management</h1>
        <button className="btn-primary" onClick={handleAddNew}>
          Add New Customer
        </button>
      </div>

      {/* Search Filters */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '1.5rem'
      }}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
            Search Customers
          </label>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search by phone number, name, or address..."
              value={searchQuery}
              onChange={handleSearchChange}
              style={{
                flex: '1',
                minWidth: '250px',
                padding: '0.75rem',
                border: '2px solid #dee2e6',
                borderRadius: '8px',
                fontSize: '0.95rem'
              }}
            />
            <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>
              {searchQuery.length > 0 && searchQuery.length < 2 && 'Enter at least 2 characters to search'}
            </div>
          </div>
        </div>
      </div>

      {/* Customers Table */}
      {loading && customers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '1.2rem', color: '#6c757d' }}>Loading customers...</div>
        </div>
      ) : customers.length === 0 ? (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ fontSize: '1.2rem', color: '#6c757d', marginBottom: '0.5rem' }}>
            No customers found
          </div>
          <div style={{ fontSize: '0.9rem', color: '#adb5bd' }}>
            {searchQuery ? 'Try a different search query' : 'Click "Add New Customer" to create one'}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}
          className="table-responsive"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Backup Phone</th>
                <th>Address</th>
                <th>Total Orders</th>
                <th>Total Spent</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(customer => (
                <tr key={customer.id}>
                  <td>{customer.id}</td>
                  <td>{customer.name}</td>
                  <td>{customer.phone}</td>
                  <td>{customer.backupPhone || customer.backup_phone || '-'}</td>
                  <td style={{ maxWidth: '200px' }}>
                    {(() => {
                      const defaultAddr = customer.addresses?.find(addr => addr.isDefault) ||
                        customer.addresses?.[0] ||
                        (customer.address ? { address: customer.address, isDefault: true } : null);
                      if (!defaultAddr) return '-';
                      return (
                        <div
                          onClick={() => handleOpenAddressModal(customer)}
                          style={{
                            cursor: 'pointer',
                            color: '#339af0',
                            textDecoration: 'underline',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '200px'
                          }}
                          title={`Click to manage addresses. ${defaultAddr.isDefault ? '(Default)' : ''}`}
                        >
                          {defaultAddr.address}
                          {defaultAddr.isDefault && ' (Default)'}
                        </div>
                      );
                    })()}
                  </td>
                  <td>{customer.totalOrders || customer.total_orders || 0}</td>
                  <td>PKR {parseFloat(customer.totalSpent || customer.total_spent || 0).toFixed(2)}</td>
                  <td>
                    <button className="btn-edit" onClick={() => handleEditCustomer(customer)}>
                      Edit
                    </button>
                    <button className="btn-delete" onClick={() => handleDeleteCustomer(customer)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer Modal */}
      {showCustomerModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '2rem',
            width: '90%',
            maxWidth: '500px',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <h2 style={{ marginBottom: '1.5rem' }}>
              {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
            </h2>
            <form onSubmit={(e) => { e.preventDefault(); handleCreateCustomer(); }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '0.95rem'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Phone *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customerForm.phone}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^[0-9]+$/.test(val)) {
                      setCustomerForm({ ...customerForm, phone: val });
                    }
                  }}
                  onKeyPress={(e) => {
                    if (!/[0-9]/.test(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '0.95rem'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Backup Phone
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customerForm.backupPhone}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^[0-9]+$/.test(val)) {
                      setCustomerForm({ ...customerForm, backupPhone: val });
                    }
                  }}
                  onKeyPress={(e) => {
                    if (!/[0-9]/.test(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '0.95rem'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem', position: 'relative' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Address *
                  {editingCustomer && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', fontWeight: 'normal', color: '#6c757d' }}>
                      (or <span
                        onClick={() => handleOpenAddressModal(editingCustomer)}
                        style={{ color: '#339af0', cursor: 'pointer', textDecoration: 'underline' }}
                      >manage addresses</span>)
                    </span>
                  )}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={editingCustomer && showAddressDropdown ? addressSearchQuery : customerForm.address}
                    onChange={(e) => {
                      const query = e.target.value;
                      setAddressSearchQuery(query);
                      setShowAddressDropdown(true);

                      // Update form address as user types
                      setCustomerForm({ ...customerForm, address: query });
                    }}
                    onFocus={() => {
                      if (editingCustomer && customerAddresses.length > 0) {
                        setAddressSearchQuery(customerForm.address);
                        setShowAddressDropdown(true);
                      }
                    }}
                    onBlur={() => {
                      // Delay to allow click on dropdown
                      setTimeout(() => {
                        setShowAddressDropdown(false);
                        // If search query doesn't match any address, keep it as new address
                        if (addressSearchQuery && editingCustomer) {
                          const matches = customerAddresses.some(addr =>
                            addr.address.toLowerCase() === addressSearchQuery.trim().toLowerCase()
                          );
                          if (!matches) {
                            // Keep the new address
                            setCustomerForm({ ...customerForm, address: addressSearchQuery });
                          } else {
                            // Reset to selected address
                            setAddressSearchQuery('');
                          }
                        } else {
                          setAddressSearchQuery('');
                        }
                      }, 200);
                    }}
                    placeholder={editingCustomer ? "Type to search addresses or enter new address..." : "Enter address..."}
                    required={!editingCustomer}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #dee2e6',
                      borderRadius: '8px',
                      fontSize: '0.95rem',
                      fontFamily: 'inherit'
                    }}
                  />

                  {/* Address Dropdown */}
                  {editingCustomer && showAddressDropdown && customerAddresses.length > 0 && (
                    <div
                      onMouseDown={(e) => e.preventDefault()}
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: '0.25rem',
                        background: 'white',
                        border: '2px solid #dee2e6',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        zIndex: 1000,
                        maxHeight: '200px',
                        overflowY: 'auto'
                      }}
                    >
                      {(() => {
                        const query = addressSearchQuery.trim().toLowerCase();
                        const filtered = query
                          ? customerAddresses.filter(addr => addr.address.toLowerCase().includes(query))
                          : customerAddresses;

                        return filtered.map((addr) => (
                          <div
                            key={addr.id}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setCustomerForm({ ...customerForm, address: addr.address });
                              setAddressSearchQuery('');
                              setShowAddressDropdown(false);
                            }}
                            style={{
                              padding: '0.75rem',
                              cursor: 'pointer',
                              borderBottom: '1px solid #f1f3f5',
                              background: customerForm.address === addr.address ? '#e7f5ff' : 'white'
                            }}
                            onMouseEnter={(e) => e.target.style.background = '#f8f9fa'}
                            onMouseLeave={(e) => e.target.style.background = customerForm.address === addr.address ? '#e7f5ff' : 'white'}
                          >
                            <div style={{ fontWeight: '500' }}>
                              {addr.address}
                              {addr.isDefault && <span style={{ color: '#339af0', fontSize: '0.85rem', marginLeft: '0.5rem' }}>(Default)</span>}
                            </div>
                            {addr.notes && (
                              <div style={{ fontSize: '0.85rem', color: '#6c757d', marginTop: '0.25rem' }}>
                                <strong>Notes:</strong> {addr.notes}
                              </div>
                            )}
                            {addr.googleMapsLink && (
                              <div style={{ fontSize: '0.85rem', color: '#6c757d', marginTop: '0.25rem' }}>
                                <strong>Google Maps:</strong>{' '}
                                <a
                                  href={addr.googleMapsLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: '#339af0', textDecoration: 'underline', wordBreak: 'break-all' }}
                                >
                                  {addr.googleMapsLink}
                                </a>
                              </div>
                            )}
                          </div>
                        ));
                      })()}

                      {/* Show "New Address" option if query doesn't match */}
                      {addressSearchQuery.trim() &&
                        !customerAddresses.some(addr =>
                          addr.address.toLowerCase() === addressSearchQuery.trim().toLowerCase()
                        ) && (
                          <div
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setCustomerForm({ ...customerForm, address: addressSearchQuery });
                              setAddressSearchQuery('');
                              setShowAddressDropdown(false);
                            }}
                            style={{
                              padding: '0.75rem',
                              cursor: 'pointer',
                              borderTop: '2px dashed #dee2e6',
                              background: '#f8f9fa',
                              color: '#28a745',
                              fontWeight: '500'
                            }}
                            onMouseEnter={(e) => e.target.style.background = '#e6ffed'}
                            onMouseLeave={(e) => e.target.style.background = '#f8f9fa'}
                          >
                            + Add as new address: "{addressSearchQuery}"
                          </div>
                        )}
                    </div>
                  )}
                </div>

                {/* Show selected address details */}
                {editingCustomer && customerForm.address && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6c757d' }}>
                    {(() => {
                      const selectedAddr = customerAddresses.find(addr => addr.address === customerForm.address);
                      if (selectedAddr) {
                        return (
                          <div>
                            {selectedAddr.isDefault && <span style={{ color: '#339af0' }}>● Default Address</span>}
                            {selectedAddr.notes && (
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>Notes:</strong> {selectedAddr.notes}
                              </div>
                            )}
                            {selectedAddr.googleMapsLink && (
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>Google Maps:</strong>{' '}
                                <a
                                  href={selectedAddr.googleMapsLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: '#339af0', textDecoration: 'underline' }}
                                >
                                  {selectedAddr.googleMapsLink}
                                </a>
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        return <span style={{ color: '#28a745' }}>● New address (will be created on save)</span>;
                      }
                    })()}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Notes
                </label>
                <textarea
                  value={customerForm.notes}
                  onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '0.95rem',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomerModal(false);
                    setEditingCustomer(null);
                    setCustomerForm({ name: '', phone: '', backupPhone: '', address: '', notes: '' });
                    setCustomerAddresses([]);
                    setAddressSearchQuery('');
                    setShowAddressDropdown(false);
                  }}
                  style={{
                    padding: '0.75rem 1.5rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    background: 'white',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '0.75rem 1.5rem' }}
                >
                  {editingCustomer ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={() => {
          if (confirmModal.onConfirm) confirmModal.onConfirm();
          setConfirmModal({ ...confirmModal, isOpen: false });
        }}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        variant={confirmModal.variant}
      />

      <CustomerAddressModal
        isOpen={showAddressModal}
        onClose={() => {
          setShowAddressModal(false);
          setSelectedCustomerForAddress(null);
        }}
        customer={selectedCustomerForAddress}
        onAddressUpdate={handleAddressUpdate}
      />
    </div>
  );
};

export default CustomerManagement;

