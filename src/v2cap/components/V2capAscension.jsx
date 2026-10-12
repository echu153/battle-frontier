import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import { CLASSES, jobOf, jobMaxOf, stageColorOf, stageLabelOf } from '../lib/jobs.js'
import {
  treeOf, treeSizeOf, ascStateOf, apTotalOf, apSpentOf, ascEffectsOf, nodeLines, nodeText, ascendError, ascResetGoldOf,
} from '../lib/ascension.js'

// ============================================================
// 「レベルキャップあり」版 — アセンション（スキルツリー）
//   【確定】2026-10-13 ユーザー指示（AION2 のダエバニオンを参考に）＋選んだこと（設計 §4-2）：
//   ・CLASS LVが1上がるごとにAPを1。APでマスを開くと、ステや技が強くなる（どのマスも1AP）
//   ・職業ごとの木で、効くのはその職業でいる間だけ。起点から4本の道があり、起点の側から順に開く
//   ・マスを押すと中身と「ここまで開く（◯AP）」（間のマスもまとめて開く）。開くのはサーバー（v2cap_ascend）
//   ・振り直しは LV×100 Gold（v2cap_ascend_reset）
//   数え方は src/v2cap/lib/ascension.js（戦闘・ステの内訳と同じもの）
// ============================================================
// ★スキルのマスは水色の丸いマス（AION2 と同じく、ステの四角いマスと形で見分ける。STRの黄色と重ならない色）
const NODE_COLOR = { skill:'#5ce1e6', big:'#ff88cc' }
const colorOf = (node) => NODE_COLOR[node.type] || STAT_DEFS[node.stat]?.color || '#88ccff'

// マス1つ。owned＝開いた／reach＝残りのAPで（間のマスごと）開ける
function NodeButton({ node, owned, reach, next, onClick }) {
  const c = colorOf(node)
  const [l1, l2] = nodeLines(node)
  const big = node.type === 'big'
  const skill = node.type === 'skill'
  const style = {
    width:'100%', boxSizing:'border-box', fontFamily:'monospace', cursor:'pointer', textAlign:'center',
    padding: big ? '7px 2px' : '4px 2px', lineHeight:1.25, overflowWrap:'anywhere',
    fontSize: big ? '11px' : '10px', fontWeight: big ? 'bold' : 'normal',
    borderRadius: skill ? '12px' : 0,
    background: owned ? `${c}22` : '#000818',
    border: `${big ? 2 : 1}px ${next && reach && !owned ? 'dashed' : 'solid'} ${owned ? c : next && reach ? '#ffcc00' : reach ? (skill ? `${c}88` : '#2a4466') : '#16243a'}`,
    color: owned ? c : reach ? (skill ? `${c}cc` : TEXT.sub) : TEXT.empty,
    boxShadow: owned && big ? `0 0 8px ${c}66` : 'none',
  }
  return (
    <button onClick={onClick} style={style} aria-pressed={owned}>
      <div>{l1}</div>
      {l2 && <div style={{ fontSize:'9px', color: owned ? c : reach ? `${c}aa` : TEXT.empty }}>{l2}</div>}
    </button>
  )
}

// 道と道のあいだの線（下のマスを開いていれば明るく）
const Link = ({ on, color }) => (
  <div style={{ width:'2px', height:'6px', margin:'0 auto', background: on ? color : '#16243a' }} />
)

export default function V2capAscension({ prof, onProfile }) {
  const [cls, setCls] = useState(prof.class)
  const [pick, setPick] = useState(null)        // { road, idx }（idx は起点の側から1始まり）
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const tree = treeOf(cls)
  // 見られる職業＝就いたことのある職業といまの職業（並びは神殿と同じ）
  const classes = CLASSES.map(c => c.id).filter(id => id === prof.class || prof.jobs?.[id])
  if (!tree) return <div style={{ ...box, padding:'12px', color: TEXT.sub, fontSize:'11px' }}>この職業にはアセンションがありません</div>

  const state = ascStateOf(prof, cls)
  const jlv = jobOf(prof.jobs, cls).lv
  const total = apTotalOf(cls, jlv)
  const spent = apSpentOf(state)
  const left = total - spent
  const isCur = cls === prof.class
  const eff = ascEffectsOf(prof, cls)
  const resetGold = ascResetGoldOf(prof.lv)
  const flatText = STAT_KEYS.filter(k => eff.flat[k] > 0).map(k => `${STAT_DEFS[k].label}+${eff.flat[k]}`).join('・')
  const pctText = Object.entries(eff.pct).map(([k, v]) => `${STAT_DEFS[k]?.label || k}+${v}%`).join('・')
  const skillNodes = tree.roads.flatMap((road, r) => road.nodes.slice(0, state[r]).filter(n => n.type === 'skill'))

  const call = async (fn, args) => {
    setBusy(true); setError(''); setMsg('')
    const { data, error: e } = await supabase.rpc(fn, args)
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || 'うまくいきませんでした'); return null }
    await onProfile?.()
    return data
  }
  const open = async (road, to) => {
    const err = ascendError(prof, cls, road, to)
    if (err) { setError(err); return }
    const cost = to - state[road]
    if (await call('v2cap_ascend', { p_class: cls, p_road: road, p_to: to })) {
      setPick(null)
      setMsg(`${tree.roads[road].name}を${to}マス目まで開きました（${cost}AP）`)
    }
  }
  const reset = async () => {
    if (await call('v2cap_ascend_reset', { p_class: cls })) {
      setConfirmReset(false)
      setMsg(`${cls}の盤面を振り直しました（${resetGold.toLocaleString()} Gold）`)
    }
  }

  const picked = pick && tree.roads[pick.road]
  const pickedNode = picked?.nodes[pick.idx - 1]
  const pickedOwned = pick && pick.idx <= state[pick.road]
  const pickedCost = pick ? pick.idx - state[pick.road] : 0
  const pickedErr = pick && !pickedOwned ? ascendError(prof, cls, pick.road, pick.idx) : null

  return (
    <div style={{ maxWidth:'640px', margin:'0 auto' }}>
      {pick && pickedNode && (
        <V2Modal title={`${picked.name}　${pick.idx}／${picked.nodes.length}マス目`} color={colorOf(pickedNode)} busy={busy}
          confirmLabel={`ここまで開く（${pickedCost}AP）`}
          onConfirm={pickedOwned || pickedErr ? undefined : () => open(pick.road, pick.idx)}
          onClose={() => { if (!busy) { setPick(null); setError('') } }}>
          <div style={{ color: colorOf(pickedNode), marginBottom:'6px' }}>{nodeText(pickedNode)}</div>
          {pickedOwned ? (
            <div style={{ color:'#44ff88', fontSize:'11px' }}>開いています</div>
          ) : (
            <div style={{ color: TEXT.sub, fontSize:'11px' }}>
              {pickedCost > 1 ? `起点の側から順に開くので、${state[pick.road] + 1}〜${pick.idx}マス目の${pickedCost}マスをまとめて開きます。` : '1APで開きます。'}
              <span style={{ marginLeft:'4px' }}>残り {left}AP</span>
              {pickedErr && <div style={{ color:'#ff8844' }}>⚠ {pickedErr}{pickedErr === 'APが足りません' ? `（あと${pickedCost - left}AP）` : ''}</div>}
            </div>
          )}
          {!isCur && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'4px' }}>※いまの職業（{prof.class}）ではないので、{cls}に転職するまで効きません</div>}
          {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'4px' }}>⚠ {error}</div>}
        </V2Modal>
      )}
      {confirmReset && (
        <V2Modal title="アセンションを振り直す" color="#ff8844" danger busy={busy}
          confirmLabel={`振り直す（${resetGold.toLocaleString()} Gold）`}
          onConfirm={reset} onClose={() => { if (!busy) { setConfirmReset(false); setError('') } }}>
          {cls}の盤面を全部戻して、使った{spent}APを返します。費用は LV×100＝{resetGold.toLocaleString()} Gold（いま {Number(prof.gold || 0).toLocaleString()} Gold）。
          {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'4px' }}>⚠ {error}</div>}
        </V2Modal>
      )}

      {/* ===== 職業とAP ===== */}
      <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
        {classes.length > 1 && (
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'8px' }}>
            {classes.map(id => {
              const on = id === cls
              const st = ascStateOf(prof, id)
              const l = apTotalOf(id, jobOf(prof.jobs, id).lv) - apSpentOf(st)
              return (
                <button key={id} onClick={() => { setCls(id); setPick(null); setMsg(''); setError('') }} aria-pressed={on}
                  style={{ ...miniBtn(on ? stageColorOf(id) : '#2a4466'), color: on ? stageColorOf(id) : TEXT.label, background: on ? '#00163a' : '#000818' }}>
                  {id}{id === prof.class ? '（いま）' : ''}{l > 0 && <span style={{ color:'#ffcc00', marginLeft:'3px' }}>AP{l}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'8px', flexWrap:'wrap' }}>
          <div style={{ fontSize:'12px' }}>
            <span style={{ color: stageColorOf(cls) }}>{cls}</span>
            <span style={{ color: TEXT.label, fontSize:'10px', marginLeft:'6px' }}>{stageLabelOf(cls)}・CLASS LV{jlv}/{jobMaxOf(cls)}</span>
          </div>
          <div style={{ fontSize:'12px' }}>
            AP 残り <span style={{ color: left > 0 ? '#ffcc00' : TEXT.bright }}>{left}</span>
            <span style={{ color: TEXT.label, fontSize:'10px' }}> ／ もらった{total}（全部で{treeSizeOf(cls)}マス）</span>
          </div>
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginTop:'4px' }}>
          CLASS LVが1上がるごとにAP+1。マスを押すと中身が見られます。1マス1APで、起点の側から順に開きます。
          {isCur ? '' : <span style={{ color:'#ff8844' }}>　いまの職業ではないので、この盤面は{cls}に転職するまで効きません。</span>}
        </div>
        {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'4px' }}>{msg}</div>}
        {error && !pick && !confirmReset && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'4px' }}>⚠ {error}</div>}
      </div>

      {/* ===== 木 ===== */}
      <div style={{ ...box, padding:'10px 8px', marginBottom:'8px' }}>
        <div style={{ textAlign:'center', marginBottom:'2px' }}>
          <span style={{ display:'inline-block', border:'1px solid #ffcc00', color:'#ffcc00', padding:'3px 12px', fontSize:'11px', background:'#1a1400' }}>★ 起点</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${tree.roads.length}, minmax(0, 1fr))`, gap:'6px' }}>
          {tree.roads.map((road, r) => {
            const c = STAT_DEFS[road.stat]?.color || '#88ccff'
            return (
              <div key={r} style={{ minWidth:0 }}>
                <Link on={state[r] > 0} color={c} />
                <div style={{ textAlign:'center', color: c, fontSize:'10px', marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {road.name}
                </div>
                <div style={{ textAlign:'center', color: TEXT.label, fontSize:'9px', marginBottom:'2px' }}>{state[r]}／{road.nodes.length}</div>
                {road.nodes.map((node, i) => {
                  const idx = i + 1
                  const owned = idx <= state[r]
                  return (
                    <div key={i}>
                      {i > 0 && <Link on={owned} color={c} />}
                      <NodeButton node={node} owned={owned} reach={!owned && idx - state[r] <= left} next={idx === state[r] + 1}
                        onClick={() => { setPick({ road: r, idx }); setError('') }} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== いま効いているもの・振り直し ===== */}
      <div style={{ ...box, padding:'10px 12px' }}>
        <div style={{ color:'#88aaff', fontSize:'11px', marginBottom:'4px' }}>この盤面で上がっているもの{isCur ? '' : '（転職すると効きます）'}</div>
        {spent === 0 ? (
          <div style={{ color: TEXT.empty, fontSize:'11px' }}>まだ開いたマスはありません</div>
        ) : (
          <div style={{ fontSize:'11px', lineHeight:1.8 }}>
            {flatText && <div style={{ color: TEXT.bright }}>{flatText}</div>}
            {pctText && <div style={{ color: NODE_COLOR.big }}>{pctText}</div>}
            {skillNodes.map(n => <div key={n.skill} style={{ color: NODE_COLOR.skill }}>{nodeText(n)}</div>)}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'8px' }}>
          <button onClick={() => { setConfirmReset(true); setError('') }} disabled={busy || spent === 0}
            style={{ ...miniBtn(spent === 0 ? '#2a3a55' : '#ff8844'), cursor: spent === 0 ? 'not-allowed' : 'pointer' }}>
            振り直す（{resetGold.toLocaleString()} Gold）
          </button>
        </div>
      </div>
    </div>
  )
}
