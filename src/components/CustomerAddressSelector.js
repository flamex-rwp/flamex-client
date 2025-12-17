import React, { useState, useEffect } from 'react';
import { customerAPI } from '../services/customerAPI';
import { useToast } from '../contexts/ToastContext';
import { isOnline } from '../utils/offlineSync';

const CustomerAddressSelector = ({
  customer,
  selectedAddress,
  onAddressSelect,
  onNewAddress,
  disabled = false
}) => {
  const { showError, showSuccess } = useToast();
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressNotes, setNewAddressNotes] = useState('');
  const [newGoogleMapsLink, setNewGoogleMapsLink] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (customer && customer.id) {
      loadAddresses();
    } else {
      setAddresses([]);
    }
  }, [customer]);

  const loadAddresses = async () => {
    if (!customer?.id) return;

    setLoading(true);
    try {
      // Check if offline - use cached customer data
      const offlineMode = !isOnline();
      const isOfflineId = typeof customer.id === 'string' && customer.id.startsWith('OFFLINE-');
      let addressData = [];

      if (offlineMode || isOfflineId) {
        // Offline mode - use customer data from cache or customer object
        if (customer.addresses && Array.isArray(customer.addresses) && customer.addresses.length > 0) {
          addressData = customer.addresses;
        } else if (customer.address) {
          // Use legacy address field
          addressData = [{
            id: 'legacy',
            address: customer.address,
            isDefault: true,
            customerId: customer.id
          }];
        } else {
          // Try to get from cached customers
          try {
            const { getCachedCustomers } = await import('../utils/offlineDB');
            const cachedCustomers = await getCachedCustomers();
            const cachedCustomer = cachedCustomers.find(c => c.id === customer.id);
            if (cachedCustomer) {
              if (cachedCustomer.addresses && Array.isArray(cachedCustomer.addresses) && cachedCustomer.addresses.length > 0) {
                addressData = cachedCustomer.addresses;
              } else if (cachedCustomer.address) {
                addressData = [{
                  id: 'legacy',
                  address: cachedCustomer.address,
                  isDefault: true,
                  customerId: customer.id
                }];
              }
            }
          } catch (cacheErr) {
            console.warn('Failed to load from cache:', cacheErr);
          }
        }
        setAddresses(addressData);
      } else {
        // Online mode - fetch from API
        try {
          const response = await customerAPI.getAddresses(customer.id);
          addressData = response.data?.data || response.data || [];
          setAddresses(Array.isArray(addressData) ? addressData : []);

          // If no addresses but customer has legacy address field, use that
          if (addressData.length === 0 && customer.address) {
            setAddresses([{
              id: 'legacy',
              address: customer.address,
              isDefault: true,
              customerId: customer.id
            }]);
          }
        } catch (apiErr) {
          // If API fails, fall back to cached or customer object data
          console.warn('API failed, using cached data:', apiErr);
          if (customer.addresses && Array.isArray(customer.addresses) && customer.addresses.length > 0) {
            addressData = customer.addresses;
          } else if (customer.address) {
            addressData = [{
              id: 'legacy',
              address: customer.address,
              isDefault: true,
              customerId: customer.id
            }];
          }
          setAddresses(addressData);
          // Don't show error if we have fallback data
          if (addressData.length === 0) {
            showError('Failed to load addresses');
          }
        }
      }
    } catch (err) {
      console.error('Failed to load addresses:', err);
      // Fallback to customer object data
      if (customer.addresses && Array.isArray(customer.addresses) && customer.addresses.length > 0) {
        setAddresses(customer.addresses);
      } else if (customer.address) {
        setAddresses([{
          id: 'legacy',
          address: customer.address,
          isDefault: true,
          customerId: customer.id
        }]);
      } else {
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
      if (!isOnline()) {
        // Offline: create local address and queue sync
        const newAddr = {
          id: `OFFLINE-ADDR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          address: newAddress.trim(),
          isDefault,
          notes: newAddressNotes.trim() || undefined,
          googleMapsLink: newGoogleMapsLink.trim() || undefined,
          customerId: customer.id,
          offline: true,
        };

        // Update local state
        setAddresses(prev => [...prev, newAddr]);
        setNewAddress('');
        setNewAddressNotes('');
        setNewGoogleMapsLink('');
        setIsDefault(false);
        setShowAddForm(false);

        // Persist in cached customer
        try {
          const { saveCustomer, addPendingOperation, getCachedCustomers } = await import('../utils/offlineDB');
          const cached = await getCachedCustomers();
          const current = cached.find(c => c.id === customer.id) || customer;
          const updatedCustomer = {
            ...current,
            addresses: [...(current.addresses || []), newAddr],
          };
          await saveCustomer(updatedCustomer);

          // Queue pending operation for sync
          await addPendingOperation({
            type: 'update_customer_address',
            endpoint: `/api/customers/${customer.id}/addresses`,
            method: 'POST',
            data: {
              address: newAddr.address,
              isDefault: newAddr.isDefault,
              notes: newAddr.notes,
              googleMapsLink: newAddr.googleMapsLink,
            },
            offlineId: customer.id,
          });
        } catch (offlineErr) {
          console.warn('Failed to cache offline address:', offlineErr);
        }

        showSuccess('Address saved offline. It will sync when back online.');
        if (onAddressSelect) {
          onAddressSelect(newAddr.address);
        }
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
      setAddresses(prev => [...prev, newAddr]);
      setNewAddress('');
      setNewAddressNotes('');
      setNewGoogleMapsLink('');
      setIsDefault(false);
      setShowAddForm(false);
      showSuccess('Address added successfully');

      // Auto-select the new address - pass full object to include googleMapsLink
      if (onAddressSelect) {
        onAddressSelect(newAddr); // Pass full address object, not just string
      }
    } catch (err) {
      console.error('Failed to add address:', err);
      const errorMsg = err.formattedMessage || err.response?.data?.error || err.response?.data?.message || 'Failed to add address';
      showError(errorMsg);
    } finally {
      setAdding(false);
    }
  };

  const handleSelectAddress = (addressString) => {
    if (onAddressSelect) {
      // Find the full address object to include googleMapsLink and notes
      const fullAddress = addresses.find(addr => addr.address === addressString);
      if (fullAddress) {
        // Pass the full address object
        onAddressSelect(fullAddress);
      } else {
        // Fallback to just the string if address not found
        onAddressSelect(addressString);
      }
    }
  };

  if (!customer || !customer.id) {
    return null;
  }

  return (
    <div style={{ width: '100%' }}>
      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#495057' }}>
        Delivery Address
      </label>

      {loading ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: '#6c757d' }}>
          Loading addresses...
        </div>
      ) : (
        <>
          <select
            value={selectedAddress || ''}
            onChange={(e) => handleSelectAddress(e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '2px solid #dee2e6',
              borderRadius: '8px',
              fontSize: '0.95rem',
              backgroundColor: disabled ? '#f8f9fa' : 'white',
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
          >
            <option value="">Select an address...</option>
            {addresses.map((addr) => (
              <option key={addr.id} value={addr.address}>
                {addr.address}
                {addr.isDefault ? ' (Default)' : ''}
              </option>
            ))}
          </select>

          {/* Show selected address details */}
          {selectedAddress && (() => {
            const selectedAddrObj = addresses.find(addr => addr.address === selectedAddress);
            if (selectedAddrObj) {
              return (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8f9fa', borderRadius: '8px', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: '500', marginBottom: '0.25rem', color: '#495057' }}>
                    Selected Address:
                  </div>
                  <div style={{ color: '#6c757d', marginBottom: '0.25rem' }}>
                    {selectedAddrObj.address}
                  </div>
                  {selectedAddrObj.notes && (
                    <div style={{ color: '#6c757d', marginTop: '0.25rem' }}>
                      <strong>Notes:</strong> {selectedAddrObj.notes}
                    </div>
                  )}
                  {selectedAddrObj.googleMapsLink && (
                    <div style={{ color: '#6c757d', marginTop: '0.25rem' }}>
                      <strong>Google Maps:</strong>{' '}
                      <a
                        href={selectedAddrObj.googleMapsLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#339af0', textDecoration: 'underline', wordBreak: 'break-all' }}
                      >
                        {selectedAddrObj.googleMapsLink}
                      </a>
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })()}

          {!disabled && (
            <div style={{ marginTop: '0.75rem' }}>
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '2px dashed #dee2e6',
                    borderRadius: '6px',
                    background: 'white',
                    color: '#495057',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    width: '100%'
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
                      id="isDefault"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      style={{ marginRight: '0.5rem' }}
                    />
                    <label htmlFor="isDefault" style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
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
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CustomerAddressSelector;

