/**
 * Keyboard Shortcuts Utility
 * Provides global keyboard shortcuts for the application
 */

const shortcuts = {
  // Global shortcuts
  'ctrl+k': { action: 'globalSearch', description: 'Open global search' },
  'ctrl+n': { action: 'newOrder', description: 'Create new order' },
  'escape': { action: 'closeModal', description: 'Close modal/dialog' },
  'f11': { action: 'toggleFullscreen', description: 'Toggle fullscreen' },
  
  // Navigation shortcuts
  'ctrl+1': { action: 'navigateOrders', description: 'Go to Orders' },
  'ctrl+2': { action: 'navigateDeliveryOrders', description: 'Go to Delivery Orders' },
  'ctrl+3': { action: 'navigateReports', description: 'Go to Reports' },
  
  // Order shortcuts
  'ctrl+s': { action: 'saveOrder', description: 'Save order' },
  'ctrl+p': { action: 'printReceipt', description: 'Print receipt' },
};

let handlers = {};
let isEnabled = true;

export const keyboardShortcuts = {
  /**
   * Register a keyboard shortcut handler
   */
  register: (key, handler) => {
    const normalizedKey = normalizeKey(key);
    handlers[normalizedKey] = handler;
  },

  /**
   * Unregister a keyboard shortcut handler
   */
  unregister: (key) => {
    const normalizedKey = normalizeKey(key);
    delete handlers[normalizedKey];
  },

  /**
   * Enable/disable keyboard shortcuts
   */
  setEnabled: (enabled) => {
    isEnabled = enabled;
  },

  /**
   * Get all registered shortcuts
   */
  getShortcuts: () => {
    return Object.keys(shortcuts).map(key => ({
      key,
      ...shortcuts[key]
    }));
  }
};

/**
 * Normalize key combination string
 */
function normalizeKey(key) {
  return key.toLowerCase().replace(/\s+/g, '');
}

/**
 * Initialize keyboard shortcuts listener
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!isEnabled) return;
    
    // Don't trigger shortcuts when typing in inputs
    if (
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable
    ) {
      // Allow Escape to close modals even when in inputs
      if (e.key === 'Escape') {
        const handler = handlers['escape'];
        if (handler) {
          e.preventDefault();
          handler();
        }
      }
      return;
    }

    const key = buildKeyString(e);
    const handler = handlers[key];
    
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
}

/**
 * Build key string from event
 */
function buildKeyString(e) {
  const parts = [];
  
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  
  const key = e.key.toLowerCase();
  if (key !== 'control' && key !== 'alt' && key !== 'shift' && key !== 'meta') {
    parts.push(key);
  }
  
  return parts.join('+');
}

/**
 * React hook for keyboard shortcuts
 * Note: Import React in your component when using this hook
 */
export function useKeyboardShortcut(key, handler, deps = []) {
  // This will be used in components that import React
  // Example: const { useEffect } = require('react');
  return { key, handler, deps };
}

// Initialize on module load
if (typeof window !== 'undefined') {
  initKeyboardShortcuts();
}

