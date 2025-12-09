import React from 'react';
import './EmptyState.css';

/**
 * Empty State Component
 * Displays helpful messages when there's no data
 */
const EmptyState = ({ 
  icon = '📭', 
  title = 'No Data Available', 
  message = 'There is no data to display at this time.',
  actionLabel = null,
  onAction = null 
}) => {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div className="empty-state-icon">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-message">{message}</p>
      {actionLabel && onAction && (
        <button 
          className="empty-state-action"
          onClick={onAction}
          aria-label={actionLabel}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;

