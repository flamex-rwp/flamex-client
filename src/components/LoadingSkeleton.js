import React from 'react';
import './LoadingSkeleton.css';

/**
 * Loading Skeleton Component for tables/lists
 */
export const TableSkeleton = ({ rows = 5, columns = 4 }) => {
  return (
    <div className="skeleton-table">
      <div className="skeleton-header">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="skeleton-cell skeleton-header-cell" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="skeleton-row">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div key={colIndex} className="skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Loading Skeleton for cards
 */
export const CardSkeleton = ({ count = 3 }) => {
  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-text" />
          <div className="skeleton-line skeleton-text short" />
        </div>
      ))}
    </div>
  );
};

/**
 * Loading Skeleton for stat cards
 */
export const StatCardSkeleton = ({ count = 4 }) => {
  return (
    <div className="skeleton-stats">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-stat-card">
          <div className="skeleton-line skeleton-label" />
          <div className="skeleton-line skeleton-value" />
        </div>
      ))}
    </div>
  );
};

/**
 * Generic loading spinner
 */
export const Spinner = ({ size = 'md', className = '' }) => {
  return (
    <div className={`spinner spinner-${size} ${className}`} role="status" aria-label="Loading">
      <div className="spinner-circle" />
    </div>
  );
};

export default TableSkeleton;

