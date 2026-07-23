// 娯楽ゲーム共通のスタンプUI(カテゴリ展開式)
// 対局者と観戦者でカテゴリが異なる。「○○頑張れ！」はプレイヤー名を選んで送る
import { useState } from 'react'

export const STAMP_PLAYER_CATS = [
  { key: 'greet', label: '👋挨拶', items: ['よろしくお願いします', 'こんにちわ', 'こんばんは', 'さようなら', 'また遊ぼう'] },
  { key: 'thanks', label: '🙏感謝', items: ['ありがとう！', '助かります', '感謝です！', 'ナイス！', 'おかげさまで'] },
  { key: 'sorry', label: '💦謝罪', items: ['ごめんなさい', 'すみません！', '今のはわざとじゃない', 'お待たせしました', '許して'] },
  { key: 'praise', label: '👏賞賛', items: ['すごいすごい！', 'うまい！', '天才か？', '完敗です', 'お見事！'] },
  { key: 'surprise', label: '😲驚き', items: ['ぐわー', 'ほわー', 'えぇ！？', 'まじか…', 'そんなー'] },
  { key: 'thinking', label: '🤔思考中', items: ['悩みますね', 'ちょっと待って', 'うーん…', '考え中…', '長考します'] },
]

// 観戦者用(応援の「○○頑張れ！」は対象プレイヤーを選択)
export const STAMP_SPECTATOR_CATS = [
  { key: 'greet', label: '👋挨拶', items: ['よろしくお願いします', 'こんにちわ', 'こんばんは', 'さようなら', 'また遊ぼう'] },
  { key: 'cheer', label: '📣応援', items: ['がんばれー！', 'いけいけ！', '負けるな！', 'あと少し！', { target: true, label: '○○頑張れ！' }] },
  { key: 'praise', label: '👏賞賛', items: ['すごいすごい！', 'うまい！', '天才か？', '完敗です', 'お見事！'] },
  { key: 'surprise', label: '😲驚き', items: ['ぐわー', 'ほわー', 'えぇ！？', 'まじか…', 'そんなー'] },
]

const btn = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '4px 9px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', borderRadius: '10px',
  whiteSpace: 'nowrap', ...extra,
})

export function StampBar({ spectator, players = [], onSend }) {
  const [cat, setCat] = useState(null)
  const [targetMode, setTargetMode] = useState(false)
  const cats = spectator ? STAMP_SPECTATOR_CATS : STAMP_PLAYER_CATS
  const cur = cats.find((c) => c.key === cat)
  // 送信してもパネルは閉じない(×かカテゴリ再タップで閉じる)
  const send = (text) => { onSend(text); setTargetMode(false) }
  return (
    <div style={{ marginTop: '10px', width: '100%' }}>
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {cats.map((c) => (
          <button key={c.key} onClick={() => { setCat(cat === c.key ? null : c.key); setTargetMode(false) }}
            style={btn(cat === c.key ? '#ffcc44' : '#6699cc', {
              padding: '4px 10px',
              background: cat === c.key ? 'rgba(255,204,68,0.12)' : 'none',
            })}>
            {c.label}
          </button>
        ))}
      </div>
      {cur && (
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '6px', padding: '6px', border: '1px solid #334466', borderRadius: '8px', background: 'rgba(20,35,60,0.5)' }}>
          {targetMode ? (
            <>
              <span style={{ color: '#ffcc44', fontSize: '11px', alignSelf: 'center' }}>誰を応援する？</span>
              {players.map((p) => (
                <button key={p.id} onClick={() => send(`${p.name}頑張れ！`)} style={btn('#44dd88')}>{p.name}</button>
              ))}
              <button onClick={() => setTargetMode(false)} style={btn('#668')}>戻る</button>
            </>
          ) : (
            <>
              {cur.items.map((it, i) => {
                const isTarget = typeof it === 'object' && it.target
                const label = isTarget ? it.label : it
                return (
                  <button key={i}
                    onClick={() => (isTarget ? setTargetMode(true) : send(it))}
                    style={btn(isTarget ? '#44dd88' : '#88ccff')}>
                    {label}
                  </button>
                )
              })}
              <button onClick={() => setCat(null)} style={btn('#668', { padding: '4px 8px' })}>×</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// 受信スタンプの簡易表示(画面下部中央・名前付き)
export function StampOverlay({ stamps, bottom = 64 }) {
  if (!stamps || stamps.length === 0) return null
  return (
    <>
      <style>{'@keyframes bfstamp { 0% { transform: translateY(8px) scale(0.8); opacity: 0 } 15% { transform: none; opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }'}</style>
      <div style={{ position: 'fixed', bottom, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', zIndex: 55, pointerEvents: 'none' }}>
        {stamps.map((s) => (
          <div key={s.id} style={{
            background: 'rgba(10,20,40,0.92)', border: '1px solid #ffcc44', borderRadius: '14px',
            padding: '6px 14px', fontSize: '13px', color: '#fff', whiteSpace: 'nowrap',
            animation: 'bfstamp 2.6s ease-out both', boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
          }}>
            <span style={{ color: '#ffcc44' }}>{s.name}</span>: {s.text}
          </div>
        ))}
      </div>
    </>
  )
}
