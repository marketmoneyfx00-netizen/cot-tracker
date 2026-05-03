import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import { AuthProvider } from './context/AuthProvider.jsx';

// Route /auth/callback without a full router dependency
const isCallback = window.location.pathname.startsWith('/auth/callback');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isCallback ? (
      <AuthCallback />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>
);
