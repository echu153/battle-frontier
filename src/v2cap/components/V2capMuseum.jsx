import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import { chip } from './v2capGearView.js'
import { RARITIES, RARITY_COLOR, ITEM_BY_ID, rarityLabel, kindLabel } from '../lib/equipment.js'
import { plusOf, plusLabel } from '../lib/smith.js'
import {
  MUSEUM_TIERS, MUSEUM_GROUPS, raritiesOfGroup, registeredSetOf, tiersOf, uniqueHidden, museumCountOf, donatablesOf,
  bulkDonatable, donatedTail,
} from '../lib/museum.js'

// ============================================================
// 「レベルキャップあり」版 — 博物館（装備の寄贈）。決まりの正は src/v2cap/lib/museum.js・サーバーは SQL §14
//   【確定】2026-10-22 ユーザー指示「V1にあるような装備を寄贈する博物館を作成したい／
//     登録時に能力もらえるけど詳細はあとで作成する、とりあえず土台だけ作って」
//   ・上：説明と登録数（段階ごと）。登録でもらえる能力は「準備中」
//   ・寄贈できる装備（持ち物のうち、着けていない・+0／+5／+9・まだ登録していない段階のもの）→「寄贈」→確認のポップアップ（装備はなくなる）
//   ・登録の一覧：エリア1〜15・ユニーク のタブ。装備ごとに 未強化／+5／+9 の印（登録した段階は色つき）
//   【確定】2026-10-23 ユーザー指示（実機を見て）：
//   ・寄贈したあとに、もう1つポップアップ「「ブロンズダガー」を寄贈しました（未強化で登録）」（一括寄贈は寄贈した数と1行ずつ）
//   ・一括寄贈：チェックで選ぶ・レア度ごとに「全部」・選んだぶんを寄贈（鍛冶屋のまとめての分解と同じ形。
//     まとめて選ぶときはユニークを入れない＝チェックで1つずつなら選べる）
//   ・ユニークは、どの段階も寄贈していないものは名前を「？？？」に
// ============================================================
const tierBadge = (t, on = true) => ({
  fontSize:'9px', padding:'0 4px', border:`1px solid ${on ? t.color : '#223a5e'}`, color: on ? t.color : TEXT.empty, flexShrink:0,
})
const rowKey = (d) => `${d.item.id}|${d.tier}`
// size … 装備名だけの文字の大きさ（1つずつの寄贈の確認＝2026-10-23 ユーザー指示「装備の名前見やすくするようにフォントの大きさ大きく」「装備名だけね」）
const NameLine = ({ d, size }) => (
  <>
    <span style={{ color: RARITY_COLOR[d.item.rarity], ...(size ? { fontSize: size } : null) }}>{d.item.name}</span>
    {plusOf(d.inv) > 0 && <span style={{ color:'#ffcc00' }}> {plusLabel(plusOf(d.inv))}</span>}
  </>
)

export default function V2capMuseum({ prof, inventory, onProfile }) {
  const [rows, setRows] = useState(null)          // 登録の記録 [{ base_id, tier, plus }]。読み込み中は null
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)    // 寄贈の確認 [{ inv, item, tier, copies }]（1つでも一括でも配列）
  const [result, setResult] = useState(null)      // 寄贈の結果 { ok, items: [{ name, rarity, tier }], skipped } ／ 失敗は { ok:false, error }
  const [picked, setPicked] = useState(() => new Set())   // 一括寄贈に選んだ行（rowKey）
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
  const pickedRows = donatables.filter(d => picked.has(rowKey(d)))
  const total = museumCountOf(rows || [])
  const group = MUSEUM_GROUPS.find(g => g.key === groupKey) || MUSEUM_GROUPS[0]
  const groupCount = museumCountOf(rows || [], group.items)

  const toggle = (key) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const pickAll = (list) => setPicked(prev => new Set([...prev, ...list.filter(bulkDonatable).map(rowKey)]))

  const donate = async () => {
    const list = confirm || []
    if (!list.length || busy) return
    setBusy(true)
    const many = list.length > 1
    const { data, error: e } = many
      ? await supabase.rpc('v2cap_museum_donate_many', { p_ids: list.map(d => d.inv.id) })
      : await supabase.rpc('v2cap_museum_donate', { p_inventory_id: list[0].inv.id })
    setBusy(false); setConfirm(null)
    if (e || !data?.ok) { setResult({ ok: false, error: e?.message || data?.error || '寄贈できませんでした' }); return }
    const done = many ? (data.donated || []) : [{ base_id: data.base_id, tier: data.tier, plus: data.plus }]
    const itemOf = (id) => ITEM_BY_ID[id] || list.find(d => d.item.id === id)?.item || { name: id, rarity: 'N' }
    setResult({ ok: true, items: done.map(x => ({ name: itemOf(x.base_id).name, rarity: itemOf(x.base_id).rarity, tier: x.tier })),
      skipped: many ? data.skipped || 0 : 0 })
    setRows(r => [...(r || []), ...done])
    setPicked(new Set())
    onProfile?.()   // 持ち物を読み直す（寄贈した装備はなくなる）
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {confirm && (
        <V2Modal title="🏺 装備を寄贈する" color="#d8b070" busy={busy} confirmLabel={confirm.length > 1 ? `${confirm.length}個を寄贈する` : '寄贈する'}
          onConfirm={donate} onClose={() => setConfirm(null)}>
          {confirm.length === 1 ? (
            <>
              <div><NameLine d={confirm[0]} size="16px" /><span style={{ color: TEXT.sub }}>（{kindLabel(confirm[0].item)}）</span></div>
              <div>登録する段階：<span style={{ color: MUSEUM_TIERS[confirm[0].tier].color }}>{MUSEUM_TIERS[confirm[0].tier].label}</span></div>
            </>
          ) : (
            <>
              <div>{confirm.length}個を寄贈します</div>
              {/* 一括のときも装備名だけ大きく（2026-10-23 ユーザー指示「複数選択したときの装備名が大きくなってない」） */}
              <div style={{ maxHeight:'260px', overflowY:'auto', margin:'4px 0', fontSize:'11px' }}>
                {confirm.map(d => (
                  <div key={rowKey(d)} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'1px 0' }}>
                    <span style={tierBadge(MUSEUM_TIERS[d.tier])}>{MUSEUM_TIERS[d.tier].label}</span>
                    <span><NameLine d={d} size="16px" /></span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ color:'#ff8844', marginTop:'6px' }}>寄贈した装備はなくなります（元に戻せません）</div>
        </V2Modal>
      )}
      {/* 寄贈の結果（2026-10-23 ユーザー指示「この画面の後に、さらにポップアップ出て」） */}
      {result && (
        <V2Modal title={result.ok ? '🏺 寄贈しました' : '⚠ 寄贈できませんでした'} color={result.ok ? '#d8b070' : '#ff8844'}
          onClose={() => setResult(null)}>
          {result.ok ? (
            <>
              {result.items.length > 1 && <div style={{ color:'#cfe2ff', fontSize:'13px' }}>{result.items.length}個を寄贈しました</div>}
              {/* 装備名だけレア度の色（2026-10-23 ユーザー指示「既存の装備と同じように色付けてほしい、装備名だけね」）。
                  文字は少し大きく（同じ日「寄贈した後のフォントも少し大きくして見やすくして」）＝文は13px・装備名は確認と同じ16px */}
              <div style={{ maxHeight:'280px', overflowY:'auto', fontSize:'13px', lineHeight:1.7 }}>
                {result.items.map((x, i) => (
                  <div key={i} style={{ color:'#cfe2ff' }}>
                    「<span style={{ color: RARITY_COLOR[x.rarity], fontSize:'16px' }}>{x.name}</span>」{donatedTail(x.tier)}
                  </div>
                ))}
              </div>
            </>
          ) : <div style={{ color:'#ff8844' }}>{result.error}</div>}
          {result.skipped > 0 && <div style={{ color: TEXT.sub, marginTop:'4px' }}>寄贈できなかった装備：{result.skipped}個</div>}
        </V2Modal>
      )}

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8 }}>
          装備を寄贈すると、博物館に登録されます（寄贈した装備はなくなります）。
          同じ装備を「未強化」「+5」「+9」のときにそれぞれ1回ずつ寄贈できます。
          ほかの強化値の装備・初期装備・着けている装備は寄贈できません。
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
      </div>

      {/* ===== 寄贈できる装備 ===== */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#d8b070', fontSize:'12px', marginBottom:'6px' }}>寄贈できる装備（{donatables.length}）</div>
        {rows === null ? <div style={{ color: TEXT.label, fontSize:'11px' }}>読み込み中...</div>
          : donatables.length === 0 ? (
            <div style={{ color: TEXT.empty, fontSize:'11px' }}>寄贈できる装備はありません（着けていない装備で、未強化・+5・+9のうちまだ登録していない段階のもの）</div>
          ) : (
            <>
              {/* 一括寄贈（鍛冶屋のまとめての分解と同じ形） */}
              <div style={{ background:'#000818', border:'1px solid #554422', padding:'7px 8px', marginBottom:'8px', fontSize:'10px' }}>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center', marginBottom:'5px' }}>
                  <span style={{ color: TEXT.label }}>まとめて選ぶ</span>
                  {RARITIES.map(r => {
                    const list = donatables.filter(d => d.item.rarity === r)
                    return (
                      <button key={r} onClick={() => pickAll(list)} disabled={busy || list.length === 0}
                        style={{ ...miniBtn(list.length ? RARITY_COLOR[r] : '#62789a'), color: list.length ? RARITY_COLOR[r] : TEXT.empty }}>
                        {rarityLabel(r)}を全部（{list.length}）
                      </button>
                    )
                  })}
                  <button onClick={() => pickAll(donatables)} disabled={busy || !donatables.some(bulkDonatable)} style={miniBtn('#88ccff')}>
                    ユニーク以外をすべて（{donatables.filter(bulkDonatable).length}）
                  </button>
                  <button onClick={() => setPicked(new Set())} disabled={busy || picked.size === 0} style={miniBtn('#62789a')}>選択を外す</button>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', alignItems:'center' }}>
                  <span style={{ color:'#cfe2ff' }}>選んだ {pickedRows.length}個</span>
                  <button onClick={() => setConfirm(pickedRows)} disabled={busy || pickedRows.length === 0} style={miniBtn('#d8b070')}>
                    選んだ{pickedRows.length}個を寄贈
                  </button>
                </div>
                <div style={{ color: TEXT.sub, marginTop:'4px' }}>まとめて選ぶときは、ユニークは選びません（チェックで1つずつなら選べます）</div>
              </div>
              <div style={{ display:'grid', gap:'3px', maxHeight:'360px', overflowY:'auto' }}>
                {donatables.map(d => {
                  const t = MUSEUM_TIERS[d.tier]
                  const on = picked.has(rowKey(d))
                  // ★行のどこを押してもチェックが入る・外れる（2026-10-23 ユーザー指示「チェックを押さなくても装備の欄を押せば」）。
                  //   チェックそのものと「寄贈」ボタンは、行の押下に伝えない（2回切り替わる・寄贈で選びが変わるのを防ぐ）
                  return (
                    <div key={rowKey(d)} onClick={() => { if (!busy) toggle(rowKey(d)) }}
                      style={{ background: on ? '#14100a' : '#000818', border:`1px solid ${on ? '#8a6a30' : '#002244'}`, padding:'5px 8px',
                        display:'flex', alignItems:'center', gap:'8px', fontSize:'11px', cursor: busy ? 'wait' : 'pointer', userSelect:'none' }}>
                      <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(rowKey(d))} onClick={e => e.stopPropagation()}
                        title="一括寄贈に選ぶ" style={{ accentColor:'#d8b070', margin:0, flexShrink:0 }} />
                      <span style={tierBadge(t)}>{t.label}</span>
                      <span style={{ flex:1, minWidth:0 }}>
                        <NameLine d={d} />
                        <span style={{ color: TEXT.label, fontSize:'10px' }}>　{kindLabel(d.item)}{d.copies > 1 ? `・${d.copies}個` : ''}</span>
                      </span>
                      <button onClick={e => { e.stopPropagation(); setConfirm([d]) }} disabled={busy} style={miniBtn('#d8b070')}>寄贈</button>
                    </div>
                  )
                })}
              </div>
            </>
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
                const hidden = uniqueHidden(registered, it)   // まだ寄贈していないユニークは「？？？」
                return (
                  <div key={it.id} style={{ background:'#000818', border:`1px solid ${has.length ? '#224466' : '#001428'}`, padding:'4px 6px',
                    display:'flex', alignItems:'center', gap:'6px', fontSize:'11px' }}>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      color: has.length ? RARITY_COLOR[it.rarity] : TEXT.empty }} title={hidden ? undefined : `${it.name}（${kindLabel(it)}）`}>
                      {hidden ? '？？？' : it.name}
                    </span>
                    {MUSEUM_TIERS.map(t => (
                      <span key={t.key} title={t.label} style={{ ...tierBadge(t, has.includes(t.key)), padding:'0 3px' }}>
                        {t.key === 0 ? '未' : t.label}
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
