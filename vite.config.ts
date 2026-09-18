import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  plugins: [vue()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
