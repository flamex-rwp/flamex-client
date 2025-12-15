// React context for offline-first PWA functionality
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { startAutoSync, stopAutoSync, getSyncStatus, forceSyncNow } from '../services/offlineSyncService';
import { isOnline } from '../services/offlineSyncService';
import { clearApiCache } from '../services/cacheService';
import {
  subscribeToOrderUpdates,
  subscribeToSyncCompleted,
  subscribeToDataRefresh,
  broadcastSyncCompleted
} from '../utils/multiTabSync';

const OfflineContext = createContext(null);

export const useOffline = () => {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within OfflineProvider');
  }
  return context;
};

export const OfflineProvider = ({ children }) => {
  const [online, setOnline] = useState(isOnline());
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [pendingOperations, setPendingOperations] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncError, setSyncError] = useState(null);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      console.log('[OfflineContext] Device came online');
      // Clear browser Cache Storage when coming online to avoid stale assets/data (auth storage untouched)
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .then(() => console.log('[OfflineContext] Cleared browser Cache Storage on online'))
          .catch((err) => console.warn('[OfflineContext] Failed to clear browser Cache Storage:', err));
      }
    };

    const handleOffline = () => {
      setOnline(false);
      console.log('[OfflineContext] Device went offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Background cache clearing every 30s while online (skip sessions/tokens)
  useEffect(() => {
    if (!online) return undefined;
    const interval = setInterval(() => {
      clearApiCache().catch((err) => console.warn('[OfflineContext] Failed to clear API cache:', err));
      // Also clear browser Cache Storage periodically while online (auth not affected)
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .catch((err) => console.warn('[OfflineContext] Failed to clear browser Cache Storage (interval):', err));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [online]);

  // Handle sync completion callback
  const handleSyncComplete = useCallback(async (result) => {
    setSyncInProgress(false);
    
    if (result && result.success) {
      setLastSyncTime(new Date().toISOString());
      setSyncError(null);
      
      // Update pending operations count
      const status = await getSyncStatus();
      setPendingOperations(status.pendingOperations || 0);

      // Broadcast to other tabs
      broadcastSyncCompleted(result);
    } else if (result && result.error) {
      setSyncError(result.error);
    }
  }, []);

  // Start auto-sync on mount
  useEffect(() => {
    const cleanup = startAutoSync(async (result) => {
      setSyncInProgress(true);
      await handleSyncComplete(result);
    });

    // Initial sync status check
    getSyncStatus().then(status => {
      setPendingOperations(status.pendingOperations || 0);
      setLastSyncTime(status.lastSyncTime);
    });

    return cleanup;
  }, [handleSyncComplete]);

  // Listen for sync updates from other tabs
  useEffect(() => {
    const unsubscribeSync = subscribeToSyncCompleted((result) => {
      console.log('[OfflineContext] Sync completed in another tab:', result);
      getSyncStatus().then(status => {
        setPendingOperations(status.pendingOperations || 0);
        setLastSyncTime(status.lastSyncTime);
      });
    });

    const unsubscribeRefresh = subscribeToDataRefresh(({ type }) => {
      console.log('[OfflineContext] Data refresh requested:', type);
      // Components can listen to this and refresh their data
    });

    return () => {
      unsubscribeSync();
      unsubscribeRefresh();
    };
  }, []);

  // Manual sync function
  const syncNow = useCallback(async () => {
    if (!online) {
      throw new Error('Cannot sync: Device is offline');
    }

    setSyncInProgress(true);
    setSyncError(null);

    try {
      const result = await forceSyncNow();
      await handleSyncComplete(result);
      return result;
    } catch (error) {
      setSyncError(error.message);
      setSyncInProgress(false);
      throw error;
    }
  }, [online, handleSyncComplete]);

  // Refresh sync status
  const refreshStatus = useCallback(async () => {
    const status = await getSyncStatus();
    setPendingOperations(status.pendingOperations || 0);
    setLastSyncTime(status.lastSyncTime);
    setSyncInProgress(status.syncInProgress || false);
  }, []);

  const value = {
    online,
    syncInProgress,
    pendingOperations,
    lastSyncTime,
    syncError,
    syncNow,
    refreshStatus
  };

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
};


