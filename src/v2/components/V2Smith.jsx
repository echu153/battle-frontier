import { useState } from 'react'
import { supabase } from '../../supabase'
import { ITEM_BY_ID, powerOf, statsOf, PLUS_MAX, socketCountOf, handsLabel, handsColor } from '../lib/equipment.js'
import { STAT_KEYS, STAT_DEFS } from '../lib/stats.js'
import { wornIdsOf } from '../lib/loadout.js'
import { COLOR_HEX, COLOR_LABEL } from '../lib/material.js'
import {
  ratesFor, checkPick, fuseCostOf, MAT_COUNT, RESULT_LABEL, RESULT_COLOR, RESULT_UP,
  PROTECT_NAME, PROTECT_DESC,
} from '../lib/smith.js'
import { filterRows, sortRows, pageOf, clampPage, defaultFilter } from '../lib/browse.js'
import { box, btn, miniBtn, RANK_COLOR } from './v2ui.js'
import { useStored } from '../lib/prefs.js'
import { V2Filter, V2Pager } from './V2Browse.jsx'
import V2Modal from './V2Modal.jsx'
import V2Help from './V2Help.jsx'
import V2Enchant from './V2Enchant.jsx'

// 鍛冶屋。「強化」と「エンチャント」の2枚看板で、タブで切り替える。
//
// 強化の流れ（2026-08-16 に作り直し）：
//   ① 持っている装備の一覧（種類ごと）から1つ選ぶ
//   ② その装備の**持っている個体**が並ぶので、強化元を1個選ぶ
//   ③ 同じ強化値の個体から強化素材を2個選ぶ
// ★強化元は成功しても失敗しても残る。消えるのは強化素材2個だけ。
//   前は3個まとめて溶けて新しい1個ができる方式だったが、それだと
//   ルーン入り・ソケット厳選の装備がどれか分からないまま消えていた。
// ★ルーンが入っている個体には印を付けて、素材に選ぶと警告を出す。
export default function V2Smith({ prof, inventory, materials, runes, isAdmin, onProfile, onBack }) {
  // ★どちらのタブを見ていたか・絞り込みは覚えておく
  const [menu, setMenu] = useStored('smithTab', 'fuse')   // fuse=強化 / enchant=エンチャント
  const [openEquip, setOpenEquip] = useState('')  // 個体一覧を開いている装備ID
  const [filter, setFilter] = useStored('smithFilter', defaultFilter, true)
  const [rawPage, setRawPage] = useState(0)            // ページ（0始まり）
  const [baseId, setBaseId] = useState(null)      // 強化元
  const [matIds, setMatIds] = useState([])        // 強化素材（2個）
  const [protect, setProtect] = useState(false)   // 守りの護符を使う
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState(null)

  const wornIds = wornIdsOf(prof, inventory)
  const protectHave = prof?.protect_count || 0

  // その個体に入っているルーン
  const essOf = (invId) => (runes || []).filter(e => String(e.inv_id) === String(invId))

  // 種類ごとにまとめた一覧（同じ装備なら＋違いも1つの見出しに入る）
  const all = []
  const byEquip = new Map()
  for (const inv of inventory || []) {
    const item = ITEM_BY_ID[inv.equip_id]
    if (!item) continue
    let k = byEquip.get(inv.equip_id)
    if (!k) { k = { equipId: inv.equip_id, item, list: [], plus: 0, count: 0, power: 0 }; byEquip.set(inv.equip_id, k); all.push(k) }
    k.list.push(inv)
  }
  for (const k of all) {
    k.list.sort((a, b) => (b.plus || 0) - (a.plus || 0) || a.id - b.id)
    k.plus  = k.list[0].plus || 0      // いちばん強化されている個体の値（並べ替え・絞り込み用）
    k.count = k.list.length
    k.power = powerOf(k.item, k.plus)
  }
  // ★絞り込みと並べ替えは倉庫と同じ（browse.js）。強化値は個体の最大で見る
  const filtered = sortRows(filterRows(all, filter), filter.sort, filter.asc)
  const page = clampPage(rawPage, filtered.length)
  const kinds = pageOf(filtered, page)

  const opened = byEquip.get(openEquip) || null
  const base = (inventory || []).find(i => i.id === baseId) || null
  const baseItem = base ? ITEM_BY_ID[base.equip_id] : null
  const mats = matIds.map(id => (inventory || []).find(i => i.id === id)).filter(Boolean)
  const rate = baseItem ? ratesFor(baseItem.rank, protect) : null
  // ★強化にはGoldが要る（2026-08-22 ユーザー決定）。成否にかかわらず取られる
  const cost = baseItem ? fuseCostOf(baseItem.rank, base.plus || 0) : 0
  const poor = cost > Number(prof?.gold || 0)
  const pickError = base
    ? (checkPick({ base, mats, plusMax: PLUS_MAX, wornIds })
       || (poor ? `Goldが足りません（${cost.toLocaleString()}G必要）` : ''))
    : ''
  // 素材に選べる個体＝強化元と同じ強化値・装備中でない・強化元そのものでない
  const candidates = base
    ? (opened?.list || []).filter(i => i.id !== base.id && (i.plus || 0) === (base.plus || 0) && !wornIds.has(String(i.id)))
    : []
  const matHasRune = mats.some(m => essOf(m.id).length > 0)

  const reset = () => { setBaseId(null); setMatIds([]); setProtect(false); setMsg(null) }
  const openKind = (equipId) => {
    setOpenEquip(cur => (cur === equipId ? '' : equipId))
    reset()
  }
  const chooseBase = (inv) => { setBaseId(inv.id); setMatIds([]); setMsg(null) }
  const toggleMat = (inv) => {
    setMsg(null)
    setMatIds(cur => cur.includes(inv.id) ? cur.filter(x => x !== inv.id)
      : cur.length >= MAT_COUNT ? cur : [...cur, inv.id])
  }

  // ★開発限定。護符の入手方法が決まるまでの仮の配り口（サーバー側でも is_admin を見ている）
  const grantProtect = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('v2_debug_grant_protect', { p_count: 5 })
    setBusy(false)
    if (error || !data?.ok) { setMsg({ text: error?.message || data?.error || '失敗しました', color:'#ff6666' }); return }
    onProfile(null)
  }

  const fuse = async () => {
    if (pickError || busy) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('v2_fuse', {
      p_base: base.id, p_mat_a: mats[0].id, p_mat_b: mats[1].id, p_protect: protect,
    })
    setBusy(false); setConfirm(false)
    if (error) { setMsg({ text: error.message, color:'#ff6666' }); return }
    if (!data?.ok) { setMsg({ text: data?.error || '強化に失敗しました', color:'#ff6666' }); return }
    // ★どれだけ伸びたかを出すため、強化前の値もいっしょに残しておく
    setResult({ ...data, name: baseItem.name, item: baseItem, fromPlus: base.plus || 0 })
    setMatIds([])
    onProfile(null)
  }

  // 個体1行
  const invRow = (inv) => {
    const item = ITEM_BY_ID[inv.equip_id]
    const es = essOf(inv.id)
    const isBase = base?.id === inv.id
    const isMat = matIds.includes(inv.id)
    const isWorn = wornIds.has(String(inv.id))
    const selectable = !base ? true : candidates.some(c => c.id === inv.id)
    const on = isBase || isMat
    return (
      <button key={inv.id}
        onClick={() => (base ? (isBase ? reset() : selectable && toggleMat(inv)) : chooseBase(inv))}
        disabled={base && !isBase && !selectable}
        style={{ display:'block', width:'100%', textAlign:'left', marginBottom:'3px', padding:'6px 8px',
          background: on ? '#002850' : '#000818',
          border:`1px solid ${isBase ? '#44ff88' : isMat ? '#ffcc00' : '#002244'}`,
          color:'#88ccff', fontFamily:'monospace', fontSize:'11px',
          opacity: (base && !isBase && !selectable) ? 0.35 : 1,
          cursor: (base && !isBase && !selectable) ? 'not-allowed' : 'pointer' }}>
        <span style={{ color:'#7fa6d0', fontSize:'9px' }}>#{inv.id}</span>{' '}
        {item.name}{inv.plus ? <span style={{ color:'#ffcc00' }}>+{inv.plus}</span> : ''}
        <span style={{ color:'#7fa6d0' }}>　戦闘力{powerOf(item, inv.plus || 0)}</span>
        {isWorn && <span style={{ color:'#44ff88', fontSize:'9px' }}>　装備中</span>}
        {es.length > 0 && (
          <span style={{ fontSize:'9px' }}>
            {'　'}
            {es.map(e => (
              <span key={e.id} style={{ color: COLOR_HEX[e.color], marginRight:'3px' }}>
                ●{COLOR_LABEL[e.color]}{e.ability ? `★${e.ability}` : ''}
              </span>
            ))}
          </span>
        )}
        {socketCountOf(item) > 0 && es.length === 0 && (
          <span style={{ color:'#62789a', fontSize:'9px' }}>　ソケット{socketCountOf(item)}（空）</span>
        )}
        {isBase && <span style={{ color:'#44ff88', fontSize:'9px' }}>　← 強化元</span>}
        {isMat && <span style={{ color:'#ffcc00', fontSize:'9px' }}>　← 強化素材</span>}
      </button>
    )
  }

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      {/* 鍛冶屋でできること。強化とエンチャントをここで切り替える */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'10px' }}>
        {[{ key:'fuse', label:'🔨 強化', color:'#ffcc00' }, { key:'enchant', label:'⚗ エンチャント', color:'#cc88ff' }].map(t => (
          <button key={t.key} onClick={() => { setMenu(t.key); setMsg(null) }}
            style={{ ...miniBtn(menu === t.key ? t.color : '#7fa6d0'), padding:'7px 14px', fontSize:'12px',
              background: menu === t.key ? '#002850' : '#000818' }}>
            {t.label}
          </button>
        ))}
      </div>

      {menu === 'enchant' && (
        <V2Enchant prof={prof} inventory={inventory} materials={materials} runes={runes}
          isAdmin={isAdmin} onRefresh={onProfile} onBack={onBack} embedded />
      )}

      {menu === 'fuse' && (<>
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
          <span style={{ color:'#ffcc00', fontSize:'13px' }}>🔨 強化</span>
          <V2Help id="smith" />
        </div>
        <div style={{ color:'#93a9be', fontSize:'10px', lineHeight:1.8 }}>
          <b style={{ color:'#44ff88' }}>強化元1個</b>に、同じ装備・同じ強化値の
          <b style={{ color:'#ffcc00' }}>強化素材{MAT_COUNT}個</b>を使って強化値を上げます（上限+{PLUS_MAX}）。<br />
          <b style={{ color:'#44ff88' }}>強化元は失敗しても残ります</b>。消えるのは強化素材{MAT_COUNT}個だけです。<br />
          強化値が1つ上がるごとに装備の戦闘力は<b style={{ color:'#ffcc00' }}>1.5倍</b>。ランクが高いほど上がりにくくなります。
        </div>
        {/* ★開発限定。護符の入手方法が決まるまでの仮の配り口 */}
        {isAdmin && (
          <button onClick={grantProtect} disabled={busy}
            style={{ ...miniBtn('#88ddaa'), marginTop:'8px' }}>
            [開発] 🛡 {PROTECT_NAME}を5個もらう（所持 {protectHave}個）
          </button>
        )}
      </div>

      {/* ① 持っている装備。②③は開いた装備のすぐ下に出す
          （前は強化ボタンが一覧の下にあり、選ぶたびに画面の端まで動く必要があった） */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <V2Filter value={filter} rows={all} onChange={f => { setFilter(f); setRawPage(0) }} />
        {all.length === 0 && <div style={{ color:'#7fa6d0', fontSize:'11px' }}>まだ持っていません（出撃で手に入ります）</div>}
        {all.length > 0 && filtered.length === 0 && (
          <div style={{ color:'#7fa6d0', fontSize:'11px' }}>絞り込みに合う装備がありません</div>
        )}
        {kinds.map(k => (
          <div key={k.equipId}>
            <button onClick={() => openKind(k.equipId)}
              style={{ display:'block', width:'100%', textAlign:'left', marginBottom:'3px', padding:'6px 8px',
                background: openEquip === k.equipId ? '#002850' : '#000818',
                border:`1px solid ${openEquip === k.equipId ? '#00aaff' : '#002244'}`,
                color:'#88ccff', fontFamily:'monospace', fontSize:'11px', cursor:'pointer' }}>
              <span style={{ color: RANK_COLOR[k.item.rank] }}>{k.item.rank}</span>
              {' '}{k.item.name}
              <span style={{ color:'#7fa6d0' }}>　×{k.count}個　{k.item.type}</span>
              {/* ★武器は持ち方も出す（強化元を選ぶときに片手か両手か分かるように） */}
              {handsLabel(k.item) && (
                <span style={{ color: handsColor(k.item) }}>　{handsLabel(k.item)}</span>
              )}
              <span style={{ color:'#7fa6d0', float:'right' }}>{openEquip === k.equipId ? '▲' : '▼'}</span>
            </button>

            {/* ② その装備の個体一覧 → ③ そのまま下で強化まで終わらせる */}
            {openEquip === k.equipId && (
              <div style={{ padding:'4px 0 8px 12px' }}>
                <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'4px' }}>
                  {base
                    ? `強化素材を${MAT_COUNT}個選んでください（あと${MAT_COUNT - mats.length}個）／強化元をもう一度押すと選び直し`
                    : '強化元にする1個を選んでください'}
                </div>
                {k.list.map(invRow)}
                {base && candidates.length === 0 && (
                  <div style={{ color:'#ff8844', fontSize:'10px' }}>
                    同じ強化値（+{base.plus || 0}）の予備がありません
                  </div>
                )}

                {base && baseItem && (
                  <div style={{ border:'1px solid #0044aa', background:'#000c1c', padding:'10px', marginTop:'6px' }}>
                    <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', fontSize:'11px', marginBottom:'8px' }}>
                      <span style={{ color: RESULT_COLOR.ok }}>成功 {rate.ok}%（+1）</span>
                      <span style={{ color: rate.great ? RESULT_COLOR.great : '#62789a' }}>大成功 {rate.great}%（+2）</span>
                      <span style={{ color: rate.super ? RESULT_COLOR.super : '#62789a' }}>超大成功 {rate.super}%（+3）</span>
                      <span style={{ color: rate.fail ? RESULT_COLOR.fail : '#7fa6d0' }}>失敗 {rate.fail}%</span>
                    </div>

                    {/* 守りの護符 */}
                    <label style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px',
                      color: protectHave > 0 ? '#88ddaa' : '#62789a', fontSize:'11px',
                      cursor: protectHave > 0 ? 'pointer' : 'not-allowed' }}>
                      <input type="checkbox" checked={protect} disabled={protectHave <= 0}
                        onChange={e => setProtect(e.target.checked)} />
                      🛡 {PROTECT_NAME}を使う<span style={{ color:'#7fa6d0' }}>（所持 {protectHave}個）</span>
                    </label>
                    <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>{PROTECT_DESC}</div>

                    {matHasRune && (
                      <div style={{ color:'#ff8844', fontSize:'11px', marginBottom:'8px' }}>
                        ⚠ 強化素材にルーンの入った装備が含まれています（消えるとルーンは外れます）
                      </div>
                    )}
                    {pickError && <div style={{ color:'#7f95c4', fontSize:'11px', marginBottom:'8px' }}>{pickError}</div>}

                    <button onClick={() => setConfirm(true)} disabled={!!pickError || busy}
                      style={{ ...btn(pickError ? '#62789a' : '#ffcc00'), width:'100%',
                        color: pickError ? '#445566' : '#ffcc00', cursor: pickError ? 'not-allowed' : 'pointer' }}>
                      🔨 {baseItem.name}{base.plus ? `+${base.plus}` : ''}（#{base.id}）を強化する
                      <span style={{ color: poor ? '#ff6666' : '#7fa6d0' }}>　{cost.toLocaleString()}G</span>
                    </button>
                    {msg && <div style={{ marginTop:'8px', fontSize:'12px', color: msg.color }}>{msg.text}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <V2Pager page={page} total={filtered.length} onPage={setRawPage} unit="種" />
      </div>
      {!base && msg && <div style={{ ...box, padding:'12px', fontSize:'12px', color: msg.color }}>{msg.text}</div>}

      {/* 強化前の確認 */}
      {confirm && base && baseItem && (
        <V2Modal title="🔨 強化の確認" color="#ffcc00" danger busy={busy}
          confirmLabel="強化する" onConfirm={fuse} onClose={() => !busy && setConfirm(false)}>
          <div style={{ color:'#44ff88' }}>
            強化元　{baseItem.name}{base.plus ? `+${base.plus}` : ''}
            <span style={{ color:'#7fa6d0' }}>（#{base.id}）</span>
          </div>
          <div style={{ color:'#ffcc00' }}>
            強化素材　{mats.map(m => `#${m.id}`).join('・')}
            <span style={{ color:'#7fa6d0' }}>　→ {protect ? '失敗しても残ります' : '失敗すると消えます'}</span>
          </div>
          <div style={{ color:'#ffcc00' }}>
            費用　{cost.toLocaleString()}G
            <span style={{ color:'#7fa6d0' }}>　→ 成否にかかわらず取られます（所持 {Number(prof?.gold || 0).toLocaleString()}G）</span>
          </div>
          <div style={{ color:'#93a9be', fontSize:'11px', marginTop:'6px' }}>
            戦闘力 {powerOf(baseItem, base.plus || 0)} → {powerOf(baseItem, (base.plus || 0) + 1)}（成功時）
          </div>
          <div style={{ marginTop:'6px', fontSize:'11px' }}>
            <div style={{ color:'#88ccff' }}>
              成功 {rate.ok}%（+1）{rate.great ? `／大成功 ${rate.great}%（+2）` : ''}{rate.super ? `／超大成功 ${rate.super}%（+3）` : ''}
            </div>
            <div style={{ color: rate.fail ? '#ff6666' : '#7fa6d0' }}>
              失敗 {rate.fail}%
              {rate.fail
                ? protect ? '　→ 何も消えません' : `　→ 強化素材${MAT_COUNT}個が消えます`
                : '　→ このランクは失敗しません'}
            </div>
          </div>
          {protect && (
            <div style={{ color:'#88ddaa', fontSize:'11px', marginTop:'6px' }}>
              🛡 {PROTECT_NAME}を1個使います（残り{protectHave - 1}個）。大成功・超大成功は出ません。
            </div>
          )}
          {matHasRune && (
            <div style={{ color:'#ff8844', fontSize:'11px', marginTop:'6px' }}>
              ⚠ 強化素材にルーンの入った装備があります。消えるとルーンは外れます。
            </div>
          )}
        </V2Modal>
      )}

      {/* 強化後の結果 */}
      {result && (
        <V2Modal title={result.result === 'fail' ? '💥 強化失敗' : '✨ 強化成功'}
          color={RESULT_COLOR[result.result]} onClose={() => setResult(null)}>
          <div style={{ color: RESULT_COLOR[result.result], fontSize:'14px' }}>
            {RESULT_LABEL[result.result]}
            {result.result !== 'fail' && `！ +${RESULT_UP[result.result]}`}
          </div>
          {result.result === 'fail' ? (
            <div style={{ color:'#88ccff', marginTop:'4px' }}>
              {result.name}<span style={{ color:'#ffcc00' }}>+{result.plus}</span> は無事だった
              <div style={{ color:'#7fa6d0', fontSize:'11px' }}>
                {result.protected ? `🛡 ${PROTECT_NAME}が強化素材を守った` : `強化素材${MAT_COUNT}個が消えた`}
              </div>
            </div>
          ) : (
            <div style={{ color:'#88ccff', marginTop:'4px' }}>
              {result.name}<span style={{ color:'#ffcc00' }}>+{result.plus}</span> になった！
              {/* ★どのステータスがどれだけ伸びたか。装備の数値は equipment.js が正 */}
              <div style={{ marginTop:'6px', fontSize:'11px' }}>
                <div style={{ color:'#7fa6d0' }}>
                  戦闘力 {powerOf(result.item, result.fromPlus)} →{' '}
                  <span style={{ color:'#ffcc00' }}>{powerOf(result.item, result.plus)}</span>
                  <span style={{ color:'#44ff88' }}>
                    {' '}(+{powerOf(result.item, result.plus) - powerOf(result.item, result.fromPlus)})
                  </span>
                </div>
                {(() => {
                  const before = statsOf(result.item, result.fromPlus)
                  const after = statsOf(result.item, result.plus)
                  return STAT_KEYS.filter(k => after[k] || before[k]).map(k => (
                    <div key={k} style={{ color:'#93a9be' }}>
                      {STAT_DEFS[k].label} {before[k]} → <span style={{ color:'#88ccff' }}>{after[k]}</span>
                      <span style={{ color:'#44ff88' }}> (+{after[k] - before[k]})</span>
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}
        </V2Modal>
      )}
      </>)}
    </div>
  )
}
