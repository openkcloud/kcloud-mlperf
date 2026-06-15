import react from '@vitejs/plugin-react-swc';

import * as path from 'path';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths(), svgr()],
  server: {
    host: true,
    port: 5173
    // origin: 'http://0.0.0.0:5173',
    // watch: {
    //   usePolling: true,
    //   interval: 10
    // }
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
