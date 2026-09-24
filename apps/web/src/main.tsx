import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './app/i18n';
import { App } from './app/App';
import { applyStoredAppearance } from './app/theme';

// Theme/Dichte vor dem ersten Rendern setzen (kein Aufblitzen); CSP erlaubt kein Inline-Skript in index.html.
applyStoredAppearance();

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
