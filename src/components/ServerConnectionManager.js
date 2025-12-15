import React, { useEffect } from 'react';
import { useServerConnection } from '../contexts/ServerConnectionContext';
import { serverErrorService } from '../services/serverErrorService';
import ServerConnectionModal from './ServerConnectionModal';

/**
 * Component that manages the server connection modal
 * This component listens to API errors and displays the modal
 */
const ServerConnectionManager = () => {
  const {
    isModalOpen,
    currentError,
    showError,
    hideError,
    retryConnection,
    checkingConnection,
    apiBaseUrl,
  } = useServerConnection();

  useEffect(() => {
    // Register error handler when component mounts
    serverErrorService.setErrorHandler(showError);

    // Cleanup on unmount
    return () => {
      serverErrorService.clearErrorHandler();
    };
  }, [showError]);

  return (
    <ServerConnectionModal
      isOpen={isModalOpen}
      error={currentError}
      onClose={hideError}
      onRetry={retryConnection}
      checking={checkingConnection}
      apiBaseUrl={apiBaseUrl}
    />
  );
};

export default ServerConnectionManager;


