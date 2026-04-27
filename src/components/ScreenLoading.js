import React from 'react';
import { Spinner } from './LoadingSkeleton';

const outerStyle = {
  padding: '2rem',
  display: 'flex',
  justifyContent: 'center',
};

const boxStyle = {
  padding: '0.9rem 1.25rem',
  borderRadius: '12px',
  background: 'transparent',
  color: 'black',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.75rem',
};

export default function ScreenLoading({ label = 'Loading...' }) {
  return (
    <div style={outerStyle}>
      <div style={boxStyle} aria-busy="true">
        <Spinner size="sm" />
        <div>{label}</div>
      </div>
    </div>
  );
}

