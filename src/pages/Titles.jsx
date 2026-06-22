import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { fetchTitleData, checkTitleCondition } from '../lib/titles'

const CATEGORY_LABELS = {
  level:'レベル到達', job:'転職・再修練', area:'エリア突破',
  boss:'ボス撃破', raid:'レイドボス', gambling:'賭博',
  treasure:'お宝・錬金', museum:'博物館', enhance:'強化',
  class_retraining:'クラス再修練', event:'イベント',
}

const GENERIC_TITLES_KEY = 'generic'

export default function Titles() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [allTitles, setAllTitles] = useState([])
  const [playerTitles, setPlayerTitles] = useState([])
  const [condData, setCondData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')

  useEffect(() => { fetchAll() }, [])

  const showMsg = (text, color = '#44ff88') => {
    setMessage(text); setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }

    const { profile: p, titles, playerTitles: pt, condData: cd } = await fetchTitleData(user.id)
    setProfile(p)
    setAllTitles(titles)
    setPlayerTitles(pt)
    setCondData(cd)
  }

  const checkCondition = (title) => checkTitleCondition(title, profile, condData)

  const condProgress = (title) => {
    if (!condData) return null
    const v = title.condition_value
    switch (title.condition_type) {
      case 'class_level_total': return `${condData.classLevelTotal.toLocaleString()}/${v.toLocaleString()}`
      case 'char_lv':           return `キャラクターLV ${(profile.char_lv||profile.lv||0).toLocaleString()}/${v.toLocaleString()}`
      case 'job_change':        return `${condData.jobChangeCount}/${v}`
      case 'advanced_class_count': return `上位クラス ${condData.advancedClassCount}/${v}種`
      case 'retraining':        return `${condData.retrainingTotal}/${v}`
      case 'area':              return `現在エリア${condData.maxUnlockedArea - 1}突破`
      case 'boss_kill':         return `${condData.bossKillCount.toLocaleString()}/${v.toLocaleString()}`
      case 'raid':              return `${condData.raidCount}/${v}`
      case 'enhance_success':   return `${condData.enhanceSuccessCount}/${v}`
      case 'enhance_fail':      return `${condData.enhanceFailCount}/${v}`
      case 'donation':          return `${condData.donationCount}/${v}`
      case 'gambling_medal':    return `${condData.gamblingMedalMax.toLocaleString()}/${v.toLocaleString()}`
      case 'gambling_gold':     return `${condData.gamblingGoldMax.toLocaleString()}/${v.toLocaleString()}`
      case 'treasure_hp_or_mp': return condData.hasHpPotion || condData.hasMpPotion ? '作成済み' : '未作成'
      case 'treasure_both':     return `HP:${condData.hasHpPotion?'✓':'✗'} MP:${condData.hasMpPotion?'✓':'✗'}`
      case 'class_retraining':  return `${title.condition_extra} 再修練 ${(profile.retraining||{})[title.condition_extra]||0}/${title.condition_value}回`
      default: return null
    }
  }

  const bonusText = (t) => {
    const parts = []
    if (t.hp_bonus)   parts.push(`HP+${t.hp_bonus}`)
    if (t.mp_bonus)   parts.push(`MP+${t.mp_bonus}`)
    if (t.atk_bonus)  parts.push(`ATK+${t.atk_bonus}`)
    if (t.def_bonus)  parts.push(`DEF+${t.def_bonus}`)
    if (t.matk_bonus) parts.push(`MATK+${t.matk_bonus}`)
    if (t.mdef_bonus) parts.push(`MDEF+${t.mdef_bonus}`)
    if (t.spd_bonus)  parts.push(`SPD+${t.spd_bonus}`)
    return parts.join(' / ') || 'ステータスなし'
  }

  const isAcquired = (titleId) => playerTitles.some(pt => pt.title_id === titleId)

  const claimTitle = async (title) => {
    if (loading) return
    setLoading(true)
    const { error } = await supabase.from('player_titles').insert({ player_id: profile.id, title_id: title.id })
    if (error) { showMsg('エラーが発生しました', '#ff4444'); setLoading(false); return }
    if (title.bonus_item_name) {
      const { data: bonusItem } = await supabase.from('items').select('id').eq('name', title.bonus_item_name).maybeSingle()
      if (bonusItem) {
        await supabase.from('player_items').insert({ player_id: profile.id, item_id: bonusItem.id, quantity: 1, equipped: false })
        showMsg(`✨ ${title.name} を獲得！ ${title.bonus_item_name} も入手！`, '#ffcc00')
      } else {
        showMsg(`✨ ${title.name} を獲得！`, '#44ff88')
      }
    } else {
      showMsg(`✨ ${title.name} を獲得！`, '#44ff88')
    }
    await fetchAll()
    setLoading(false)
  }

  const setDisplayTitle = async (titleText) => {
    if (loading) return
    setLoading(true)
    const { error } = await supabase.from('profiles').update({ display_title: titleText || null }).eq('id', profile.id)
    if (error) { showMsg(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    await fetchAll()
    setLoading(false)
  }

  const setAbilityTitle = async (titleId) => {
    if (loading) return
    setLoading(true)
    const { error } = await supabase.from('profiles').update({ ability_title_id: titleId || null }).eq('id', profile.id)
    if (error) { showMsg(`エラー: ${error.message}`, '#ff4444'); setLoading(false); return }
    await fetchAll()
    setLoading(false)
  }

  if (!profile || !condData) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  const genericTitles = allTitles.filter(t => t.condition_type === 'generic')
  const earnedTitles = allTitles.filter(t => t.condition_type !== 'generic')
  const acquiredEarned = earnedTitles.filter(t => isAcquired(t.id))
  const currentAbilityTitle = acquiredEarned.find(t => t.id === profile.ability_title_id)

  const categorized = {}
  for (const t of earnedTitles) {
    if (!categorized[t.category]) categorized[t.category] = []
    categorized[t.category].push(t)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/profile')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← プロフィールへ</button>
        </div>

        {message && (
          <div style={{ color: messageColor, fontSize:'12px', textAlign:'center', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px' }}>{message}</div>
        )}

        <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'12px', letterSpacing:'2px' }}>⬡ 称号設定</div>

        {/* 現在の設定 */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'16px' }}>
          {/* 見た目称号 */}
          <div style={{ border:'1px solid #0055aa', background:'#001028', padding:'12px' }}>
            <div style={{ color:'#88ccff', fontSize:'10px', marginBottom:'6px' }}>見た目称号（名前の左に表示）</div>
            <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'8px' }}>
              {profile.display_title ? `${profile.display_title} ${profile.username}` : profile.username}
            </div>
            <select
              value={profile.display_title || ''}
              onChange={e => setDisplayTitle(e.target.value)}
              disabled={loading}
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'4px', marginBottom:'6px' }}
            >
              <option value=''>（なし）</option>
              <optgroup label='★汎用称号★'>
                {genericTitles.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </optgroup>
              {acquiredEarned.length > 0 && (
                <optgroup label='★獲得済み称号★'>
                  {acquiredEarned.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>

          {/* 能力称号 */}
          <div style={{ border:'1px solid #0055aa', background:'#001028', padding:'12px' }}>
            <div style={{ color:'#88ccff', fontSize:'10px', marginBottom:'6px' }}>能力称号（ステータス付与のみ）</div>
            <div style={{ color:'#cc44ff', fontSize:'12px', marginBottom:'8px' }}>
              {currentAbilityTitle ? currentAbilityTitle.name : '未設定'}
            </div>
            {currentAbilityTitle && (
              <div style={{ color:'#aaaaaa', fontSize:'9px', marginBottom:'6px' }}>{bonusText(currentAbilityTitle)}</div>
            )}
            <select
              value={profile.ability_title_id || ''}
              onChange={e => setAbilityTitle(e.target.value ? Number(e.target.value) : null)}
              disabled={loading}
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#cc44ff', fontFamily:'monospace', fontSize:'10px', padding:'4px' }}
            >
              <option value=''>（なし）</option>
              {acquiredEarned.filter(t => t.atk_bonus||t.def_bonus||t.matk_bonus||t.mdef_bonus||t.spd_bonus||t.hp_bonus||t.mp_bonus).map(t => (
                <option key={t.id} value={t.id}>{t.name} ({bonusText(t)})</option>
              ))}
            </select>
          </div>
        </div>

        {/* 獲得可能な称号 */}
        {(() => {
          const claimable = earnedTitles.filter(t => checkCondition(t) && !isAcquired(t.id))
          if (claimable.length === 0) return null
          return (
            <div style={{ border:'1px solid #44aa44', background:'#001a08', padding:'12px', marginBottom:'16px' }}>
              <div style={{ color:'#44ff88', fontSize:'12px', marginBottom:'8px' }}>🎉 獲得可能な称号 ({claimable.length}件)</div>
              {claimable.map(title => (
                <div key={title.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #002244' }}>
                  <div>
                    <span style={{ color:'#88ff88', fontSize:'12px', marginRight:'8px' }}>{title.name}</span>
                    <span style={{ color:'#887700', fontSize:'9px' }}>{bonusText(title)}</span>
                    {title.bonus_item_name && <span style={{ color:'#ffaa44', fontSize:'9px', marginLeft:'6px' }}>＋{title.bonus_item_name}</span>}
                  </div>
                  <button onClick={() => claimTitle(title)} disabled={loading}
                    style={{ padding:'4px 14px', background:'#001a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                    獲得
                  </button>
                </div>
              ))}
            </div>
          )
        })()}

        {/* 実績称号リスト */}
        <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'10px', letterSpacing:'2px' }}>⬡ 実績称号一覧</div>
        {Object.entries(categorized).map(([cat, titles]) => (
          <div key={cat} style={{ marginBottom:'14px' }}>
            <div style={{ color:'#446688', fontSize:'11px', borderBottom:'1px solid #002244', paddingBottom:'4px', marginBottom:'6px' }}>{CATEGORY_LABELS[cat] || cat}</div>
            {titles.map(title => {
              const acquired = isAcquired(title.id)
              const condMet = checkCondition(title)
              const progress = condProgress(title)
              return (
                <div key={title.id} style={{ border:`1px solid ${acquired ? '#005500' : condMet ? '#44aa44' : '#002244'}`, background: acquired ? '#001408' : '#000818', padding:'10px', marginBottom:'6px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:'6px', alignItems:'center', marginBottom:'2px' }}>
                      <span style={{ color: acquired ? '#44ff88' : condMet ? '#88ff88' : '#446688', fontSize:'12px' }}>{title.name}</span>
                      {acquired && <span style={{ color:'#44ff88', fontSize:'9px', border:'1px solid #44ff88', padding:'0 4px' }}>獲得済み</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'9px', marginBottom:'2px' }}>{title.description}</div>
                    <div style={{ color:'#887700', fontSize:'9px' }}>{bonusText(title)}</div>
                    {title.bonus_item_name && <div style={{ color:'#ffaa44', fontSize:'9px' }}>＋{title.bonus_item_name}</div>}
                    {!acquired && progress && <div style={{ color: condMet ? '#44ff88' : '#446688', fontSize:'9px', marginTop:'2px' }}>進捗: {progress}</div>}
                  </div>
                  <div style={{ flexShrink:0 }}>
                    {acquired ? (
                      <span style={{ color:'#44ff88', fontSize:'16px' }}>✓</span>
                    ) : condMet ? (
                      <button onClick={() => claimTitle(title)} disabled={loading}
                        style={{ padding:'4px 12px', background:'#001a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                        獲得
                      </button>
                    ) : (
                      <span style={{ color:'#223344', fontSize:'16px' }}>🔒</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
