import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AdminShell } from './admin/AdminShell';
import './index.css';

// The router is mounted under basename="/admin"; any URL outside it (e.g. "/")
// matches nothing and renders a blank page. Send those to the admin root.
if (!window.location.pathname.startsWith('/admin')) {
  window.location.replace('/admin');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin">
      <AdminShell />
    </BrowserRouter>
  </React.StrictMode>,
);
