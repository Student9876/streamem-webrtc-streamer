import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // Change the output directory to match what Electron is looking for
    outDir: path.resolve(__dirname, '..', 'dist', 'client', 'dist'),
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: true
  }
})
