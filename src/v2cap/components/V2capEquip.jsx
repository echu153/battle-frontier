import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import {
  ITEM_BY_ID, SLOTS, SLOT_LABEL, PARTS, RARITIES, ARMOR_EFFECT, RARITY_COLOR, slotsFor, kindLabel, partLabel, rarityLabel, itemLabel,
} from '../lib/equipment.js'
import { AREA_LIST } from '../lib/areas.js'
import { canEquipType, weaponsOf } from '../lib/jobs.js'
import { equippedItems, wornIdsOf } from '../lib/loadout.js'
import { powerAt, statsAt, effectPct } from '../lib/gear.js'
import {
  PLUS_MAX, plusOf, plusLabel, scrapNameOf, scrapOf, dismantleGainOf, bulkPickable, enhanceCostOf, enhanceErrorOf, SCRAP_NAMES,
} from '../lib/smith.js'

// ============================================================
// 「レベルキャップあり」版 — 装備（着脱・強化・分解と持ち物）
//   ・枠は7つ（武器1・頭・鎧・腕・足・アクセ2）。盾なし・武器は1本（2026-10-09 ユーザー決定）
//   ・武器は**いまの職業が装備できる種類だけ**着けられる（職業ごとに3種）
//   ・防具は重鎧（受けるダメージ−3%）／軽装（AGI+5%）。どの職業でも着けられる
//   ・装備は**アイテムLV**を持つ（＝必要LV）。足りなくても着けられるが、不足1LVごとに効果-5%（最低10%）
//   ・装備はエリアごとの一覧で、レア度（ノーマル・レア・エピック・レジェンダリー）を持つ。
//     ノーマルは名前だけ、ほかは【レア】のように頭に付けてレア度の色で出す
//   ・【確定】2026-10-10 強化と分解（smith.js）：強化はGoldとその装備のエリアの残骸で+10まで（失敗あり・下がらない）。
//     「捨てる」は分解に置き換えた。まとめて分解は「レア度で選ぶ」「1つずつ選ぶ」「表示中を全部選ぶ」の3通り
//     （まとめて選ぶときは、着けているものと強化したものは選ばない）
// ============================================================
const statLine = (s) => STAT_KEYS.filter(k => s[k] > 0).map(k => `${STAT_DEFS[k].label}+${s[k]}`).join(' ')
const nameColor = (item) => (item.rarity === 'N' ? '#88ccff' : RARITY_COLOR[item.rarity])
// レア度の印（ノーマルは付けない）
const RarityTag = ({ item }) => (item.rarity === 'N' ? null
  : <span style={{ color: RARITY_COLOR[item.rarity] }}>【{rarityLabel(item.rarity)}】</span>)
// 強化値の印（+0は付けない）
const PLUS_COLOR = '#ffcc00'
const PlusTag = ({ inv }) => (plusOf(inv) > 0 ? <span style={{ color: PLUS_COLOR }}> {plusLabel(plusOf(inv))}</span> : null)
const gainText = (gain) => Object.entries(gain).sort((a, b) => a[0] - b[0])
  .map(([a, n]) => `${scrapNameOf(Number(a))} +${n}`).join('・')
const chip = (on) => ({ ...miniBtn(on ? '#44aaff' : '#62789a'), color: on ? '#88ccff' : '#93a9be' })

export default function V2capEquip({ prof, inventory, onProfile }) {
  const [part, setPart] = useState('all')
  const [rarity, setRarity] = useState('all')
  const [area, setArea] = useState('all')
  const [sort, setSort] = useState('power')   // power / ilv / new
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')         // 分解した結果
  const [picked, setPicked] = useState(() => new Set())   // 分解に選んだ持ち物のID（文字列）
  const [confirm, setConfirm] = useState(null)     // 分解の確認 [{ inv, item }]
  const [smithId, setSmithId] = useState(null)     // 強化の画面を開いている持ち物のID
  const [smithMsg, setSmithMsg] = useState(null)   // 直前の強化の結果 { ok, text }

  const worn = equippedItems(prof, inventory)
  const wornIds = wornIdsOf(prof, inventory)
  const all = useMemo(() => (inventory || [])
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.base_id] }))
    .filter(r => r.item), [inventory])
  const rows = useMemo(() => {
    const list = all.filter(r => (part === 'all' || r.item.part === part)
      && (rarity === 'all' || r.item.rarity === rarity)
      && (area === 'all' || r.item.area === area))
    const pw = (r) => Math.round(powerAt(r.item, r.inv.ilv, plusOf(r.inv)) * effectPct(r.inv.ilv, prof.lv) / 100)
    if (sort === 'power') list.sort((a, b) => pw(b) - pw(a) || b.inv.ilv - a.inv.ilv)
    else if (sort === 'ilv') list.sort((a, b) => b.inv.ilv - a.inv.ilv || pw(b) - pw(a))
    else list.sort((a, b) => b.inv.id - a.inv.id)
    return list
  }, [all, part, rarity, area, sort, prof.lv])
  // 持っている装備のエリア（絞り込みの選択肢）
  const areas = useMemo(() => [...new Set([...all.map(r => r.item.area), ...(area === 'all' ? [] : [area])])].sort((a, b) => a - b), [all, area])
  // 分解に選んでいるもの（着けたものは外す）
  const pickedRows = all.filter(r => picked.has(String(r.inv.id)) && !wornIds.has(String(r.inv.id)))
  const materials = prof.materials || {}
  const owned = SCRAP_NAMES.map((name, i) => ({ area: i + 1, name, n: scrapOf(materials, i + 1) })).filter(m => m.n > 0)

  const call = async (fn, args) => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e || !data?.ok) { setBusy(false); setError(e?.message || data?.error || '失敗しました'); return null }
    await onProfile(null)
    setBusy(false)
    return data
  }
  const equip = (slot, inv) => call('v2cap_equip', { p_slot: slot, p_inventory_id: inv.id })
  const unequip = (slot) => call('v2cap_unequip', { p_slot: slot })

  // ===== 分解 =====
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const pickAll = (list) => setPicked(prev => new Set([...prev, ...list.filter(r => bulkPickable(r, wornIds)).map(r => String(r.inv.id))]))
  const dismantle = async () => {
    const list = confirm || []
    setNotice('')
    const data = await call('v2cap_dismantle', { p_ids: list.map(r => r.inv.id) })
    if (!data) return
    setNotice(`🔨 ${data.dismantled}個を分解しました${Object.keys(data.gained || {}).length ? `：${gainText(data.gained)}` : ''}`)
    setPicked(prev => new Set([...prev].filter(id => !list.some(r => String(r.inv.id) === id))))
    setConfirm(null)
  }

  // ===== 強化 =====
  const smithRow = smithId === null ? null : all.find(r => String(r.inv.id) === String(smithId)) || null
  const openSmith = (inv) => { setSmithId(String(inv.id)); setSmithMsg(null) }
  const enhance = async () => {
    if (!smithRow) return
    setBusy(true); setSmithMsg(null)
    const { data, error: e } = await supabase.rpc('v2cap_enhance', { p_inventory_id: smithRow.inv.id })
    if (e || !data?.ok) { setBusy(false); setSmithMsg({ ok: false, text: `⚠ ${e?.message || data?.error || '失敗しました'}` }); return }
    setSmithMsg(data.success
      ? { ok: true, text: `✨ 成功！ +${data.plus} になりました` }
      : { ok: false, text: `💥 失敗… +${data.plus} のまま（${scrapNameOf(data.area)} ${data.scrap}個と Gold ${Number(data.gold).toLocaleString()} はなくなりました）` })
    await onProfile(null)
    setBusy(false)
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {confirm && <DismantleModal list={confirm} busy={busy} onConfirm={dismantle} onClose={() => setConfirm(null)} />}
      {smithRow && (
        <SmithModal row={smithRow} prof={prof} busy={busy} msg={smithMsg}
          onEnhance={enhance} onClose={() => { if (!busy) { setSmithId(null); setSmithMsg(null) } }} />
      )}

      {/* 着けているもの */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🛡 装備中</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
          {prof.class}が装備できる武器は <span style={{ color:'#cfe2ff' }}>{weaponsOf(prof.class).join('・')}</span> です。
          防具は重鎧（{ARMOR_EFFECT.重鎧.label}）か軽装（{ARMOR_EFFECT.軽装.label}）を部位ごとに選べます（1部位ごと）。
          装備のLV（アイテムLV）が必要LVで、足りないと1LVごとに効果が5%下がります（最低10%）。
          強化すると+1ごとに強さが10%ずつ上がります（+{PLUS_MAX}まで）。
        </div>
        <div style={{ display:'grid', gap:'3px' }}>
          {SLOTS.map(slot => {
            const w = worn[slot]
            const pct = w ? effectPct(w.inv.ilv, prof.lv) : 100
            return (
              <div key={slot} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', flexWrap:'wrap' }}>
                <span style={{ color: TEXT.label, width:'52px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
                {w ? (
                  <>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      <RarityTag item={w.item} />
                      <span style={{ color: nameColor(w.item) }}>{w.item.name}</span>
                      <PlusTag inv={w.inv} />
                      <span style={{ color: w.inv.ilv > prof.lv ? '#ff8844' : TEXT.sub }}> LV{w.inv.ilv}</span>
                      {pct < 100 && <span style={{ color:'#ff8844' }}> 効果{pct}%</span>}
                    </span>
                    <span style={{ color: TEXT.sub, fontSize:'10px' }}>{statLine(statsAt(w.item, w.inv.ilv, pct, plusOf(w.inv)))}</span>
                    <button onClick={() => openSmith(w.inv)} disabled={busy} style={miniBtn('#ffcc00')}>強化</button>
                    <button onClick={() => unequip(slot)} disabled={busy} style={miniBtn('#aa5566')}>外す</button>
                  </>
                ) : <span style={{ color: TEXT.empty }}>—</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* 残骸 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🧱 残骸（強化に使う）</div>
        {owned.length === 0
          ? <div style={{ color: TEXT.label, fontSize:'10px' }}>まだありません。装備を分解すると、その装備のエリアの残骸が手に入ります（ノーマル1・レア5・エピック10・レジェンダリー25）</div>
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

      {/* 持ち物 */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎒 持っている装備（{all.length}）</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'4px' }}>
          {['all', ...PARTS].map(p => (
            <button key={p} onClick={() => setPart(p)} style={chip(part === p)}>{p === 'all' ? 'すべて' : partLabel(p)}</button>
          ))}
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'4px', alignItems:'center' }}>
          {['all', ...RARITIES].map(r => (
            <button key={r} onClick={() => setRarity(r)}
              style={r !== 'all' && rarity === r ? { ...miniBtn(RARITY_COLOR[r]), color: RARITY_COLOR[r] } : chip(rarity === r)}>
              {r === 'all' ? 'すべてのレア度' : rarityLabel(r)}
            </button>
          ))}
          <select value={area} onChange={e => setArea(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={{ background:'#000818', border:'1px solid #62789a', color:'#93a9be', fontFamily:'monospace', fontSize:'10px', padding:'2px 4px' }}>
            <option value="all">すべてのエリア</option>
            {areas.map(a => <option key={a} value={a}>{a} {AREA_LIST[a - 1]?.name}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'8px', fontSize:'10px', color: TEXT.label, flexWrap:'wrap' }}>
          <span>並べ替え</span>
          {[['power', '強い順'], ['ilv', 'LVの高い順'], ['new', '新しい順']].map(([k, label]) => (
            <button key={k} onClick={() => setSort(k)} style={chip(sort === k)}>{label}</button>
          ))}
        </div>

        {/* まとめて分解 */}
        <div style={{ background:'#000818', border:'1px solid #553322', padding:'7px 8px', marginBottom:'8px', fontSize:'10px' }}>
          <div style={{ color:'#ff9966', marginBottom:'5px' }}>🔨 分解（その装備のエリアの残骸になる）</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center', marginBottom:'5px' }}>
            <span style={{ color: TEXT.label }}>まとめて選ぶ</span>
            {RARITIES.map(r => {
              const list = all.filter(x => x.item.rarity === r && bulkPickable(x, wornIds))
              return (
                <button key={r} onClick={() => pickAll(list)} disabled={busy || list.length === 0}
                  style={{ ...miniBtn(list.length ? RARITY_COLOR[r] : '#62789a'), color: list.length ? RARITY_COLOR[r] : TEXT.empty }}>
                  {rarityLabel(r)}を全部（{list.length}）
                </button>
              )
            })}
            <button onClick={() => pickAll(rows)} disabled={busy || rows.length === 0} style={miniBtn('#88ccff')}>表示中をすべて</button>
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

        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
        {notice && <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'6px' }}>{notice}</div>}
        <div style={{ display:'grid', gap:'4px', maxHeight:'520px', overflowY:'auto' }}>
          {rows.length === 0 && (
            <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>
              {all.length === 0 ? '装備がありません（出撃で勝つと落ちることがあります。ふつうの敵は3%・レアとボスは10%）' : 'この絞り込みに当てはまる装備はありません'}
            </div>
          )}
          {rows.map(({ inv, item }) => {
            const pct = effectPct(inv.ilv, prof.lv)
            const plus = plusOf(inv)
            const isWorn = wornIds.has(String(inv.id))
            const isPicked = !isWorn && picked.has(String(inv.id))
            const usable = item.part !== '武器' || canEquipType(prof.class, item.type)
            const effect = item.line ? ARMOR_EFFECT[item.line]?.label : null
            const power = powerAt(item, inv.ilv, plus)
            return (
              <div key={inv.id} style={{ background: isPicked ? '#1a0c08' : '#000818', border:`1px solid ${isPicked ? '#aa5533' : isWorn ? '#0055aa' : '#002244'}`, padding:'6px 8px', opacity: usable ? 1 : 0.6 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                  <input type="checkbox" checked={isPicked} disabled={isWorn || busy} onChange={() => toggle(String(inv.id))}
                    title={isWorn ? '着けている装備は分解できません' : '分解に選ぶ'} style={{ accentColor:'#ff8844', margin:0, flexShrink:0 }} />
                  <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
                    <RarityTag item={item} />{item.name}<PlusTag inv={inv} />
                    <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
                    {effect && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{effect}</span>}
                    {isWorn && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>装備中</span>}
                  </span>
                  <span style={{ color: inv.ilv > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px' }}>LV{inv.ilv}</span>
                </div>
                <div style={{ fontSize:'10px', color: TEXT.sub, margin:'3px 0', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  <span>戦闘力 {power}{pct < 100 && <span style={{ color:'#ff8844' }}> → {Math.round(power * pct / 100)}（効果{pct}%・必要LVまであと{inv.ilv - prof.lv}）</span>}</span>
                  <span>{statLine(statsAt(item, inv.ilv, pct, plus))}</span>
                </div>
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', alignItems:'center' }}>
                  {usable
                    ? slotsFor(item).map(slot => (
                      <button key={slot} onClick={() => equip(slot, inv)} disabled={busy || String(prof.equipped?.[slot]) === String(inv.id)}
                        style={miniBtn('#44aaff')}>{SLOT_LABEL[slot]}に着ける</button>
                    ))
                    : <span style={{ color:'#c69a5c', fontSize:'10px' }}>{prof.class}は{item.type}を装備できない</span>}
                  <button onClick={() => openSmith(inv)} disabled={busy} style={miniBtn('#ffcc00')}>{plus >= PLUS_MAX ? `+${PLUS_MAX}（上限）` : '強化'}</button>
                  {!isWorn && <button onClick={() => setConfirm([{ inv, item }])} disabled={busy} style={miniBtn('#aa5566')}>分解</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// 分解の確認。何個・どのレア度・どの残骸がいくつ入るかを出す
function DismantleModal({ list, busy, onConfirm, onClose }) {
  const counts = RARITIES.map(r => [r, list.filter(x => x.item.rarity === r).length]).filter(([, n]) => n > 0)
  const enhanced = list.filter(x => plusOf(x.inv) > 0).length
  const one = list.length === 1 ? list[0] : null
  return (
    <V2Modal title="🔨 装備を分解する" color="#ff8844" danger busy={busy}
      confirmLabel={`${list.length}個を分解する`} onConfirm={onConfirm} onClose={onClose}>
      {one
        ? <div><span style={{ color: nameColor(one.item) }}>{itemLabel(one.item)}</span><PlusTag inv={one.inv} />（LV{one.inv.ilv}）を分解します。</div>
        : <div>{list.length}個を分解します。</div>}
      <div style={{ color: TEXT.sub }}>
        {counts.map(([r, n]) => <span key={r} style={{ marginRight:'8px' }}><span style={{ color: RARITY_COLOR[r] }}>{rarityLabel(r)}</span> {n}</span>)}
      </div>
      <div>手に入る残骸：<span style={{ color:'#ffcc00' }}>{gainText(dismantleGainOf(list))}</span></div>
      {enhanced > 0 && <div style={{ color:'#ff8844' }}>⚠ 強化した装備が{enhanced}個入っています（強化に使った残骸とGoldは戻りません）</div>}
      <div style={{ color: TEXT.sub }}>元には戻せません。</div>
    </V2Modal>
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
  const short = { color:'#ff8844' }
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
            {pct < 100 && <span style={{ color:'#ff8844', fontSize:'11px' }}>（いまは効果{pct}%）</span>}
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
          <div>成功率 <span style={{ color: cost.rate >= 50 ? '#44ff88' : '#ff8844' }}>{cost.rate}%</span></div>
          <div style={{ color: TEXT.sub, fontSize:'11px' }}>失敗すると残骸とGoldはなくなり、強化値はそのままです。</div>
          {err && <div style={short}>⚠ {err}</div>}
        </>
      ) : <div style={{ color: PLUS_COLOR }}>強化値は+{PLUS_MAX}（上限）です</div>}
      {msg && <div style={{ color: msg.ok ? '#44ff88' : '#ff8844', marginTop:'6px' }}>{msg.text}</div>}
    </V2Modal>
  )
}
