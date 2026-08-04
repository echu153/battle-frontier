import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { GEM_DATA, GEM_RANKS, GEM_TYPES, gemEffectValue } from './Game'
import { gemAllowedSlots, gemSlotCategory, GEM_SLOT_LABEL, calcProfBonus } from '../lib/stats'
import { evoMultiplier, displayRarity, isShinka, BOSS_LINES } from '../constants/bossEvolution'
import { getEmblemRank, EMBLEM_RANK_COLOR, emblemAllocTotal, calcEmblemBonus } from '../lib/emblem'
import { isHachigokuUnlocked } from '../lib/hachigoku'
import { effectLabel } from '../constants/effectLabels'

const SLOT_LABELS_FULL = { weapon:'武器', armor:'防具', accessory:'装飾品①', accessory2:'装飾品②' }
const gemDisplayName = (gemType, rank) => `${GEM_DATA[gemType]?.name || gemType}(${rank})`
const gemBonusText = (gemType, rank) => {
  const g = GEM_DATA[gemType]; if (!g) return ''
  const v = gemEffectValue(gemType, rank)
  return g.pct ? `${g.label} +${v}%` : `${g.label} +${v}`
}

const RARITY_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00'
}
const RARITY_LABELS = {
  f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS'
}
const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品①', accessory2:'装飾品②' }

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたオーブ'
]

const RARITY_ORDER = ['f','e','d','c','b','a','s','ss','sss']

const sortEquipment = (items, key) => [...items].sort((a, b) => {
  if (key === 'rarity_asc')  return RARITY_ORDER.indexOf(a.weapons.rarity) - RARITY_ORDER.indexOf(b.weapons.rarity)
  if (key === 'rarity_desc') return RARITY_ORDER.indexOf(b.weapons.rarity) - RARITY_ORDER.indexOf(a.weapons.rarity)
  if (key === 'obtained_desc') return new Date(b.obtained_at) - new Date(a.obtained_at)
  return new Date(a.obtained_at) - new Date(b.obtained_at)
})

const ARTIFACT_EVOLVED = {
  '古びた剣':'黒星ノ断剣','古びた短剣':'血哭ノ短刃','古びた弓':'月影ノ断弓',
  '古びた斧':'奈落ノ処刑斧','古びた刀':'斬月ノ終刀','古びた銃':'虚無ノ閃砲',
  '古びた杖':'星喰ノ導杖','古びた魔導書':'終焉ノ魔書','古びた槍':'冥哭ノ長槍',
  '古びたオーブ':'深淵ノ霊珠',
}

const getProfPrefix = (profLv) => {
  if (profLv >= 300) return '【極】'
  if (profLv >= 200) return '【真】'
  if (profLv >= 100) return '【改】'
  return ''
}

const getEffectLabel = (effect) => effectLabel(effect)  // 定義は src/constants/effectLabels.js に一元化

// enhance_plus(1.5倍)＋進化(基礎×(1+0.2*stage))による強化後ステータス計算（古びた○○除外）
const calcEnhancedStats = (weapon, plus, evolveStage = 0) => {
  const isArtifactBase = ARTIFACT_BASE_NAMES.includes(weapon.name)
  const mult = (plus > 0 && !isArtifactBase) ? Math.pow(1.5, plus) : 1
  const baseMult = mult * evoMultiplier(evolveStage)
  if (baseMult === 1) return weapon
  return {
    ...weapon,
    atk_bonus:  weapon.atk_bonus  > 0 ? Math.ceil(weapon.atk_bonus  * baseMult) : weapon.atk_bonus,
    def_bonus:  weapon.def_bonus  > 0 ? Math.ceil(weapon.def_bonus  * baseMult) : weapon.def_bonus,
    matk_bonus: weapon.matk_bonus > 0 ? Math.ceil(weapon.matk_bonus * baseMult) : weapon.matk_bonus,
    mdef_bonus: weapon.mdef_bonus > 0 ? Math.ceil(weapon.mdef_bonus * baseMult) : weapon.mdef_bonus,
    spd_bonus:  weapon.spd_bonus  > 0 ? Math.ceil(weapon.spd_bonus  * baseMult) : weapon.spd_bonus,
    hp_bonus:   weapon.hp_bonus   > 0 ? Math.ceil(weapon.hp_bonus   * baseMult) : weapon.hp_bonus,
    mp_bonus:   weapon.mp_bonus   > 0 ? Math.ceil(weapon.mp_bonus   * baseMult) : weapon.mp_bonus,
  }
}

export default function Equipment() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [allItems, setAllItems] = useState([])
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view')  // 'gear'(装備+宝石) / 'items'(アイテム+お宝) / null(全部)
  const [tab, setTab] = useState(view === 'items' ? 'item' : 'weapon')
  const [loading, setLoading] = useState(false)
  const craftBusyRef = useRef(false)  // ポーション作成/宝石合成の二重実行ガード（連打対策）
  const [awakenMessage, setAwakenMessage] = useState('')
  const [confirmReset, setConfirmReset] = useState(null)
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('equipSortKey') || 'obtained_asc')
  const [gems, setGems] = useState([])
  const [embedTarget, setEmbedTarget] = useState(null)  // 埋め込み先の装備id
  const [bulkPreview, setBulkPreview] = useState(null)  // 一括合成プレビュー
  const [craftMsg, setCraftMsg] = useState('')
  const [ticketPopup, setTicketPopup] = useState(false)  // Sレアレイドボス装備選択券のポップアップ
  const [ticketMsg, setTicketMsg] = useState('')
  const [ticketGot, setTicketGot] = useState(null)  // 交換成功で獲得した装備名（ポップアップ内に表示）
  const [renamePopup, setRenamePopup] = useState(null)  // 装備命名券のポップアップ（対象=player_items行）
  const [renameTargetId, setRenameTargetId] = useState(null)  // 命名する装備のid
  const [renameText, setRenameText] = useState('')
  const [renameMsg, setRenameMsg] = useState('')
  const [boxPopup, setBoxPopup] = useState(false)   // ボス装備進化支援箱の選択ポップアップ
  const [boxConfirm, setBoxConfirm] = useState(null) // 選択確認中のボスline（OK前の1段確認）
  const [boxToast, setBoxToast] = useState('')       // 獲得トースト（自動消滅）
  const [boxMsg, setBoxMsg] = useState('')
  const [emblemRow, setEmblemRow] = useState(null)   // 紋章（第5枠・開発限定）: player_emblem行
  const [bossBoxPopup, setBossBoxPopup] = useState(false)  // 初級ボス装備選択箱（初心者ビンゴ①報酬）のポップアップ
  const [bossBoxMsg, setBossBoxMsg] = useState('')
  const [bossBoxGot, setBossBoxGot] = useState(null)  // 交換成功で獲得した装備名
  const [areaBox, setAreaBox] = useState(null)  // 初級/中級/上級エリアボス装備選択箱（②報酬）: {name,tier,choices}
  const [areaBoxMsg, setAreaBoxMsg] = useState('')
  const [areaBoxGot, setAreaBoxGot] = useState(null)
  const [artBox, setArtBox] = useState(false)  // アーティファクト装備選択箱（夏イベント報酬）のポップアップ
  const [artBoxMsg, setArtBoxMsg] = useState('')
  const [artBoxGot, setArtBoxGot] = useState(null)
  const [boxWeapons, setBoxWeapons] = useState({})  // 選択箱で選べる装備の weapons 情報（name→row。ステ表示用）
  // 選択箱／選択券の交換確認（誤タップ防止の1段確認）: {kind:'ticket'|'beginner'|'area'|'artifact', name, cost}
  const [pickConfirm, setPickConfirm] = useState(null)

  // 選択券で交換できるS級レイド装備（redeem_raid_ticket の許可リストと一致）
  const RAID_TICKET_CHOICES = [
    { name:'ヴァルブレイカー', desc:'S級大剣。攻撃80 防御20。攻撃ヒット時、2T対象の回復力-30%。' },
    { name:'マレディクシオン', desc:'S級銃。攻撃60 特攻60 素早さ10。攻撃ヒット時、2T対象の回復力-30%。' },
    { name:'濡羽杖アマザネ',   desc:'S級杖。特攻80 特防20。攻撃ヒット時、2Tの間対象の素早さ-5%（最大4重複）。' },
    { name:'哭雨の羽衣',       desc:'S級防具。特攻20 特防80。戦闘開始時と5Tごとに、状態異常を1回無効化するバフを獲得。' },
    { name:'雷鋼の機神鎧',     desc:'S級防具。防御60 特防40。被ダメージ時、2T素早さ+15%。' },
    { name:'蒼雷の短刃',       desc:'S級短剣。攻撃40 素早さ60。追加行動の攻撃ヒット時、20%で麻痺。' },
  ]

  // 初級ボス装備選択箱で選べるエリア①〜②のボス装備（redeem_beginner_boss_box の許可リストと一致）
  const BEGINNER_BOX_CHOICES = [
    { name:'スライムの指輪',   desc:'エリア①ボス装備・指輪。' },
    { name:'蒼粘剣',           desc:'エリア①ボス装備・剣。' },
    { name:'略奪者の短剣',     desc:'エリア②ボス装備・短剣。' },
    { name:'影踏みのブーツ',   desc:'エリア②ボス装備・靴。' },
  ]
  // 初級/中級/上級エリアボス装備選択箱（②報酬）: redeem_area_boss_box の許可リストと一致
  const AREA_BOX = {
    '初級エリアボス装備選択箱': { tier:'初級', choices:[
      { name:'スライムの指輪', desc:'エリア①ボス装備・指輪。' },
      { name:'蒼粘剣', desc:'エリア①ボス装備・剣。' },
      { name:'略奪者の短剣', desc:'エリア②ボス装備・短剣。' },
      { name:'影踏みのブーツ', desc:'エリア②ボス装備・靴。' },
      { name:'古代魔導コア', desc:'エリア③ボス装備。' },
      { name:'虚無の杖', desc:'エリア③ボス装備・杖。' },
    ]},
    '中級エリアボス装備選択箱': { tier:'中級', choices:[
      { name:'海竜の鱗', desc:'エリア④ボス装備。' },
      { name:'アクアクラウン', desc:'エリア④ボス装備。' },
      { name:'雷鷲の爪牙', desc:'エリア⑤ボス装備。' },
      { name:'嵐の重装甲', desc:'エリア⑤ボス装備。' },
    ]},
    '上級エリアボス装備選択箱': { tier:'上級', choices:[
      { name:'絶零の魔導砲', desc:'エリア⑥ボス装備。' },
      { name:'フロストバーンの聖鎧', desc:'エリア⑥ボス装備。' },
      { name:'深紅の牙輪', desc:'エリア⑦ボス装備。' },
      { name:'深紅の魔眼石', desc:'エリア⑦ボス装備。' },
      { name:'インフェルノバスティオン', desc:'エリア⑦ボス装備。' },
    ]},
  }
  // アーティファクト装備選択箱（夏イベント報酬）: redeem_artifact_box の許可リストと一致
  const ARTIFACT_BOX_CHOICES = [
    { name:'黒星ノ断剣',   desc:'アーティファクト・剣。' },
    { name:'血哭ノ短刃',   desc:'アーティファクト・短剣。' },
    { name:'月影ノ断弓',   desc:'アーティファクト・弓。' },
    { name:'奈落ノ処刑斧', desc:'アーティファクト・斧。' },
    { name:'斬月ノ終刀',   desc:'アーティファクト・刀。' },
    { name:'虚無ノ閃砲',   desc:'アーティファクト・銃。' },
    { name:'星喰ノ導杖',   desc:'アーティファクト・杖。' },
    { name:'終焉ノ魔書',   desc:'アーティファクト・魔導書。' },
    { name:'冥哭ノ長槍',   desc:'アーティファクト・槍。' },
    { name:'深淵ノ霊珠',   desc:'アーティファクト・オーブ。' },
  ]

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    const { data: eq } = await supabase
      .from('player_equipment').select('*, weapons(*)')
      .eq('player_id', user.id).order('obtained_at')
    setEquipment((eq || []).filter(e => !e.listed))  // 取引所に出品中の装備は隠す
    const { data: prof } = await supabase
      .from('proficiency').select('*, weapons(*)')
      .eq('player_id', user.id)
    setProficiency(prof || [])
    const { data: pi } = await supabase
      .from('player_items').select('*, items(*)')
      .eq('player_id', user.id)
    setAllItems(pi || [])
    const { data: g } = await supabase.from('player_gems').select('*').eq('player_id', user.id)
    setGems(g || [])
    // 紋章（第5枠・開発限定）。SQL未適用/未付与なら無視
    try {
      const { data: em } = await supabase.from('player_emblem').select('*').eq('player_id', user.id).maybeSingle()
      setEmblemRow(em || null)
    } catch { /* 紋章未導入時は無視 */ }
    // 選択箱で選べる装備のステータス（weapons）を読み込み（選択時にステを表示するため）
    try {
      const boxNames = [...new Set([
        ...BEGINNER_BOX_CHOICES.map(c => c.name),
        ...Object.values(AREA_BOX).flatMap(b => b.choices.map(c => c.name)),
        ...ARTIFACT_BOX_CHOICES.map(c => c.name),
      ])]
      const { data: bw } = await supabase.from('weapons').select('*').in('name', boxNames)
      const map = {}; (bw || []).forEach(w => { map[w.name] = w }); setBoxWeapons(map)
    } catch { /* weapons取得失敗時はステ非表示 */ }
  }

  // 装備の種別は大分類（武器/防具/装飾品）にまとめて表示。slot(weapon/armor/accessory)基準。
  const TYPE_JP = { weapon:'武器', armor:'防具', accessory:'装飾品', accessory2:'装飾品', shield:'防具' }
  const jpType = (w) => TYPE_JP[w.slot] || TYPE_JP[w.weapon_type] || '装備'
  // レアリティのバッジ（普通の装備と同じ見た目・装備名の横に置く）
  const rarityBadge = (name) => {
    const w = boxWeapons[name]; if (!w?.rarity) return null
    const r = String(w.rarity).toLowerCase()
    return <span style={{ fontSize:'9px', padding:'1px 4px', marginRight:'5px', color: RARITY_COLORS[r] || '#999', border:`1px solid ${RARITY_COLORS[r] || '#999'}` }}>{RARITY_LABELS[r] || String(w.rarity).toUpperCase()}</span>
  }
  // 選択箱の候補装備のステータス表示（weapons情報から）
  const renderWeaponInfo = (name) => {
    const w = boxWeapons[name]
    if (!w) return null
    const typeStr = jpType(w)
    return (
      <div style={{ marginTop:'4px' }}>
        {typeStr && <div style={{ color:'#8899aa', fontSize:'9.5px', marginBottom:'2px' }}>{typeStr}</div>}
        <div style={{ fontSize:'10px', lineHeight:'1.7' }}>
          {w.atk_bonus  > 0 && <span style={{ color:'#ffcc00' }}>攻+{w.atk_bonus} </span>}
          {w.def_bonus  > 0 && <span style={{ color:'#88aaff' }}>防+{w.def_bonus} </span>}
          {w.matk_bonus > 0 && <span style={{ color:'#cc44ff' }}>特攻+{w.matk_bonus} </span>}
          {w.mdef_bonus > 0 && <span style={{ color:'#44ccff' }}>特防+{w.mdef_bonus} </span>}
          {w.spd_bonus  > 0 && <span style={{ color:'#ff8844' }}>速+{w.spd_bonus} </span>}
          {w.hp_bonus   > 0 && <span style={{ color:'#44ff88' }}>HP+{w.hp_bonus} </span>}
          {w.mp_bonus   > 0 && <span style={{ color:'#4488ff' }}>MP+{w.mp_bonus} </span>}
          {w.atk_bonus_pct  > 0 && <span style={{ color:'#ffcc00' }}>攻+{w.atk_bonus_pct}% </span>}
          {w.matk_bonus_pct > 0 && <span style={{ color:'#cc44ff' }}>特攻+{w.matk_bonus_pct}% </span>}
          {w.spd_bonus_pct  > 0 && <span style={{ color:'#ff8844' }}>速+{w.spd_bonus_pct}% </span>}
          {w.hp_bonus_pct   > 0 && <span style={{ color:'#44ff88' }}>HP+{w.hp_bonus_pct}% </span>}
          {w.mp_bonus_pct   > 0 && <span style={{ color:'#4488ff' }}>MP+{w.mp_bonus_pct}% </span>}
          {w.hit_bonus  > 0 && <span style={{ color:'#ffaa44' }}>命中+{w.hit_bonus}% </span>}
          {w.crit_bonus > 0 && <span style={{ color:'#ff6688' }}>クリ+{w.crit_bonus}% </span>}
          {w.crit_resist > 0 && <span style={{ color:'#66ccff' }}>クリ抵抗+{w.crit_resist}% </span>}
        </div>
        {w.effect && <div style={{ color:'#ffaa66', fontSize:'9.5px', marginTop:'2px' }}>{getEffectLabel(w.effect)}</div>}
      </div>
    )
  }

  // 選択箱／選択券の交換確認パネル（誤タップ防止。OKを押すまで消費しない）
  const renderPickConfirm = (accent, onOk) => (
    <>
      <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'16px', lineHeight:'1.6', textAlign:'center' }}>
        <span style={{ color:accent, fontSize:'13px' }}>{pickConfirm.name}</span> を受け取ります。<br/>
        <span style={{ color:'#ff8844', fontSize:'11px' }}>{pickConfirm.cost}を1{pickConfirm.unit}消費します。よろしいですか？</span>
      </div>
      {renderWeaponInfo(pickConfirm.name) && (
        <div style={{ border:'1px solid #223344', background:'#000c1c', padding:'8px', marginBottom:'14px' }}>
          {renderWeaponInfo(pickConfirm.name)}
        </div>
      )}
      <div style={{ display:'flex', gap:'8px' }}>
        <button onClick={onOk} disabled={loading}
          style={{ flex:1, padding:'10px', background:'#001028', border:`1px solid ${accent}`, color:accent, cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'12px', opacity: loading ? 0.5 : 1 }}>{loading ? '処理中...' : 'OK'}</button>
        <button onClick={() => setPickConfirm(null)} disabled={loading}
          style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>戻る</button>
      </div>
    </>
  )

  // 選択券を1枚消費してS級レイド装備へ交換（fetchAll 定義後に置く＝参照前定義のlint回避）
  const redeemRaidTicket = async (weaponName) => {
    if (loading) return
    setLoading(true); setTicketMsg(''); setTicketGot(null)
    const { data, error } = await supabase.rpc('redeem_raid_ticket', { p_weapon_name: weaponName })
    if (error || data?.error) {
      setTicketMsg(data?.error || 'エラーが発生しました')
    } else {
      setTicketGot(weaponName)  // ポップアップは閉じず、獲得表示を出す
      await fetchAll()
    }
    setPickConfirm(null)
    setLoading(false)
  }

  // 初級ボス装備選択箱：箱を1個消費して、選んだエリア①〜②のボス装備を受け取る（サーバーRPCで処理）
  const redeemBeginnerBossBox = async (weaponName) => {
    if (loading) return
    setLoading(true); setBossBoxMsg(''); setBossBoxGot(null)
    const { data, error } = await supabase.rpc('redeem_beginner_boss_box', { p_weapon_name: weaponName })
    if (error || !data?.ok) {
      setBossBoxMsg(data?.error || 'エラーが発生しました')
    } else {
      setBossBoxGot(weaponName)  // ポップアップは閉じず、獲得表示を出す
      await fetchAll()
    }
    setPickConfirm(null)
    setLoading(false)
  }

  // 初級/中級/上級エリアボス装備選択箱（②報酬）：箱を1個消費して対象エリアのボス装備を受け取る
  const redeemAreaBossBox = async (tier, weaponName) => {
    if (loading) return
    setLoading(true); setAreaBoxMsg(''); setAreaBoxGot(null)
    const { data, error } = await supabase.rpc('redeem_area_boss_box', { p_tier: tier, p_weapon_name: weaponName })
    if (error || !data?.ok) {
      setAreaBoxMsg(data?.error || 'エラーが発生しました')
    } else {
      setAreaBoxGot(weaponName)
      await fetchAll()
    }
    setPickConfirm(null)
    setLoading(false)
  }

  // アーティファクト装備選択箱：箱を1個消費して、選んだアーティファクト武器を受け取る（サーバーRPC）
  const redeemArtifactBox = async (weaponName) => {
    if (loading) return
    setLoading(true); setArtBoxMsg(''); setArtBoxGot(null)
    const { data, error } = await supabase.rpc('redeem_artifact_box', { p_weapon_name: weaponName })
    if (error || !data?.ok) {
      setArtBoxMsg(data?.error || 'エラーが発生しました')
    } else {
      setArtBoxGot(weaponName)
      await fetchAll()
    }
    setPickConfirm(null)
    setLoading(false)
  }

  // ボス装備進化支援箱：箱を1個消費して、選んだボスの血×10を受け取る（サーバーRPCで処理）
  const useBloodBox = async (bloodName) => {
    if (loading) return
    setLoading(true); setBoxMsg('')
    const { data, error } = await supabase.rpc('use_boss_blood_box', { p_blood_name: bloodName })
    if (error || data === false) {
      setBoxMsg(error?.message || '使用できませんでした（箱がない、または不正な選択）')
    } else {
      setBoxPopup(false); setBoxConfirm(null)
      setBoxToast(bloodName)
      setTimeout(() => setBoxToast(''), 2500)  // 獲得ポップアップは自動で消す
      await fetchAll()
    }
    setLoading(false)
  }

  // 装備命名券：+10以上の装備に好きな名前(12文字以内)を付ける。券を1枚消費。
  const RENAME_MAX = 12
  const applyRename = async () => {
    if (loading || !renamePopup) return
    const name = renameText.trim()
    if (name.length === 0) { setRenameMsg('名前を入力してください'); return }
    if ([...name].length > RENAME_MAX) { setRenameMsg(`${RENAME_MAX}文字以内で入力してください`); return }
    const target = equipment.find(e => e.id === renameTargetId)
    if (!target) { setRenameMsg('命名する装備を選んでください'); return }
    if (!target.equipped) { setRenameMsg('装備中の装備にのみ命名できます'); return }
    if ((target.enhance_plus || 0) < 7) { setRenameMsg('+7以上の装備にのみ命名できます'); return }
    setRenameMsg('')
    setLoading(true)
    const pi = renamePopup
    // 券を1枚消費（楽観ロック：数量が読取時と一致するときだけ消費）
    if ((pi.quantity || 0) > 1) {
      const { data: upd } = await supabase.from('player_items').update({ quantity: pi.quantity - 1 }).eq('id', pi.id).eq('quantity', pi.quantity).select('id')
      if (!upd || upd.length === 0) { setRenameMsg('処理に失敗しました。もう一度お試しください。'); await fetchAll(); setLoading(false); return }
    } else {
      const { data: del } = await supabase.from('player_items').delete().eq('id', pi.id).eq('quantity', pi.quantity).select('id')
      if (!del || del.length === 0) { setRenameMsg('処理に失敗しました。もう一度お試しください。'); await fetchAll(); setLoading(false); return }
    }
    await supabase.from('player_equipment').update({ custom_name: name }).eq('id', target.id)
    await fetchAll()
    setRenamePopup(null); setRenameTargetId(null); setRenameText(''); setRenameMsg('')
    setAwakenMessage(`✨ 「${name}」と命名した！`)
    setTimeout(() => setAwakenMessage(''), 3000)
    setLoading(false)
  }

  const HP_RECIPE = ['森の生命液','荒野の薬草','古代の精髄']
  const MP_RECIPE = ['蒼海の精気','雷鳴の精気','霜の精気']

  const getMaterialQty = (name) => {
    const pi = allItems.find(i => i.items?.name === name)
    return pi?.quantity || 0
  }

  const hasInfinitePotion = (effect) => allItems.some(i => i.items?.effect === effect)

  const craftPotion = async (recipe, potionEffect) => {
    if (loading) return
    if (craftBusyRef.current) return  // 連打ガード（二重作成＝素材二重消費/無限ポーション複製を防ぐ）
    craftBusyRef.current = true
    setLoading(true)
    setCraftMsg('')
    try {
    // 無限ポーションは1個のみ。既に所持していれば作成しない（連打での複製防止）
    if (hasInfinitePotion(potionEffect)) { setCraftMsg('すでに所持しています'); setTimeout(()=>setCraftMsg(''),3000); return }
    const { data: potionItem } = await supabase.from('items').select('*').eq('effect', potionEffect).single()
    if (!potionItem) { return }
    // 素材を楽観ロックで1個ずつ消費。1つでも消費できなければ中断（不整合な消費・複製を防ぐ）
    for (const matName of recipe) {
      const pi = allItems.find(i => i.items?.name === matName)
      if (!pi || (pi.quantity||0) < 1) { setCraftMsg('素材が足りません'); setTimeout(()=>setCraftMsg(''),3000); await fetchAll(); return }
      if (pi.quantity > 1) {
        const { data: upd } = await supabase.from('player_items').update({ quantity: pi.quantity - 1 }).eq('id', pi.id).eq('quantity', pi.quantity).select('id')
        if (!upd || upd.length === 0) { setCraftMsg('作成に失敗しました。もう一度お試しください。'); setTimeout(()=>setCraftMsg(''),3000); await fetchAll(); return }
      } else {
        const { data: del } = await supabase.from('player_items').delete().eq('id', pi.id).eq('quantity', pi.quantity).select('id')
        if (!del || del.length === 0) { setCraftMsg('作成に失敗しました。もう一度お試しください。'); setTimeout(()=>setCraftMsg(''),3000); await fetchAll(); return }
      }
    }
    await supabase.from('player_items').insert({ player_id: profile.id, item_id: potionItem.id, quantity: 1, equipped: false })
    await fetchAll()
    setCraftMsg(`✨ ${potionItem.name} を作成した！`)
    setTimeout(() => setCraftMsg(''), 3000)
    } finally { setLoading(false); craftBusyRef.current = false }
  }

  // 一括合成：合成可能なものをすべてシミュレート（カスケード対応）
  const calcBulkSynthesis = () => {
    // 現在の所持数をコピー: { gemType: { rank: quantity } }
    const map = {}
    for (const gm of gems) {
      if (!map[gm.gem_type]) map[gm.gem_type] = {}
      map[gm.gem_type][gm.rank] = (map[gm.gem_type][gm.rank] || 0) + (gm.quantity || 0)
    }
    const before = Object.entries(map).flatMap(([gt, ranks]) =>
      Object.entries(ranks).filter(([,q]) => q > 0).map(([r, q]) => ({ gem_type: gt, rank: r, quantity: q }))
    )
    const ops = [] // { gemType, fromRank, toRank, count }
    // 低ランクから順に合成（カスケード）
    for (const gemType of Object.keys(map)) {
      for (let ri = 0; ri < GEM_RANKS.length - 1; ri++) {
        const rank = GEM_RANKS[ri]
        const nextRank = GEM_RANKS[ri + 1]
        const qty = map[gemType][rank] || 0
        const n = Math.floor(qty / 3)
        if (n > 0) {
          map[gemType][rank] -= n * 3
          map[gemType][nextRank] = (map[gemType][nextRank] || 0) + n
          ops.push({ gemType, fromRank: rank, toRank: nextRank, count: n })
        }
      }
    }
    const after = Object.entries(map).flatMap(([gt, ranks]) =>
      Object.entries(ranks).filter(([,q]) => q > 0).map(([r, q]) => ({ gem_type: gt, rank: r, quantity: q }))
    )
    return { ops, before, after }
  }

  const openBulkPreview = () => {
    const result = calcBulkSynthesis()
    if (result.ops.length === 0) return
    setBulkPreview(result)
  }

  const executeBulkSynthesis = async () => {
    if (!bulkPreview || loading) return
    if (craftBusyRef.current) return  // 連打ガード（宝石の二重消費/複製を防ぐ）
    craftBusyRef.current = true
    setLoading(true)
    try {
    for (const op of bulkPreview.ops) {
      // fromRankを消費（楽観ロック：所持数が読取時と一致する時だけ-。失敗ならその操作をスキップ）
      const fromRow = gems.find(g => g.gem_type === op.gemType && g.rank === op.fromRank)
      if (!fromRow || (fromRow.quantity || 0) < op.count * 3) continue
      const newQty = (fromRow.quantity || 0) - op.count * 3
      const { data: consumed } = await supabase.from('player_gems')
        .update({ quantity: newQty }).eq('id', fromRow.id).eq('quantity', fromRow.quantity).select('id')
      if (!consumed || consumed.length === 0) continue  // 競合が起きた操作は付与せずスキップ
      if (newQty <= 0) await supabase.from('player_gems').delete().eq('id', fromRow.id).eq('quantity', 0)
      // toRankを付与（既存があればupdate、なければinsert）
      const toRow = gems.find(g => g.gem_type === op.gemType && g.rank === op.toRank)
      if (toRow) await supabase.from('player_gems').update({ quantity: (toRow.quantity || 0) + op.count }).eq('id', toRow.id)
      else await supabase.from('player_gems').insert({ player_id: profile.id, gem_type: op.gemType, rank: op.toRank, quantity: op.count })
    }
    await fetchAll()
    setBulkPreview({ done: true })
    } finally { setLoading(false); craftBusyRef.current = false }
  }

  // 宝石：同種3個→上位ランク1個に合成
  const combineGem = async (gemRow) => {
    if (loading) return
    const i = GEM_RANKS.indexOf(gemRow.rank)
    if (i < 0 || i >= GEM_RANKS.length - 1) return
    setLoading(true)
    const { data: cur } = await supabase.from('player_gems').select('*').eq('id', gemRow.id).single()
    if (!cur || cur.quantity < 3) { await fetchAll(); setLoading(false); return }
    const remain = cur.quantity - 3
    if (remain <= 0) await supabase.from('player_gems').delete().eq('id', cur.id)
    else await supabase.from('player_gems').update({ quantity: remain }).eq('id', cur.id)
    const nextRank = GEM_RANKS[i + 1]
    const { data: ex } = await supabase.from('player_gems').select('*').eq('player_id', profile.id).eq('gem_type', cur.gem_type).eq('rank', nextRank).maybeSingle()
    if (ex) await supabase.from('player_gems').update({ quantity: (ex.quantity || 1) + 1 }).eq('id', ex.id)
    else await supabase.from('player_gems').insert({ player_id: profile.id, gem_type: cur.gem_type, rank: nextRank, quantity: 1 })
    await fetchAll(); setLoading(false)
  }

  // 宝石を在庫へ戻す（取り外し・上書き時の共通処理）
  const returnGemToStock = async (gemType, rank) => {
    const { data: ex } = await supabase.from('player_gems').select('*').eq('player_id', profile.id).eq('gem_type', gemType).eq('rank', rank).maybeSingle()
    if (ex) await supabase.from('player_gems').update({ quantity: (ex.quantity || 1) + 1 }).eq('id', ex.id)
    else await supabase.from('player_gems').insert({ player_id: profile.id, gem_type: gemType, rank, quantity: 1 })
  }

  // 宝石を選択中の装備ソケットに埋め込む
  const embedGem = async (gemRow) => {
    if (loading || !embedTarget) return
    const target = equipment.find(e => e.id === embedTarget)
    if (!target) return
    if (!gemAllowedSlots(gemRow.gem_type).includes(gemSlotCategory(target.slot))) return  // 部位制限
    setLoading(true)
    if (target.gem_type && target.gem_rank) await returnGemToStock(target.gem_type, target.gem_rank)
    const remain = (gemRow.quantity || 1) - 1
    if (remain <= 0) await supabase.from('player_gems').delete().eq('id', gemRow.id)
    else await supabase.from('player_gems').update({ quantity: remain }).eq('id', gemRow.id)
    await supabase.from('player_equipment').update({ gem_type: gemRow.gem_type, gem_rank: gemRow.rank }).eq('id', target.id)
    await fetchAll(); setLoading(false)
  }

  // 装備から宝石を取り外して在庫へ
  const unembedGem = async (eq) => {
    if (loading || !eq.gem_type) return
    setLoading(true)
    await returnGemToStock(eq.gem_type, eq.gem_rank)
    await supabase.from('player_equipment').update({ gem_type: null, gem_rank: null }).eq('id', eq.id)
    await fetchAll(); setLoading(false)
  }

  const equip = async (item) => {
    setLoading(true)
    await supabase.from('player_equipment').update({ equipped: false }).eq('player_id', profile.id).eq('slot', item.slot).eq('equipped', true)
    await supabase.from('player_equipment').update({ equipped: true }).eq('id', item.id)
    if (item.slot === 'weapon') {
      // 装備インスタンス(item.id)ごとに熟練度を管理
      const { data: existing } = await supabase.from('proficiency').select('id').eq('player_id', profile.id).eq('equipment_id', item.id).maybeSingle()
      if (!existing) {
        await supabase.from('proficiency').insert({ player_id: profile.id, weapon_id: item.weapons.id, equipment_id: item.id, prof_exp: 0, prof_lv: 0, awakening: 0 })
      }
    }
    await fetchAll()
    setLoading(false)
  }

  // お気に入り切替：ONにすると加工・寄贈の対象から外れる（誤操作防止）
  const toggleFavorite = async (item) => {
    setLoading(true)
    const next = !item.is_favorite
    // 楽観更新（即座にUI反映）
    setEquipment(prev => prev.map(e => e.id === item.id ? { ...e, is_favorite: next } : e))
    await supabase.from('player_equipment').update({ is_favorite: next }).eq('id', item.id)
    setLoading(false)
  }

  const unequip = async (item) => {
    setLoading(true)
    await supabase.from('player_equipment').update({ equipped: false }).eq('id', item.id)
    await fetchAll()
    setLoading(false)
  }

  const changeSlot = async (item, newSlot) => {
    setLoading(true)
    await supabase.from('player_equipment').update({ equipped: false }).eq('player_id', profile.id).eq('slot', newSlot).eq('equipped', true)
    await supabase.from('player_equipment').update({ slot: newSlot, equipped: true }).eq('id', item.id)
    await fetchAll()
    setLoading(false)
  }

  const setItemSlot = async (itemId) => {
    setLoading(true)
    await supabase.from('player_items').update({ equipped: false }).eq('player_id', profile.id)
    if (itemId) await supabase.from('player_items').update({ equipped: true }).eq('id', itemId)
    await fetchAll()
    setLoading(false)
  }

  const setItemThreshold = async (itemId, threshold) => {
    setLoading(true)
    await supabase.from('player_items').update({ use_threshold: threshold }).eq('id', itemId)
    await fetchAll()
    setLoading(false)
  }

  const useStatReset = async (pi) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('reset_stat_points')
    if (error || !data?.ok) {
      if (data?.reason === 'war_locked') alert('⚔ 戦争中は記憶除去（ステータス振り直し）が使えません。')
      setLoading(false); setConfirmReset(null); return
    }
    if (pi.quantity > 1) {
      await supabase.from('player_items').update({ quantity: pi.quantity - 1 }).eq('id', pi.id)
    } else {
      await supabase.from('player_items').delete().eq('id', pi.id)
    }
    await fetchAll()
    setConfirmReset(null)
    setLoading(false)
  }

  const doAwaken = async (item) => {
    setLoading(true)
    const evolvedName = ARTIFACT_EVOLVED[item.weapons.name]
    if (!evolvedName) { setLoading(false); return }
    const { data: evolvedWeapon } = await supabase.from('weapons').select('*').eq('name', evolvedName).single()
    if (!evolvedWeapon) { setLoading(false); return }
    await supabase.from('player_equipment').update({ weapon_id: evolvedWeapon.id, bonus_effect: 'artifact' }).eq('id', item.id)
    // 覚醒後は熟練度をLV1・EXP0にリセット（この装備インスタンス）
    await supabase.from('proficiency').update({ prof_lv: 0, prof_exp: 0 }).eq('player_id', profile.id).eq('equipment_id', item.id)
    setAwakenMessage(`✨ ${evolvedName} に覚醒した！`)
    setTimeout(() => setAwakenMessage(''), 3000)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  const slots = ['weapon', 'armor', 'accessory']
  const equippedSlots = ['weapon', 'armor', 'accessory', 'accessory2']
  const filteredEquipment = sortEquipment(equipment.filter(e => tab === 'accessory' ? (e.slot === 'accessory' || e.slot === 'accessory2') : e.slot === tab), sortKey)
  const equippedItem = allItems.find(i => i.equipped)

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        {awakenMessage && (
          <div style={{ color:'#ffcc00', fontSize:'14px', textAlign:'center', padding:'12px', border:'1px solid #ffcc00', marginBottom:'12px', background:'#1a1000' }}>{awakenMessage}</div>
        )}

        {/* 装備中セクション（横並び） */}
        <div style={{ marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>装備中</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'6px' }}>
            {equippedSlots.map(slot => {
              const equipped = equipment.find(e => e.slot === slot && e.equipped)
              const plus = equipped?.enhance_plus || 0
              const enhW = equipped ? calcEnhancedStats(equipped.weapons, plus, equipped.evolve_stage || 0) : null
              return (
                <div key={slot} style={{ border:'1px solid #003366', background:'#001028', padding:'8px' }}>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'3px' }}>{SLOT_LABELS[slot]}</div>
                  {equipped ? (
                    <>
                      <div style={{ color: RARITY_COLORS[displayRarity(equipped)], fontSize:'11px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {getProfPrefix(proficiency.find(p => p.equipment_id === equipped.id)?.prof_lv || 0)}
                        {equipped.custom_name ? <span style={{color:'#ff99cc'}}>{equipped.custom_name}</span> : equipped.weapons.name}
                        {isShinka(equipped) && <span style={{color:'#ffcc00'}}>★</span>}
                        {plus > 0 && <span style={{color:'#ffcc00'}}> +{plus}</span>}
                      </div>
                      <div style={{ fontSize:'9px', color: RARITY_COLORS[displayRarity(equipped)] }}>{RARITY_LABELS[displayRarity(equipped)]}</div>
                      <div style={{ fontSize:'9px', marginTop:'2px', lineHeight:'1.4' }}>
                        {enhW.hp_bonus   > 0 && <span style={{color:'#44ff88'}}>HP+{enhW.hp_bonus} </span>}
                        {enhW.mp_bonus   > 0 && <span style={{color:'#4488ff'}}>MP+{enhW.mp_bonus} </span>}
                        {enhW.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻+{enhW.atk_bonus} </span>}
                        {enhW.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防+{enhW.def_bonus} </span>}
                        {enhW.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特攻+{enhW.matk_bonus} </span>}
                        {enhW.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特防+{enhW.mdef_bonus} </span>}
                        {enhW.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>速+{enhW.spd_bonus} </span>}
                      </div>
                      {equipped.bonus_effect && equipped.bonus_effect !== 'artifact' && <div style={{color:'#ffaa00', fontSize:'9px'}}>{getEffectLabel(equipped.bonus_effect)}</div>}
                      {equipped.bonus_effect === 'artifact' && <div style={{color:'#44ccff', fontSize:'9px'}}>【特殊能力】{getEffectLabel(equipped.bonus_effect)}</div>}
                    </>
                  ) : (
                    <div style={{ color:'#334455', fontSize:'11px' }}>なし</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 第5枠: 紋章（エリア⑤踏破で解放） */}
          {isHachigokuUnlocked(profile) && (() => {
            const emLevel = emblemRow?.level || 1
            const emRank = getEmblemRank(emblemAllocTotal(emblemRow?.alloc))  // ランクは結晶の使用個数で決まる
            const b = calcEmblemBonus(emblemRow?.alloc)
            // 上昇しているステータスだけをチップで表示
            const effChips = [
              b.flat.atk  > 0 && `攻撃+${b.flat.atk}`,
              b.flat.def  > 0 && `防御+${b.flat.def}`,
              b.flat.matk > 0 && `特攻+${b.flat.matk}`,
              b.flat.mdef > 0 && `特防+${b.flat.mdef}`,
              b.physDmg   > 0 && `物理ダメ+${b.physDmg}%`,
              b.specialDmg> 0 && `特殊ダメ+${b.specialDmg}%`,
              b.defPen    > 0 && `物防貫通+${b.defPen}%`,
              b.mdefPen   > 0 && `特防貫通+${b.mdefPen}%`,
              b.dotUp.bleed > 0 && `出血ダメ+${b.dotUp.bleed}%`,
              b.dotUp.burn  > 0 && `やけどダメ+${b.dotUp.burn}%`,
              b.dotUp.poison> 0 && `毒ダメ+${b.dotUp.poison}%`,
              b.physDrain > 0 && `物理吸収+${b.physDrain}%`,
              b.specialDrain > 0 && `特殊吸収+${b.specialDrain}%`,
              b.evasion   > 0 && `回避+${b.evasion}%`,
              b.crit      > 0 && `クリ率+${b.crit}%`,
              b.critDmg   > 0 && `クリ威力+${b.critDmg}%`,
              b.critResist> 0 && `クリ抵抗+${b.critResist}%`,
              b.ailRes.poison    > 0 && `毒耐性+${b.ailRes.poison}%`,
              b.ailRes.paralysis > 0 && `麻痺耐性+${b.ailRes.paralysis}%`,
              b.ailRes.burn      > 0 && `やけど耐性+${b.ailRes.burn}%`,
              b.ailRes.bleed     > 0 && `出血耐性+${b.ailRes.bleed}%`,
              b.ailRes.stun      > 0 && `スタン耐性+${b.ailRes.stun}%`,
            ].filter(Boolean)
            return (
              <div onClick={()=>nav('/emblem')} style={{ border:'1px solid #335588', background:'#001028', padding:'8px', marginBottom:'6px', cursor:'pointer' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <span style={{ color:'#446688', fontSize:'10px' }}>紋章</span>
                    <span style={{ color:'#aaccff', fontSize:'11px', marginLeft:'8px' }}>LV {emLevel}</span>
                    <span style={{ color: EMBLEM_RANK_COLOR[emRank], fontSize:'11px', marginLeft:'8px' }}>ランク {emRank}</span>
                  </div>
                  <span style={{ color:'#4488ff', fontSize:'11px' }}>強化 ▶</span>
                </div>
                <div style={{ marginTop:'5px', display:'flex', flexWrap:'wrap', gap:'3px' }}>
                  {effChips.length > 0 ? effChips.map((c, i) => (
                    <span key={i} style={{ fontSize:'9px', color:'#66dd99', background:'#02201a', border:'1px solid #1a4a3a', borderRadius:'3px', padding:'1px 5px' }}>{c}</span>
                  )) : <span style={{ fontSize:'9px', color:'#556677' }}>結晶を割り振ると効果が表示されます</span>}
                </div>
              </div>
            )
          })()}

          {/* 持ち物 */}
          <div style={{ border:'1px solid #003366', background:'#001028', padding:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ color:'#446688', fontSize:'10px' }}>持ち物</span>
              {equippedItem ? (
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ color:'#44ff88', fontSize:'11px' }}>{equippedItem.items.name}</span>
                  <span style={{ color:'#446688', fontSize:'10px' }}>×{equippedItem.quantity}</span>
                  {(equippedItem.items.effect === 'hp_pct' || equippedItem.items.effect === 'mp_pct') && (
                    <select value={equippedItem.use_threshold || 50} onChange={e => setItemThreshold(equippedItem.id, Number(e.target.value))}
                      style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'1px' }}>
                      {[10,20,30,40,50,60,70,80,90,100].map(n => <option key={n} value={n}>{n}%以下</option>)}
                    </select>
                  )}
                  <button onClick={() => setItemSlot(null)} disabled={loading}
                    style={{ padding:'2px 6px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                </div>
              ) : (
                <span style={{ color:'#334455', fontSize:'11px' }}>なし</span>
              )}
            </div>
          </div>
        </div>

        {/* 所持装備 */}
        <div>
            <div style={{ display:'flex', gap:'4px', marginBottom:'6px', flexWrap:'wrap' }}>
              {(view === 'items' ? ['item', 'treasure'] : view === 'gear' ? [...slots, 'gem'] : [...slots, 'item', 'gem', 'treasure']).map(s => (
                <button key={s} onClick={() => setTab(s)}
                  style={{ padding:'4px 8px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background: tab === s ? '#001840' : '#000818',
                    border: `1px solid ${tab === s ? '#ffcc00' : '#003366'}`,
                    color: tab === s ? '#ffcc00' : '#446688' }}>
                  {s === 'item' ? 'アイテム' : s === 'gem' ? '宝石' : s === 'treasure' ? 'お宝' : s === 'accessory' ? '装飾品' : SLOT_LABELS[s]}
                </button>
              ))}
            </div>

            {tab !== 'item' && tab !== 'gem' && (
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px', fontSize:'11px' }}>
                <span style={{color:'#446688'}}>並び替え:</span>
                <select value={sortKey} onChange={e => { const v=e.target.value; setSortKey(v); localStorage.setItem('equipSortKey',v) }}
                  style={{ background:'#001028', border:'1px solid #003366', color:'#88ccff', fontFamily:'monospace', fontSize:'11px', padding:'2px 4px' }}>
                  <option value="obtained_asc">入手順（古い順）</option>
                  <option value="obtained_desc">入手順（新しい順）</option>
                  <option value="rarity_asc">レアリティ（低い順）</option>
                  <option value="rarity_desc">レアリティ（高い順）</option>
                </select>
              </div>
            )}

            {tab === 'item' && (
              <div>
                {allItems.filter(i => i.items?.effect !== 'hp_pct_infinite' && i.items?.effect !== 'mp_pct_infinite').length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>所持していません</div>}
                {allItems.filter(i => i.items?.effect !== 'hp_pct_infinite' && i.items?.effect !== 'mp_pct_infinite').map(pi => (
                  <div key={pi.id} style={{ border:`1px solid ${pi.equipped ? '#0044aa' : '#002244'}`, background: pi.equipped ? '#001028' : '#000818', padding:'10px', marginBottom:'6px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                      <span style={{ color:'#44ff88', fontSize:'12px' }}>{pi.items.name}</span>
                      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                        <span style={{ color:'#446688', fontSize:'10px' }}>×{pi.quantity}</span>
                        {(pi.items.effect === 'enhance_stone' || pi.items.name?.includes('依頼書')) ? (
                          <span style={{ color:'#aa8800', fontSize:'10px' }}>強化素材</span>
                        ) : (pi.items.effect?.startsWith('casino_area') || pi.items.effect?.endsWith('_proof') || pi.items.effect === 'exp_dungeon_ticket') ? (
                          <span style={{ color:'#cc44ff', fontSize:'10px' }}>大切なもの</span>
                        ) : pi.items.effect === 'stat_reset' ? (
                          <button onClick={() => setConfirmReset(pi)} disabled={loading}
                            style={{ padding:'2px 8px', background:'#200010', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.items.name === 'Sレアレイドボス装備選択券' ? (
                          <button onClick={() => { setTicketPopup(true); setTicketMsg(''); setTicketGot(null) }} disabled={loading}
                            style={{ padding:'2px 8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.items.name === '初級ボス装備選択箱' ? (
                          <button onClick={() => { setBossBoxPopup(true); setBossBoxMsg(''); setBossBoxGot(null) }} disabled={loading}
                            style={{ padding:'2px 8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : AREA_BOX[pi.items.name] ? (
                          <button onClick={() => { setAreaBox({ name: pi.items.name, ...AREA_BOX[pi.items.name] }); setAreaBoxMsg(''); setAreaBoxGot(null) }} disabled={loading}
                            style={{ padding:'2px 8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.items.name === 'アーティファクト装備選択箱' ? (
                          <button onClick={() => { setArtBox(true); setArtBoxMsg(''); setArtBoxGot(null) }} disabled={loading}
                            style={{ padding:'2px 8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.items.effect === 'equip_rename' ? (
                          <button onClick={() => { setRenamePopup(pi); setRenameTargetId(null); setRenameText(''); setRenameMsg('') }} disabled={loading}
                            style={{ padding:'2px 8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.items.effect === 'boss_blood_box' ? (
                          <button onClick={() => { setBoxPopup(true); setBoxMsg('') }} disabled={loading}
                            style={{ padding:'2px 8px', background:'#1a1400', border:'1px solid #ff88aa', color:'#ff88aa', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>使用する</button>
                        ) : pi.items.effect === 'material' ? (
                          <span style={{ color:'#aa8800', fontSize:'10px' }}>素材</span>
                        ) : pi.equipped ? (
                          <span style={{ color:'#0088ff', fontSize:'10px' }}>セット中</span>
                        ) : (
                          <button onClick={() => setItemSlot(pi.id)} disabled={loading}
                            style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>セットする</button>
                        )}
                      </div>
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>{pi.items.description}</div>
                    {pi.equipped && (pi.items.effect === 'hp_pct' || pi.items.effect === 'mp_pct' || pi.items.effect === 'hp_pct_infinite' || pi.items.effect === 'mp_pct_infinite') && (
                      <div style={{ display:'flex', alignItems:'center', gap:'4px', marginTop:'4px' }}>
                        <span style={{ color:'#446688', fontSize:'10px' }}>使用タイミング:</span>
                        <select value={pi.use_threshold || 50} onChange={e => setItemThreshold(pi.id, Number(e.target.value))}
                          style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'1px' }}>
                          {[10,20,30,40,50,60,70,80,90,100].map(n => <option key={n} value={n}>{n}%以下で使用</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab !== 'item' && tab !== 'gem' && (
              <div>
                {filteredEquipment.length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>所持していません</div>}
                {filteredEquipment.map(item => {
                  const w = item.weapons
                  const plus = item.enhance_plus || 0
                  const enhW = calcEnhancedStats(w, plus, item.evolve_stage || 0)
                  // 「元:」表示用の基礎ステ＝強化(+N)前・進化倍率は反映済み（真化で基礎ステが2倍になるのを正しく表示）
                  const baseW = calcEnhancedStats(w, 0, item.evolve_stage || 0)
                  const isArtifactBase = ARTIFACT_BASE_NAMES.includes(w.name)
                  const prof = tab === 'weapon' ? proficiency.find(p => p.equipment_id === item.id) : null
                  const profBonus = prof ? calcProfBonus(prof, w, item.evolve_stage || 0) : {}
                  const profPct = prof ? Math.min(100, (prof.prof_exp / 100) * 100) : 0
                  const profPrefix = prof ? getProfPrefix(prof.prof_lv) : ''
                  const canAwaken = isArtifactBase && prof && prof.prof_lv >= 300
                  const hasBonus = item.bonus_atk > 0 || item.bonus_def > 0 || item.bonus_matk > 0 || item.bonus_mdef > 0 || item.bonus_spd > 0 || item.bonus_hp > 0 || item.bonus_mp > 0 || (item.bonus_crit||0) > 0 || (item.bonus_evasion||0) > 0 || (item.bonus_hit||0) > 0 || (item.bonus_effect && item.bonus_effect !== 'artifact')
                  const isAccessory = tab === 'accessory'

                  return (
                    <div key={item.id} style={{ border:`1px solid ${item.equipped ? '#0044aa' : '#002244'}`, background: item.equipped ? '#001028' : '#000818', padding:'10px', marginBottom:'6px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                          <span style={{ fontSize:'9px', padding:'1px 4px', color: RARITY_COLORS[displayRarity(item)], border:`1px solid ${RARITY_COLORS[displayRarity(item)]}` }}>{RARITY_LABELS[displayRarity(item)]}</span>
                          <span style={{ color: RARITY_COLORS[displayRarity(item)], fontSize:'12px' }}>
                            {profPrefix}
                            {item.custom_name ? <span style={{color:'#ff99cc'}}>{item.custom_name}</span> : w.name}
                            {isShinka(item) && <span style={{ color:'#ffcc00' }}>★</span>}
                          </span>
                          {item.custom_name && <span style={{ color:'#667788', fontSize:'9px' }}>({w.name})</span>}
                          {plus > 0 && !isArtifactBase && <span style={{ color:'#ffcc00', fontSize:'11px', fontWeight:'bold' }}>+{plus}</span>}
                        </div>
                        <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                          {item.is_bound && (
                            <span title="帰属（取引所で入手・再出品不可／強化・加工は可）" style={{ fontSize:'9px', padding:'2px 5px', color:'#cc88ff', border:'1px solid #6644aa', borderRadius:'3px' }}>帰属</span>
                          )}
                          <button onClick={() => toggleFavorite(item)} disabled={loading}
                            title={item.is_favorite ? 'お気に入り解除（加工・寄贈できるようになる）' : 'お気に入り登録（加工・寄贈されなくなる）'}
                            style={{ padding:'2px 6px', background: item.is_favorite ? '#2a2000' : '#001', border:`1px solid ${item.is_favorite ? '#ffcc00' : '#334455'}`, color: item.is_favorite ? '#ffcc00' : '#445566', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>{item.is_favorite ? '★' : '☆'}</button>
                          {canAwaken && (
                            <button onClick={() => doAwaken(item)} disabled={loading}
                              style={{ padding:'2px 8px', background:'#1a0800', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>✨ 覚醒</button>
                          )}
                          {item.equipped ? (
                            <button onClick={() => unequip(item)} disabled={loading}
                              style={{ padding:'2px 8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                          ) : (
                            <>
                              <button onClick={() => isAccessory ? changeSlot(item, 'accessory') : equip(item)} disabled={loading}
                                style={{ padding:'2px 8px', background:'#001840', border:'1px solid #0044aa', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>{isAccessory ? '装飾品①' : '装備'}</button>
                              {isAccessory && (
                                <button onClick={() => changeSlot(item, 'accessory2')} disabled={loading}
                                  style={{ padding:'2px 8px', background:'#001840', border:'1px solid #4466aa', color:'#88aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>装飾品②</button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* 強化後ステータス表示 */}
                      <div style={{ fontSize:'10px', color:'#446688', marginBottom:'4px' }}>
                        {enhW.atk_bonus  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{enhW.atk_bonus}{plus>0&&!isArtifactBase&&w.atk_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{baseW.atk_bonus})</span>:null} </span>}
                        {enhW.def_bonus  > 0 && <span style={{color:'#88aaff'}}>防御力+{enhW.def_bonus}{plus>0&&!isArtifactBase&&w.def_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{baseW.def_bonus})</span>:null} </span>}
                        {enhW.matk_bonus > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{enhW.matk_bonus}{plus>0&&!isArtifactBase&&w.matk_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{baseW.matk_bonus})</span>:null} </span>}
                        {enhW.mdef_bonus > 0 && <span style={{color:'#44ccff'}}>特殊防御力+{enhW.mdef_bonus}{plus>0&&!isArtifactBase&&w.mdef_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{baseW.mdef_bonus})</span>:null} </span>}
                        {enhW.spd_bonus  > 0 && <span style={{color:'#ff8844'}}>素早さ+{enhW.spd_bonus}{plus>0&&!isArtifactBase&&w.spd_bonus>0?<span style={{color:'#888',fontSize:'9px'}}>(元:{baseW.spd_bonus})</span>:null} </span>}
                        {w.spd_bonus_pct > 0 && <span style={{color:'#ff8844'}}>素早さ+{w.spd_bonus_pct}% </span>}
                        {enhW.hp_bonus   > 0 && <span style={{color:'#44ff88'}}>HP+{enhW.hp_bonus} </span>}
                        {enhW.mp_bonus   > 0 && <span style={{color:'#4488ff'}}>MP+{enhW.mp_bonus} </span>}
                        {w.hp_bonus_pct  > 0 && <span style={{color:'#44ff88'}}>HP+{w.hp_bonus_pct}% </span>}
                        {w.mp_bonus_pct  > 0 && <span style={{color:'#4488ff'}}>MP+{w.mp_bonus_pct}% </span>}
                        {w.atk_bonus_pct  > 0 && <span style={{color:'#ffcc00'}}>攻撃力+{w.atk_bonus_pct}% </span>}
                        {w.matk_bonus_pct > 0 && <span style={{color:'#cc44ff'}}>特殊攻撃力+{w.matk_bonus_pct}% </span>}
                        {w.hit_bonus     > 0 && <span style={{color:'#ffaa44'}}>命中+{w.hit_bonus}% </span>}
                        {w.crit_bonus    > 0 && <span style={{color:'#ff6688'}}>クリ率+{w.crit_bonus}% </span>}
                        {w.crit_resist   > 0 && <span style={{color:'#66ccff'}}>クリ抵抗+{w.crit_resist}% </span>}
                      </div>

                      {hasBonus && (
                        <div style={{ fontSize:'10px', color:'#ffaa00', marginBottom:'4px' }}>
                          ボーナス:
                          {item.bonus_atk  > 0 && ` 攻撃力+${item.bonus_atk}`}
                          {item.bonus_def  > 0 && ` 防御力+${item.bonus_def}`}
                          {item.bonus_matk > 0 && ` 特殊攻撃力+${item.bonus_matk}`}
                          {item.bonus_mdef > 0 && ` 特殊防御力+${item.bonus_mdef}`}
                          {item.bonus_spd  > 0 && ` 素早さ+${item.bonus_spd}`}
                          {item.bonus_hp   > 0 && ` HP+${item.bonus_hp}`}
                          {item.bonus_mp   > 0 && ` MP+${item.bonus_mp}`}
                          {(item.bonus_crit||0) > 0 && ` クリティカル率+${item.bonus_crit}%`}
                          {(item.bonus_evasion||0) > 0 && ` 回避率+${item.bonus_evasion}%`}
                          {(item.bonus_hit||0) > 0 && ` 命中率+${item.bonus_hit}%`}
                        </div>
                      )}
                      {item.bonus_effect && item.bonus_effect !== 'artifact' && <div style={{ fontSize:'10px', color:'#ffaa00', marginBottom:'4px' }}>{getEffectLabel(item.bonus_effect)}</div>}
                      {item.bonus_effect === 'artifact' && <div style={{ fontSize:'10px', color:'#44ccff', marginBottom:'4px' }}>【特殊能力】{getEffectLabel(item.bonus_effect)}</div>}

                      {tab === 'weapon' && prof && item.equipped && (
                        <div>
                          <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
                            <span>{profPrefix}熟練度 LV{prof.prof_lv}</span>
                            <span>{prof.prof_exp}/100</span>
                          </div>
                          <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'2px' }}>
                            <div style={{ height:'100%', width:`${profPct}%`, background:'linear-gradient(90deg,#220044,#aa44ff)' }} />
                          </div>
                          {Object.keys(profBonus).length > 0 && (
                            <div style={{ fontSize:'10px', color:'#aa44ff' }}>
                              熟練度ボーナス: {Object.entries(profBonus).map(([k,v]) => {
                                const label = k==='atk'?'攻撃力':k==='matk'?'特殊攻撃力':k==='def'?'防御力':k==='mdef'?'特殊防御力':k==='hp'?'HP':k==='mp'?'MP':'素早さ'
                                return `${label}+${v}`
                              }).join(' ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'gem' && (
              <div>
                <div style={{ color:'#ff66cc', fontSize:'11px', marginBottom:'6px' }}>装備ソケット（埋め込み先を選択）</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
                  {equippedSlots.map(slot => {
                    const eq = equipment.find(e => e.slot === slot && e.equipped)
                    const selected = eq && embedTarget === eq.id
                    return (
                      <div key={slot} onClick={() => eq && setEmbedTarget(selected ? null : eq.id)}
                        style={{ border:`1px solid ${selected?'#ff66cc':'#003366'}`, background: selected?'#1a0014':'#001028', padding:'8px', cursor: eq?'pointer':'default', opacity: eq?1:0.5 }}>
                        <div style={{ color:'#446688', fontSize:'10px' }}>{SLOT_LABELS_FULL[slot]}</div>
                        {eq ? (
                          <>
                            <div style={{ color:'#88ccff', fontSize:'10px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{eq.weapons.name}</div>
                            {eq.gem_type ? (
                              <div style={{ fontSize:'10px', color:'#ff66cc', marginTop:'2px' }}>
                                💍 {gemBonusText(eq.gem_type, eq.gem_rank)}
                                <button onClick={(ev)=>{ ev.stopPropagation(); unembedGem(eq) }} disabled={loading}
                                  style={{ marginLeft:'4px', padding:'1px 6px', background:'#200010', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'9px' }}>外す</button>
                              </div>
                            ) : <div style={{ fontSize:'10px', color:'#334455', marginTop:'2px' }}>ソケット空</div>}
                          </>
                        ) : <div style={{ fontSize:'10px', color:'#334455' }}>未装備</div>}
                      </div>
                    )
                  })}
                </div>
                {embedTarget && <div style={{ color:'#ff66cc', fontSize:'10px', marginBottom:'8px' }}>↑選択中のソケットに、下の宝石「埋め込み」で装着できます（既存の宝石は在庫へ戻ります）</div>}

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                  <div style={{ color:'#ff66cc', fontSize:'11px' }}>所持宝石（同じ宝石3個で1ランクUP）</div>
                  {gems.some(gm => (gm.quantity||0) >= 3 && GEM_RANKS.indexOf(gm.rank) < GEM_RANKS.length-1) && (
                    <button onClick={openBulkPreview} disabled={loading}
                      style={{ padding:'3px 10px', background:'#001840', border:'1px solid #0088ff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                      ✨ 一括合成
                    </button>
                  )}
                </div>
                {gems.length === 0 && <div style={{ color:'#334455', fontSize:'11px', padding:'10px' }}>宝石を所持していません（宝石ダンジョンで入手）</div>}
                {[...gems].sort((a,b)=> (GEM_TYPES.indexOf(a.gem_type)-GEM_TYPES.indexOf(b.gem_type)) || (GEM_RANKS.indexOf(a.rank)-GEM_RANKS.indexOf(b.rank))).map(gm => {
                  const canCombine = (gm.quantity||0) >= 3 && GEM_RANKS.indexOf(gm.rank) < GEM_RANKS.length-1
                  const allowed = gemAllowedSlots(gm.gem_type)
                  const targetEq = embedTarget ? equipment.find(e => e.id === embedTarget) : null
                  const canEmbedHere = targetEq && allowed.includes(gemSlotCategory(targetEq.slot))
                  return (
                    <div key={gm.id} style={{ border:'1px solid #002244', background:'#000818', padding:'8px', marginBottom:'6px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div>
                        <span style={{ color:'#ff66cc', fontSize:'12px' }}>{gemDisplayName(gm.gem_type, gm.rank)}</span>
                        <span style={{ color:'#446688', fontSize:'10px' }}> ×{gm.quantity}</span>
                        <div style={{ color:'#88ccff', fontSize:'10px' }}>{gemBonusText(gm.gem_type, gm.rank)}</div>
                        <div style={{ color:'#557799', fontSize:'9px' }}>装着可: {allowed.map(s=>GEM_SLOT_LABEL[s]).join('・')}</div>
                      </div>
                      <div style={{ display:'flex', gap:'6px' }}>
                        <button onClick={()=>embedGem(gm)} disabled={loading || !canEmbedHere}
                          style={{ padding:'3px 8px', background: canEmbedHere?'#1a0014':'#0a0010', border:`1px solid ${canEmbedHere?'#ff66cc':'#442233'}`, color: canEmbedHere?'#ff66cc':'#553344', cursor: canEmbedHere?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>埋め込み</button>
                        <button onClick={()=>combineGem(gm)} disabled={loading || !canCombine}
                          style={{ padding:'3px 8px', background: canCombine?'#001840':'#000c18', border:`1px solid ${canCombine?'#0088ff':'#223344'}`, color: canCombine?'#88ccff':'#334455', cursor: canCombine?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>合成</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'treasure' && (
              <div>
                {craftMsg && (
                  <div style={{ color:'#44ffaa', fontSize:'13px', textAlign:'center', padding:'10px', border:'1px solid #44ffaa', marginBottom:'12px', background:'#001a0a' }}>{craftMsg}</div>
                )}
                <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'10px' }}>素材を集めることで無限ポーションを作成できます</div>

                {/* HP無限ポーション */}
                {(() => {
                  const canCraft = HP_RECIPE.every(n => getMaterialQty(n) >= 1)
                  const alreadyHave = hasInfinitePotion('hp_pct_infinite')
                  const pi = allItems.find(i => i.items?.effect === 'hp_pct_infinite')
                  if (alreadyHave) return (
                    <div style={{ border:'2px solid #44ff88', background:'#001a0a', padding:'12px', marginBottom:'10px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                        <div style={{ color:'#44ff88', fontSize:'14px', fontWeight:'bold' }}>不滅の霊薬</div>
                        <span style={{ color:'#44ff88', fontSize:'10px', border:'1px solid #44ff88', padding:'1px 6px' }}>✓ 作成済み</span>
                      </div>
                      <div style={{ color:'#88ccaa', fontSize:'10px', marginBottom:'10px' }}>HP20%回復・使用後5Tクールダウン・消費なし</div>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                        {pi?.equipped
                          ? <><span style={{ color:'#0088ff', fontSize:'10px' }}>セット中</span>
                              <button onClick={() => setItemSlot(null)} disabled={loading} style={{ padding:'3px 10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                              <select value={pi.use_threshold || 50} onChange={e => setItemThreshold(pi.id, Number(e.target.value))}
                                style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'2px' }}>
                                {[10,20,30,40,50,60,70,80,90,100].map(n => <option key={n} value={n}>{n}%以下で使用</option>)}
                              </select>
                            </>
                          : <button onClick={() => setItemSlot(pi.id)} disabled={loading} style={{ padding:'3px 14px', background:'#001840', border:'1px solid #0088ff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>セットする</button>
                        }
                      </div>
                    </div>
                  )
                  return (
                    <div style={{ border:`1px solid ${canCraft ? '#44ffaa' : '#002244'}`, background:'#000818', padding:'12px', marginBottom:'10px' }}>
                      <div style={{ color:'#44ff88', fontSize:'13px', marginBottom:'6px' }}>不滅の霊薬</div>
                      <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px' }}>HP20%回復・使用後5Tクールダウン・消費なし</div>
                      <div style={{ fontSize:'10px', marginBottom:'10px' }}>
                        {HP_RECIPE.map(n => {
                          const qty = getMaterialQty(n)
                          return <span key={n} style={{ color: qty >= 1 ? '#44ff88' : '#ff4444', marginRight:'10px' }}>{n} {qty}/1</span>
                        })}
                      </div>
                      <button onClick={() => craftPotion(HP_RECIPE, 'hp_pct_infinite')} disabled={loading || !canCraft}
                        style={{ padding:'4px 14px', background: canCraft ? '#001a08' : '#000810', border:`1px solid ${canCraft ? '#44ffaa' : '#224433'}`, color: canCraft ? '#44ffaa' : '#334433', cursor: canCraft ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>
                        {loading ? '作成中...' : '作成する'}
                      </button>
                    </div>
                  )
                })()}

                {/* MP無限ポーション */}
                {(() => {
                  const canCraft = MP_RECIPE.every(n => getMaterialQty(n) >= 1)
                  const alreadyHave = hasInfinitePotion('mp_pct_infinite')
                  const pi = allItems.find(i => i.items?.effect === 'mp_pct_infinite')
                  if (alreadyHave) return (
                    <div style={{ border:'2px solid #4488ff', background:'#00101a', padding:'12px', marginBottom:'10px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                        <div style={{ color:'#4488ff', fontSize:'14px', fontWeight:'bold' }}>魔泉の霊薬</div>
                        <span style={{ color:'#4488ff', fontSize:'10px', border:'1px solid #4488ff', padding:'1px 6px' }}>✓ 作成済み</span>
                      </div>
                      <div style={{ color:'#8899cc', fontSize:'10px', marginBottom:'10px' }}>MP20%回復・使用後5Tクールダウン・消費なし</div>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                        {pi?.equipped
                          ? <><span style={{ color:'#0088ff', fontSize:'10px' }}>セット中</span>
                              <button onClick={() => setItemSlot(null)} disabled={loading} style={{ padding:'3px 10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
                              <select value={pi.use_threshold || 50} onChange={e => setItemThreshold(pi.id, Number(e.target.value))}
                                style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'2px' }}>
                                {[10,20,30,40,50,60,70,80,90,100].map(n => <option key={n} value={n}>{n}%以下で使用</option>)}
                              </select>
                            </>
                          : <button onClick={() => setItemSlot(pi.id)} disabled={loading} style={{ padding:'3px 14px', background:'#001840', border:'1px solid #0088ff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>セットする</button>
                        }
                      </div>
                    </div>
                  )
                  return (
                    <div style={{ border:`1px solid ${canCraft ? '#44aaff' : '#002244'}`, background:'#000818', padding:'12px', marginBottom:'10px' }}>
                      <div style={{ color:'#4488ff', fontSize:'13px', marginBottom:'6px' }}>魔泉の霊薬</div>
                      <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px' }}>MP20%回復・使用後5Tクールダウン・消費なし</div>
                      <div style={{ fontSize:'10px', marginBottom:'10px' }}>
                        {MP_RECIPE.map(n => {
                          const qty = getMaterialQty(n)
                          return <span key={n} style={{ color: qty >= 1 ? '#44ff88' : '#ff4444', marginRight:'10px' }}>{n} {qty}/1</span>
                        })}
                      </div>
                      <button onClick={() => craftPotion(MP_RECIPE, 'mp_pct_infinite')} disabled={loading || !canCraft}
                        style={{ padding:'4px 14px', background: canCraft ? '#00101a' : '#000810', border:`1px solid ${canCraft ? '#44aaff' : '#223344'}`, color: canCraft ? '#44aaff' : '#334455', cursor: canCraft ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>
                        {loading ? '作成中...' : '作成する'}
                      </button>
                    </div>
                  )
                })()}

                {/* 素材一覧 */}
                <div style={{ color:'#446688', fontSize:'11px', marginTop:'12px', marginBottom:'6px' }}>所持素材</div>
                {[...HP_RECIPE, ...MP_RECIPE].map(n => {
                  const qty = getMaterialQty(n)
                  return (
                    <div key={n} style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color: qty > 0 ? '#aaccff' : '#334455', padding:'3px 0', borderBottom:'1px solid #001122' }}>
                      <span>{n}</span>
                      <span>×{qty}</span>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
      </div>

      {/* 一括合成 確認モーダル */}
      {bulkPreview && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'#000e20', border:'1px solid #0088ff', padding:'20px', maxWidth:'360px', width:'90%', fontFamily:'monospace', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'14px' }}>✨ 一括合成の確認</div>

            {bulkPreview.done ? (
              <>
                <div style={{ color:'#44ff88', fontSize:'13px', textAlign:'center', padding:'16px 0' }}>✓ 合成が完了しました！</div>
                <button onClick={()=>setBulkPreview(null)} style={{ width:'100%', padding:'8px', background:'#001840', border:'1px solid #0088ff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>閉じる</button>
              </>
            ) : (
              <>
                <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>合成内容</div>
                {bulkPreview.ops.map((op, i) => (
                  <div key={i} style={{ fontSize:'11px', color:'#aaccff', padding:'3px 0', borderBottom:'1px solid #112233' }}>
                    {GEM_DATA[op.gemType]?.name}({op.fromRank}) ×{op.count * 3}
                    <span style={{ color:'#446688' }}> → </span>
                    {GEM_DATA[op.gemType]?.name}({op.toRank}) ×{op.count}
                  </div>
                ))}
                <div style={{ display:'flex', gap:'8px', marginTop:'16px' }}>
                  <button onClick={()=>setBulkPreview(null)} style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>キャンセル</button>
                  <button onClick={executeBulkSynthesis} disabled={loading} style={{ flex:2, padding:'8px', background:'#001840', border:'1px solid #0088ff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                    {loading ? '合成中...' : '合成する'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 記憶除去装置 確認ダイアログ */}
      {confirmReset && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'#0a0020', border:'1px solid #cc44ff', padding:'24px', maxWidth:'320px', width:'90%', fontFamily:'monospace' }}>
            <div style={{ color:'#cc44ff', fontSize:'14px', marginBottom:'12px' }}>⚠ 記憶除去装置を使用しますか？</div>
            <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'16px', lineHeight:'1.6' }}>
              振り分けたステータスポイントがすべてリセットされ、再度割り振りできるようになります。<br/>
              <span style={{ color:'#ff8844' }}>この操作は取り消せません。</span>
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => setConfirmReset(null)} style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>キャンセル</button>
              <button onClick={() => useStatReset(confirmReset)} disabled={loading} style={{ flex:1, padding:'8px', background:'#200010', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>使用する</button>
            </div>
          </div>
        </div>
      )}

      {ticketPopup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={() => { if (!loading) { setTicketPopup(false); setPickConfirm(null) } }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#0a0c1a', border:'1px solid #ffcc44', padding:'20px', maxWidth:'360px', width:'92%', fontFamily:'monospace', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'6px' }}>🎫 Sレアレイドボス装備選択券</div>
            {ticketMsg && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'10px' }}>{ticketMsg}</div>}
            {pickConfirm?.kind === 'ticket' ? renderPickConfirm('#ffcc44', () => redeemRaidTicket(pickConfirm.name)) : (<>
            <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'14px', lineHeight:'1.5' }}>
              交換するS級レイド装備を1つ選んでください。<br/>
              <span style={{ color:'#ff8844' }}>選択すると券を1枚消費します。</span>
            </div>
            {ticketGot && (
              <div style={{ border:'1px solid #2a6a3a', background:'#04140a', padding:'10px', marginBottom:'12px', color:'#44ff88', fontSize:'12px', lineHeight:'1.5' }}>
                ✨ 「{ticketGot}」を獲得しました！<br/>
                <span style={{ color:'#88ccaa', fontSize:'10px' }}>装備タブで確認・装備できます。</span>
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {RAID_TICKET_CHOICES.map(c => (
                <button key={c.name} onClick={() => { setPickConfirm({ kind:'ticket', name:c.name, cost:'券', unit:'枚' }); setTicketMsg(''); setTicketGot(null) }} disabled={loading}
                  style={{ textAlign:'left', padding:'10px', background:'#001028', border:'1px solid #0055aa', color:'#cce0ff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'11px', opacity: loading ? 0.5 : 1 }}>
                  <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'2px' }}>{c.name}</div>
                  <div style={{ color:'#778899', fontSize:'10px' }}>{c.desc}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setTicketPopup(false)} disabled={loading}
              style={{ width:'100%', marginTop:'12px', padding:'8px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>{ticketGot ? '閉じる' : 'キャンセル'}</button>
            </>)}
          </div>
        </div>
      )}

      {bossBoxPopup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={() => { if (!loading) { setBossBoxPopup(false); setPickConfirm(null) } }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#0a0c1a', border:'1px solid #ffcc44', padding:'20px', maxWidth:'360px', width:'92%', fontFamily:'monospace', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'6px' }}>🎁 初級ボス装備選択箱</div>
            {bossBoxMsg && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'10px' }}>{bossBoxMsg}</div>}
            {pickConfirm?.kind === 'beginner' ? renderPickConfirm('#ffcc44', () => redeemBeginnerBossBox(pickConfirm.name)) : (<>
            <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'14px', lineHeight:'1.5' }}>
              交換するエリア①〜②のボス装備を1つ選んでください。<br/>
              <span style={{ color:'#ff8844' }}>選択すると箱を1個消費します。</span>
            </div>
            {bossBoxGot && (
              <div style={{ border:'1px solid #2a6a3a', background:'#04140a', padding:'10px', marginBottom:'12px', color:'#44ff88', fontSize:'12px', lineHeight:'1.5' }}>
                ✨ 「{bossBoxGot}」を獲得しました！<br/>
                <span style={{ color:'#88ccaa', fontSize:'10px' }}>装備タブで確認・装備できます。</span>
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {BEGINNER_BOX_CHOICES.map(c => (
                <button key={c.name} onClick={() => { setPickConfirm({ kind:'beginner', name:c.name, cost:'箱', unit:'個' }); setBossBoxMsg(''); setBossBoxGot(null) }} disabled={loading}
                  style={{ textAlign:'left', padding:'10px', background:'#001028', border:'1px solid #0055aa', color:'#cce0ff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'11px', opacity: loading ? 0.5 : 1 }}>
                  <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'2px' }}>{rarityBadge(c.name)}{c.name}</div>
                  <div style={{ color:'#778899', fontSize:'10px' }}>{c.desc}</div>
                  {renderWeaponInfo(c.name)}
                </button>
              ))}
            </div>
            <button onClick={() => setBossBoxPopup(false)} disabled={loading}
              style={{ width:'100%', marginTop:'12px', padding:'8px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>{bossBoxGot ? '閉じる' : 'キャンセル'}</button>
            </>)}
          </div>
        </div>
      )}

      {areaBox && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={() => { if (!loading) { setAreaBox(null); setPickConfirm(null) } }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#0a0c1a', border:'1px solid #ffcc44', padding:'20px', maxWidth:'360px', width:'92%', fontFamily:'monospace', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'6px' }}>🎁 {areaBox.name}</div>
            {areaBoxMsg && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'10px' }}>{areaBoxMsg}</div>}
            {pickConfirm?.kind === 'area' ? renderPickConfirm('#ffcc44', () => redeemAreaBossBox(areaBox.tier, pickConfirm.name)) : (<>
            <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'14px', lineHeight:'1.5' }}>
              交換する{areaBox.tier}エリアのボス装備を1つ選んでください。<br/>
              <span style={{ color:'#ff8844' }}>選択すると箱を1個消費します。</span>
            </div>
            {areaBoxGot && (
              <div style={{ border:'1px solid #2a6a3a', background:'#04140a', padding:'10px', marginBottom:'12px', color:'#44ff88', fontSize:'12px', lineHeight:'1.5' }}>
                ✨ 「{areaBoxGot}」を獲得しました！<br/>
                <span style={{ color:'#88ccaa', fontSize:'10px' }}>装備タブで確認・装備できます。</span>
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {areaBox.choices.map(c => (
                <button key={c.name} onClick={() => { setPickConfirm({ kind:'area', name:c.name, cost:'箱', unit:'個' }); setAreaBoxMsg(''); setAreaBoxGot(null) }} disabled={loading}
                  style={{ textAlign:'left', padding:'10px', background:'#001028', border:'1px solid #0055aa', color:'#cce0ff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'11px', opacity: loading ? 0.5 : 1 }}>
                  <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'2px' }}>{rarityBadge(c.name)}{c.name}</div>
                  <div style={{ color:'#778899', fontSize:'10px' }}>{c.desc}</div>
                  {renderWeaponInfo(c.name)}
                </button>
              ))}
            </div>
            <button onClick={() => setAreaBox(null)} disabled={loading}
              style={{ width:'100%', marginTop:'12px', padding:'8px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>{areaBoxGot ? '閉じる' : 'キャンセル'}</button>
            </>)}
          </div>
        </div>
      )}

      {artBox && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={() => { if (!loading) { setArtBox(false); setPickConfirm(null) } }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#0a0c1a', border:'1px solid #cc88ff', padding:'20px', maxWidth:'360px', width:'92%', fontFamily:'monospace', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ color:'#cc88ff', fontSize:'14px', marginBottom:'6px' }}>🏺 アーティファクト装備選択箱</div>
            {artBoxMsg && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'10px' }}>{artBoxMsg}</div>}
            {pickConfirm?.kind === 'artifact' ? renderPickConfirm('#cc88ff', () => redeemArtifactBox(pickConfirm.name)) : (<>
            <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'14px', lineHeight:'1.5' }}>
              受け取るアーティファクト武器を1つ選んでください。<br/>
              <span style={{ color:'#44ccff' }}>【特殊能力】{getEffectLabel('artifact')}</span><br/>
              <span style={{ color:'#ff8844' }}>選択すると箱を1個消費します。</span>
            </div>
            {artBoxGot && (
              <div style={{ border:'1px solid #2a6a3a', background:'#04140a', padding:'10px', marginBottom:'12px', color:'#44ff88', fontSize:'12px', lineHeight:'1.5' }}>
                ✨ 「{artBoxGot}」を獲得しました！<br/>
                <span style={{ color:'#88ccaa', fontSize:'10px' }}>装備タブで確認・装備できます。</span>
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {ARTIFACT_BOX_CHOICES.map(c => (
                <button key={c.name} onClick={() => { setPickConfirm({ kind:'artifact', name:c.name, cost:'箱', unit:'個' }); setArtBoxMsg(''); setArtBoxGot(null) }} disabled={loading}
                  style={{ textAlign:'left', padding:'10px', background:'#001028', border:'1px solid #7755aa', color:'#cce0ff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'11px', opacity: loading ? 0.5 : 1 }}>
                  <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'2px' }}>{rarityBadge(c.name)}{c.name}</div>
                  <div style={{ color:'#778899', fontSize:'10px' }}>{c.desc}</div>
                  {renderWeaponInfo(c.name)}
                </button>
              ))}
            </div>
            <button onClick={() => setArtBox(false)} disabled={loading}
              style={{ width:'100%', marginTop:'12px', padding:'8px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>{artBoxGot ? '閉じる' : 'キャンセル'}</button>
            </>)}
          </div>
        </div>
      )}

      {boxToast && (
        <div style={{ position:'fixed', top:'18px', left:'50%', transform:'translateX(-50%)', zIndex:200, background:'#140a10', border:'1px solid #ff88aa', color:'#ff99cc', padding:'12px 22px', fontFamily:'monospace', fontSize:'13px', boxShadow:'0 2px 12px rgba(0,0,0,0.6)' }}>
          ✨ {boxToast}×10 を獲得しました！
        </div>
      )}

      {boxPopup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={() => { if (!loading) { setBoxPopup(false); setBoxConfirm(null) } }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#0a0c1a', border:'1px solid #ff88aa', padding:'20px', maxWidth:'360px', width:'92%', fontFamily:'monospace', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ color:'#ff88aa', fontSize:'14px', marginBottom:'10px' }}>🎁 ボス装備進化支援箱</div>
            {boxMsg && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'10px' }}>{boxMsg}</div>}
            {boxConfirm ? (
              <>
                <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'16px', lineHeight:'1.6', textAlign:'center' }}>
                  <span style={{ color:'#ff99cc', fontSize:'13px' }}>{boxConfirm.blood}×10</span> を選択します。<br/>
                  <span style={{ color:'#ff8844', fontSize:'11px' }}>箱を1個消費します。よろしいですか？</span>
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={() => useBloodBox(boxConfirm.blood)} disabled={loading}
                    style={{ flex:1, padding:'10px', background:'#1a0010', border:'1px solid #ff88aa', color:'#ff99cc', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'12px', opacity: loading ? 0.5 : 1 }}>{loading ? '処理中...' : 'OK'}</button>
                  <button onClick={() => setBoxConfirm(null)} disabled={loading}
                    style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>戻る</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'14px', lineHeight:'1.5' }}>
                  血を受け取るボスを1つ選んでください。<br/>
                  <span style={{ color:'#ff8844' }}>選択すると箱を1個消費し、そのボスの血×10を受け取ります。</span>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                  {BOSS_LINES.map(line => (
                    <button key={line.area} onClick={() => { setBoxConfirm(line); setBoxMsg('') }} disabled={loading}
                      style={{ textAlign:'left', padding:'10px', background:'#001028', border:'1px solid #aa4466', color:'#cce0ff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'11px', opacity: loading ? 0.5 : 1 }}>
                      <div style={{ color:'#ff99cc', fontSize:'12px', marginBottom:'2px' }}>{line.boss}</div>
                      <div style={{ color:'#778899', fontSize:'10px' }}>{line.blood} ×10 を受け取る</div>
                    </button>
                  ))}
                </div>
                <button onClick={() => setBoxPopup(false)} disabled={loading}
                  style={{ width:'100%', marginTop:'12px', padding:'8px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>キャンセル</button>
              </>
            )}
          </div>
        </div>
      )}

      {renamePopup && (() => {
        const targets = equipment.filter(e => e.equipped && (e.enhance_plus || 0) >= 7)
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
            onClick={() => { if (!loading) setRenamePopup(null) }}>
            <div onClick={e => e.stopPropagation()} style={{ background:'#0a0c1a', border:'1px solid #ffcc44', padding:'20px', maxWidth:'380px', width:'92%', fontFamily:'monospace', maxHeight:'82vh', overflowY:'auto' }}>
              <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'6px' }}>🏷 装備命名券</div>
              <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'14px', lineHeight:'1.5' }}>
                <span style={{ color:'#ffcc00' }}>装備中で+7以上</span>の装備に好きな名前（{RENAME_MAX}文字以内）を付けられます。<br/>
                <span style={{ color:'#ff8844' }}>命名すると券を1枚消費します。</span>
              </div>
              {targets.length === 0 ? (
                <div style={{ color:'#ff8844', fontSize:'11px', marginBottom:'12px' }}>装備中で+7以上の装備がありません。</div>
              ) : (
                <>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>命名する装備を選択</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'12px' }}>
                    {targets.map(e => {
                      const on = renameTargetId === e.id
                      return (
                        <button key={e.id} onClick={() => setRenameTargetId(e.id)} disabled={loading}
                          style={{ textAlign:'left', padding:'8px', background: on ? '#1a1400' : '#001028', border:`1px solid ${on ? '#ffcc44' : '#0055aa'}`, color: on ? '#ffcc44' : '#cce0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                          {e.custom_name && <span style={{ color:'#ff99cc' }}>「{e.custom_name}」</span>}
                          {e.weapons.name} <span style={{ color:'#ffcc00' }}>+{e.enhance_plus}</span>
                          <span style={{ color:'#446688', fontSize:'10px' }}>（{SLOT_LABELS[e.slot] || e.slot}）</span>
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ color:'#446688', fontSize:'10px', marginBottom:'4px' }}>新しい名前（{RENAME_MAX}文字以内）</div>
                  <input type="text" value={renameText} maxLength={RENAME_MAX}
                    onChange={e => setRenameText(e.target.value)}
                    placeholder="例：絶対正義の剣"
                    style={{ width:'100%', boxSizing:'border-box', background:'#001028', border:'1px solid #0055aa', color:'#cce0ff', fontFamily:'monospace', fontSize:'13px', padding:'8px', marginBottom:'4px' }} />
                  <div style={{ textAlign:'right', color:'#446688', fontSize:'10px', marginBottom:'10px' }}>{[...renameText].length}/{RENAME_MAX}</div>
                </>
              )}
              {renameMsg && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'10px' }}>{renameMsg}</div>}
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={() => setRenamePopup(null)} disabled={loading}
                  style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>キャンセル</button>
                {targets.length > 0 && (
                  <button onClick={applyRename} disabled={loading || !renameTargetId || renameText.trim().length === 0}
                    style={{ flex:2, padding:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', opacity:(!renameTargetId || renameText.trim().length===0)?0.5:1 }}>
                    {loading ? '処理中...' : '命名する'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
