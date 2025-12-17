import React from 'react';
import { FaExclamationTriangle, FaPlug, FaSync } from 'react-icons/fa';

const ServerConnectionModal = ({
  isOpen,
  error,
  onClose,
  onRetry,
  checking = false,
  apiBaseUrl,
}) => {
  if (!isOpen) return null;

  const message =
    error?.formattedMessage ||
    error?.message ||
    `Cannot connect to the server. Please ensure it is running at ${apiBaseUrl || 'http://localhost:3000'}.`;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.iconContainer}>
            <FaPlug />
          </div>
          <div>
            <h2 style={styles.title}>Server Connection Issue</h2>
            <p style={styles.subtitle}>We couldn&apos;t reach the backend service.</p>
          </div>
        </div>

        <div style={styles.body}>
          <div style={styles.alert}>
            <FaExclamationTriangle style={{ color: '#c53030', marginRight: '0.5rem' }} />
            <span>{message}</span>
          </div>
          <div style={styles.details}>
            <div>
              <strong>Base URL:</strong> {apiBaseUrl || 'http://localhost:3000'}
            </div>
            {error?.status && (
              <div>
                <strong>Status:</strong> {error.status} {error.statusText || ''}
              </div>
            )}
            {error?.url && (
              <div>
                <strong>Endpoint:</strong> {error.url}
              </div>
            )}
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.secondaryBtn} onClick={onClose}>
            Dismiss
          </button>
          <button
            style={{ ...styles.primaryBtn, ...(checking ? styles.disabledBtn : {}) }}
            onClick={onRetry}
            disabled={checking}
          >
            <FaSync style={{ marginRight: '0.5rem' }} />
            {checking ? 'Checking...' : 'Retry connection'}
          </button>
        </div>
        <p style={styles.hint}>
          Tip: Start your backend server (e.g., `npm run dev` on port 3000/5001) or update
          REACT_APP_API_BASE_URL if it runs elsewhere.
        </p>
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '1rem',
  },
  modal: {
    background: '#fff',
    borderRadius: '12px',
    maxWidth: '520px',
    width: '100%',
    boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
    padding: '1.5rem',
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '1rem',
  },
  iconContainer: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    background: '#edf2f7',
    display: 'grid',
    placeItems: 'center',
    fontSize: '1.25rem',
    color: '#2b6cb0',
  },
  title: {
    margin: 0,
    fontSize: '1.3rem',
    color: '#1a202c',
  },
  subtitle: {
    margin: '0.15rem 0 0 0',
    color: '#4a5568',
    fontSize: '0.95rem',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    marginBottom: '1.25rem',
  },
  alert: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem',
    background: '#fff5f5',
    border: '1px solid #fed7d7',
    borderRadius: '8px',
    color: '#c53030',
    fontWeight: 500,
  },
  details: {
    background: '#f7fafc',
    borderRadius: '8px',
    padding: '0.75rem',
    display: 'grid',
    gap: '0.35rem',
    color: '#2d3748',
    fontSize: '0.95rem',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    alignItems: 'center',
  },
  primaryBtn: {
    background: '#2b6cb0',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '0.65rem 1rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'background 0.2s ease',
  },
  secondaryBtn: {
    background: '#edf2f7',
    color: '#2d3748',
    border: 'none',
    borderRadius: '8px',
    padding: '0.65rem 1rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  disabledBtn: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  hint: {
    marginTop: '0.75rem',
    color: '#718096',
    fontSize: '0.85rem',
  },
};

export default ServerConnectionModal;


