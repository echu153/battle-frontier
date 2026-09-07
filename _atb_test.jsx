// ATB戦闘プロトタイプの試し撃ち（開発用・コミットしない）
import { createRoot } from 'react-dom/client'
import V2Atb from './src/v2/components/V2Atb.jsx'

const prof = {
  username: 'テスト戦士',
  class: '戦士',
  lv: 100,
  hp: 4000, mp: 400, str: 300, dex: 200, agi: 200, int_stat: 100, vit: 250, luk: 120,
  skill_set: [
    { name: '強撃', uses: 3 },
    { name: '防御崩し', uses: 3 },
    { name: '防御態勢', uses: 3 },
    { name: 'シールドアタック', uses: 3 },
    { name: '体当たり', uses: 3 },
  ],
}

createRoot(document.getElementById('root')).render(
  <V2Atb prof={prof} inventory={[]} runes={[]} fishDex={[]} />
)
