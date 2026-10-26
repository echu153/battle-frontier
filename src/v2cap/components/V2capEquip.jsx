import { useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from './v2ui.js'
import { ITEM_BY_ID, SLOTS, SLOT_LABEL, ARMOR_EFFECT, slotsFor, kindLabel, needLvOf, isUnique, RARITY_COLOR } from '../lib/equipment.js'
import { UniqueText } from './V2capUniqueFx.jsx'
import { canEquipType } from '../lib/jobs.js'
import { equippedItems, wornIdsOf } from '../lib/loadout.js'
import { powerAt, statsAt, effectivePowerAt, syncLabelOf } from '../lib/gear.js'
import { plusOf } from '../lib/smith.js'
import { DROP_CHANCE, openAreaOf } from '../lib/sortie.js'
import { statLine, nameColor, useGearRows, useFavToggle, withFavs } from './v2capGearView.js'
import { PlusTag, GearFilterBar, FavStar } from './v2capGear.jsx'
import { saveGearFav } from './v2capGearFav.js'
import { V2Tip } from './V2ItemTip.jsx'
import { isSetPiece, setLabel, setTierText, armorSetOf, SET_TIERS } from '../lib/armorSets.js'

// ============================================================
// 「レベルキャップあり」版 — 装備（着ける・外すと持ち物）
//   ・枠は7つ（武器1・頭・鎧・腕・足・アクセ2）。盾なし・武器は1本（2026-10-09 ユーザー決定）
//   ・武器は**いまの職業が装備できる種類だけ**着けられる（職業ごとに3種）
//   ・防具は重鎧（受けるダメージ−1%）／軽装（AGI+1%）・1部位ごと。どの職業でも着けられる
//   ・装備は**アイテムLV**を持つ（＝必要LV）。足りなくても着けられるが、不足1LVごとに効果-5%（最低10%）
//   ・装備はエリアごとの一覧で、レア度（ノーマル・レア・エピック・レジェンダリー）を持つ。
//     名前だけをレア度の色で出す（【レア】のような頭の表記は 2026-10-13 ユーザー指示でやめた）
//   ・【確定】2026-10-10 強化・分解・作成は**鍛冶屋だけ**（V2capSmith.jsx）。ここは着ける・外すだけ（ユーザー決定）
// ============================================================
export default function V2capEquip({ prof, inventory, onProfile, onGo }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const worn = equippedItems(prof, inventory)
  const wornIds = wornIdsOf(prof, inventory)
  // お気に入りの★は押した瞬間に変え、サーバー（v2cap_gear_fav）には後ろで送る（2026-10-26 ユーザー指示「登録されるまでラグがある」・useFavToggle）
  const fav = useFavToggle({ save: saveGearFav, refresh: () => onProfile(null), onError: setError })
  const all = useMemo(() => withFavs(inventory, fav.over)
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.base_id] }))
    .filter(r => r.item), [inventory, fav.over])
  const g = useGearRows(all, prof.lv, openAreaOf(prof.cleared_spots))   // エリアは行ったことのあるところまで（2026-10-26 ユーザー指示）
  const rows = g.rows

  const call = async (fn, args) => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e || !data?.ok) { setBusy(false); setError(e?.message || data?.error || '失敗しました'); return }
    await onProfile(null)
    setBusy(false)
  }
  const equip = (slot, inv) => call('v2cap_equip', { p_slot: slot, p_inventory_id: inv.id })
  const unequip = (slot) => call('v2cap_unequip', { p_slot: slot })
  // お気に入りの★（2026-10-26 ユーザー指示「装備にお気に入りできるようにして」・分解と寄贈から守る）
  const toggleFav = fav.toggle

  return (
    <div style={{ fontFamily:'monospace' }}>
      {/* 着けているもの */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        {/* 2026-10-14 ユーザー指示で説明文（装備できる武器・重鎧と軽装・必要LV・強化の説明）を外した */}
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>🛡 装備中</div>
        <div style={{ display:'grid', gap:'3px' }}>
          {SLOTS.map(slot => {
            const w = worn[slot]
            const sync = w ? syncLabelOf(w.item, w.inv.ilv, prof.lv) : ''
            return (
              <div key={slot} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', flexWrap:'wrap' }}>
                <span style={{ color: TEXT.label, width:'52px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
                {w ? (
                  <>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {/* ユニーク（2026-10-21）はカーソルで固有の能力 */}
                      {isUnique(w.item)
                        ? <V2Tip width="260px" color={RARITY_COLOR.U} style={{ color: nameColor(w.item), borderBottom:`1px dotted ${RARITY_COLOR.U}` }}
                            body={<><div style={{ color: RARITY_COLOR.U }}>{w.item.name}（{w.item.boss}が落とす）</div><UniqueText item={w.item} /></>}>
                            {w.item.name}
                          </V2Tip>
                        : <span style={{ color: nameColor(w.item) }}>{w.item.name}</span>}
                      <PlusTag inv={w.inv} />
                      {/* 装備中の行にLVは出さない（2026-10-14 ユーザー指示）。必要LVに足りないときの「要求LV不足」だけ出す（2026-10-18〜・10-23 に「LV〇相当」から） */}
                      {sync && <span style={{ color:'#ff8844' }}> {sync}</span>}
                    </span>
                    <span style={{ color: TEXT.sub, fontSize:'10px' }}>{statLine(statsAt(w.item, w.inv.ilv, prof.lv, plusOf(w.inv)))}</span>
                    <button onClick={() => unequip(slot)} disabled={busy} style={miniBtn('#aa5566')}>外す</button>
                  </>
                ) : <span style={{ color: TEXT.empty }}>—</span>}
              </div>
            )
          })}
        </div>
        {onGo && (
          <button onClick={() => onGo('smith')} style={{ ...miniBtn('#ffaa44'), marginTop:'8px' }}>🔨 鍛冶屋へ（強化・分解・作成）</button>
        )}
      </div>

      {/* 持ち物 */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎒 持っている装備（{all.length}）</div>
        <GearFilterBar g={g} />
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
        <div style={{ display:'grid', gap:'4px', maxHeight:'520px', overflowY:'auto' }}>
          {rows.length === 0 && (
            <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>
              {/* ★落ちる確率は sortie.js の DROP_CHANCE から出す（直書きしていて 3%→8% のときに古いまま残った） */}
              {all.length === 0
                ? `装備がありません（出撃で勝つと落ちることがあります。ふつうの敵は${DROP_CHANCE.normal}%・レアは${DROP_CHANCE.rare}%・ボスは${DROP_CHANCE.boss}%。鍛冶屋で作ることもできます）`
                : 'この絞り込みに当てはまる装備はありません'}
            </div>
          )}
          {rows.map(({ inv, item }) => {
            const sync = syncLabelOf(item, inv.ilv, prof.lv)
            const plus = plusOf(inv)
            const isWorn = wornIds.has(String(inv.id))
            const usable = item.part !== '武器' || canEquipType(prof.class, item.type)
            const effect = item.line ? ARMOR_EFFECT[item.line]?.label : null
            const power = powerAt(item, inv.ilv, plus)
            return (
              <div key={inv.id} style={{ background:'#000818', border:`1px solid ${isWorn ? '#0055aa' : '#002244'}`, padding:'6px 8px', opacity: usable ? 1 : 0.6 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                  <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
                    {item.name}<PlusTag inv={inv} />
                    <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
                    {effect && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{effect}</span>}
                    {/* 防具のセット能力（2026-10-14）：レア以上の防具はどのセットか。カーソルで2・3・4部位の中身 */}
                    {isSetPiece(item) && (
                      <V2Tip width="270px" color="#88ddaa" style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px', borderBottom:'1px dotted #88ddaa' }}
                        body={<>
                          <div style={{ color:'#88ddaa' }}>セット：{setLabel(item.area, item.line)}</div>
                          {SET_TIERS.map(n => <div key={n}>{n}部位：{setTierText(armorSetOf(item.area), n, item.line)}</div>)}
                          <div style={{ color:'#7fa6d0', marginTop:'3px' }}>同じエリア・同じ系統（重鎧／軽装）のレア以上の防具を2部位以上着けると発動</div>
                        </>}>
                        セット：{setLabel(item.area, item.line)}
                      </V2Tip>
                    )}
                    {isWorn && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>装備中</span>}
                  </span>
                  {/* 2026-10-14 ユーザー指示「LV〇は『要求レベル〇LV』にして」 */}
                  <span style={{ color: needLvOf(item, inv.ilv) > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px', whiteSpace:'nowrap' }}>要求レベル{needLvOf(item, inv.ilv)}LV</span>
                  {/* お気に入りの★は右上（2026-10-26 ユーザー指示「お気に入りのボタンは右上にして」・鍛冶屋と同じ） */}
                  <FavStar inv={inv} busy={busy} onToggle={toggleFav} />
                </div>
                {/* 要求LVが足りないときは、いまの（LV相当の）戦闘力だけを出し、ステも同じ色（2026-10-26 ユーザー指示・鍛冶屋と同じ。前は「288 → 119（要求LV不足・あと◯LV）」） */}
                <div style={{ fontSize:'10px', color: sync ? '#ff8844' : TEXT.sub, margin:'3px 0', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  <span>戦闘力 {sync ? effectivePowerAt(item, inv.ilv, prof.lv, plus) : power}{sync && `（${sync}）`}</span>
                  <span>{statLine(statsAt(item, inv.ilv, prof.lv, plus))}</span>
                </div>
                {/* ユニーク（2026-10-21）：固有の能力と落とすボス。LV80より低くても能力は全部効く */}
                {isUnique(item) && (
                  <div style={{ fontSize:'10px', margin:'2px 0 4px', padding:'3px 6px', border:'1px solid #3a1c23', background:'#12060a' }}>
                    <UniqueText item={item} />
                    <div style={{ color:'#7fa6d0' }}>{item.boss}が落とす・同じものは1つまで着けられる</div>
                  </div>
                )}
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', alignItems:'center' }}>
                  {usable
                    ? slotsFor(item).map(slot => {
                      // ★同じユニークは1つまで（2026-10-21 ユーザー選択）：ほかの枠に同じユニークが着いていたら、その枠には着けられない
                      const twin = isUnique(item) && SLOTS.some(s => s !== slot && worn[s]?.item.id === item.id && String(worn[s].inv.id) !== String(inv.id))
                      return twin
                        ? <span key={slot} style={{ color:'#c69a5c', fontSize:'10px' }}>{SLOT_LABEL[slot]}：同じユニークは1つまで</span>
                        : (
                          <button key={slot} onClick={() => equip(slot, inv)} disabled={busy || String(prof.equipped?.[slot]) === String(inv.id)}
                            style={miniBtn('#44aaff')}>{SLOT_LABEL[slot]}に着ける</button>
                        )
                    })
                    : <span style={{ color:'#c69a5c', fontSize:'10px' }}>{prof.class}は{item.type}を装備できない</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
