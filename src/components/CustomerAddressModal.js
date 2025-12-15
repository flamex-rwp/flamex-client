import React, { useState, useEffect } from 'react';
import { customerAPI } from '../services/customerAPI';
import { useToast } from '../contexts/ToastContext';
import ConfirmationModal from './ConfirmationModal';

const CustomerAddressModal = ({ isOpen, onClose, customer, onAddressUpdate }) => {
  const { showSuccess, showError } = useToast();
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressNotes, setNewAddressNotes] = useState('');
  const [newGoogleMapsLink, setNewGoogleMapsLink] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  useEffect(() => {
    if (isOpen && customer?.id) {
      loadAddresses();
    }
  }, [isOpen, customer]);

  const loadAddresses = async () => {
    if (!customer?.id) return;

    setLoading(true);
    try {
      // Always fetch fresh addresses from API to ensure we have all addresses
      const response = await customerAPI.getAddresses(customer.id);
      const addressData = response.data?.data || response.data || [];
      let addressList = Array.isArray(addressData) ? addressData : [];

      // If no addresses but customer has legacy address field, use that (online fallback)
      if (addressList.length === 0 && customer.address) {
        addressList = [{
          id: 'legacy',
          address: customer.address,
          isDefault: true,
          customerId: customer.id
        }];
      }

      console.log(`[CustomerAddressModal] Loaded ${addressList.length} addresses for customer ${customer.id}`);
      setAddresses(addressList);
    } catch (err) {
      console.error('Failed to load addresses:', err);
      
      // Fallback: use addresses from customer object if available
      if (customer.addresses && Array.isArray(customer.addresses) && customer.addresses.length > 0) {
        console.log(`[CustomerAddressModal] Using addresses from customer object: ${customer.addresses.length}`);
        setAddresses(customer.addresses);
      } else if (customer.address) {
        // Fallback to legacy address if available
        setAddresses([{
          id: 'legacy',
          address: customer.address,
          isDefault: true,
          customerId: customer.id
        }]);
      } else {
        setAddresses([]);
        showError('Failed to load addresses');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddAddress = async () => {
    if (!newAddress.trim()) {
      showError('Address is required');
      return;
    }

    // Check for duplicates
    const normalizedNew = newAddress.trim().toLowerCase();
    const duplicate = addresses.find(
      addr => addr.address.trim().toLowerCase() === normalizedNew
    );

    if (duplicate) {
      showError('This address already exists for this customer');
      return;
    }

    setAdding(true);
    try {
      const customerIdStr = String(customer.id ?? '');
      const isOfflineId = typeof customer.id === 'string' && customerIdStr.startsWith('OFFLINE-');

      if (!navigator.onLine || isOfflineId) {
        // Offline: create local address and queue sync
        const newAddr = {
          id: `OFFLINE-ADDR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          address: newAddress.trim(),
          isDefault,
          notes: newAddressNotes.trim() || undefined,
          googleMapsLink: newGoogleMapsLink.trim() || undefined,
          customerId: customer.id,
          offline: true
        };

        try {
          const { saveCustomer, addPendingOperation, getCachedCustomers } = await import('../utils/offlineDB');
          const cached = await getCachedCustomers();
          const current = cached.find(c => c.id === customer.id) || customer;
          const updatedCustomer = {
            ...current,
            addresses: [...(current.addresses || []), newAddr]
          };
          await saveCustomer(updatedCustomer);

          await addPendingOperation({
            type: 'update_customer_address',
            endpoint: `/api/customers/${customer.id}/addresses`,
            method: 'POST',
            data: {
              address: newAddr.address,
              isDefault: newAddr.isDefault,
              notes: newAddr.notes,
              googleMapsLink: newAddr.googleMapsLink
            },
            offlineId: customer.id
          });
        } catch (offlineErr) {
          console.warn('Failed to cache offline address:', offlineErr);
        }

      setAddresses(prev => [...prev, newAddr]);
      setNewAddress('');
      setNewAddressNotes('');
      setNewGoogleMapsLink('');
      setIsDefault(false);
      setShowAddForm(false);
        showSuccess('Address saved offline. It will sync when back online.');
        if (onAddressUpdate) onAddressUpdate();
        return;
      }

      // Online path
      const response = await customerAPI.createAddress(customer.id, {
        address: newAddress.trim(),
        isDefault: isDefault,
        notes: newAddressNotes.trim() || undefined,
        googleMapsLink: newGoogleMapsLink.trim() || undefined
      });

      const newAddr = response.data?.data || response.data;
      await loadAddresses(); // Reload to get updated list
      setNewAddress('');
      setNewAddressNotes('');
      setNewGoogleMapsLink('');
      setIsDefault(false);
      setShowAddForm(false);
      showSuccess('Address added successfully');
      
      if (onAddressUpdate) {
        onAddressUpdate();
      }
    } catch (err) {
      console.error('Failed to add address:', err);
      const errorMsg = err.response?.data?.error || err.response?.data?.message || 'Failed to add address';
      showError(errorMsg);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteAddress = async (addressId, addressText) => {
    console.log('[AddressModal] Delete icon clicked (direct)', { addressId, addressText, customerId: customer?.id, online: navigator.onLine });
    if (addressId === 'legacy') {
      showError('Cannot delete legacy address. Please add a new address first.');
      return;
    }

        setDeletingId(addressId);
        try {
      const customerIdStr = String(customer.id ?? '');
      const isOfflineId = typeof customer.id === 'string' && customerIdStr.startsWith('OFFLINE-');

      if (!navigator.onLine || isOfflineId) {
        // Offline delete: remove locally and queue sync
        try {
          const { saveCustomer, addPendingOperation, getCachedCustomers } = await import('../utils/offlineDB');
          const cached = await getCachedCustomers();
          const current = cached.find(c => c.id === customer.id) || customer;
          const updatedAddresses = (current.addresses || []).filter(a => a.id !== addressId);
          const updatedCustomer = { ...current, addresses: updatedAddresses };
          await saveCustomer(updatedCustomer);

          await addPendingOperation({
            type: 'delete_customer_address',
            endpoint: `/api/customers/addresses/${addressId}`,
            method: 'DELETE',
            data: { customerId: customer.id },
            offlineId: customer.id
          });
          console.log('[AddressModal] Offline delete queued and cached updated', { addressId, customerId: customer.id });
        } catch (offlineErr) {
          console.warn('Failed to cache delete address offline:', offlineErr);
        }
        setAddresses(prev => prev.filter(a => a.id !== addressId));
        showSuccess('Address removed offline. It will sync when back online.');
        if (onAddressUpdate) onAddressUpdate();
      } else {
        console.log('[AddressModal] Online delete starting', { addressId, customerId: customer.id });
          await customerAPI.deleteAddress(addressId);
        console.log('[AddressModal] Online delete response success', { addressId });

        // Update local state immediately
        setAddresses(prev => prev.filter(a => a.id !== addressId));

        // Update cached customer for offline use
        try {
          const { saveCustomer, getCachedCustomers } = await import('../utils/offlineDB');
          const cached = await getCachedCustomers();
          const current = cached.find(c => c.id === customer.id) || customer;
          const updatedAddresses = (current.addresses || []).filter(a => a.id !== addressId);
          const updatedCustomer = { ...current, addresses: updatedAddresses };
          await saveCustomer(updatedCustomer);
          console.log('[AddressModal] Cached customer updated after online delete', { addressId, customerId: customer.id });
        } catch (cacheErr) {
          console.warn('Failed to update cached customer after delete:', cacheErr);
        }

        // Reload to ensure fresh list from API
          await loadAddresses();
        console.log('[AddressModal] Reloaded addresses after delete');
          showSuccess('Address deleted successfully');
          if (onAddressUpdate) {
            onAddressUpdate();
        }
          }
        } catch (err) {
          console.error('Failed to delete address:', err);
          showError(err.response?.data?.error || err.response?.data?.message || 'Failed to delete address');
        } finally {
          setDeletingId(null);
          setConfirmModal({ ...confirmModal, isOpen: false });
        }
  };

  const handleSetDefault = async (addressId) => {
    try {
      const customerIdStr = String(customer.id ?? '');
      const isOfflineId = typeof customer.id === 'string' && customerIdStr.startsWith('OFFLINE-');

      if (!navigator.onLine || isOfflineId) {
        // Offline set default: update local state and queue sync
        const updated = addresses.map(addr => ({
          ...addr,
          isDefault: addr.id === addressId
        }));
        setAddresses(updated);
        try {
          const { saveCustomer, addPendingOperation, getCachedCustomers } = await import('../utils/offlineDB');
          const cached = await getCachedCustomers();
          const current = cached.find(c => c.id === customer.id) || customer;
          const updatedCustomer = { ...current, addresses: updated };
          await saveCustomer(updatedCustomer);
          await addPendingOperation({
            type: 'update_customer_address',
            endpoint: `/api/customers/addresses/${addressId}`,
            method: 'PUT',
            data: { isDefault: true },
            offlineId: customer.id
          });
        } catch (offlineErr) {
          console.warn('Failed to cache default address change offline:', offlineErr);
        }
        showSuccess('Default address updated offline. It will sync when back online.');
        if (onAddressUpdate) onAddressUpdate();
        return;
      }

      await customerAPI.updateAddress(addressId, { isDefault: true });
      console.log('[AddressModal] Online set default success', { addressId, customerId: customer.id });
      await loadAddresses();
      showSuccess('Default address updated');
      if (onAddressUpdate) {
        onAddressUpdate();
      }
    } catch (err) {
      console.error('Failed to set default address:', err);
      showError(err.response?.data?.error || err.response?.data?.message || 'Failed to update default address');
    }
  };

  if (!isOpen) return null;

  const defaultAddress = addresses.find(addr => addr.isDefault) || addresses[0];

  return (
    <>
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
        zIndex: 2000
      }} onClick={onClose}>
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '2rem',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflow: 'auto',
          position: 'relative'
        }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>
              Addresses for {customer?.name || 'Customer'}
            </h2>
            <button
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#6c757d',
                padding: '0.25rem 0.5rem'
              }}
            >
              ×
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#6c757d' }}>
              Loading addresses...
            </div>
          ) : (
            <>
              {/* Default Address Display */}
              {defaultAddress && (
                <div style={{
                  padding: '1rem',
                  background: '#e7f5ff',
                  border: '2px solid #339af0',
                  borderRadius: '8px',
                  marginBottom: '1.5rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.85rem', color: '#339af0', fontWeight: '600', marginBottom: '0.5rem' }}>
                        DEFAULT ADDRESS
                      </div>
                      <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                        {defaultAddress.address}
                      </div>
                      {defaultAddress.notes && (
                        <div style={{ fontSize: '0.9rem', color: '#6c757d', marginTop: '0.25rem' }}>
                          <strong>Notes:</strong> {defaultAddress.notes}
                        </div>
                      )}
                      {defaultAddress.googleMapsLink && (
                        <div style={{ fontSize: '0.9rem', color: '#6c757d', marginTop: '0.25rem' }}>
                          <strong>Google Maps:</strong>{' '}
                          <a 
                            href={defaultAddress.googleMapsLink} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ color: '#339af0', textDecoration: 'underline', wordBreak: 'break-all' }}
                          >
                            {defaultAddress.googleMapsLink}
                          </a>
                        </div>
                      )}
                    </div>
                    {defaultAddress.id !== 'legacy' && (
                      <button
                        onClick={() => handleDeleteAddress(defaultAddress.id, defaultAddress.address)}
                        disabled={deletingId === defaultAddress.id}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#dc3545',
                          cursor: deletingId === defaultAddress.id ? 'not-allowed' : 'pointer',
                          padding: '0.25rem 0.5rem',
                          fontSize: '1.2rem',
                          opacity: deletingId === defaultAddress.id ? 0.5 : 1
                        }}
                        title="Delete address"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Other Addresses */}
              {addresses.filter(addr => !addr.isDefault).length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', color: '#495057' }}>
                    Other Addresses ({addresses.filter(addr => !addr.isDefault).length})
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {addresses.filter(addr => !addr.isDefault).map((addr) => (
                      <div
                        key={addr.id}
                        style={{
                          padding: '1rem',
                          border: '1px solid #dee2e6',
                          borderRadius: '8px',
                          background: 'white'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>
                              {addr.address}
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
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <button
                              onClick={() => handleSetDefault(addr.id)}
                              style={{
                                border: '1px solid #28a745',
                                background: 'white',
                                color: '#28a745',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: '500'
                              }}
                              title="Set as default"
                            >
                              Set Default
                            </button>
                            {addr.id !== 'legacy' && (
                              <button
                                onClick={() => handleDeleteAddress(addr.id, addr.address)}
                                disabled={deletingId === addr.id}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#dc3545',
                                  cursor: deletingId === addr.id ? 'not-allowed' : 'pointer',
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '1.2rem',
                                  opacity: deletingId === addr.id ? 0.5 : 1
                                }}
                                title="Delete address"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add New Address Form */}
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px dashed #dee2e6',
                    borderRadius: '8px',
                    background: 'white',
                    color: '#495057',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: '500'
                  }}
                >
                  + Add New Address
                </button>
              ) : (
                <div style={{
                  padding: '1rem',
                  border: '2px solid #dee2e6',
                  borderRadius: '8px',
                  background: '#f8f9fa'
                }}>
                  <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Add New Address</h3>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: '500' }}>
                      Address *
                    </label>
                    <textarea
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="Enter full address..."
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        fontSize: '0.9rem',
                        resize: 'vertical'
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: '500' }}>
                      Notes (optional)
                    </label>
                    <input
                      type="text"
                      value={newAddressNotes}
                      onChange={(e) => setNewAddressNotes(e.target.value)}
                      placeholder="Delivery instructions, landmarks, etc."
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: '500' }}>
                      Google Maps Link (optional)
                    </label>
                    <input
                      type="url"
                      value={newGoogleMapsLink}
                      onChange={(e) => setNewGoogleMapsLink(e.target.value)}
                      placeholder="https://maps.google.com/..."
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      id="isDefaultNew"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      style={{ marginRight: '0.5rem' }}
                    />
                    <label htmlFor="isDefaultNew" style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
                      Set as default address
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleAddAddress}
                      disabled={adding || !newAddress.trim()}
                      style={{
                        flex: 1,
                        padding: '0.5rem 1rem',
                        border: 'none',
                        borderRadius: '6px',
                        background: adding ? '#6c757d' : '#28a745',
                        color: 'white',
                        cursor: adding || !newAddress.trim() ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: '500'
                      }}
                    >
                      {adding ? 'Adding...' : 'Add Address'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setNewAddress('');
                        setNewAddressNotes('');
                        setNewGoogleMapsLink('');
                        setIsDefault(false);
                      }}
                      style={{
                        padding: '0.5rem 1rem',
                        border: '1px solid #dee2e6',
                        borderRadius: '6px',
                        background: 'white',
                        color: '#495057',
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={async () => {
          try {
            if (confirmModal.onConfirm) {
              await confirmModal.onConfirm();
            }
          } catch (err) {
            console.error('[AddressModal] Confirm handler error:', err);
          }
        }}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        variant="danger"
      />
    </>
  );
};

export default CustomerAddressModal;


