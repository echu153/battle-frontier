import { useMemo, useState } from 'react'
import V2Modal from './V2Modal.jsx'
import { CATEGORIES, byCategory, firstTabOf, hasNewIn, sortNewest } from '../lib/announce.js'
import { box, miniBtn, TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— お知らせ
// ------------------------------------------------------------
// ★中身の並べ替え・種類分けは src/v2/lib/announce.js が正。ここは見せるだけ。
// ★読み込むのはホーム（V2Home）。この画面はもらったものを出すだけにして、
//   ポップアップと一覧で「別々に取ってきて食い違う」をなくす。

const dateOf = (a) => (a?.created_at ? new Date(a.created_at).toLocaleDateString('ja-JP') : '')

// 新着の目印。一覧でもポップアップでも同じ見た目にする
const NewMark = () => (
  <span style={{ color:'#ff8844', fontSize:'9px', padding:'1px 4px', border:'1px solid #ff8844' }}>NEW</span>
)

// ===== メニューから開く一覧 =====
export default function V2Announce({ list, unread, onBack }) {
  const all = useMemo(() => sortNewest(list), [list])
  // ★新着がある種類を開いた状態で始める（せっかく出したものを探させない）
  const [tab, setTab] = useState(() => firstTabOf(all, unread))
  const [open, setOpen] = useState(() => {
    // 新着が1件だけならその中身を開いておく
    const u = all.filter(a => unread?.has?.(a.id))
    return u.length === 1 ? u[0].id : null
  })
  const rows = useMemo(() => byCategory(all, tab), [all, tab])

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <div style={{ color:'#ff8844', fontSize:'13px' }}>📢 お知らせ</div>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      </div>

      {/* 種類のタブ */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'10px' }}>
        {CATEGORIES.map(c => {
          const on = tab === c.key
          const isNew = hasNewIn(all, c.key, unread)
          return (
            <button key={c.key} onClick={() => { setTab(c.key); setOpen(null) }}
              style={{ flex:1, padding:'6px 2px', background: on ? '#001840' : '#000818',
                border:`1px solid ${on ? c.color : '#223a5e'}`, color: on ? c.color : TEXT.label,
                cursor:'pointer', fontFamily:'monospace', fontSize:'10px', position:'relative' }}>
              {c.icon} {c.label}
              {isNew && <span style={{ position:'absolute', top:'-5px', right:'-3px', background:'#ff4400',
                color:'#fff', fontSize:'7px', padding:'1px 4px', borderRadius:'6px' }}>NEW</span>}
            </button>
          )
        })}
      </div>

      {rows.length === 0 && (
        <div style={{ color:TEXT.empty, fontSize:'11px', padding:'12px 0', textAlign:'center' }}>
          この種類のお知らせはまだありません
        </div>
      )}
      {rows.map(a => {
        const isNew = !!unread?.has?.(a.id)
        const opened = open === a.id
        return (
          <div key={a.id} style={{ marginBottom:'6px', border:`1px solid ${isNew ? '#443300' : '#002a55'}`, background:'#000818' }}>
            <button onClick={() => setOpen(opened ? null : a.id)}
              style={{ width:'100%', padding:'9px 10px', background:'none', border:'none', color:TEXT.body,
                cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left',
                display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px' }}>
              <span>
                <span style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  {isNew && <NewMark />}
                  <span>{a.title}</span>
                </span>
                <span style={{ display:'block', color:TEXT.label, fontSize:'10px', marginTop:'2px' }}>{dateOf(a)}</span>
              </span>
              <span style={{ color:TEXT.label, fontSize:'10px' }}>{opened ? '▲' : '▼'}</span>
            </button>
            {opened && (
              <div style={{ padding:'10px 12px', borderTop:'1px solid #002a55', color:TEXT.bright,
                fontSize:'11px', lineHeight:1.8, whiteSpace:'pre-wrap' }}>
                {a.content}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ===== 読み込んだときに出るポップアップ =====
// ★件名だけ並べる（中身は一覧で読む）。旧版と同じで「詳しく見る」「閉じる」の2つ。
export function V2AnnouncePopup({ items, onOpen, onClose }) {
  const rows = useMemo(() => sortNewest(items), [items])
  if (!rows.length) return null
  return (
    <V2Modal title="📢 新着お知らせ" color="#ff8844" onClose={onClose}
      confirmLabel="詳しく見る" cancelLabel="閉じる" onConfirm={onOpen}>
      {rows.map(a => (
        <div key={a.id} style={{ marginBottom:'6px', padding:'8px 10px', background:'#000818', border:'1px solid #332200' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <NewMark />
            <span style={{ color:TEXT.body, fontSize:'12px' }}>{a.title}</span>
          </div>
          <div style={{ color:TEXT.label, fontSize:'10px', marginTop:'3px' }}>{dateOf(a)}</div>
        </div>
      ))}
    </V2Modal>
  )
}
