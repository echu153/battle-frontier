import { Fragment } from 'react'
import { STAT_DEFS, STAT_KEYS, calcPower } from '../../v2/lib/stats.js'
import { box, TEXT } from '../../v2/components/v2ui.js'
import { SLOTS, SLOT_LABEL, ARMOR_EFFECT } from '../lib/equipment.js'
import { jobOf } from '../lib/jobs.js'
import { equippedItems, statBreakdown } from '../lib/loadout.js'
import { effectPct, statsAt, armorEffectText } from '../lib/gear.js'
import { plusOf } from '../lib/smith.js'
import { nameColor } from './v2capGearView.js'
import { RarityTag, PlusTag, StatGain } from './v2capGear.jsx'

// ============================================================
// 「レベルキャップあり」版 — ステータスの内訳（プロフィールの中）
//   【確定】2026-10-12 ユーザー指示「ホーム画面の数値は最終値だけ記載するでいい、装備とかどのくらいプラスされてるかはプロフから確認できればいい」
//   ・ステごとに 本体・クラス（いまの職業）・装備・軽装（AGIだけ）・合計 を表で出す。戦闘力も同じ列で
//   ・その下に、装備ごとの上がるステ（強化値と必要LV不足の効果%込み）と防具の効果
//   数は戦闘で使うものと同じ（loadout.js の statBreakdown）
// ============================================================
const NUM = { textAlign:'right', whiteSpace:'nowrap' }
const COLOR = { body:'#cfe2ff', job:'#ffcc00', gear:'#44ff88', armor:'#88ddaa' }

export default function V2capBreakdown({ prof, inventory }) {
  const bd = statBreakdown(prof, inventory)
  const worn = equippedItems(prof, inventory)
  const job = jobOf(prof.jobs, prof.class)
  const showArmor = bd.armorAgi > 0   // 軽装の列は、軽装でAGIが上がっているときだけ
  const cols = [['body', '本体'], ['job', 'クラス'], ['gear', '装備'], ...(showArmor ? [['armor', '軽装']] : []), ['total', '合計']]
  // 広い画面で横に伸びすぎると行を目で追いにくいので、表は幅を決めておく
  const grid = { display:'grid', gridTemplateColumns:`48px repeat(${cols.length}, minmax(0, 1fr))`, gap:'3px 6px', alignItems:'baseline', maxWidth:'480px' }
  const num = (key, v, color) => <span key={key} style={{ ...NUM, color: v ? color : TEXT.empty }}>{v ? v.toLocaleString() : '—'}</span>
  // ステの行の数（軽装はAGIだけ）
  const valueOf = (key, k) => (key === 'armor' ? (k === 'agi' ? bd.armorAgi : 0) : bd[key][k])
  // 戦闘力の行。軽装のぶん＝合計から「本体＋クラス＋装備」の戦闘力を引いたもの
  const base = Object.fromEntries(STAT_KEYS.map(k => [k, bd.body[k] + bd.job[k] + bd.gear[k]]))
  const power = { body: calcPower(bd.body), job: calcPower(bd.job), gear: calcPower(bd.gear), armor: bd.power - calcPower(base), total: bd.power }
  const armorParts = []
  if (bd.armor.takenPct) armorParts.push(`受けるダメージ${bd.armor.takenPct}%`)
  if (bd.armor.agiPct) armorParts.push(`AGI+${bd.armor.agiPct}%`)

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
      <div style={{ color:'#88aaff', fontSize:'12px', marginBottom:'8px' }}>📊 ステータスの内訳</div>
      <div style={{ ...grid, fontSize:'11px' }}>
        <span />
        {cols.map(([key, label]) => (
          <span key={key} style={{ ...NUM, fontSize:'10px', color: key === 'total' ? '#cfe2ff' : COLOR[key] }}>{label}</span>
        ))}
        {STAT_KEYS.map(k => (
          <Fragment key={k}>
            <span style={{ color: STAT_DEFS[k].color }}>{STAT_DEFS[k].label}</span>
            {cols.map(([key]) => (key === 'total'
              ? <span key={key} style={{ ...NUM, color: STAT_DEFS[k].color }}>{bd.total[k].toLocaleString()}</span>
              : num(key, valueOf(key, k), COLOR[key])))}
          </Fragment>
        ))}
        <span style={{ gridColumn:'1 / -1', borderTop:'1px solid #002a55', margin:'2px 0' }} />
        <span style={{ color:'#44ff88' }}>戦闘力</span>
        {cols.map(([key]) => (key === 'total'
          ? <span key={key} style={{ ...NUM, color:'#44ff88' }}>{power.total.toLocaleString()}</span>
          : num(key, power[key], COLOR[key])))}
      </div>
      <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginTop:'8px' }}>
        <div><span style={{ color: COLOR.body }}>本体</span>＝キャラそのもの（振ったステータスポイントを含む）</div>
        <div><span style={{ color: COLOR.job }}>クラス</span>＝いまの職業（{prof.class}・ClassLV{job.lv}）のぶん。就いている間だけ</div>
        <div><span style={{ color: COLOR.gear }}>装備</span>＝着けている装備の合計（強化値と、必要LVに足りないときの効果%を入れたあと）</div>
        {showArmor && <div><span style={{ color: COLOR.armor }}>軽装</span>＝軽装1部位ごとに{ARMOR_EFFECT.軽装.label}（本体＋クラス＋装備のAGIに掛ける）</div>}
      </div>

      <div style={{ color:'#88aaff', fontSize:'11px', margin:'10px 0 4px', display:'flex', justifyContent:'space-between', gap:'6px', flexWrap:'wrap' }}>
        <span>装備ごと</span>
        {armorParts.length > 0 && <span style={{ color: COLOR.armor, fontSize:'10px' }}>防具の効果：{armorParts.join('・')}</span>}
      </div>
      <div style={{ display:'grid', gap:'2px' }}>
        {SLOTS.map(slot => {
          const w = worn[slot]
          const pct = w ? effectPct(w.inv.ilv, prof.lv) : 100
          return (
            <div key={slot} style={{ display:'flex', gap:'8px', background:'#000818', border:'1px solid #002244', padding:'4px 7px', fontSize:'11px' }}>
              <span style={{ color:'#7fa6d0', fontSize:'10px', width:'52px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
              {w ? (
                <div style={{ flex:1, minWidth:0 }}>
                  <div>
                    <span style={{ color: nameColor(w.item) }}><RarityTag item={w.item} />{w.item.name}</span><PlusTag inv={w.inv} />
                    {pct < 100 && <span style={{ color:'#ff8844', fontSize:'10px' }}> 効果{pct}%（必要LV{w.inv.ilv}）</span>}
                  </div>
                  <div style={{ fontSize:'10px' }}>
                    <StatGain s={statsAt(w.item, w.inv.ilv, pct, plusOf(w.inv))} />
                    {w.item.line && <span style={{ color: COLOR.armor, whiteSpace:'nowrap' }}>{w.item.line}：{armorEffectText(w.item, pct)}</span>}
                  </div>
                </div>
              ) : <span style={{ color: TEXT.empty }}>—</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
