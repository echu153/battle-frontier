import { useState } from 'react'
import { supabase } from '../../supabase'
import { ITEM_BY_ID, handsLabel, handsColor } from '../lib/equipment.js'
import { wornIdsOf } from '../lib/loadout.js'
import {
  FUSIONS, FUSION_BY_ID, fusedName, canFuseItem, checkFuse, fusionText,
  fusionsOfSource, FUSE_COST, ENEMY_FUSION_RATE,
} from '../lib/fusion.js'
import { ABILITY_LABEL, abilityText } from '../lib/enchant.js'
import { box, btn, miniBtn, TEXT, RANK_COLOR } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import V2Help from './V2Help.jsx'

// ============================================================
// 鍛冶屋「合成」（docs/v2-raid-design.md §6）
// ------------------------------------------------------------
//   武器1個 ＋ 合成素材1個
//     → その武器に**特殊能力**が付き、名前が「◯◯の××」に変わる
//
// ★合成素材は2つの出どころがある（2026-09-06 ユーザー指示で特殊能力をここへ一本化）
//     ・倒した敵から**一律1%**（敵270体ぶん）
//     ・レイドボスの討伐報酬（5体ぶん）
//
// ★強化はこれまで通り。強化は equip_id で見ているので、合成していても
//   「同じ武器名」であれば強化元にも強化素材にもできる。
// ★もう一度合成すると**上書き**（前の能力は消える）。確認を1段はさむ。
// ============================================================
export default function V2Fusion({ prof, inventory, fusions, isAdmin, onRefresh }) {
  const [invId, setInvId] = useState(null)
  const [matId, setMatId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState(null)
  const [msg, setMsg] = useState('')

  const wornIds = wornIdsOf(prof, inventory)
  // 持っている合成素材（qty > 0 のものだけ）。★名簿は275種あるので、持っているぶんだけ出す
  const have = Object.fromEntries((fusions || []).map(r => [r.fusion_id, r.qty]))
  const owned = FUSIONS.filter(f => (have[f.id] || 0) > 0)
  // レイドぶんを先に、そのあと敵ぶん（帯の順）
  owned.sort((a, b) => (a.source === b.source ? (a.tier || 0) - (b.tier || 0) : a.source === 'raid' ? -1 : 1))

  // 合成できるのは武器だけ
  const weapons = (inventory || [])
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.equip_id] }))
    .filter(w => canFuseItem(w.item))
    .sort((a, b) => (b.item.rank).localeCompare(a.item.rank) || (b.inv.plus || 0) - (a.inv.plus || 0))

  const picked = weapons.find(w => String(w.inv.id) === String(invId)) || null
  const mat = matId ? FUSION_BY_ID[matId] : null
  const err = checkFuse({ inv: picked?.inv, item: picked?.item, matId, have: have[matId] || 0 })

  const run = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('v2_fuse_weapon', {
      p_inv_id: picked.inv.id, p_fusion_id: matId,
    })
    setBusy(false)
    setConfirm(false)
    if (error || !data?.ok) { setMsg(`⚠ ${error?.message || data?.error}`); return }
    setResult({ name: fusedName(picked.item, mat.boss), ability: fusionText(matId) })
    setInvId(null); setMatId(null)
    onRefresh?.(null)
  }

  const grant = async (id) => {
    setBusy(true)
    await supabase.rpc('v2_debug_grant_fusion', { p_fusion_id: id, p_count: 3 })
    setBusy(false)
    onRefresh?.(null)
  }

  // ★開発限定：**出撃で落ちたときと同じ道**（v2_grant_fusion_drop）を1回だけ通す。
  //   一律1%なので、ふつうに出撃していると出るまで100回かかる＝これが無いと確かめられない。
  //   ⚠敵の因子しか受け取れないRPCなので、レイド由来の素材では弾かれる（それも確認になる）
  const tryDrop = async () => {
    const f = fusionsOfSource('enemy')[0]
    setBusy(true)
    const { data, error } = await supabase.rpc('v2_grant_fusion_drop', { p_fusion_id: f.id })
    setBusy(false)
    setMsg(error || !data?.ok
      ? `⚠ 出撃ドロップの受け取りに失敗（${error?.message || data?.error}）`
      : `✦ 出撃ドロップと同じ道で「${data.fusion?.name}」を受け取りました`)
    onRefresh?.(null)
  }

  return (
    <div>
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
          <span style={{ color:'#ff8844', fontSize:'13px' }}>✦ 合成</span>
          <V2Help id="fusion" />
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8 }}>
          <b style={{ color:'#ff8844' }}>合成素材</b>を武器に{FUSE_COST}個合わせると、
          その<b style={{ color:'#ffcc00' }}>{ABILITY_LABEL}</b>が付いて名前が変わります。<br />
          合成素材は<b>倒した敵から{ENEMY_FUSION_RATE}%</b>で落ちるほか、レイドボスの報酬でも手に入ります。<br />
          <b style={{ color:'#44ff88' }}>強化はこれまで通り</b>。合成しても、同じ武器名なら強化元にも強化素材にも使えます。<br />
          ソケットに刻んだルーンと武器の進化はそのまま残ります。
        </div>
        {/* ★開発限定の配り口。敵ぶんは270種あるので、レイドぶんだけボタンにする */}
        {isAdmin && (
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginTop:'8px' }}>
            {fusionsOfSource('raid').map(f => (
              <button key={f.id} onClick={() => grant(f.id)} disabled={busy} style={miniBtn('#88ddaa')}>
                [開発] {f.name}×3
              </button>
            ))}
            <button onClick={tryDrop} disabled={busy} style={miniBtn('#ffcc00')}>
              [開発] 出撃ドロップを1回ためす（{fusionsOfSource('enemy')[0]?.name}）
            </button>
          </div>
        )}
      </div>

      {msg && <div style={{ color:'#ff8844', fontSize:'11px', marginBottom:'8px' }}>{msg}</div>}

      {/* ① 合成素材 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'6px' }}>① 合成素材を選ぶ</div>
        {owned.length === 0 && (
          <div style={{ color: TEXT.sub, fontSize:'11px' }}>
            まだ持っていません（出撃で敵を倒すと{ENEMY_FUSION_RATE}%で落ちます）
          </div>
        )}
        {owned.length > 0 && (
          <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'4px' }}>
            持っているもの {owned.length}種
          </div>
        )}
        <div style={{ maxHeight:'320px', overflowY:'auto' }}>
        {owned.map(f => (
          <button key={f.id} onClick={() => setMatId(matId === f.id ? null : f.id)}
            style={{ display:'block', width:'100%', textAlign:'left', marginBottom:'4px', padding:'6px 8px',
              background: matId === f.id ? '#002850' : '#000818',
              border:`1px solid ${matId === f.id ? f.color : '#002244'}`,
              color: TEXT.body, fontFamily:'monospace', fontSize:'11px', cursor:'pointer' }}>
            <span style={{ color: f.color }}>{f.name}</span>
            <span style={{ color: TEXT.label }}>　×{have[f.id]}個</span>
            <div style={{ color:'#ffcc00', fontSize:'10px', marginTop:'2px' }}>{ABILITY_LABEL}：{fusionText(f.id)}</div>
          </button>
        ))}
        </div>
      </div>

      {/* ② 武器 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'6px' }}>② 合成する武器を選ぶ</div>
        {weapons.length === 0 && <div style={{ color: TEXT.sub, fontSize:'11px' }}>武器を持っていません</div>}
        <div style={{ maxHeight:'320px', overflowY:'auto' }}>
          {weapons.map(({ inv, item }) => {
            const on = String(inv.id) === String(invId)
            return (
              <button key={inv.id} onClick={() => setInvId(on ? null : inv.id)}
                style={{ display:'block', width:'100%', textAlign:'left', marginBottom:'3px', padding:'5px 8px',
                  background: on ? '#002850' : '#000818',
                  border:`1px solid ${on ? '#00aaff' : '#002244'}`,
                  color: TEXT.body, fontFamily:'monospace', fontSize:'11px', cursor:'pointer' }}>
                <span style={{ color: RANK_COLOR[item.rank] }}>{item.rank}</span>
                {' '}{fusedName(item, inv.fused)}
                {inv.plus > 0 && <span style={{ color:'#ffcc00' }}> +{inv.plus}</span>}
                {handsLabel(item) && <span style={{ color: handsColor(item) }}>　{handsLabel(item)}</span>}
                {wornIds.has(String(inv.id)) && <span style={{ color:'#44ff88' }}>　装備中</span>}
                {inv.fused && (
                  <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'2px' }}>
                    合成済み：{abilityText(inv.fused)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ③ 実行 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        {err
          ? <div style={{ color: TEXT.sub, fontSize:'11px' }}>{err}</div>
          : (
            <>
              <div style={{ fontSize:'12px', color: TEXT.bright, marginBottom:'6px' }}>
                「{fusedName(picked.item, picked.inv.fused)}」→
                <span style={{ color:'#ff8844' }}>「{fusedName(picked.item, mat.boss)}」</span>
              </div>
              <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'8px' }}>
                {ABILITY_LABEL}：{fusionText(matId)}
              </div>
              {picked.inv.fused && picked.inv.fused !== mat.boss && (
                <div style={{ color:'#ff8844', fontSize:'11px', marginBottom:'8px' }}>
                  ⚠ すでに合成されています。実行すると前の{ABILITY_LABEL}は消えます
                </div>
              )}
              <button onClick={() => setConfirm(true)} disabled={busy}
                style={{ ...btn('#ff8844'), width:'100%' }}>✦ 合成する</button>
            </>
          )}
      </div>

      {confirm && (
        <V2Modal title="✦ 合成" color="#ff8844" danger={!!picked?.inv?.fused} busy={busy}
          confirmLabel="合成する" onConfirm={run} onClose={() => setConfirm(false)}>
          <div>「{mat.name}」を1個使って、この武器に{ABILITY_LABEL}を付けます。</div>
          <div style={{ color:'#ffcc00', marginTop:'6px' }}>{fusionText(matId)}</div>
          <div style={{ color: TEXT.label, marginTop:'6px' }}>
            名前が「{fusedName(picked.item, mat.boss)}」に変わります。強化はこれまで通りできます。
          </div>
          {picked.inv.fused && picked.inv.fused !== mat.boss && (
            <div style={{ color:'#ff8844', marginTop:'6px' }}>前の{ABILITY_LABEL}は消えます。</div>
          )}
        </V2Modal>
      )}

      {result && (
        <V2Modal title="✦ 合成できました" color="#44ff88" onClose={() => setResult(null)}>
          <div style={{ color:'#ff8844', fontSize:'13px' }}>{result.name}</div>
          <div style={{ color:'#ffcc00', marginTop:'6px' }}>{ABILITY_LABEL}：{result.ability}</div>
        </V2Modal>
      )}
    </div>
  )
}
