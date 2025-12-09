import React, { useEffect, useState, useMemo } from 'react';
import { customerAPI } from '../services/customerAPI';

const MIN_QUERY_LENGTH = 2;

const CustomerSearchModal = ({
  isOpen,
  onClose,
  onSelect,
  onAddNew,
  recentCustomers = []
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(-1);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setError('');
      setHighlightIndex(-1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    const timeout = setTimeout(async () => {
      try {
        const response = await customerAPI.search(query.trim());
        if (!cancelled) {
          setResults(response.data || []);
          setHighlightIndex(response.data?.length ? 0 : -1);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to search customers. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, isOpen]);

  const visibleRecentCustomers = useMemo(() => {
    if (!recentCustomers || recentCustomers.length === 0) {
      return [];
    }
    return recentCustomers.slice(0, 5);
  }, [recentCustomers]);

  if (!isOpen) {
    return null;
  }

  const handleSelect = (customer) => {
    onSelect(customer);
    onClose();
  };

  const handleKeyDown = (event) => {
    if (!results.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter' && highlightIndex >= 0) {
      event.preventDefault();
      handleSelect(results[highlightIndex]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  };

  const getFirstAddress = (customer) => {
    // Check if customer has addresses array (new structure)
    if (customer.addresses && customer.addresses.length > 0) {
      return customer.addresses[0].address;
    }
    // Fallback to legacy address field
    return customer.address || '';
  };

  const renderCustomerCard = (customer, isRecent = false) => {
    const firstAddress = getFirstAddress(customer);
    return (
      <button
        onClick={() => handleSelect(customer)}
        className="customer-card"
        style={{
          width: '100%',
          textAlign: 'left',
          border: '2px solid transparent',
          borderRadius: '12px',
          padding: '0.75rem 1rem',
          background: isRecent ? '#fffaf0' : 'white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          cursor: 'pointer'
        }}
      >
        <div style={{ fontWeight: '700', fontSize: '1rem', marginBottom: '0.2rem' }}>
          {customer.name || 'Unnamed Customer'}
        </div>
        <div style={{ color: '#495057', fontSize: '0.9rem' }}>
          {customer.phone}
          {customer.backupPhone || customer.backup_phone ? ` • ${customer.backupPhone || customer.backup_phone}` : ''}
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: '#6c757d' }}>
          {firstAddress ? firstAddress.slice(0, 80) : 'No address on file'}
        </div>
      </button>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem'
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          maxHeight: '90vh',
          background: '#f8f9fb',
          borderRadius: '18px',
          boxShadow: '0 25px 65px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'white'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Select Customer</h3>
            <p style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>
              Search by name or phone. Press Enter to select, Esc to close.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: '#6c757d'
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', background: 'white' }}>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input
              autoFocus
              type="text"
              value={query}
              placeholder="Start typing name or phone..."
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1,
                padding: '0.85rem 1.1rem',
                border: '2px solid #e2e8f0',
                borderRadius: '12px',
                fontSize: '1rem'
              }}
            />
            <button
              onClick={onAddNew}
              style={{
                padding: '0.85rem 1.25rem',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                fontWeight: 'bold',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              + Add New
            </button>
          </div>
          <p style={{ marginTop: '0.5rem', color: '#6c757d', fontSize: '0.85rem' }}>
            Minimum {MIN_QUERY_LENGTH} characters required for search.
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', gap: '1rem', display: 'flex', flexDirection: 'column' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#6c757d' }}>Searching...</div>
          )}
          {error && (
            <div style={{
              padding: '0.75rem',
              borderRadius: '10px',
              background: '#fff5f5',
              border: '1px solid #feb2b2',
              color: '#c53030'
            }}>
              {error}
            </div>
          )}
          {!query && visibleRecentCustomers.length > 0 && (
            <div>
              <h4 style={{ marginBottom: '0.5rem' }}>Recent Customers</h4>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
              {visibleRecentCustomers.map((customer) => (
                <div key={`recent-${customer.id || customer.phone}`}>
                  {renderCustomerCard(customer, true)}
                </div>
              ))}
              </div>
            </div>
          )}
          {query.length >= MIN_QUERY_LENGTH && !loading && results.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6c757d', marginTop: '1rem' }}>
              No customers found. Try a different search or add new.
            </div>
          )}
          {results.length > 0 && (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {results.map((customer, index) => (
                <div
                  key={customer.id}
                  style={{
                    borderRadius: '12px',
                    border: highlightIndex === index ? '2px solid #764ba2' : '2px solid transparent',
                    transition: 'border 0.2s ease'
                  }}
                >
                  {renderCustomerCard(customer)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerSearchModal;

