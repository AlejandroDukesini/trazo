import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'uplot/dist/uPlot.min.css';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';
import './design/layout.css';
import './design/features.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initPwa } from './app/pwa';
import { initTheme } from './app/theme';

initTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void initPwa();
