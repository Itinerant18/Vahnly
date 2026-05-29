import React from 'react';
import ReactDOM from 'react-dom/client';
import { ControlRoomDashboard } from './admin/ControlRoomDashboard';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ControlRoomDashboard />
  </React.StrictMode>,
);
