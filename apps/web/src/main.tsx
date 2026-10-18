import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startLiveConnection } from './live/connection';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

startLiveConnection();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
