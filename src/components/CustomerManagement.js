import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import OfflineModal from './OfflineModal';
import ConfirmationModal from './ConfirmationModal';
import CustomerAddressModal from './CustomerAddressModal';
import './AdminPortal.css';
import { FaMapMarkerAlt } from 'react-icons/fa';
import {
  useDebouncedValue,
  useCustomerListQuery,
  useCustomerSearchQuery,
  useCustomersAddressHydration,
  useCustomerDetailQuery,
  useCreateCustomerMutation,
  useUpdateCustomerMutation,
  useDeleteCustomerMutation,
  useCreateCustomerAddressMutation,
} from '../hooks';
import { customerKeys } from '../lib/queryKeys';

const CustomerManagement = () => {
  const { showSuccess, showError } = useToast();
  const { online } = useOffline();
  const queryClient = useQueryClient();
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const fetchEnabled = online || isElectron;

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 500);
  const isSearch = debouncedSearch.trim().length >= 2;

  const listQuery = useCustomerListQuery(1, 1000, { enabled: fetchEnabled && !isSearch });
  const searchQueryHook = useCustomerSearchQuery(debouncedSearch, { enabled: fetchEnabled && isSearch });

  const sourceQuery = isSearch ? searchQueryHook : listQuery;

  const { customers } = useCustomersAddressHydration(
    sourceQuery.data ?? [],
    { enabled: fetchEnabled && sourceQuery.isSuccess }
  );

  const initializingList =
    !sourceQuery.data && (sourceQuery.isPending || sourceQuery.isFetching);

  const createCustomerMutation = useCreateCustomerMutation();
  const updateCustomerMutation = useUpdateCustomerMutation();
  const deleteCustomerMutation = useDeleteCustomerMutation();
  const createCustomerAddressMutation = useCreateCustomerAddressMutation();

  const savingCustomer =
    createCustomerMutation.isPending ||
    updateCustomerMutation.isPending ||
    createCustomerAddressMutation.isPending;

  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    backupPhone: '',
    address: '',
    notes: '',
    googleLink: ''
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

  const detailForEdit = useCustomerDetailQuery(editingCustomer?.id, {
    enabled: Boolean(editingCustomer?.id && showCustomerModal && fetchEnabled),
    placeholderData: editingCustomer || undefined,
  });

  const prevEditingIdRef = useRef(null);
  useEffect(() => {
    if (!editingCustomer || !showCustomerModal) {
      prevEditingIdRef.current = null;
      return;
    }
    const id = editingCustomer.id;
    const fromDetail = detailForEdit.data?.addresses;
    const fromRow = editingCustomer.addresses;
    const addrs =
      Array.isArray(fromDetail) && fromDetail.length > 0
        ? fromDetail
        : (Array.isArray(fromRow) && fromRow.length > 0 ? fromRow : []);
    setCustomerAddresses(addrs);
    if (prevEditingIdRef.current !== id) {
      prevEditingIdRef.current = id;
      const defaultAddress = addrs.find((addr) => addr.isDefault) || addrs[0];
      const displayAddress = defaultAddress?.address || editingCustomer.address || '';
      setCustomerForm({
        name: editingCustomer.name || '',
        phone: editingCustomer.phone || '',
        backupPhone: editingCustomer.backupPhone || editingCustomer.backup_phone || '',
        address: displayAddress,
        notes: editingCustomer.notes || '',
        googleLink: editingCustomer.googleLink || editingCustomer.google_link || ''
      });
    }
  }, [editingCustomer, showCustomerModal, detailForEdit.data]);

  const invalidateCustomers = () => {
    queryClient.invalidateQueries({ queryKey: customerKeys.all });
  };

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
        const isNewAddress = !customerAddresses.some((addr) => addr.address === customerForm.address);

        await updateCustomerMutation.mutateAsync({
          id: editingCustomer.id,
          data: {
            name: customerForm.name,
            phone: customerForm.phone,
            backupPhone: customerForm.backupPhone,
            notes: customerForm.notes,
            googleLink: customerForm.googleLink || undefined
          }
        });

        if (isNewAddress && customerForm.address.trim()) {
          try {
            await createCustomerAddressMutation.mutateAsync({
              customerId: editingCustomer.id,
              data: {
                address: customerForm.address.trim(),
                isDefault: customerAddresses.length === 0,
                notes: customerForm.notes || undefined
              }
            });
          } catch (addrErr) {
            console.warn('Failed to add new address:', addrErr);
          }
        }

        showSuccess('Customer updated successfully');
      } else {
        await createCustomerMutation.mutateAsync({
          ...customerForm,
          googleLink: customerForm.googleLink || undefined
        });
        showSuccess('Customer created successfully');
      }

      setShowCustomerModal(false);
      setEditingCustomer(null);
      setCustomerForm({ name: '', phone: '', backupPhone: '', address: '', notes: '', googleLink: '' });
      setCustomerAddresses([]);
      setAddressSearchQuery('');
      invalidateCustomers();
    } catch (err) {
      console.error('Customer Error:', err);
      const errorMessage = err.formattedMessage || err.response?.data?.message || err.response?.data?.error || 'Error processing customer';
      showError(errorMessage);
    }
  };

  const handleDeleteCustomer = (customer) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Customer',
      message: `Are you sure you want to delete customer "${customer.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await deleteCustomerMutation.mutateAsync(customer.id);
          showSuccess('Customer deleted successfully');
          invalidateCustomers();
        } catch (err) {
          console.error('Delete Customer Error:', err);
          const errorMessage = err.formattedMessage || err.response?.data?.message || err.response?.data?.error || 'Error deleting customer';
          showError(errorMessage);
        }
      },
      variant: 'danger'
    });
  };

  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setShowCustomerModal(true);
  };

  const handleOpenAddressModal = (customer) => {
    setSelectedCustomerForAddress(customer);
    setShowAddressModal(true);
  };

  const handleAddressUpdate = () => {
    if (editingCustomer) {
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(editingCustomer.id) });
      queryClient.invalidateQueries({ queryKey: customerKeys.addresses(editingCustomer.id) });
    }
    invalidateCustomers();
  };

  const handleAddNew = () => {
    setEditingCustomer(null);
    setCustomerForm({ name: '', phone: '', backupPhone: '', address: '', notes: '', googleLink: '' });
    setShowCustomerModal(true);
  };

  if (!online && !isElectron) {
    return <OfflineModal title="Customer Management - Offline" />;
  }

  const listError =
    sourceQuery.isError &&
    sourceQuery.error?.response &&
    (sourceQuery.error.formattedMessage ||
      sourceQuery.error.response?.data?.message ||
      sourceQuery.error.response?.data?.error ||
      'Unknown server error');

  return (
    <div className="users-tab" style={{ marginTop: '20px' }}>
      <div className="tab-header">
        <h1>Customer Management</h1>
        <button type="button" className="btn-primary" onClick={handleAddNew}>
          Add New Customer
        </button>
      </div>

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

      {sourceQuery.isError && customers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#dc3545' }}>
          Failed to load customers: {listError}
        </div>
      ) : initializingList && customers.length === 0 ? (
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
                <th>Google Maps</th>
                <th>Total Orders</th>
                <th>Total Spent</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.id}</td>
                  <td>{customer.name.length > 20 ? customer.name.slice(0, 20) + '...' : customer.name}</td>
                  <td>{customer.phone.length > 10 ? customer.phone.slice(0, 10) + '...' : customer.phone}</td>
                  <td>{customer.backupPhone && customer.backupPhone.length > 10 ? customer.backupPhone.slice(0, 10) + '...' : customer.backupPhone || customer.backup_phone || '-'}</td>
                  <td style={{ maxWidth: '200px' }}>
                    {(() => {
                      const defaultAddr = customer.addresses?.find((addr) => addr.isDefault) ||
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
                  <td style={{ maxWidth: '200px' }}>
                    {(() => {
                      const customerMapsLink = customer.googleLink || customer.google_link;
                      const defaultAddr = customer.addresses?.find((addr) => addr.isDefault) ||
                        customer.addresses?.[0] ||
                        (customer.address ? { address: customer.address, isDefault: true, googleMapsLink: null } : null);
                      const addressMapsLink = defaultAddr?.googleMapsLink || defaultAddr?.google_maps_link;
                      const mapsLink = customerMapsLink || addressMapsLink;
                      if (!mapsLink) return '-';
                      return (
                        <a
                          href={mapsLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#339af0',
                            textDecoration: 'underline',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'block',
                            maxWidth: '200px'
                          }}
                          title={mapsLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FaMapMarkerAlt style={{ marginRight: '0.5rem' }} /> Open Map
                        </a>
                      );
                    })()}
                  </td>
                  <td>{customer.totalOrders || customer.total_orders || 0}</td>
                  <td>PKR {parseFloat(customer.totalSpent || customer.total_spent || 0).toFixed(2)}</td>
                  <td className="table-actions-cell">
                    <div className="table-action-buttons">
                      <button type="button" className="btn-edit" onClick={() => handleEditCustomer(customer)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => handleDeleteCustomer(customer)}
                        disabled={deleteCustomerMutation.isPending}
                      >
                        {deleteCustomerMutation.isPending ? 'Processing...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
            overflow: 'auto',
            position: 'relative'
          }}>

            <button type="button" style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              background: 'white',
              borderRadius: '50%',
              padding: '0.5rem',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer'
            }}
            onClick={() => {
              setShowCustomerModal(false);
              setEditingCustomer(null);
            }}
            >
              ×
            </button>
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
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenAddressModal(editingCustomer)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleOpenAddressModal(editingCustomer); }}
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
                      setCustomerForm({ ...customerForm, address: query });
                    }}
                    onFocus={() => {
                      if (editingCustomer && customerAddresses.length > 0) {
                        setAddressSearchQuery(customerForm.address);
                        setShowAddressDropdown(true);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowAddressDropdown(false);
                        if (addressSearchQuery && editingCustomer) {
                          const matches = customerAddresses.some((addr) =>
                            addr.address.toLowerCase() === addressSearchQuery.trim().toLowerCase()
                          );
                          if (!matches) {
                            setCustomerForm({ ...customerForm, address: addressSearchQuery });
                          } else {
                            setAddressSearchQuery('');
                          }
                        } else {
                          setAddressSearchQuery('');
                        }
                      }, 200);
                    }}
                    placeholder={editingCustomer ? 'Type to search addresses or enter new address...' : 'Enter address...'}
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
                          ? customerAddresses.filter((addr) => addr.address.toLowerCase().includes(query))
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
                            onMouseEnter={(e) => { e.target.style.background = '#f8f9fa'; }}
                            onMouseLeave={(e) => { e.target.style.background = customerForm.address === addr.address ? '#e7f5ff' : 'white'; }}
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

                      {addressSearchQuery.trim() &&
                        !customerAddresses.some((addr) =>
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
                            onMouseEnter={(e) => { e.target.style.background = '#e6ffed'; }}
                            onMouseLeave={(e) => { e.target.style.background = '#f8f9fa'; }}
                          >
                            + Add as new address: &quot;{addressSearchQuery}&quot;
                          </div>
                      )}
                    </div>
                  )}
                </div>

                {editingCustomer && customerForm.address && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6c757d' }}>
                    {(() => {
                      const selectedAddr = customerAddresses.find((addr) => addr.address === customerForm.address);
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
                      }
                      return <span style={{ color: '#28a745' }}>● New address (will be created on save)</span>;
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
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Google Maps Link
                </label>
                <input
                  type="url"
                  value={customerForm.googleLink}
                  onChange={(e) => setCustomerForm({ ...customerForm, googleLink: e.target.value })}
                  placeholder="https://maps.google.com/..."
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #dee2e6',
                    borderRadius: '8px',
                    fontSize: '0.95rem'
                  }}
                />
                <small style={{ display: 'block', marginTop: '0.25rem', color: '#6c757d', fontSize: '0.85rem' }}>
                  Optional: Add a Google Maps link for this customer&apos;s location
                </small>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomerModal(false);
                    setEditingCustomer(null);
                    setCustomerForm({ name: '', phone: '', backupPhone: '', address: '', notes: '', googleLink: '' });
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
                  disabled={savingCustomer}
                >
                  {savingCustomer ? 'Processing...' : (editingCustomer ? 'Update' : 'Create')}
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
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
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
