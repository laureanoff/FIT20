import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { setupPwa } from '@/app/pwa';
import { setAudioSession } from '@/features/running/lockscreen';
import { AppCrash, ErrorBoundary } from '@/components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={(retry) => <AppCrash retry={retry} />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

setupPwa();
// Pitidos del temporizador mezclados con la música de otras apps (no la cortan).
setAudioSession('ambient');
