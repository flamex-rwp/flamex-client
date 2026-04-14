import React, { useState } from 'react';
import { authAPI } from '../services/api';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { getPublicAssetUrl } from '../utils/publicAssetUrl';
import './Login.css';

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('manager');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const logoUrl = getPublicAssetUrl('logo.png');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Use the centralized API service
      const response = await authAPI.login({ username, password });

      // Check for success in the response data
      if (response.data.success) {
        const { accessToken, refreshToken, user } = response.data.data;

        // Store tokens using the keys expected by api.js ('token')
        if (accessToken) {
          localStorage.setItem('token', accessToken);
        }

        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }

        // Store user data
        if (user) {
          localStorage.setItem('user', JSON.stringify(user));
        }

        onLoginSuccess(user);
      }
    } catch (err) {
      console.error('Login error:', err);
      // improved error handling
      const errorMessage = err.formattedMessage || err.response?.data?.message || err.response?.data?.error || 'Login failed. Please check your credentials.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <img src={logoUrl} alt="Logo" className="login-logo" />
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
          </div>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Processing...' : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <div className="demo-credentials">
            <p><strong>Demo Credentials:</strong></p>
            <p>Admin: admin / admin123</p>
            <p>Manager: manager / manager123</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
