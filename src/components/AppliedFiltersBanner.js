import React from 'react';
import { FaTimes } from 'react-icons/fa';

/**
 * Shows active filters as removable chips. Use when any non-default filter is applied.
 *
 * @param {{ id: string, label: string, onRemove: () => void }[]} items
 * @param {() => void} [onClearAll] — shown when more than one chip is present
 * @param {string} [clearAllLabel]
 */
const AppliedFiltersBanner = ({ items = [], onClearAll, clearAllLabel = 'Clear all filters' }) => {
  if (!items.length) return null;

  const showClearAll = typeof onClearAll === 'function' && items.length > 1;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.6rem',
        marginTop: '1.25rem',
        marginBottom: '1.25rem',
        padding: '0.9rem 1.15rem',
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '10px',
        fontSize: '0.875rem',
        color: '#1e3a5f'
      }}
    >
      <span style={{ fontWeight: 700, flexShrink: 0 }}>Applied filters</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center', flex: 1, minWidth: 0 }}>
        {items.map((item) => (
          <span
            key={item.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.25rem 0.5rem 0.25rem 0.65rem',
              background: 'white',
              border: '1px solid #93c5fd',
              borderRadius: '999px',
              fontWeight: 600,
              maxWidth: '100%'
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
            <button
              type="button"
              onClick={item.onRemove}
              aria-label={`Remove filter: ${item.label}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.15rem',
                border: 'none',
                borderRadius: '6px',
                background: 'transparent',
                color: '#1d4ed8',
                cursor: 'pointer',
                lineHeight: 1
              }}
            >
              <FaTimes style={{ fontSize: '0.75rem' }} aria-hidden />
            </button>
          </span>
        ))}
      </div>
      {showClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          style={{
            flexShrink: 0,
            padding: '0.35rem 0.75rem',
            border: '1px solid #dc2626',
            borderRadius: '8px',
            background: 'white',
            color: '#dc2626',
            fontWeight: 600,
            fontSize: '0.8rem',
            cursor: 'pointer'
          }}
        >
          {clearAllLabel}
        </button>
      )}
    </div>
  );
};

export default AppliedFiltersBanner;
