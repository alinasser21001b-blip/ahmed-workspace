import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support unavailable; the app still works online */
    });
  });
}
