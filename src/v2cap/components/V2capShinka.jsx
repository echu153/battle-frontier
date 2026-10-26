import { useState } from 'react'
import V2Modal from './V2Modal.jsx'
import { MasterSays } from './V2capSmithMaster.jsx'
import { V2Tip } from './V2ItemTip.jsx'
import { miniBtn, TEXT } from './v2ui.js'
import { nameColor } from './v2capGearView.js'
import { PlusTag } from './v2capGear.jsx'
import {
  SHINKA_MAX, isShinka, masteryOf, canShinka, shinkaNameOf, shinkaLines, flagLabelOf,
} from '../lib/shinka.js'

// ============================================================
// 「レベルキャップあり」版 — 武器の真化（2026-10-26・決まりは src/v2cap/lib/shinka.js）
//   ・ShinkaNote … 武器の行に出す1行（真化していれば能力の名前・カーソルで中身／していなければ熟練度）
//   ・ShinkaTab  … 鍛冶屋の「真化」のタブ（熟練度が MAX の武器を真化する）
// ★抽選はサーバー（v2cap_shinka）。画面は結果を出すだけ
// ============================================================
const GOLD = '#ffcc66'
const COST = '#ff8866'

// 能力の中身（得は青・代償は橙）
export function ShinkaLines({ sh, size = '11px' }) {
  return shinkaLines(sh).map((l, i) => (
    <div key={i} style={{ color: l.cost ? COST : '#93c6ff', fontSize: size }}>{l.cost ? '▼ ' : '▲ '}{l.text}</div>
  ))
}

// 武器の行の1行。真化した武器は「✦ 真化：◯◯キラー」（カーソルで中身）・していない武器は熟練度
export function ShinkaNote({ inv, item }) {
  if (item?.part !== '武器') return null
  const sh = inv?.shinka
  if (isShinka(sh)) {
    return (
      <V2Tip width="260px" color={GOLD} style={{ color: GOLD, fontSize:'10px', borderBottom:`1px dotted ${GOLD}` }}
        body={<><div style={{ color: GOLD }}>✦ 真化：{shinkaNameOf(sh)}</div><ShinkaLines sh={sh} /></>}>
        ✦ 真化：{shinkaNameOf(sh)}
      </V2Tip>
    )
  }
  const m = masteryOf(inv)
  return (
    <span style={{ fontSize:'10px', color: m >= SHINKA_MAX ? GOLD : TEXT.sub }}>
      熟練度 {m.toLocaleString()} / {SHINKA_MAX.toLocaleString()}{m >= SHINKA_MAX ? '（鍛冶屋で真化できます）' : ''}
    </span>
  )
}

// 熟練度のゲージ
const Gauge = ({ m }) => (
  <div style={{ height:'5px', background:'#001a33', border:'1px solid #003366', margin:'3px 0' }}>
    <div style={{ width:`${Math.min(100, (m / SHINKA_MAX) * 100)}%`, height:'100%', background: m >= SHINKA_MAX ? GOLD : '#3a86d0' }} />
  </div>
)

// ===== 鍛冶屋の「真化」のタブ =====
// Head・Stats … 鍛冶屋の行の頭とステ（V2capSmith.jsx の ItemHead・ItemStats をそのまま使う）
export function ShinkaTab({ prof, all, wornIds, busy, call, setError, say, Head, Stats }) {
  const [askId, setAskId] = useState(null)   // 真化の確認を開いている持ち物のID
  const [ask, setAsk] = useState(null)       // 確認のときの親方のひとこと
  const [done, setDone] = useState(null)     // 真化の結果 { name, color, sh, pool, say }
  // 武器だけ。着けている武器 → 真化できる → 熟練度の高い順 → 真化したもの
  const wornWeapon = String(prof.equipped?.weapon ?? '')
  const rank = ({ inv }) => (String(inv.id) === wornWeapon ? 0 : canShinka(inv) ? 1 : isShinka(inv.shinka) ? 3 : 2)
  const rows = all.filter(r => r.item.part === '武器')
    .sort((a, b) => rank(a) - rank(b) || masteryOf(b.inv) - masteryOf(a.inv) || b.inv.id - a.inv.id)
  const askRow = askId === null ? null : rows.find(r => String(r.inv.id) === askId) || null
  const open = (inv) => { setAskId(String(inv.id)); setAsk(say('shinkaAsk')) }
  const shinka = async () => {
    if (!askRow || busy) return
    const { item } = askRow
    const { data, error } = await call('v2cap_shinka', { p_inv: askRow.inv.id })
    setAskId(null)
    if (error) { setError(error); say('error'); return }
    const line = say('shinka', { item: item.name })
    setDone({ name: item.name, color: nameColor(item), sh: data.shinka, pool: data.pool || [], say: line })
  }
  return (
    <>
      {askRow && (
        <V2Modal title="✦ 武器の真化" color={GOLD} busy={busy} confirmLabel="真化する" cancelLabel="やめる"
          onConfirm={shinka} onClose={() => { if (!busy) setAskId(null) }}>
          {ask && <MasterSays face={ask.face} line={ask.text} />}
          <div style={{ fontSize:'14px' }}><span style={{ color: nameColor(askRow.item) }}>{askRow.item.name}</span><PlusTag inv={askRow.inv} /></div>
          <div style={{ marginTop:'6px', lineHeight:1.7 }}>
            この武器の戦い方から、能力が1つ付きます（どれが付くかは戦い方の中から選ばれます）。
            <span style={{ color: COST }}>代償（デメリット）が付くこともあります。</span>
            真化は1本につき1回だけで、やり直せません。
          </div>
        </V2Modal>
      )}
      {done && (
        <V2Modal title="✦ 真化した！" color={GOLD} cancelLabel="閉じる" onClose={() => setDone(null)}>
          {done.say && <MasterSays face={done.say.face} line={done.say.text} />}
          <div style={{ fontSize:'14px' }}><span style={{ color: done.color }}>{done.name}</span></div>
          <div style={{ color: GOLD, fontSize:'15px', margin:'6px 0 2px' }}>✦ {shinkaNameOf(done.sh)}</div>
          <ShinkaLines sh={done.sh} size="12px" />
          {done.pool.length > 0 && (
            <div style={{ marginTop:'8px', fontSize:'11px', color: TEXT.sub }}>
              <div style={{ color:'#88ccff' }}>この武器の戦い方</div>
              {done.pool.map((p, i) => (
                <div key={i} style={{ color: p.key === done.sh.key ? GOLD : TEXT.sub }}>・{flagLabelOf(p)}</div>
              ))}
            </div>
          )}
        </V2Modal>
      )}
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {rows.length === 0 && <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>武器を持っていません</div>}
        {rows.map(({ inv, item }) => {
          const isWorn = wornIds.has(String(inv.id))
          const m = masteryOf(inv)
          const sh = inv.shinka
          return (
            <div key={inv.id} style={{ background:'#000818', border:`1px solid ${canShinka(inv) ? '#aa8833' : isWorn ? '#0055aa' : '#002244'}`, padding:'6px 8px' }}>
              <Head inv={inv} item={item} lv={prof.lv} isWorn={isWorn} />
              <Stats inv={inv} item={item} lv={prof.lv} isWorn={isWorn} />
              {isShinka(sh)
                ? (
                  <div style={{ marginTop:'2px' }}>
                    <div style={{ color: GOLD, fontSize:'12px' }}>✦ 真化：{shinkaNameOf(sh)}</div>
                    <ShinkaLines sh={sh} size="10px" />
                  </div>
                )
                : (
                  <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                    <div style={{ flex:1, minWidth:0, fontSize:'10px', color: canShinka(inv) ? GOLD : TEXT.sub }}>
                      熟練度 {m.toLocaleString()} / {SHINKA_MAX.toLocaleString()}
                      <Gauge m={m} />
                    </div>
                    {canShinka(inv)
                      ? <button onClick={() => open(inv)} disabled={busy} style={{ ...miniBtn(GOLD), flexShrink:0 }}>✦ 真化する</button>
                      : <span style={{ color: TEXT.empty, fontSize:'10px', flexShrink:0 }}>あと{(SHINKA_MAX - m).toLocaleString()}戦</span>}
                  </div>
                )}
            </div>
          )
        })}
      </div>
    </>
  )
}
