import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A GitHub Pages project site is served from https://<user>.github.io/<repo>/, so the
// built asset URLs have to carry that prefix. The deploy workflow sets BASE_PATH from
// the repository name; local dev and any root-domain host keep "/".
// src/lib/data.ts reads import.meta.env.BASE_URL, so the JSON fetches follow automatically.
const base = process.env.BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
})
