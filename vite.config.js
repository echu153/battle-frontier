import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 開発サーバーのポート: ツール(PORT環境変数)から指定があればそれを使う
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
})
