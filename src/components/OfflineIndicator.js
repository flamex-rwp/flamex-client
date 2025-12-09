import React, { useState, useEffect } from 'react';
import { startAutoSync, getPendingOrdersCount, forceSyncNow } from '../utils/offlineSync';
import { useToast } from '../contexts/ToastContext';
import './OfflineIndicator.css';

const OfflineIndicator = () => {
  const { showError } = useToast();
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  // Update online status
  useEffect(() => {
    const updateOnlineStatus = () => {
      setOnline(navigator.onLine);
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  // Update pending orders count
  useEffect(() => {
    const updatePendingCount = async () => {
      const count = await getPendingOrdersCount();
      setPendingCount(count);
    };

    updatePendingCount();
    const interval = setInterval(updatePendingCount, 5001); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Start auto-sync
  useEffect(() => {
    const cleanup = startAutoSync((result) => {
      setLastSyncResult(result);
      setSyncing(false);
      // Update pending count after sync
      getPendingOrdersCount().then(setPendingCount);
    });

    return cleanup;
  }, []);

  // Handle manual sync
  const handleManualSync = async () => {
    if (!online) {
      showError('Cannot sync: Device is offline');
      return;
    }

    if (syncing) return;

    setSyncing(true);
    try {
      const result = await forceSyncNow();
      setLastSyncResult(result);
      setPendingCount(await getPendingOrdersCount());
    } catch (error) {
      showError('Sync failed: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  // Don't show if online and no pending orders
  if (online && pendingCount === 0) {
    return null;
  }

  return (
    <div className={`offline-indicator ${online ? 'online-pending' : 'offline'}`}>
      <div className="indicator-main" onClick={() => setShowDetails(!showDetails)}>
        <div className="indicator-icon">
          {online ? (
            syncing ? (
              <div className="spinner"></div>
            ) : (
              <span className="icon">&#x21bb;</span>
            )
          ) : (
            <span className="icon">&#x26a0;</span>
          )}
        </div>
        <div className="indicator-text">
          {online ? (
            <span>
              {syncing ? 'Syncing...' : `${pendingCount} pending order${pendingCount !== 1 ? 's' : ''}`}
            </span>
          ) : (
            <span>Offline Mode - {pendingCount} order{pendingCount !== 1 ? 's' : ''} pending</span>
          )}
        </div>
      </div>

      {showDetails && (
        <div className="indicator-details">
          <div className="details-content">
            <p>
              <strong>Status:</strong> {online ? 'Online' : 'Offline'}
            </p>
            <p>
              <strong>Pending Orders:</strong> {pendingCount}
            </p>

            {lastSyncResult && (
              <div className="sync-result">
                <p>
                  <strong>Last Sync:</strong>
                </p>
                <p className={lastSyncResult.success ? 'success' : 'error'}>
                  {lastSyncResult.message}
                </p>
                {lastSyncResult.synced > 0 && (
                  <p className="success">Synced: {lastSyncResult.synced}</p>
                )}
                {lastSyncResult.failed > 0 && (
                  <p className="error">Failed: {lastSyncResult.failed}</p>
                )}
              </div>
            )}

            {online && pendingCount > 0 && (
              <button
                className="sync-button"
                onClick={handleManualSync}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            )}

            {!online && (
              <p className="offline-message">
                Orders will be automatically synced when connection is restored.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OfflineIndicator;
