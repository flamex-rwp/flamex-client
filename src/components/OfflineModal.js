import React from 'react';
import { FaWifi, FaExclamationTriangle } from 'react-icons/fa';

const OfflineModal = ({ title = "You're Offline" }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '60vh',
      padding: '2rem',
      textAlign: 'center',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      borderRadius: '12px',
      margin: '2rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <div style={{
        background: 'white',
        padding: '3rem',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        maxWidth: '500px',
        width: '100%'
      }}>
        <div style={{
          fontSize: '4rem',
          color: '#ff6b6b',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <FaWifi style={{ transform: 'rotate(45deg)' }} />
        </div>
        
        <h2 style={{
          fontSize: '2rem',
          fontWeight: 'bold',
          color: '#2d3748',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem'
        }}>
          <FaExclamationTriangle style={{ color: '#ff6b6b' }} />
          {title}
        </h2>
        
        <p style={{
          fontSize: '1.1rem',
          color: '#4a5568',
          lineHeight: '1.6',
          marginBottom: '2rem'
        }}>
          This section requires an internet connection to function properly.
          Please check your network connection and try again.
        </p>
        
        <div style={{
          background: '#fff5f5',
          border: '2px solid #fed7d7',
          borderRadius: '8px',
          padding: '1.5rem',
          marginTop: '2rem'
        }}>
          <p style={{
            fontSize: '0.95rem',
            color: '#c53030',
            margin: 0,
            fontWeight: '500'
          }}>
            💡 Tip: You can still use the Orders, Dine-In, and Delivery sections while offline.
          </p>
        </div>
      </div>
    </div>
  );
};

export default OfflineModal;

