// 60Fボス「カモルス・V・ナスB=パピア」レイヤー分解アニメスプライト
// 1枚絵を8パーツ（本体／左右ドローン／大ダイヤ／頭上結晶／左右シャード／ペンダント）に分解し、
// 各パーツを離散keyframes（コマ送り＝GIFドット絵風）で別リズム浮遊させる。
// 画像: public/boss60/*.png（全レイヤー1254×1254の同座標キャンバス。重ねるだけで元絵に戻る）
import { assetSrc } from '../constants/pets'

const LAYERS = [
  // [file, animation]
  ['body',        'b60-bob2 2.4s linear infinite'],
  ['pendant',     'b60-bob2 2.4s linear infinite'],                 // 本体から下がる鎖due、本体と同期
  ['droneL',      'b60-bob3 1.9s linear infinite'],
  ['droneR',      'b60-bob3 1.9s linear infinite -0.95s'],          // 左右逆位相
  ['shardsL',     'b60-bob3 1.9s linear infinite -0.35s'],          // ドローンを少し遅れて追う
  ['shardsR',     'b60-bob3 1.9s linear infinite -1.30s'],
  ['diamond',     'b60-diamond 2.8s linear infinite'],
  ['crystalsTop', 'b60-bob3 2.2s linear infinite -0.7s'],
]

// size: 表示px（正方形）。animated=falseで静止画（一覧表示など負荷を抑えたい場面用）
export default function Boss60Sprite({ size = 220, animated = true, style }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, ...style }}>
      <style>{`
        @keyframes b60-bob2 {
          0%, 49.99% { transform: translateY(0); }
          50%, 100%  { transform: translateY(1.6%); }
        }
        @keyframes b60-bob3 {
          0%, 33.32%  { transform: translateY(0); }
          33.33%, 66.65% { transform: translateY(-2.2%); }
          66.66%, 100%   { transform: translateY(-1.1%); }
        }
        @keyframes b60-diamond {
          0%, 24.99%  { transform: translateY(0);      filter: brightness(1); }
          25%, 49.99% { transform: translateY(-1.5%);  filter: brightness(1.25) drop-shadow(0 0 6px #66ccffcc); }
          50%, 74.99% { transform: translateY(-2.6%);  filter: brightness(1.45) drop-shadow(0 0 10px #88ddffee); }
          75%, 100%   { transform: translateY(-1.3%);  filter: brightness(1.2) drop-shadow(0 0 5px #66ccffaa); }
        }
      `}</style>
      {LAYERS.map(([name, anim]) => (
        <img key={name} src={assetSrc(`/boss60/${name}.png`)} alt=""
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'contain', display: 'block', pointerEvents: 'none',
            animation: animated ? anim : undefined,
          }} />
      ))}
    </div>
  )
}
