import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, btn, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { ITEMS, ITEM_BY_ID, PARTS, RARITIES, RARITY_COLOR, ARMOR_EFFECT, kindLabel, partLabel, rarityLabel, itemLabel } from '../lib/equipment.js'
import { spotOf } from '../lib/areas.js'
import { openUntilOf } from '../lib/sortie.js'
import { canEquipType } from '../lib/jobs.js'
import { wornIdsOf } from '../lib/loadout.js'
import { powerAt, statsAt, effectPct } from '../lib/gear.js'
import {
  PLUS_MAX, plusOf, scrapNameOf, scrapOf, dismantleGainOf, bulkPickable, enhanceCostOf, enhanceErrorOf,
  SCRAP_NAMES, SCRAP_YIELD, CRAFT_RARITIES, craftCostOf, craftErrorOf,
} from '../lib/smith.js'
import { statLine, nameColor, PLUS_COLOR, chip, gainText, areaOptionLabel, useGearRows } from './v2capGearView.js'
import { RarityTag, PlusTag, GearFilterBar } from './v2capGear.jsx'

// ============================================================
// 「レベルキャップあり」版 — 鍛冶屋（強化・分解・作成）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザー指示「鍛冶屋を追加、ここで装備の強化・分解・作成が可能」。数の正は src/v2cap/lib/smith.js
//   ・強化 … Goldとその装備のエリアの残骸で+1（+10まで・+1ごとに強さ+10%）。失敗すると残骸とGoldはなくなり、強化値はそのまま
//   ・分解 … 装備をその装備のエリアの残骸にする（ノーマル1・レア5・エピック10・レジェンダリー25）。
//            まとめて選べる（レア度で・チェックで・表示中を全部。まとめて選ぶときは装備中と強化したものは選ばない）
//   ・作成 … レア・エピック・レジェンダリーを、Goldとそのエリアの残骸で作る（残骸30／100／300・Gold 必要LV×50／100／200）。
//            必ずできる・+0で持ち物に入る。武器は14種どれでも作れる（ユーザー決定）。作れるのは行ったことのあるエリアまで
//   ・強化と分解は鍛冶屋だけ（装備画面は着ける・外すだけ・ユーザー決定）
// ============================================================
const TABS = [
  { key:'enhance',   label:'強化', desc:`Goldとその装備のエリアの残骸で強化値を+1（+${PLUS_MAX}まで・+1ごとに強さ+10%）。失敗すると残骸とGoldはなくなり、強化値はそのままです。着けている装備も強化できます。` },
  { key:'dismantle', label:'分解', desc:`装備を、その装備のエリアの残骸にします（${RARITIES.map(r => `${rarityLabel(r)}${SCRAP_YIELD[r]}`).join('・')}個）。着けている装備は分解できません。` },
  { key:'craft',     label:'作成', desc:'レア・エピック・レジェンダリーの装備を、Goldとそのエリアの残骸で作ります（必ずできます・+0で持ち物に入ります）。武器はどの職業のものでも作れます。' },
]
const rowBox = (border, bg = '#000818') => ({ background: bg, border:`1px solid ${border}`, padding:'6px 8px' })
const SHORT = '#ff8844'

export default function V2capSmith({ prof, inventory, onProfile, onGo }) {
  const [tab, setTab] = useState('enhance')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const wornIds = wornIdsOf(prof, inventory)
  const all = useMemo(() => (inventory || [])
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.base_id] }))
    .filter(r => r.item), [inventory])
  const list = useGearRows(all, prof.lv)   // 強化と分解で同じ絞り込み・並べ替えを使う
  const owned = SCRAP_NAMES.map((name, i) => ({ area: i + 1, name, n: scrapOf(prof.materials, i + 1) })).filter(m => m.n > 0)

  // RPCを呼び、うまくいったらサーバーから取り直す。返すのは { data } か { error }
  const call = async (fn, args) => {
    setBusy(true); setError(''); setNotice('')
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e || !data?.ok) { setBusy(false); return { error: e?.message || data?.error || '失敗しました' } }
    await onProfile(null)
    setBusy(false)
    return { data }
  }
  const switchTab = (key) => { setTab(key); setError(''); setNotice('') }
  const shared = { prof, all, wornIds, list, busy, call, setError, setNotice }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {/* 持っている残骸とGold */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', marginBottom:'6px', flexWrap:'wrap' }}>
          <span style={{ color:'#88ccff', fontSize:'12px' }}>🧱 持っている残骸</span>
          <span style={{ fontSize:'11px', color: TEXT.label }}>💰 Gold <span style={{ color:'#ffcc00' }}>{Number(prof.gold || 0).toLocaleString()}</span></span>
        </div>
        {owned.length === 0
          ? <div style={{ color: TEXT.label, fontSize:'10px' }}>まだありません。装備を分解すると、その装備のエリアの残骸が手に入ります</div>
          : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:'3px' }}>
              {owned.map(m => (
                <div key={m.area} style={{ background:'#000818', border:'1px solid #002244', padding:'4px 7px', fontSize:'11px', display:'flex', justifyContent:'space-between', gap:'6px' }}>
                  <span style={{ color:'#cfe2ff' }}>{m.name}</span>
                  <span style={{ color:'#ffcc00' }}>{m.n.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      <div style={{ ...box, padding:'12px' }}>
        <div style={{ display:'flex', gap:'4px', marginBottom:'6px', flexWrap:'wrap', alignItems:'center' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => switchTab(t.key)} disabled={busy}
              style={{ ...btn(tab === t.key ? '#ffaa44' : '#62789a'), padding:'6px 14px', color: tab === t.key ? '#ffcc66' : '#93a9be' }}>
              {t.label}
            </button>
          ))}
          {onGo && <button onClick={() => onGo('equip')} style={{ ...miniBtn('#88ccff'), marginLeft:'auto' }}>🛡 装備へ</button>}
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>{TABS.find(t => t.key === tab).desc}</div>
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
        {notice && <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'6px' }}>{notice}</div>}
        {tab === 'enhance' && <EnhanceTab {...shared} />}
        {tab === 'dismantle' && <DismantleTab {...shared} />}
        {tab === 'craft' && <CraftTab {...shared} />}
      </div>
    </div>
  )
}

// ===== 強化 =====
function EnhanceTab({ prof, all, wornIds, list, busy, call }) {
  const [smithId, setSmithId] = useState(null)   // 強化の画面を開いている持ち物のID
  const [msg, setMsg] = useState(null)           // 直前の強化の結果 { ok, text }
  const row = smithId === null ? null : all.find(r => String(r.inv.id) === smithId) || null
  const gold = Number(prof.gold) || 0
  const enhance = async () => {
    if (!row) return
    setMsg(null)
    const { data, error } = await call('v2cap_enhance', { p_inventory_id: row.inv.id })
    if (error) { setMsg({ ok: false, text: `⚠ ${error}` }); return }
    setMsg(data.success
      ? { ok: true, text: `✨ 成功！ +${data.plus} になりました` }
      : { ok: false, text: `💥 失敗… +${data.plus} のまま（${scrapNameOf(data.area)} ${data.scrap}個と Gold ${Number(data.gold).toLocaleString()} はなくなりました）` })
  }
  return (
    <>
      {row && (
        <SmithModal row={row} prof={prof} busy={busy} msg={msg}
          onEnhance={enhance} onClose={() => { if (!busy) { setSmithId(null); setMsg(null) } }} />
      )}
      <GearFilterBar g={list} />
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {list.rows.length === 0 && <Empty all={all} />}
        {list.rows.map(({ inv, item }) => {
          const pct = effectPct(inv.ilv, prof.lv)
          const cost = enhanceCostOf(item, inv)
          const isWorn = wornIds.has(String(inv.id))
          const scrapShort = cost && scrapOf(prof.materials, item.area) < cost.scrap
          const goldShort = cost && gold < cost.gold
          return (
            <div key={inv.id} style={rowBox(isWorn ? '#0055aa' : '#002244')}>
              <ItemHead inv={inv} item={item} lv={prof.lv} isWorn={isWorn} />
              <ItemStats inv={inv} item={item} pct={pct} />
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', fontSize:'10px' }}>
                {cost ? (
                  <span style={{ color: TEXT.sub, flex:1, minWidth:0 }}>
                    次は <span style={{ color: PLUS_COLOR }}>+{cost.next}</span>：
                    <span style={{ color: scrapShort ? SHORT : '#cfe2ff' }}>{scrapNameOf(item.area)} {cost.scrap}個</span>・
                    <span style={{ color: goldShort ? SHORT : '#ffcc00' }}>Gold {cost.gold.toLocaleString()}</span>・成功率 {cost.rate}%
                  </span>
                ) : <span style={{ color: PLUS_COLOR, flex:1 }}>+{PLUS_MAX}（上限）</span>}
                <button onClick={() => { setSmithId(String(inv.id)); setMsg(null) }} disabled={busy || !cost} style={miniBtn('#ffcc00')}>強化</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 分解 =====
function DismantleTab({ all, wornIds, list, busy, call, setError, setNotice }) {
  const [picked, setPicked] = useState(() => new Set())   // 分解に選んだ持ち物のID（文字列）
  const [confirm, setConfirm] = useState(null)             // 分解の確認 [{ inv, item }]
  const pickedRows = all.filter(r => picked.has(String(r.inv.id)) && !wornIds.has(String(r.inv.id)))
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const pickAll = (rows) => setPicked(prev => new Set([...prev, ...rows.filter(r => bulkPickable(r, wornIds)).map(r => String(r.inv.id))]))
  const dismantle = async () => {
    const target = confirm || []
    const { data, error } = await call('v2cap_dismantle', { p_ids: target.map(r => r.inv.id) })
    setConfirm(null)
    if (error) { setError(error); return }
    setNotice(`🔨 ${data.dismantled}個を分解しました${Object.keys(data.gained || {}).length ? `：${gainText(data.gained)}` : ''}`)
    setPicked(prev => new Set([...prev].filter(id => !target.some(r => String(r.inv.id) === id))))
  }
  return (
    <>
      {confirm && <DismantleModal list={confirm} busy={busy} onConfirm={dismantle} onClose={() => setConfirm(null)} />}
      <GearFilterBar g={list} />
      <div style={{ background:'#000818', border:'1px solid #553322', padding:'7px 8px', marginBottom:'8px', fontSize:'10px' }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center', marginBottom:'5px' }}>
          <span style={{ color: TEXT.label }}>まとめて選ぶ</span>
          {RARITIES.map(r => {
            const rows = all.filter(x => x.item.rarity === r && bulkPickable(x, wornIds))
            return (
              <button key={r} onClick={() => pickAll(rows)} disabled={busy || rows.length === 0}
                style={{ ...miniBtn(rows.length ? RARITY_COLOR[r] : '#62789a'), color: rows.length ? RARITY_COLOR[r] : TEXT.empty }}>
                {rarityLabel(r)}を全部（{rows.length}）
              </button>
            )
          })}
          <button onClick={() => pickAll(list.rows)} disabled={busy || list.rows.length === 0} style={miniBtn('#88ccff')}>表示中をすべて</button>
          <button onClick={() => setPicked(new Set())} disabled={busy || picked.size === 0} style={miniBtn('#62789a')}>選択を外す</button>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', alignItems:'center' }}>
          <span style={{ color:'#cfe2ff' }}>選んだ {pickedRows.length}個</span>
          {pickedRows.length > 0 && <span style={{ color: TEXT.sub }}>→ {gainText(dismantleGainOf(pickedRows))}</span>}
          <button onClick={() => setConfirm(pickedRows)} disabled={busy || pickedRows.length === 0} style={miniBtn('#ff8844')}>
            選んだ{pickedRows.length}個を分解
          </button>
        </div>
        <div style={{ color: TEXT.sub, marginTop:'4px' }}>まとめて選ぶときは、装備中と強化した装備は選びません（チェックで1つずつなら選べます）</div>
      </div>
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {list.rows.length === 0 && <Empty all={all} />}
        {list.rows.map(({ inv, item }) => {
          const isWorn = wornIds.has(String(inv.id))
          const isPicked = !isWorn && picked.has(String(inv.id))
          return (
            <div key={inv.id} style={rowBox(isPicked ? '#aa5533' : isWorn ? '#0055aa' : '#002244', isPicked ? '#1a0c08' : '#000818')}>
              <ItemHead inv={inv} item={item} isWorn={isWorn}
                check={<input type="checkbox" checked={isPicked} disabled={isWorn || busy} onChange={() => toggle(String(inv.id))}
                  title={isWorn ? '着けている装備は分解できません' : '分解に選ぶ'} style={{ accentColor:'#ff8844', margin:0, flexShrink:0 }} />} />
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', fontSize:'10px' }}>
                <span style={{ color: TEXT.sub, flex:1, minWidth:0 }}>
                  分解すると <span style={{ color:'#cfe2ff' }}>{scrapNameOf(item.area)} +{SCRAP_YIELD[item.rarity]}</span>
                </span>
                {isWorn
                  ? <span style={{ color: TEXT.empty }}>装備中は分解できない</span>
                  : <button onClick={() => setConfirm([{ inv, item }])} disabled={busy} style={miniBtn('#aa5566')}>分解</button>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 作成 =====
function CraftTab({ prof, all, busy, call, setError, setNotice }) {
  // 作れるのは行ったことのあるエリアまで（残骸もそのエリアの装備からしか出ない）
  const maxArea = Math.max(1, spotOf(openUntilOf(prof.cleared_spots))?.area || 1)
  const [area, setArea] = useState(maxArea)
  const [rarity, setRarity] = useState('R')
  const [part, setPart] = useState('all')
  const [confirm, setConfirm] = useState(null)   // 作る装備（item）
  const items = ITEMS.filter(i => i.area === area && i.rarity === rarity && (part === 'all' || i.part === part))
  const cost = craftCostOf(ITEMS.find(i => i.area === area && i.rarity === rarity))
  const have = scrapOf(prof.materials, area)
  const gold = Number(prof.gold) || 0
  const times = cost ? Math.min(Math.floor(have / cost.scrap), Math.floor(gold / cost.gold)) : 0
  const ownCount = useMemo(() => {
    const out = {}
    for (const r of all) out[r.item.id] = (out[r.item.id] || 0) + 1
    return out
  }, [all])
  const craft = async () => {
    const item = confirm
    const { data, error } = await call('v2cap_craft', { p_equip_id: item.id })
    setConfirm(null)
    if (error) { setError(error); return }
    setNotice(`🔨 ${itemLabel(item)}（LV${data.ilv}）を作りました`)
  }
  return (
    <>
      {confirm && <CraftModal item={confirm} prof={prof} busy={busy} onConfirm={craft} onClose={() => setConfirm(null)} />}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'4px', alignItems:'center' }}>
        <select value={area} onChange={e => setArea(Number(e.target.value))}
          style={{ background:'#000818', border:'1px solid #62789a', color:'#cfe2ff', fontFamily:'monospace', fontSize:'11px', padding:'3px 4px' }}>
          {Array.from({ length: maxArea }, (_, i) => i + 1).map(a => <option key={a} value={a}>{areaOptionLabel(a)}</option>)}
        </select>
        {CRAFT_RARITIES.map(r => (
          <button key={r} onClick={() => setRarity(r)}
            style={rarity === r ? { ...miniBtn(RARITY_COLOR[r]), color: RARITY_COLOR[r] } : chip(false)}>{rarityLabel(r)}</button>
        ))}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
        {['all', ...PARTS].map(p => (
          <button key={p} onClick={() => setPart(p)} style={chip(part === p)}>{p === 'all' ? 'すべて' : partLabel(p)}</button>
        ))}
      </div>
      {cost && (
        <div style={{ background:'#000818', border:'1px solid #553322', padding:'6px 8px', marginBottom:'8px', fontSize:'10px', color: TEXT.sub, lineHeight:1.7 }}>
          1つ作るのに：<span style={{ color: have < cost.scrap ? SHORT : '#cfe2ff' }}>{scrapNameOf(area)} {cost.scrap}個</span>（持っている {have.toLocaleString()}）・
          <span style={{ color: gold < cost.gold ? SHORT : '#ffcc00' }}>Gold {cost.gold.toLocaleString()}</span>（持っている {gold.toLocaleString()}）
          <span style={{ color: times > 0 ? '#44ff88' : TEXT.empty }}>　いま作れるのは {times}個</span>
        </div>
      )}
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {items.map(item => {
          const usable = item.part !== '武器' || canEquipType(prof.class, item.type)
          const err = craftErrorOf(item, prof)
          const pct = effectPct(item.lv, prof.lv)
          const n = ownCount[item.id] || 0
          return (
            <div key={item.id} style={rowBox('#002244')}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
                  <RarityTag item={item} />{item.name}
                  <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
                  {item.line && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{ARMOR_EFFECT[item.line]?.label}</span>}
                  {n > 0 && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>持っている {n}</span>}
                </span>
                <span style={{ color: item.lv > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px' }}>LV{item.lv}</span>
              </div>
              <ItemStats inv={{ ilv: item.lv, plus: 0 }} item={item} pct={pct} />
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', fontSize:'10px' }}>
                <span style={{ flex:1, minWidth:0, color:'#c69a5c' }}>{usable ? '' : `${prof.class}は${item.type}を装備できない（作ることはできる）`}</span>
                <button onClick={() => setConfirm(item)} disabled={busy || !!err} title={err || ''} style={miniBtn('#ffaa44')}>作る</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 部品 =====
// 名前の行（レア度・名前・強化値・種類・防具の効果・装備中・LV）
function ItemHead({ inv, item, lv, isWorn, check }) {
  const effect = item.line ? ARMOR_EFFECT[item.line]?.label : null
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
      {check}
      <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
        <RarityTag item={item} />{item.name}<PlusTag inv={inv} />
        <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
        {effect && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{effect}</span>}
        {isWorn && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>装備中</span>}
      </span>
      <span style={{ color: lv && inv.ilv > lv ? '#ff8844' : '#cfe2ff', fontSize:'11px' }}>LV{inv.ilv}</span>
    </div>
  )
}
// 戦闘力とステ（強化値・必要LV不足の効果%込み）
function ItemStats({ inv, item, pct }) {
  const power = powerAt(item, inv.ilv, plusOf(inv))
  return (
    <div style={{ fontSize:'10px', color: TEXT.sub, margin:'3px 0', display:'flex', gap:'8px', flexWrap:'wrap' }}>
      <span>戦闘力 {power}{pct < 100 && <span style={{ color:'#ff8844' }}> → {Math.round(power * pct / 100)}（効果{pct}%）</span>}</span>
      <span>{statLine(statsAt(item, inv.ilv, pct, plusOf(inv)))}</span>
    </div>
  )
}
function Empty({ all }) {
  return (
    <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>
      {all.length === 0 ? '装備がありません（出撃で勝つと落ちることがあります。「作成」で作ることもできます）' : 'この絞り込みに当てはまる装備はありません'}
    </div>
  )
}

// 強化の画面。結果を出したまま続けて強化できる（閉じるまで開いたまま）
function SmithModal({ row, prof, busy, msg, onEnhance, onClose }) {
  const { inv, item } = row
  const plus = plusOf(inv)
  const cost = enhanceCostOf(item, inv)
  const err = enhanceErrorOf(item, inv, prof)
  const pct = effectPct(inv.ilv, prof.lv)
  const now = powerAt(item, inv.ilv, plus)
  const have = scrapOf(prof.materials, item.area)
  const gold = Number(prof.gold) || 0
  const short = { color: SHORT }
  return (
    <V2Modal title="🔨 装備の強化" color="#ffcc00" busy={busy}
      confirmLabel={cost ? `+${cost.next}にする` : '強化する'} cancelLabel="閉じる"
      onConfirm={err ? undefined : onEnhance} onClose={onClose}>
      <div>
        <RarityTag item={item} /><span style={{ color: nameColor(item) }}>{item.name}</span><PlusTag inv={inv} />
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（{kindLabel(item)}・LV{inv.ilv}）</span>
      </div>
      {cost ? (
        <>
          <div>強化値 +{plus} → <span style={{ color: PLUS_COLOR }}>+{cost.next}</span>
            <span style={{ color: TEXT.sub, fontSize:'11px' }}>（強さ {100 + plus * 10}% → {100 + cost.next * 10}%）</span>
          </div>
          <div>戦闘力 {now} → <span style={{ color:'#44ff88' }}>{powerAt(item, inv.ilv, cost.next)}</span>
            {pct < 100 && <span style={{ color: SHORT, fontSize:'11px' }}>（いまは効果{pct}%）</span>}
          </div>
          <div style={{ color: TEXT.sub, fontSize:'11px' }}>
            {statLine(statsAt(item, inv.ilv, pct, plus))}<br />→ {statLine(statsAt(item, inv.ilv, pct, cost.next))}
          </div>
          <div style={{ marginTop:'4px' }}>
            使うもの：<span style={have < cost.scrap ? short : { color:'#cfe2ff' }}>{scrapNameOf(item.area)} {cost.scrap}個</span>
            <span style={{ color: TEXT.sub, fontSize:'11px' }}>（持っている {have.toLocaleString()}）</span>
            ・<span style={gold < cost.gold ? short : { color:'#ffcc00' }}>Gold {cost.gold.toLocaleString()}</span>
            <span style={{ color: TEXT.sub, fontSize:'11px' }}>（持っている {gold.toLocaleString()}）</span>
          </div>
          <div>成功率 <span style={{ color: cost.rate >= 50 ? '#44ff88' : SHORT }}>{cost.rate}%</span></div>
          <div style={{ color: TEXT.sub, fontSize:'11px' }}>失敗すると残骸とGoldはなくなり、強化値はそのままです。</div>
          {err && <div style={short}>⚠ {err}</div>}
        </>
      ) : <div style={{ color: PLUS_COLOR }}>強化値は+{PLUS_MAX}（上限）です</div>}
      {msg && <div style={{ color: msg.ok ? '#44ff88' : SHORT, marginTop:'6px' }}>{msg.text}</div>}
    </V2Modal>
  )
}

// 分解の確認。何個・どのレア度・どの残骸がいくつ入るかを出す
function DismantleModal({ list, busy, onConfirm, onClose }) {
  const counts = RARITIES.map(r => [r, list.filter(x => x.item.rarity === r).length]).filter(([, n]) => n > 0)
  const enhanced = list.filter(x => plusOf(x.inv) > 0).length
  const one = list.length === 1 ? list[0] : null
  return (
    <V2Modal title="🔨 装備を分解する" color={SHORT} danger busy={busy}
      confirmLabel={`${list.length}個を分解する`} onConfirm={onConfirm} onClose={onClose}>
      {one
        ? <div><span style={{ color: nameColor(one.item) }}>{itemLabel(one.item)}</span><PlusTag inv={one.inv} />（LV{one.inv.ilv}）を分解します。</div>
        : <div>{list.length}個を分解します。</div>}
      <div style={{ color: TEXT.sub }}>
        {counts.map(([r, n]) => <span key={r} style={{ marginRight:'8px' }}><span style={{ color: RARITY_COLOR[r] }}>{rarityLabel(r)}</span> {n}</span>)}
      </div>
      <div>手に入る残骸：<span style={{ color:'#ffcc00' }}>{gainText(dismantleGainOf(list))}</span></div>
      {enhanced > 0 && <div style={{ color: SHORT }}>⚠ 強化した装備が{enhanced}個入っています（強化に使った残骸とGoldは戻りません）</div>}
      <div style={{ color: TEXT.sub }}>元には戻せません。</div>
    </V2Modal>
  )
}

// 作成の確認
function CraftModal({ item, prof, busy, onConfirm, onClose }) {
  const cost = craftCostOf(item)
  const pct = effectPct(item.lv, prof.lv)
  return (
    <V2Modal title="🔨 装備を作る" color="#ffaa44" busy={busy} confirmLabel="作る" onConfirm={onConfirm} onClose={onClose}>
      <div>
        <RarityTag item={item} /><span style={{ color: nameColor(item) }}>{item.name}</span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（{kindLabel(item)}・LV{item.lv}）</span>を作ります。
      </div>
      <ItemStats inv={{ ilv: item.lv, plus: 0 }} item={item} pct={pct} />
      <div>使うもの：<span style={{ color:'#cfe2ff' }}>{scrapNameOf(item.area)} {cost.scrap}個</span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（持っている {scrapOf(prof.materials, item.area).toLocaleString()}）</span>
        ・<span style={{ color:'#ffcc00' }}>Gold {cost.gold.toLocaleString()}</span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（持っている {(Number(prof.gold) || 0).toLocaleString()}）</span>
      </div>
      <div style={{ color: TEXT.sub, fontSize:'11px' }}>必ずできます。+0で持ち物に入ります。</div>
    </V2Modal>
  )
}
