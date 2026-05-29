import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const PRESET_AVATARS = [
  { id:'warrior1',  label:'戦士①',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/warrior1.png` },
  { id:'knight1',   label:'騎士',       url:`${SUPABASE_URL}/storage/v1/object/public/avatars/knight1.png` },
  { id:'samurai',   label:'侍',         url:`${SUPABASE_URL}/storage/v1/object/public/avatars/samurai.png` },
  { id:'hunter1',   label:'狩人①',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter1.png` },
  { id:'hunter2',   label:'狩人②',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter2.png` },
  { id:'wizard1',   label:'魔法使い①', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard1.png` },
  { id:'wizard2',   label:'魔法使い②', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard2.png` },
  { id:'priest',    label:'僧侶',       url:`${SUPABASE_URL}/storage/v1/object/public/avatars/priest.png` },
]

const RARITY_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたハンマー'
]

const getStatRank = (val, type) => {
  let thresholds
  if (type === 'hp') thresholds = [450,1200,2400,4500,7500,12000,18000,27000]
  else if (type === 'mp') thresholds = [225,600,1200,2250,3750,6000,9000,13500]
  else thresholds = [45,120,240,450,750,1200,1800,2700]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (val <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

const getTotalRank = (total) => {
  const thresholds = [200,500,1000,2000,4000,7000,11000,16000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

const calcTotal = (p) => Math.floor((p.hp_max/10)+(p.mp_max/5)+p.atk+p.def+p.matk+p.mdef+p.spd)

const getProfPrefix = (profLv) => {
  if (profLv >= 300) return '【極】'
  if (profLv >= 200) return '【真】'
  if (profLv >= 100) return '【改】'
  return ''
}

const getEffectLabel = (effect) => {
  const labels = {
    'open_atk_10_2t':'【開幕2T・攻撃力+10%】','open_atk_20_1t':'【開幕1T・攻撃力+20%】',
    'open_def_10_2t':'【開幕2T・防御力+10%】','open_def_20_1t':'【開幕1T・防御力+20%】',
    'open_matk_10_2t':'【開幕2T・特殊攻撃力+10%】','open_matk_20_1t':'【開幕1T・特殊攻撃力+20%】',
    'open_mdef_10_2t':'【開幕2T・特殊防御力+10%】','open_mdef_20_1t':'【開幕1T・特殊防御力+20%】',
    'open_spd_10_2t':'【開幕2T・素早さ+10%】','open_spd_20_1t':'【開幕1T・素早さ+20%】',
    'delay_heal_10':'【3T後・HP10%回復】','regen_heal_5_3t':'【開幕3T・毎T HP5%回復】',
    'artifact':'【消費MP2倍・与ダメージ1.2倍】',
  }
  return labels[effect] || effect
}

// 強化後ステータス計算（1.5倍）
const calcEnhancedStats = (weapon, plus) => {
  if (!plus || plus <= 0) return weapon
  const isArtifactBase = ARTIFACT_BASE_NAMES.includes(weapon.name)
  if (isArtifactBase) return weapon
  const mult = Math.pow(1.5, plus)
  return {
    ...weapon,
    atk_bonus:  weapon.atk_bonus  > 0 ? Math.ceil(weapon.atk_bonus  * mult) : weapon.atk_bonus,
    def_bonus:  weapon.def_bonus  > 0 ? Math.ceil(weapon.def_bonus  * mult) : weapon.def_bonus,
    matk_bonus: weapon.matk_bonus > 0 ? Math.ceil(weapon.matk_bonus * mult) : weapon.matk_bonus,
    mdef_bonus: weapon.mdef_bonus > 0 ? Math.ceil(weapon.mdef_bonus * mult) : weapon.mdef_bonus,
    spd_bonus:  weapon.spd_bonus  > 0 ? Math.ceil(weapon.spd_bonus  * mult) : weapon.spd_bonus,
    hp_bonus:   weapon.hp_bonus   > 0 ? Math.ceil(weapon.hp_bonus   * mult) : weapon.hp_bonus,
    mp_bonus:   weapon.mp_bonus   > 0 ? Math.ceil(weapon.mp_bonus   * mult) : weapon.mp_bonus,
  }
}

const TYPE_COLORS = { '物理攻撃':'#ffcc00','魔法攻撃':'#cc44ff','回復':'#44ff88','強化':'#44ccff','パッシブ':'#ff8844' }

export default function Profile() {
  const nav = useNavigate()
  const { playerId } = useParams()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [isOwn, setIsOwn] = useState(false)
  const [showAvatarPanel, setShowAvatarPanel] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetchAll() }, [playerId])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const targetId = playerId || user.id
    setIsOwn(targetId === user.id)
    const { data: p } = await supabase.from('profiles').select('*').eq('id', targetId).single()
    if (!p) { nav('/game'); return }
    setProfile(p)
    setSelectedAvatar(p.avatar_url)
    const { data: eq } = await supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', targetId)
    setEquipment(eq || [])
    const { data: prof } = await supabase.from('proficiency').select('*, weapons(*)').eq('player_id', targetId)
    setProficiency(prof || [])
    const { data: ss } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', targetId).order('slot_order')
    setSkillSets(ss || [])
  }

  const saveAvatar = async () => {
    setLoading(true)
    await supabase.from('profiles').update({ avatar_url: selectedAvatar }).eq('id', profile.id)
    setMessage('アイコンを変更しました！')
    setTimeout(() => setMessage(''), 2000)
    await fetchAll()
    setShowAvatarPanel(false)
    setLoading(false)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  const total = calcTotal(profile)
  const totalRank = getTotalRank(total)
  const slots = ['weapon','armor','accessory','accessory2']

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <div style={{ display:'flex', gap:'8px' }}>
            {isOwn && (
              <button onClick={() => nav('/barber')}
                style={{ background:'none', border:'1px solid #ff88cc', color:'#ff88cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>✂ 美容院</button>
            )}
            <button onClick={() => nav(isOwn ? '/game' : '/ranking')}
              style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
              ← {isOwn ? '街に戻る' : 'ランキングへ'}
            </button>
          </div>
        </div>

        {message && (
          <div style={{ color:'#44ff88', fontSize:'12px', textAlign:'center', padding:'8px', border:'1px solid #44ff88', marginBottom:'12px' }}>{message}</div>
        )}

        {/* アバター */}
        <div style={{ display:'flex', gap:'16px', alignItems:'center', marginBottom:'16px' }}>
          <div style={{ position:'relative' }}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" style={{ width:'80px', height:'80px', objectFit:'cover' }} />
            ) : (
              <div style={{ width:'80px', height:'80px', border:'2px solid #446688', background:'#001028', display:'flex', alignItems:'center', justifyContent:'center', color:'#446688', fontSize:'24px' }}>👤</div>
            )}
            {isOwn && (
              <button onClick={() => setShowAvatarPanel(!showAvatarPanel)}
                style={{ position:'absolute', bottom:'-8px', right:'-8px', background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'9px', padding:'2px 4px' }}>変更</button>
            )}
          </div>
          <div>
            <div style={{ color:'#44ff88', fontSize:'16px', marginBottom:'4px' }}>{profile.username}</div>
            <div style={{ color:'#446688', fontSize:'11px' }}>クラス: <span style={{color:'#88ccff'}}>{profile.class}</span></div>
            <div style={{ color:'#446688', fontSize:'11px' }}>LV: <span style={{color:'#ffcc00'}}>{profile.lv}</span></div>
            <div style={{ color:'#446688', fontSize:'11px' }}>総合力: <span style={{color:'#44ff88'}}>{total}</span> <span style={{color: totalRank.color}}>【{totalRank.rank}】</span></div>
          </div>
        </div>

        {/* アバター変更パネル */}
        {isOwn && showAvatarPanel && (
          <div style={{ border:'1px solid #ffcc00', background:'#0a0800', padding:'12px', marginBottom:'12px' }}>
            <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>アイコンを選ぶ</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'6px', marginBottom:'10px' }}>
              {PRESET_AVATARS.map(a => (
                <div key={a.id} onClick={() => setSelectedAvatar(a.url)}
                  style={{ cursor:'pointer', border:`2px solid ${selectedAvatar === a.url ? '#ffcc00' : '#003366'}`, background: selectedAvatar === a.url ? '#1a1000' : '#000818', padding:'4px', textAlign:'center' }}>
                  <img src={a.url} alt={a.label} style={{ width:'100%', aspectRatio:'1', objectFit:'cover' }} onError={e => { e.target.style.display='none' }} />
                  <div style={{ color: selectedAvatar === a.url ? '#ffcc00' : '#446688', fontSize:'9px', marginTop:'2px' }}>{a.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => setShowAvatarPanel(false)}
                style={{ flex:1, padding:'6px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>キャンセル</button>
              <button onClick={saveAvatar} disabled={loading}
                style={{ flex:2, padding:'6px', background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>決定する</button>
            </div>
          </div>
        )}

        {/* ステータス */}
        <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>ステータス</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px', fontSize:'11px' }}>
            {[
              { label:'HP', val:profile.hp_max, type:'hp', color:'#00cc44' },
              { label:'MP', val:profile.mp_max, type:'mp', color:'#4488ff' },
              { label:'攻撃力', val:profile.atk, type:'atk', color:'#ffcc00' },
              { label:'防御力', val:profile.def, type:'def', color:'#88aaff' },
              { label:'特殊攻撃力', val:profile.matk, type:'matk', color:'#cc44ff' },
              { label:'特殊防御力', val:profile.mdef, type:'mdef', color:'#44ccff' },
              { label:'素早さ', val:profile.spd, type:'spd', color:'#ff8844' },
            ].map(s => {
              const rank = getStatRank(s.val, s.type)
              return (
                <div key={s.label} style={{ display:'flex', justifyContent:'space-between', color:'#446688' }}>
                  <span>{s.label}: <span style={{color:s.color}}>{s.val}</span></span>
                  <span style={{color:rank.color, fontSize:'10px'}}>{rank.rank}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 装備中 */}
        <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>装備中</div>
          {slots.map(slot => {
            const equipped = equipment.find(e => e.slot === slot && e.equipped)
            const slotLabel = { weapon:'武器', armor:'防具', accessory:'装飾品①', accessory2:'装飾品②' }[slot]
            if (!equipped) return (
              <div key={slot} style={{ display:'flex', gap:'8px', marginBottom:'6px', fontSize:'11px' }}>
                <span style={{ color:'#446688', minWidth:'60px' }}>{slotLabel}:</span>
                <span style={{ color:'#334455' }}>なし</span>
              </div>
            )
            const plus = equipped.enhance_plus || 0
            const isArtifactBase = ARTIFACT_BASE_NAMES.includes(equipped.weapons.name)
            const enhW = calcEnhancedStats(equipped.weapons, plus)
            const profLv = proficiency.find(p => p.weapon_id === equipped.weapons.id)?.prof_lv || 0
            return (
              <div key={slot} style={{ marginBottom:'8px', borderBottom:'1px solid #002244', paddingBottom:'6px' }}>
                <div style={{ display:'flex', gap:'8px', fontSize:'11px', marginBottom:'2px' }}>
                  <span style={{ color:'#446688', minWidth:'60px' }}>{slotLabel}:</span>
                  <span style={{ color: RARITY_COLORS[equipped.weapons.rarity] }}>
                    {getProfPrefix(profLv)}{equipped.weapons.name}
                    {plus > 0 && !isArtifactBase && <span style={{color:'#ffcc00'}}> +{plus}</span>}
                  </span>
                </div>
                <div style={{ fontSize:'10px', color:'#446688', marginLeft:'68px' }}>
                  {enhW.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{enhW.atk_bonus} </span>}
                  {enhW.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{enhW.def_bonus} </span>}
                  {enhW.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{enhW.matk_bonus} </span>}
                  {enhW.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{enhW.mdef_bonus} </span>}
                  {enhW.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{enhW.spd_bonus} </span>}
                  {equipped.weapons.matk_bonus_pct > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{equipped.weapons.matk_bonus_pct}% </span>}
                  {equipped.weapons.hit_bonus > 0 && <span style={{color:'#ffaa44'}}>命中+{equipped.weapons.hit_bonus}% </span>}
                  {(equipped.bonus_atk > 0 || equipped.bonus_def > 0 || equipped.bonus_matk > 0 || equipped.bonus_mdef > 0 || equipped.bonus_spd > 0) && (
                    <span style={{color:'#ffaa00'}}>
                      ボーナス:
                      {equipped.bonus_atk  > 0 && ` 攻撃力+${equipped.bonus_atk}`}
                      {equipped.bonus_def  > 0 && ` 防御力+${equipped.bonus_def}`}
                      {equipped.bonus_matk > 0 && ` 特殊攻撃力+${equipped.bonus_matk}`}
                      {equipped.bonus_mdef > 0 && ` 特殊防御力+${equipped.bonus_mdef}`}
                      {equipped.bonus_spd  > 0 && ` 素早さ+${equipped.bonus_spd}`}
                    </span>
                  )}
                  {equipped.bonus_effect && <span style={{color:'#ffaa00'}}> {getEffectLabel(equipped.bonus_effect)}</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* スキルセット */}
        <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>スキルセット</div>
          {skillSets.length === 0 ? (
            <div style={{ color:'#334455', fontSize:'11px' }}>未設定</div>
          ) : (
            skillSets.map(ss => (
              <div key={ss.id} style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'4px', fontSize:'11px' }}>
                <span style={{ color:'#446688', minWidth:'20px' }}>{ss.slot_order}.</span>
                <span style={{ color: TYPE_COLORS[ss.skills.type] || '#88ccff' }}>{ss.skills.name}</span>
                <span style={{ color:'#446688', fontSize:'10px' }}>×{ss.use_count || 1}</span>
                <span style={{ color:'#446688', fontSize:'10px' }}>MP{ss.skills.mp_cost}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
