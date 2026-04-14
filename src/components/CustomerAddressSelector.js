import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useOffline } from '../contexts/OfflineContext';
import { isOnline } from '../utils/offlineSync';
import { useCustomerAddressesQuery, useCreateCustomerAddressMutation } from '../hooks';

const CustomerAddressSelector = ({
  customer,
  selectedAddress,
  onAddressSelect,
  onNewAddress,
  disabled = false
}) => {
  const { showError, showSuccess } = useToast();
  const { online } = useOffline();
  const createAddressMutation = useCreateCustomerAddressMutation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressNotes, setNewAddressNotes] = useState('');
  const [newGoogleMapsLink, setNewGoogleMapsLink] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [adding, setAdding] = useState(false);
  const [offlineAddresses, setOfflineAddresses] = useState([]);

  const isOfflineId = typeof customer?.id === 'string' && customer.id.startsWith('OFFLINE-');
  const shouldFetch = Boolean(customer?.id && online && !isOfflineId);

  const placeholderAddresses = useMemo(() => {
    if (!customer?.id) return undefined;
    if (customer.addresses?.length) return [...customer.addresses];
    if (customer.address) {
      return [{
        id: 'legacy',
        address: customer.address,
        isDefault: true,
        customerId: customer.id
      }];
    }
    return undefined;
  }, [customer]);

  const addressesQuery = useCustomerAddressesQuery(customer?.id, {
    enabled: shouldFetch,
    placeholderData: placeholderAddresses,
  });

  useEffect(() => {
    if (!customer?.id || shouldFetch) {
      if (!customer?.id) setOfflineAddresses([]);
      return undefined;
    }

    let cancelled = false;

    const buildFromCustomer = () => {
      if (customer.addresses && Array.isArray(customer.addresses) && customer.addresses.length > 0) {
        return [...customer.addresses];
      }
      if (customer.address) {
        return [{
          id: 'legacy',
          address: customer.address,
          isDefault: true,
          customerId: customer.id
        }];
      }
      return null;
    };

    const direct = buildFromCustomer();
    if (direct) {
      setOfflineAddresses(direct);
      return undefined;
    }

    import('../utils/offlineDB')
      .then(({ getCachedCustomers }) => getCachedCustomers())
      .then((cachedCustomers) => {
        if (cancelled) return;
        const cachedCustomer = cachedCustomers.find((c) => c.id === customer.id);
        let addressData = [];
        if (cachedCustomer?.addresses?.length) {
          addressData = [...cachedCustomer.addresses];
        } else if (cachedCustomer?.address) {
          addressData = [{
            id: 'legacy',
            address: cachedCustomer.address,
            isDefault: true,
            customerId: customer.id
          }];
        }
        setOfflineAddresses(addressData);
      })
      .catch((cacheErr) => {
        console.warn('Failed to load from cache:', cacheErr);
        if (!cancelled) setOfflineAddresses([]);
      });

    return () => {
      cancelled = true;
    };
  }, [customer, shouldFetch]);

  const addressesOnline = useMemo(() => {
    if (!shouldFetch || !customer) return [];
    const raw = addressesQuery.data;
    let list = Array.isArray(raw) ? [...raw] : [];
    if (list.length === 0 && customer.address) {
      list = [{
        id: 'legacy',
        address: customer.address,
        isDefault: true,
        customerId: customer.id
      }];
    }
    return list;
  }, [shouldFetch, customer, addressesQuery.data]);

  const addresses = shouldFetch ? addressesOnline : offlineAddresses;

  const loading = shouldFetch && addressesQuery.isPending && placeholderAddresses == null;

  const handleAddAddress = async () => {
    if (!newAddress.trim()) {
      showError('Address is required');
      return;
    }

    const normalizedNew = newAddress.trim().toLowerCase();
    const duplicate = addresses.find(
      (addr) => addr.address.trim().toLowerCase() === normalizedNew
    );

    if (duplicate) {
      showError('This address already exists for this customer');
      return;
    }

    setAdding(true);
    try {
      if (!isOnline()) {
        const newAddr = {
          id: `OFFLINE-ADDR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          address: newAddress.trim(),
          isDefault,
          notes: newAddressNotes.trim() || undefined,
          googleMapsLink: newGoogleMapsLink.trim() || undefined,
          customerId: customer.id,
          offline: true,
        };

        setOfflineAddresses((prev) => [...prev, newAddr]);
        setNewAddress('');
        setNewAddressNotes('');
        setNewGoogleMapsLink('');
        setIsDefault(false);
        setShowAddForm(false);

        try {
          const { saveCustomer, addPendingOperation, getCachedCustomers } = await import('../utils/offlineDB');
          const cached = await getCachedCustomers();
          const current = cached.find((c) => c.id === customer.id) || customer;
          const updatedCustomer = {
            ...current,
            addresses: [...(current.addresses || []), newAddr],
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

      const newAddr = await createAddressMutation.mutateAsync({
        customerId: customer.id,
        data: {
          address: newAddress.trim(),
          isDefault: isDefault,
          notes: newAddressNotes.trim() || undefined,
          googleMapsLink: newGoogleMapsLink.trim() || undefined
        }
      });

      setNewAddress('');
      setNewAddressNotes('');
      setNewGoogleMapsLink('');
      setIsDefault(false);
      setShowAddForm(false);
      showSuccess('Address added successfully');

      if (onAddressSelect) {
        onAddressSelect(newAddr);
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
      const fullAddress = addresses.find((addr) => addr.address === addressString);
      if (fullAddress) {
        onAddressSelect(fullAddress);
      } else {
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

      {shouldFetch && addressesQuery.isError && addresses.length === 0 ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: '#dc3545' }}>
          Failed to load addresses
        </div>
      ) : loading ? (
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

          {selectedAddress && (() => {
            const selectedAddrObj = addresses.find((addr) => addr.address === selectedAddress);
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
