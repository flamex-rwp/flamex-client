import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { authAPI } from './services/api';
import './App.css';
import Login from './components/Login';
import AdminPortal from './components/AdminPortal';
import ManagerPortal from './components/ManagerPortal';
import { ToastProvider } from './contexts/ToastContext';
import { OfflineProvider } from './contexts/OfflineContext';
import { Spinner } from './components/LoadingSkeleton';
import './utils/debugOffline'; // Enable debug functions

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      // First, try to get user from localStorage as backup
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        } catch (e) {
          console.error('Error parsing stored user:', e);
          localStorage.removeItem('user');
        }
      }

      // Then verify with backend using the centralized API service
      // This automatically adds the Authorization header
      const response = await authAPI.getCurrentUser();

      if (response.data.success && response.data.data) {
        // authAPI returns { success: true, data: user }
        setUser(response.data.data);
        // Store in localStorage for persistence
        localStorage.setItem('user', JSON.stringify(response.data.data));
      } else if (response.data.authenticated && response.data.user) {
        // Handle potential legacy response format if any
        setUser(response.data.user);
        localStorage.setItem('user', JSON.stringify(response.data.user));
      } else {
        // If not authenticated, clear everything
        // Don't clear immediately if we have stored user, wait for explict 401 which api.js handles
        // But if success is false, maybe we should? 
        // Let's rely onapi.js interceptor to handle 401s
      }
    } catch (err) {
      console.error('Session check failed:', err);
      // api.js interceptor will handle 401 and redirect if needed
      // If network error, we might still want to rely on stored user
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        setUser(null);
      }
    } finally {
      // ALWAYS set loading to false
      setLoading(false);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    // Store user data in localStorage
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    // Clear localStorage
    localStorage.removeItem('user');
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
        <Login onLoginSuccess={handleLoginSuccess} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <OfflineProvider>
        <Router>
          <Routes>
            {user.role === 'admin' ? (
              <Route path="/*" element={<AdminPortal user={user} onLogout={handleLogout} />} />
            ) : (
              <>
                <Route path="/manager/*" element={<ManagerPortal user={user} onLogout={handleLogout} />} />
                <Route path="/*" element={<Navigate to="/manager/orders" replace />} />
              </>
            )}
          </Routes>
        </Router>
      </OfflineProvider>
    </ToastProvider>
  );
}

export default App;