import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // この画面のコミット。挑戦の前に本番の関数と比べて、画面が古ければ読み直してもらう（src/v2cap/lib/dungeonVerifyCall.js）
  define: { __BUILD_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || '') },
  // 開発サーバーのポート: ツール(PORT環境変数)から指定があればそれを使う
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
})
