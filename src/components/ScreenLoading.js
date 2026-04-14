import React from 'react';
import { Spinner } from './LoadingSkeleton';

const containerStyle = {
  textAlign: 'center',
  padding: '3rem',
  color: '#6c757d',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '1rem',
};

export default function ScreenLoading({ label = 'Loading...' }) {
  return (
    <div style={containerStyle}>
      <Spinner size="lg" />
      <div>{label}</div>
    </div>
  );
}

