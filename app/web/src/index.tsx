import { createRoot } from 'react-dom/client';

import '@/styles/main.css';

import { App } from '@/App';

import '@fontsource-variable/inter';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

const rootEl = document.getElementById('root') as HTMLElement;

createRoot(rootEl).render(<App />);
