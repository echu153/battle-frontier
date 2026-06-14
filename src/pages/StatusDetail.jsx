// ============================================================
// ステータス詳細ページ（草案 / DRAFT）
// ------------------------------------------------------------
// 実効ステータスが「どのボーナス源から」積み上がっているかを一画面に集約する。
//   ・基礎値（レベル/職業/ステ振り）
//   ・博物館 寄贈ボーナス（museum_* 列）
//   ・装備ボーナス（武器ベース×強化 + 個別ボーナス）
//   ・宝石ボーナス
//   ・熟練度ボーナス
//   ・称号ボーナス
//   ・戦闘補正（被ダメージ軽減率・クリ・命中・回避・貫通）
//   ・釣りボーナス（受取済み・参考値）※下部の注意書き参照
// ------------------------------------------------------------
// dev確認用の暫定ページ。導線は Game.jsx メニュー / App.jsx ルートに仮配線。
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import {
  calcStatsBreakdown, calcEffectiveStats, calcDefReduction, getTotalRank,
} from '../lib/stats'
import { sumClaimedFishingBonus, toFishingColumns } from '../lib/fishing'
import { petStats, applyCharmStats, speciesLabel, speciesEmoji, charmDisplayName, atkLabel, petImage } from '../constants/pets'

const STAT_META = [
  { key:'hp',   label:'HP',         color:'#00cc44', rankType:'hp'  },
  { key:'mp',   label:'MP',         color:'#4488ff', rankType:'mp'  },
  { key:'atk',  label:'攻撃力',     color:'#ffcc00', rankType:'atk' },
  { key:'def',  label:'防御力',     color:'#88aaff', rankType:'def' },
  { key:'matk', label:'特殊攻撃力', color:'#cc44ff', rankType:'matk'},
  { key:'mdef', label:'特殊防御力', color:'#44ccff', rankType:'mdef'},
  { key:'spd',  label:'素早さ',     color:'#ff8844', rankType:'spd' },
]

const SOURCE_META = [
  { key:'base',    label:'基礎',   color:'#88ccab' },
  { key:'museum',  label:'博物館', color:'#ccaa44' },
  { key:'fishing', label:'釣り',   color:'#44aaff' },
  { key:'equip',   label:'装備',   color:'#6699cc' },
  { key:'gem',     label:'宝石',   color:'#ff66cc' },
  { key:'prof',    label:'熟練度', color:'#44ff88' },
  { key:'title',   label:'称号',   color:'#ffaa44' },
]

const getStatRank = (val, type) => {
  let thresholds
  if (type === 'hp') thresholds = [550,1500,3000,5500,9000,15000,22000,33000]
  else if (type === 'mp') thresholds = [280,750,1500,2800,4500,7500,11000,16500]
  else thresholds = [55,150,300,550,950,1500,2200,3300]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (val <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

const pct1 = (v) => `${(v * 100).toFixed(1)}%`

const STAT_JP = { atk:'攻撃力', def:'防御力', matk:'特殊攻撃力', mdef:'特殊防御力', spd:'素早さ', hp_max:'HP', mp_max:'MP' }
// 内訳バケット（bd.museum 等）のキー（hp/mp）用ラベル
const STAT_LABEL_BY_KEY = Object.fromEntries(STAT_META.map(s => [s.key, s.label]))

export default function StatusDetail() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [fishingRecords, setFishingRecords] = useState([])
  const [museumCounts, setMuseumCounts] = useState({ donations:0, completes:0 })
  const [pets, setPets] = useState([])
  const [petCharms, setPetCharms] = useState({})

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!p) { nav('/game'); return }
    const [{ data: eq }, { data: prof }, { data: fr }, { count: donCount }, { count: cbCount }] = await Promise.all([
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('fishing_records').select('fish_name, fish_rank, location, bonus_claimed').eq('player_id', user.id),
      supabase.from('museum_donations').select('*', { count:'exact', head:true }).eq('player_id', user.id),
      supabase.from('museum_complete_bonuses').select('*', { count:'exact', head:true }).eq('player_id', user.id),
    ])
    setEquipment(eq || [])
    setProficiency(prof || [])
    setFishingRecords(fr || [])
    setMuseumCounts({ donations: donCount || 0, completes: cbCount || 0 })
    // ペット（アクティブを先頭に）＋装備チャーム
    const { data: petRows } = await supabase.from('pets').select('*').eq('owner_id', user.id)
    const petList = (petRows || []).sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0))
    setPets(petList)
    const charmIds = [...new Set(petList.map(p => p.charm_id).filter(Boolean))]
    if (charmIds.length > 0) {
      const { data: charmRows } = await supabase.from('player_charms').select('*').in('id', charmIds)
      const map = {}
      for (const c of (charmRows || [])) map[c.id] = c
      setPetCharms(map)
    }
    // 旧仕様で消えた釣りボーナスを fishing_* 列へ一度だけ復元（Fishing.jsx と同一処理）
    if (!p.fishing_migrated) {
      const { totals, completed } = sumClaimedFishingBonus(fr || [])
      const updates = {
        ...toFishingColumns(totals),
        fishing_completed: Object.keys(completed).filter(loc => completed[loc]),
        fishing_migrated: true,
      }
      await supabase.from('profiles').update(updates).eq('id', p.id)
      Object.assign(p, updates)
    }
    setProfile(p)
    if (p.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', p.ability_title_id).single()
      setAbilityTitle(at || null)
    }
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  const bd = calcStatsBreakdown(profile, equipment, proficiency, abilityTitle)
  const eff = bd.effective
  // dev: 実効値が calcEffectiveStats と一致するか検証
  let reconcileWarn = null
  if (import.meta.env.DEV) {
    const ref = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
    const refMap = { atk:ref.atk, def:ref.def, matk:ref.matk, mdef:ref.mdef, spd:ref.spd, hp:ref.hp_max, mp:ref.mp_max }
    const diffs = STAT_META.filter(s => refMap[s.key] !== eff[s.key]).map(s => `${s.label}:${eff[s.key]}≠${refMap[s.key]}`)
    if (diffs.length) reconcileWarn = diffs.join(' / ')
  }

  const total = Math.floor((eff.hp/10)+(eff.mp/5)+eff.atk+eff.def+eff.matk+eff.mdef+eff.spd)
  const totalRank = getTotalRank(total)

  const fishing = sumClaimedFishingBonus(fishingRecords)
  const fishingNonZero = Object.entries(fishing.totals).filter(([,v]) => v > 0)
  const museumNonZero = Object.entries(bd.museum).filter(([,v]) => v > 0)

  const box = { border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'12px' }
  const head = { color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={() => nav('/profile')} style={{ background:'none', border:'1px solid #44ff88', color:'#44ff88', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>👤 プロフィール</button>
            <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
          </div>
        </div>

        <div style={{ color:'#88ccff', fontSize:'14px', marginBottom:'4px' }}>📊 ステータス詳細</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          {profile.username} ／ LV {profile.lv} ／ 総合力 <span style={{ color:'#44ff88' }}>{total}</span>{' '}
          <span style={{ color:totalRank.color }}>【{totalRank.rank}】</span>
        </div>

        {reconcileWarn && (
          <div style={{ color:'#ff6644', fontSize:'11px', padding:'8px', border:'1px solid #882200', background:'#1a0500', marginBottom:'12px' }}>
            ⚠ [dev] 内訳合計が実効値と不一致: {reconcileWarn}
          </div>
        )}

        {/* ステータス別 内訳 */}
        <div style={box}>
          <div style={head}>ステータス内訳（ソース別）</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            {STAT_META.map(s => {
              const rank = getStatRank(eff[s.key], s.rankType)
              const chips = SOURCE_META
                .map(src => ({ ...src, val: bd[src.key][s.key] }))
                .filter(src => src.val !== 0)
              return (
                <div key={s.key} style={{ borderBottom:'1px solid #002244', paddingBottom:'8px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'4px' }}>
                    <span style={{ color:'#446688', fontSize:'12px' }}>{s.label}</span>
                    <span>
                      <span style={{ color:s.color, fontSize:'15px', fontWeight:'bold' }}>{eff[s.key]}</span>
                      <span style={{ color:rank.color, fontSize:'10px', marginLeft:'6px' }}>{rank.rank}</span>
                    </span>
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
                    {chips.map(c => (
                      <span key={c.key} style={{ fontSize:'10px', color:c.color, border:`1px solid ${c.color}44`, background:'#000c1c', padding:'1px 6px' }}>
                        {c.label} +{c.val}
                      </span>
                    ))}
                    {s.key === 'matk' && bd.matkPct > 0 && (
                      <span style={{ fontSize:'10px', color:'#cc44ff', border:'1px solid #cc44ff44', background:'#000c1c', padding:'1px 6px' }}>
                        装備%補正 ×{(1 + bd.matkPct/100).toFixed(2)}
                      </span>
                    )}
                    {chips.length === 0 && bd.matkPct === 0 && <span style={{ fontSize:'10px', color:'#334455' }}>ボーナスなし</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 戦闘補正 */}
        <div style={box}>
          <div style={head}>戦闘補正</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', fontSize:'11px' }}>
            <Row label="物理ダメージ軽減（防御）" value={pct1(calcDefReduction(eff.def))} color="#88aaff" />
            <Row label="特殊ダメージ軽減（特防）" value={pct1(calcDefReduction(eff.mdef))} color="#44ccff" />
            <Row label="クリティカル率（装備/宝石）" value={`+${bd.combat.critBonus}%`} color="#ffcc00" />
            <Row label="クリティカル抵抗" value={`+${bd.combat.critResist}%`} color="#88ccff" />
            <Row label="クリティカル威力" value={`+${pct1(bd.combat.critDmg)}`} color="#ff8844" />
            <Row label="命中補正" value={`+${bd.combat.hitBonus}%`} color="#ffaa44" />
            <Row label="回避補正" value={`+${bd.combat.evasionBonus}%`} color="#44ff88" />
            <Row label="防御貫通" value={pct1(bd.combat.defPen)} color="#cc88ff" />
            <Row label="特殊防御貫通" value={pct1(bd.combat.mdefPen)} color="#cc88ff" />
          </div>
          <div style={{ color:'#446688', fontSize:'10px', marginTop:'8px', lineHeight:'1.6' }}>
            ※ ダメージ軽減率は防御/特防の値から滑らかに算出（F=1%〜SSS=30%）。<br />
            ※ 貫通は最大80%でキャップ。
          </div>
        </div>

        {/* 博物館ボーナス */}
        <div style={{ ...box, border:'1px solid #5a4a1a' }}>
          <div style={{ ...head, color:'#ccaa44' }}>🏛 博物館ボーナス</div>
          {museumNonZero.length === 0 ? (
            <div style={{ color:'#334455', fontSize:'11px' }}>博物館ボーナスはありません</div>
          ) : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'8px' }}>
              {museumNonZero.map(([k,v]) => (
                <span key={k} style={{ fontSize:'11px', color:'#ccaa44', border:'1px solid #5a4a1a', background:'#000c1c', padding:'2px 8px' }}>
                  {STAT_LABEL_BY_KEY[k] || k} +{v}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize:'10px', color:'#446688', lineHeight:'1.7' }}>
            寄贈 {museumCounts.donations} 件
            {museumCounts.completes > 0 && `／コンプリート報酬 ${museumCounts.completes} 件`}
            <br />
            ※ 博物館ボーナスは専用枠で永続保存され、上の各ステータスの「博物館」内訳に反映されています。
            未寄贈の装備は <span style={{ color:'#88ccff' }}>🏛 博物館</span> から寄贈できます。
          </div>
        </div>

        {/* 釣りボーナス（受取済み） */}
        <div style={{ ...box, border:'1px solid #225588' }}>
          <div style={{ ...head, color:'#44aaff' }}>🎣 釣りボーナス（受取済み）</div>
          {fishingNonZero.length === 0 ? (
            <div style={{ color:'#334455', fontSize:'11px' }}>受取済みの釣りボーナスはありません</div>
          ) : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'8px' }}>
              {fishingNonZero.map(([k,v]) => (
                <span key={k} style={{ fontSize:'11px', color:'#44aaff', border:'1px solid #225588', background:'#000c1c', padding:'2px 8px' }}>
                  {STAT_JP[k] || k} +{v}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize:'10px', color:'#446688', lineHeight:'1.7' }}>
            受取済み魚 {fishing.perFishCount} 種
            {fishing.completeCount > 0 && `／コンプリート ${fishing.completeCount} 釣り場`}
            <br />
            ※ 釣りボーナスは専用枠で永続保存され、上の各ステータスの「釣り」内訳に反映されています。
            未釣り上げ・未受取の魚は <span style={{ color:'#88ccff' }}>🎣 釣り場 → 魚図鑑</span> から受け取れます。
          </div>
        </div>

        {/* ペット（チャーム込みステータス） */}
        <div style={{ ...box, border:'1px solid #1a5a3a' }}>
          <div style={{ ...head, color:'#44ffaa' }}>🐾 ペット</div>
          {pets.length === 0 ? (
            <div style={{ color:'#334455', fontSize:'11px' }}>ペットを所持していません</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {pets.map(pet => {
                const charm = pet.charm_id ? petCharms[pet.charm_id] : null
                const st = applyCharmStats(petStats(pet), charm || null)
                const power = Math.floor(st.maxHp / 10) + st.atk + st.def + st.mdef
                const img = petImage(pet)
                return (
                  <div key={pet.id} style={{ display:'flex', gap:'10px', alignItems:'center', padding:'8px', border:`1px solid ${pet.is_active ? '#2a6a4a' : '#143322'}`, background: pet.is_active ? '#06180f' : '#04120a' }}>
                    <div style={{ width:'40px', height:'40px', display:'flex', alignItems:'center', justifyContent:'center', background:'#0c1a12', border:'1px solid #1a3322', flexShrink:0, fontSize:'22px', overflow:'hidden' }}>
                      {img ? <img src={img} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : speciesEmoji(pet)}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:'12px', color:'#88ffcc', marginBottom:'2px' }}>
                        {pet.name || speciesLabel(pet)}
                        {pet.evolved && <span style={{ color:'#ffcc00', fontSize:'10px' }}> ✦進化</span>}
                        {pet.is_active && <span style={{ color:'#44ff88', fontSize:'10px' }}> 【出撃中】</span>}
                      </div>
                      <div style={{ fontSize:'10px', color:'#558866', marginBottom:'4px' }}>
                        {speciesLabel(pet)} Lv{pet.level || 1}
                        {charm && <span style={{ color:'#ff88cc' }}> ・{charmDisplayName(charm)}</span>}
                      </div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', fontSize:'10px' }}>
                        <span style={{ color:'#00cc44', border:'1px solid #1a5a3a', background:'#000c1c', padding:'1px 6px' }}>HP {st.maxHp}</span>
                        <span style={{ color:'#ffcc00', border:'1px solid #5a4a1a', background:'#000c1c', padding:'1px 6px' }}>{atkLabel(pet)} {st.atk}</span>
                        <span style={{ color:'#88aaff', border:'1px solid #2a3a6a', background:'#000c1c', padding:'1px 6px' }}>防御 {st.def}</span>
                        <span style={{ color:'#44ccff', border:'1px solid #1a4a6a', background:'#000c1c', padding:'1px 6px' }}>特防 {st.mdef}</span>
                      </div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ color:'#44ffaa', fontSize:'14px', fontWeight:'bold' }}>{power}</div>
                      <div style={{ color:'#558866', fontSize:'9px' }}>能力合計</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ fontSize:'10px', color:'#446688', lineHeight:'1.7', marginTop:'8px' }}>
            ※ 表示ステータスは装備中チャームの補正を含みます。能力合計は <span style={{ color:'#88ccff' }}>🐾 ペットランキング</span> と同じ計算（HP/10＋攻撃＋防御＋特防）です。
          </div>
        </div>

        {/* 称号ボーナス内訳（参考） */}
        {abilityTitle && (
          <div style={box}>
            <div style={head}>装備中の称号</div>
            <div style={{ fontSize:'12px', color:'#ffaa44' }}>{abilityTitle.name}</div>
            <div style={{ fontSize:'10px', color:'#446688', marginTop:'4px' }}>
              {STAT_META.map(s => bd.title[s.key] ? `${s.label}+${bd.title[s.key]}` : null).filter(Boolean).join(' / ') || 'ステータス補正なし'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, color }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', color:'#446688' }}>
      <span>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  )
}
