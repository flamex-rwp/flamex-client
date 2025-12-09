import React, { useState, useEffect } from 'react';
import { customerAPI } from '../services/customerAPI';
import { useToast } from '../contexts/ToastContext';

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
      const response = await customerAPI.getAddresses(customer.id);
      const addressData = response.data?.data || response.data || [];
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
    } catch (err) {
      console.error('Failed to load addresses:', err);
      showError('Failed to load addresses');
      // Fallback to legacy address if available
      if (customer.address) {
        setAddresses([{
          id: 'legacy',
          address: customer.address,
          isDefault: true,
          customerId: customer.id
        }]);
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
      const response = await customerAPI.createAddress(customer.id, {
        address: newAddress.trim(),
        isDefault: isDefault,
        notes: newAddressNotes.trim() || undefined
      });

      const newAddr = response.data?.data || response.data;
      setAddresses(prev => [...prev, newAddr]);
      setNewAddress('');
      setNewAddressNotes('');
      setIsDefault(false);
      setShowAddForm(false);
      showSuccess('Address added successfully');

      // Auto-select the new address
      if (onAddressSelect) {
        onAddressSelect(newAddr.address);
      }
    } catch (err) {
      console.error('Failed to add address:', err);
      const errorMsg = err.response?.data?.error || err.response?.data?.message || 'Failed to add address';
      showError(errorMsg);
    } finally {
      setAdding(false);
    }
  };

  const handleSelectAddress = (address) => {
    if (onAddressSelect) {
      onAddressSelect(address);
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

