import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { authAPI } from './services/api';
import './App.css';
import Login from './components/Login';
import AdminPortal from './components/AdminPortal';
import ManagerPortal from './components/ManagerPortal';
import StaffPortal from './components/StaffPortal';
import { ToastProvider } from './contexts/ToastContext';
import { OfflineProvider } from './contexts/OfflineContext';
import { ServerConnectionProvider } from './contexts/ServerConnectionContext';
import { Spinner } from './components/LoadingSkeleton';
import ServerConnectionManager from './components/ServerConnectionManager';
import QuerySyncBridge from './components/QuerySyncBridge';
import { queryClient } from './queryClient';
import './utils/debugOffline'; // Enable debug functions

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
    const timeout = setTimeout(() => {
      console.warn('Session check timeout - showing login');
      setLoading(false);
    }, 10000);
    return () => clearTimeout(timeout);
  }, []);

  const checkSession = async () => {
    try {
      const token = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');

      if (!token) {
        localStorage.removeItem('user');
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const response = await authAPI.getCurrentUser();

        if (response.data.success && response.data.data) {
          const userData = response.data.data;
          setUser(userData);
          localStorage.setItem('user', JSON.stringify(userData));
        } else if (response.data.authenticated && response.data.user) {
          const userData = response.data.user;
          setUser(userData);
          localStorage.setItem('user', JSON.stringify(userData));
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
        }
      } catch (apiError) {
        if (apiError.response?.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
        } else {
          console.warn('Session check error (non-401):', apiError.message);
          if (storedUser) {
            try {
              const parsedUser = JSON.parse(storedUser);
              setUser(parsedUser);
            } catch (e) {
              console.error('Error parsing stored user:', e);
              localStorage.removeItem('user');
              setUser(null);
            }
          } else {
            setUser(null);
          }
        }
      }
    } catch (err) {
      console.error('Session check failed:', err);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '20px',
        color: 'var(--color-primary)'
      }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <ToastProvider>
        <ServerConnectionProvider>
          <ServerConnectionManager />
          <Login onLoginSuccess={handleLoginSuccess} />
        </ServerConnectionProvider>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ServerConnectionProvider>
        <OfflineProvider>
          <QueryClientProvider client={queryClient}>
            <QuerySyncBridge />
            <ServerConnectionManager />
            {process.env.NODE_ENV === 'development' ? (
              <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
            ) : null}
            <Router>
              <Routes>
                {user.role === 'admin' ? (
                  <>
                    <Route path="/admin/*" element={<AdminPortal user={user} onLogout={handleLogout} />} />
                    <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
                    <Route path="/*" element={<Navigate to="/admin/dashboard" replace />} />
                  </>
                ) : user.role === 'manager' ? (
                  <>
                    <Route path="/manager/*" element={<ManagerPortal user={user} onLogout={handleLogout} />} />
                    <Route path="/" element={<Navigate to="/manager/orders" replace />} />
                    <Route path="/*" element={<Navigate to="/manager/orders" replace />} />
                  </>
                ) : (
                  <>
                    <Route path="/staff/*" element={<StaffPortal user={user} onLogout={handleLogout} />} />
                    <Route path="/" element={<Navigate to="/staff/orders" replace />} />
                    <Route path="/*" element={<Navigate to="/staff/orders" replace />} />
                  </>
                )}
              </Routes>
            </Router>
          </QueryClientProvider>
        </OfflineProvider>
      </ServerConnectionProvider>
    </ToastProvider>
  );
}

export default App;
