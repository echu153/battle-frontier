import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import { chip } from './v2capGearView.js'
import { RARITY_COLOR, rarityLabel, kindLabel } from '../lib/equipment.js'
import { plusOf, plusLabel } from '../lib/smith.js'
import {
  MUSEUM_TIERS, MUSEUM_GROUPS, raritiesOfGroup, registeredSetOf, tiersOf, museumCountOf, donatablesOf,
} from '../lib/museum.js'

// ============================================================
// 「レベルキャップあり」版 — 博物館（装備の寄贈）。決まりの正は src/v2cap/lib/museum.js・サーバーは SQL §14
//   【確定】2026-10-22 ユーザー指示「V1にあるような装備を寄贈する博物館を作成したい／
//     登録時に能力もらえるけど詳細はあとで作成する、とりあえず土台だけ作って」
//   ・上：説明と登録数（段階ごと）。登録でもらえる能力は「準備中」
//   ・寄贈できる装備（持ち物のうち、着けていない・まだ登録していない段階のもの）→「寄贈」→確認のポップアップ（装備はなくなる）
//   ・登録の一覧：初期装備・エリア1〜15・ユニーク のタブ。装備ごとに 未強化／+5以上／+9以上 の印（登録した段階は色つき）
// ============================================================
const tierBadge = (t, on = true) => ({
  fontSize:'9px', padding:'0 4px', border:`1px solid ${on ? t.color : '#223a5e'}`, color: on ? t.color : TEXT.empty, flexShrink:0,
})

export default function V2capMuseum({ prof, inventory, onProfile }) {
  const [rows, setRows] = useState(null)          // 登録の記録 [{ base_id, tier, plus }]。読み込み中は null
  const [error, setError] = useState('')
  const [msg, setMsg] = useState(null)            // { ok, text }
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)    // 寄贈の確認 { inv, item, tier }
  const [groupKey, setGroupKey] = useState(MUSEUM_GROUPS[0].key)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('v2cap_museum').select('base_id, tier, plus')
    if (e) { setError(e.message); setRows([]); return }
    setError('')
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const registered = useMemo(() => registeredSetOf(rows), [rows])
  const donatables = useMemo(() => (rows ? donatablesOf(prof, inventory, rows) : []), [prof, inventory, rows])
  const total = museumCountOf(rows || [])
  const group = MUSEUM_GROUPS.find(g => g.key === groupKey) || MUSEUM_GROUPS[0]
  const groupCount = museumCountOf(rows || [], group.items)

  const donate = async () => {
    const c = confirm
    if (!c || busy) return
    setBusy(true); setMsg(null)
    const { data, error: e } = await supabase.rpc('v2cap_museum_donate', { p_inventory_id: c.inv.id })
    setBusy(false); setConfirm(null)
    if (e || !data?.ok) { setMsg({ ok: false, text: `⚠ ${e?.message || data?.error || '寄贈できませんでした'}` }); return }
    setMsg({ ok: true, text: `🏺 「${c.item.name}」を寄贈しました（${MUSEUM_TIERS[data.tier]?.label}で登録）` })
    setRows(r => [...(r || []), { base_id: data.base_id, tier: data.tier, plus: data.plus }])
    onProfile?.()   // 持ち物を読み直す（寄贈した装備はなくなる）
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {confirm && (
        <V2Modal title="🏺 装備を寄贈する" color="#d8b070" busy={busy} confirmLabel="寄贈する"
          onConfirm={donate} onClose={() => setConfirm(null)}>
          <div>
            <span style={{ color: RARITY_COLOR[confirm.item.rarity] }}>{confirm.item.name}</span>
            {plusOf(confirm.inv) > 0 && <span style={{ color:'#ffcc00' }}> {plusLabel(plusOf(confirm.inv))}</span>}
            <span style={{ color: TEXT.sub }}>（{kindLabel(confirm.item)}）</span>
          </div>
          <div>登録する段階：<span style={{ color: MUSEUM_TIERS[confirm.tier].color }}>{MUSEUM_TIERS[confirm.tier].label}</span></div>
          <div style={{ color:'#ff8844', marginTop:'6px' }}>寄贈した装備はなくなります（元に戻せません）</div>
        </V2Modal>
      )}

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8 }}>
          装備を寄贈すると、博物館に登録されます（寄贈した装備はなくなります）。
          同じ装備を「未強化（+4まで）」「+5以上」「+9以上」の段階ごとに1回ずつ寄贈できます。着けている装備は寄贈できません。
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', alignItems:'center', fontSize:'11px', marginTop:'6px' }}>
          {MUSEUM_TIERS.map((t, i) => (
            <span key={t.key} style={{ color: TEXT.label }}>
              <span style={{ color: t.color }}>{t.label}</span> <span style={{ color:'#ffcc00' }}>{total.byTier[i]}</span> / {total.items}
            </span>
          ))}
        </div>
        {/* ★能力はあとで（ユーザー「登録時に能力もらえるけど詳細はあとで作成する」） */}
        <div style={{ color: TEXT.empty, fontSize:'10px', marginTop:'4px' }}>登録でもらえる能力：準備中</div>
        {error && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'4px' }}>⚠ 登録を読めませんでした（{error}）</div>}
        {msg && <div style={{ color: msg.ok ? '#44ff88' : '#ff8844', fontSize:'11px', marginTop:'6px' }}>{msg.text}</div>}
      </div>

      {/* ===== 寄贈できる装備 ===== */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#d8b070', fontSize:'12px', marginBottom:'6px' }}>寄贈できる装備（{donatables.length}）</div>
        {rows === null ? <div style={{ color: TEXT.label, fontSize:'11px' }}>読み込み中...</div>
          : donatables.length === 0 ? (
            <div style={{ color: TEXT.empty, fontSize:'11px' }}>寄贈できる装備はありません（着けていない装備で、まだ登録していない段階のもの）</div>
          ) : (
            <div style={{ display:'grid', gap:'3px', maxHeight:'320px', overflowY:'auto' }}>
              {donatables.map(d => {
                const t = MUSEUM_TIERS[d.tier]
                return (
                  <div key={`${d.item.id}|${d.tier}`} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 8px',
                    display:'flex', alignItems:'center', gap:'8px', fontSize:'11px' }}>
                    <span style={tierBadge(t)}>{t.label}</span>
                    <span style={{ flex:1, minWidth:0 }}>
                      <span style={{ color: RARITY_COLOR[d.item.rarity] }}>{d.item.name}</span>
                      {plusOf(d.inv) > 0 && <span style={{ color:'#ffcc00' }}> {plusLabel(plusOf(d.inv))}</span>}
                      <span style={{ color: TEXT.label, fontSize:'10px' }}>　{kindLabel(d.item)}{d.copies > 1 ? `・${d.copies}個` : ''}</span>
                    </span>
                    <button onClick={() => { setMsg(null); setConfirm(d) }} disabled={busy} style={miniBtn('#d8b070')}>寄贈</button>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {/* ===== 登録の一覧 ===== */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'8px' }}>
          {MUSEUM_GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroupKey(g.key)} style={chip(g.key === group.key)}>{g.label}</button>
          ))}
        </div>
        <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'8px' }}>
          {group.label}：
          {MUSEUM_TIERS.map((t, i) => (
            <span key={t.key}>{i ? '・' : ''}<span style={{ color: t.color }}>{t.label}</span> {groupCount.byTier[i]}/{groupCount.items}</span>
          ))}
        </div>
        {raritiesOfGroup(group).map(r => (
          <div key={r} style={{ marginBottom:'8px' }}>
            <div style={{ color: RARITY_COLOR[r], fontSize:'11px', marginBottom:'4px' }}>{rarityLabel(r)}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(min(100%, 230px), 1fr))', gap:'3px' }}>
              {group.items.filter(it => it.rarity === r).map(it => {
                const has = tiersOf(registered, it.id)
                return (
                  <div key={it.id} style={{ background:'#000818', border:`1px solid ${has.length ? '#224466' : '#001428'}`, padding:'4px 6px',
                    display:'flex', alignItems:'center', gap:'6px', fontSize:'11px' }}>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      color: has.length ? RARITY_COLOR[it.rarity] : TEXT.empty }} title={`${it.name}（${kindLabel(it)}）`}>
                      {it.name}
                    </span>
                    {MUSEUM_TIERS.map(t => (
                      <span key={t.key} title={t.label} style={{ ...tierBadge(t, has.includes(t.key)), padding:'0 3px' }}>
                        {t.key === 0 ? '未' : t.key === 1 ? '+5' : '+9'}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
