/**
 * Service to bridge API errors with React components
 * This allows the axios interceptor to trigger the server connection modal
 */

let errorCallback = null;

export const serverErrorService = {
  /**
   * Register a callback function to be called when server errors occur
   * @param {Function} callback - Function that receives error object
   */
  setErrorHandler: (callback) => {
    errorCallback = callback;
  },

  /**
   * Unregister the error handler
   */
  clearErrorHandler: () => {
    errorCallback = null;
  },

  /**
   * Trigger the error handler with an error
   * @param {Error} error - The error object
   */
  triggerError: (error) => {
    if (errorCallback && typeof errorCallback === 'function') {
      errorCallback(error);
    }
  }
};
