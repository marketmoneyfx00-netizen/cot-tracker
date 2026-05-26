import './index.css';
import { StrictMode, Component } from 'react';
import { polymarketService } from './polymarket/index.js';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import { AuthProvider } from './context/AuthProvider.jsx';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[COT Tracker] Render error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          minHeight:'100vh', background:'#0d0f12', color:'#e2e8f0',
          fontFamily:"'Inter',Helvetica,sans-serif", padding:32, textAlign:'center',
        }}>
          <div style={{fontSize:40,marginBottom:16}}>⚠️</div>
          <h2 style={{margin:'0 0 8px',fontSize:20,fontWeight:700,color:'#f8fafc'}}>
            Error inesperado
          </h2>
          <p style={{margin:'0 0 24px',fontSize:14,color:'#94a3b8',maxWidth:480,lineHeight:1.6}}>
            La aplicación encontró un error al renderizar. Intenta recargar la página.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding:'10px 24px', borderRadius:8, border:'none', cursor:'pointer',
              background:'#1a6bf5', color:'#fff', fontSize:14, fontWeight:600,
            }}
          >
            Recargar
          </button>
          {import.meta.env.DEV && (
            <pre style={{
              marginTop:24, fontSize:11, color:'#ef4444', textAlign:'left',
              background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)',
              borderRadius:8, padding:16, maxWidth:640, overflowX:'auto',
              whiteSpace:'pre-wrap', wordBreak:'break-all',
            }}>
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// Route /auth/callback without a full router dependency
const isCallback = window.location.pathname.startsWith('/auth/callback');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      {isCallback ? (
        <AuthCallback />
      ) : (
        <AuthProvider>
          <App />
        </AuthProvider>
      )}
    </ErrorBoundary>
  </StrictMode>
);

// Initialize Polymarket intelligence layer in background (non-blocking, non-critical)
if (!isCallback) {
  polymarketService.initialize().catch(err =>
    console.warn('[Polymarket] Init failed (non-critical):', err.message)
  );
}
