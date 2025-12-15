import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { API_BASE_URL } from '../services/api';

const ServerConnectionContext = createContext(null);

const buildErrorDetails = (error) => {
  if (!error) return null;

  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const baseURL = error.config?.baseURL || API_BASE_URL;
  const url = error.config?.url || '';
  const message =
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    'Cannot connect to server';

  return {
    status,
    statusText,
    baseURL,
    url,
    message,
    isNetworkError: !error.response,
  };
};

export const useServerConnection = () => {
  const ctx = useContext(ServerConnectionContext);
  if (!ctx) {
    throw new Error('useServerConnection must be used within ServerConnectionProvider');
  }
  return ctx;
};

export const ServerConnectionProvider = ({ children }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorDetails, setErrorDetails] = useState(null);
  const [checkingConnection, setCheckingConnection] = useState(false);

  const showError = useCallback((error) => {
    setErrorDetails(buildErrorDetails(error));
    setIsModalOpen(true);
  }, []);

  const hideError = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const retryConnection = useCallback(async () => {
    setCheckingConnection(true);
    try {
      const response = await fetch(`${API_BASE_URL}/health`, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }
      setIsModalOpen(false);
      setErrorDetails(null);
      return true;
    } catch (err) {
      setErrorDetails(buildErrorDetails(err));
      setIsModalOpen(true);
      return false;
    } finally {
      setCheckingConnection(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      isModalOpen,
      currentError: errorDetails,
      showError,
      hideError,
      retryConnection,
      checkingConnection,
      apiBaseUrl: API_BASE_URL,
    }),
    [isModalOpen, errorDetails, showError, hideError, retryConnection, checkingConnection]
  );

  return (
    <ServerConnectionContext.Provider value={value}>
      {children}
    </ServerConnectionContext.Provider>
  );
};


