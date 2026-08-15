import { useState } from 'react'
import { supabase } from '../../supabase'
import { powerOf, PLUS_MAX } from '../lib/equipment.js'
import { wornIdsOf, stackInventory } from '../lib/loadout.js'
import { box, btn, miniBtn, RANK_COLOR, PART_ICON } from './v2ui.js'

// 鍛冶屋：**同じ装備・同じ強化値を3個**合成して強化する（あるけみすと式）。
// 失敗＝消失／成功+1／大成功+2／超大成功+3。ランクが高いほど失敗しやすい。
// 抽選も3個の消費もサーバー（v2_fuse）が1つのトランザクションで行う。
const RATES = {
  F:{ fail:0, ok:85, great:12, super:3 }, E:{ fail:2, ok:82, great:13, super:3 },
  D:{ fail:4, ok:78, great:14, super:4 }, C:{ fail:6, ok:74, great:15, super:5 },
  B:{ fail:9, ok:69, great:16, super:6 }, A:{ fail:12, ok:64, great:17, super:7 },
  S:{ fail:15, ok:58, great:18, super:9 },
}
const RESULT_TEXT = { fail:['失敗… 装備は消えた', '#ff6666'], ok:['成功！ +1', '#88ccff'], great:['大成功！ +2', '#44ff88'], super:['超大成功！ +3', '#ffcc00'] }

export default function V2Smith({ prof, inventory, onProfile, onBack }) {
  const [pick, setPick] = useState([])     // 選んだ所持品ID（3つまで）
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [confirm, setConfirm] = useState(false)

  // 「同じ装備・同じ強化値」のまとめ方は倉庫と共通（loadout.js が正）。
  // 合成に使えるのは free＝装着していないぶんだけ。3個以上そろっていれば合成できる
  const groups = stackInventory(inventory, wornIdsOf(prof, inventory))
  const ready = groups.filter(g => g.free.length >= 3 && g.plus < PLUS_MAX)

  const selectedGroup = pick.length ? groups.find(g => g.free.some(i => i.id === pick[0])) : null
  const rate = selectedGroup ? RATES[selectedGroup.item.rank] : null

  const chooseGroup = (g) => { setPick(g.free.slice(0, 3).map(i => i.id)); setMsg(null); setConfirm(false) }

  const fuse = async () => {
    if (pick.length !== 3 || busy) return
    // ★+4以上で保護なしのときは確認を1段挟む（旧版で連打して溶かす事故があった）
    if (selectedGroup.plus >= 4 && !confirm) { setConfirm(true); return }
    setBusy(true); setMsg(null); setConfirm(false)
    const { data, error } = await supabase.rpc('v2_fuse', { p_a: pick[0], p_b: pick[1], p_c: pick[2] })
    setBusy(false)
    if (error) { setMsg({ text:error.message, color:'#ff6666' }); return }
    if (!data?.ok) { setMsg({ text:data?.error || '合成に失敗しました', color:'#ff6666' }); return }
    const [text, color] = RESULT_TEXT[data.result]
    setMsg({ text: data.result === 'fail' ? text : `${text}　→ ${selectedGroup.item.name}+${data.plus}`, color })
    setPick([])
    onProfile(null)
  }

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      <div style={{ ...box, padding:'12px', marginBottom:'10px', fontSize:'11px', color:'#88aaff' }}>
        <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'6px' }}>🔨 鍛冶屋</div>
        <div style={{ color:'#556677', fontSize:'10px', lineHeight:1.8 }}>
          同じ装備・同じ強化値を<b style={{ color:'#88ccff' }}>3個</b>合成すると強化値が上がります（上限+{PLUS_MAX}）。<br />
          失敗すると<b style={{ color:'#ff6666' }}>3個とも消えます</b>。ランクが高いほど失敗しやすくなります。<br />
          強化値が1つ上がるごとに装備の戦闘力は<b style={{ color:'#ffcc00' }}>1.5倍</b>になります。
        </div>
      </div>

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>合成できるもの（3個以上あるもの）</div>
        {ready.length === 0 && <div style={{ color:'#446688', fontSize:'11px' }}>同じ装備が3個そろっていません（装着中のものは使えません）</div>}
        {ready.map(g => {
          const on = selectedGroup && selectedGroup.item.id === g.item.id && selectedGroup.plus === g.plus
          return (
            <button key={`${g.item.id}#${g.plus}`} onClick={() => chooseGroup(g)}
              style={{ display:'block', width:'100%', textAlign:'left', marginBottom:'3px', padding:'6px 8px',
                background: on ? '#002850' : '#000818', border:`1px solid ${on ? '#00aaff' : '#002244'}`,
                color:'#88ccff', fontFamily:'monospace', fontSize:'11px', cursor:'pointer' }}>
              <span style={{ color: RANK_COLOR[g.item.rank] }}>{g.item.rank}</span>
              {' '}{PART_ICON[g.item.part]}{g.item.name}
              {g.plus ? <span style={{ color:'#ffcc00' }}>+{g.plus}</span> : ''}
              <span style={{ color:'#446688' }}>　×{g.free.length}個　戦闘力{powerOf(g.item, g.plus)} → {powerOf(g.item, g.plus + 1)}</span>
            </button>
          )
        })}
      </div>

      {selectedGroup && (
        <div style={{ ...box, padding:'12px' }}>
          <div style={{ fontSize:'12px', color:'#88ccff', marginBottom:'8px' }}>
            {selectedGroup.item.name}{selectedGroup.plus ? `+${selectedGroup.plus}` : ''} を3個合成する
          </div>
          <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', fontSize:'11px', marginBottom:'10px' }}>
            <span style={{ color:'#88ccff' }}>成功 {rate.ok}%（+1）</span>
            <span style={{ color:'#44ff88' }}>大成功 {rate.great}%（+2）</span>
            <span style={{ color:'#ffcc00' }}>超大成功 {rate.super}%（+3）</span>
            <span style={{ color: rate.fail ? '#ff6666' : '#446688' }}>失敗 {rate.fail}%{rate.fail ? '（消失）' : ''}</span>
          </div>
          {confirm && (
            <div style={{ color:'#ffaa66', fontSize:'11px', marginBottom:'8px' }}>
              ⚠ +{selectedGroup.plus} の装備です。失敗すると3個とも消えます。本当に合成しますか？
            </div>
          )}
          <button onClick={fuse} disabled={busy} style={{ ...btn(confirm ? '#ff8844' : '#ffcc00'), width:'100%' }}>
            {busy ? '合成中...' : confirm ? '本当に合成する' : '🔨 合成する'}
          </button>
          {msg && <div style={{ marginTop:'8px', fontSize:'12px', color: msg.color }}>{msg.text}</div>}
        </div>
      )}
      {!selectedGroup && msg && <div style={{ ...box, padding:'12px', fontSize:'12px', color: msg.color }}>{msg.text}</div>}
    </div>
  )
}
