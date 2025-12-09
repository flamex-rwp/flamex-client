// Multi-tab synchronization using BroadcastChannel API
// Ensures all tabs stay in sync when data changes

const CHANNEL_NAME = 'flamex-pos-sync';

class MultiTabSync {
  constructor() {
    this.channel = null;
    this.listeners = new Map();
    this.isSupported = typeof BroadcastChannel !== 'undefined';

    if (this.isSupported) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = this.handleMessage.bind(this);
    }
  }

  handleMessage(event) {
    const { type, payload, tabId } = event.data;

    // Ignore messages from this tab
    if (tabId === this.tabId) {
      return;
    }

    // Notify listeners
    const listeners = this.listeners.get(type) || [];
    listeners.forEach(listener => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[MultiTabSync] Error in listener for ${type}:`, error);
      }
    });
  }

  // Broadcast a message to all tabs
  broadcast(type, payload) {
    if (!this.isSupported || !this.channel) {
      return;
    }

    this.channel.postMessage({
      type,
      payload,
      tabId: this.tabId,
      timestamp: Date.now()
    });
  }

  // Subscribe to a message type
  subscribe(type, callback) {
    if (!this.isSupported) {
      return () => {}; // Return no-op unsubscribe
    }

    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }

    this.listeners.get(type).push(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(type);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  // Initialize tab ID
  init() {
    if (!this.tabId) {
      this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log('[MultiTabSync] Tab ID:', this.tabId);
    }
  }

  // Cleanup
  destroy() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
  }
}

// Create singleton instance
const multiTabSync = new MultiTabSync();
multiTabSync.init();

// Message types
export const MESSAGE_TYPES = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_SYNCED: 'ORDER_SYNCED',
  MENU_UPDATED: 'MENU_UPDATED',
  TABLES_UPDATED: 'TABLES_UPDATED',
  SYNC_STARTED: 'SYNC_STARTED',
  SYNC_COMPLETED: 'SYNC_COMPLETED',
  DATA_REFRESH: 'DATA_REFRESH'
};

// Convenience functions
export const broadcastOrderCreated = (order) => {
  multiTabSync.broadcast(MESSAGE_TYPES.ORDER_CREATED, order);
};

export const broadcastOrderUpdated = (order) => {
  multiTabSync.broadcast(MESSAGE_TYPES.ORDER_UPDATED, order);
};

export const broadcastOrderSynced = (order) => {
  multiTabSync.broadcast(MESSAGE_TYPES.ORDER_SYNCED, order);
};

export const broadcastMenuUpdated = () => {
  multiTabSync.broadcast(MESSAGE_TYPES.MENU_UPDATED, {});
};

export const broadcastTablesUpdated = (tables) => {
  multiTabSync.broadcast(MESSAGE_TYPES.TABLES_UPDATED, tables);
};

export const broadcastSyncStarted = () => {
  multiTabSync.broadcast(MESSAGE_TYPES.SYNC_STARTED, {});
};

export const broadcastSyncCompleted = (result) => {
  multiTabSync.broadcast(MESSAGE_TYPES.SYNC_COMPLETED, result);
};

export const broadcastDataRefresh = (dataType) => {
  multiTabSync.broadcast(MESSAGE_TYPES.DATA_REFRESH, { type: dataType });
};

// Subscribe helpers
export const subscribeToOrderUpdates = (callback) => {
  return multiTabSync.subscribe(MESSAGE_TYPES.ORDER_UPDATED, callback);
};

export const subscribeToOrderCreated = (callback) => {
  return multiTabSync.subscribe(MESSAGE_TYPES.ORDER_CREATED, callback);
};

export const subscribeToSyncCompleted = (callback) => {
  return multiTabSync.subscribe(MESSAGE_TYPES.SYNC_COMPLETED, callback);
};

export const subscribeToDataRefresh = (callback) => {
  return multiTabSync.subscribe(MESSAGE_TYPES.DATA_REFRESH, callback);
};

export default multiTabSync;


