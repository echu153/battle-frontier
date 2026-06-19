import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const RARITY_COLORS = {
  f:'#888888', e:'#6699cc', d:'#ff8844', c:'#44bb44',
  b:'#4488ff', a:'#ff4444', s:'#ffcc00', ss:'#ffcc00', sss:'#ffcc00',
}
const RARITY_LABELS = { f:'F', e:'E', d:'D', c:'C', b:'B', a:'A', s:'S', ss:'SS', sss:'SSS' }
const SLOT_LABELS = { weapon:'武器', armor:'防具', accessory:'装飾品①', accessory2:'装飾品②' }

const BONUS_EFFECT_DESC = {
  'hit_heal_down_10_2t': '攻撃ヒット時、2ターンの間対象の回復力-10%',
  'open_atk_10_2t':  'バトル開始時、2ターンの間攻撃力+10%',
  'open_def_10_2t':  'バトル開始時、2ターンの間防御力+10%',
  'open_matk_10_2t': 'バトル開始時、2ターンの間特殊攻撃力+10%',
  'open_mdef_10_2t': 'バトル開始時、2ターンの間特殊防御力+10%',
  'open_spd_10_2t':  'バトル開始時、2ターンの間素早さ+10%',
  'regen_heal_5_3t': 'バトル開始時、3ターンの間毎ターンHP5%回復',
  'artifact':        'アーティファクト（出品不可）',
  'hit_spd_down_5':  '攻撃ヒット時、対象の素早さ-5%',
  'mdef_pen_5':      '魔法防御貫通+5%',
}

// クライアント側でも基準価格を算出（サーバーと同じロジック。表示・スライダー用）
function basePriceOf(weapon) {
  if (!weapon) return null
  if (weapon.name && weapon.name.startsWith('古びた')) return null  // 古びた○○は出品不可
  if (weapon.base_price && weapon.base_price > 0) return weapon.base_price
  return { a:300000, b:250000, c:150000, d:100000, e:50000, f:20000 }[String(weapon.rarity).toLowerCase()] ?? null
}

const RARITY_ORDER = { sss:8, ss:7, s:6, a:5, b:4, c:3, d:2, e:1, f:0 }
const RANK_FILTERS = ['all', 'a', 'b', 'c', 'd', 'e', 'f']
const SORT_OPTIONS = [
  { id:'obtained', label:'入手順' },
  { id:'rank_desc', label:'ランク高→低' },
  { id:'rank_asc', label:'ランク低→高' },
  { id:'price_desc', label:'価格高→安' },
  { id:'price_asc', label:'価格安→高' },
]

const yen = n => (n ?? 0).toLocaleString()

function WeaponCard({ weapon, bonusEffect, enhancePlus, right }) {
  if (!weapon) return null
  const rarity = weapon.rarity?.toLowerCase() || 'f'
  const color = RARITY_COLORS[rarity] || '#888888'
  const effectDesc = BONUS_EFFECT_DESC[bonusEffect] || null
  const stats = [
    weapon.atk_bonus      > 0 && ['攻撃',   weapon.atk_bonus,      '#ffcc00'],
    weapon.def_bonus      > 0 && ['防御',   weapon.def_bonus,      '#88aaff'],
    weapon.matk_bonus     > 0 && ['特攻',   weapon.matk_bonus,     '#cc44ff'],
    weapon.mdef_bonus     > 0 && ['特防',   weapon.mdef_bonus,     '#44ccff'],
    weapon.spd_bonus      > 0 && ['素早さ', weapon.spd_bonus,      '#ff8844'],
    weapon.atk_bonus_pct  > 0 && ['攻撃',   weapon.atk_bonus_pct + '%',  '#ffcc00'],
    weapon.matk_bonus_pct > 0 && ['特攻',   weapon.matk_bonus_pct + '%', '#cc44ff'],
  ].filter(Boolean)
  return (
    <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
      {/* ランクバッジ（大きめ・左揃え） */}
      <div style={{ width:'34px', height:'34px', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color, border:`1px solid ${color}`, borderRadius:'4px', fontSize:'15px', fontWeight:'bold', background:'#00060f' }}>
        {RARITY_LABELS[rarity] || rarity.toUpperCase()}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:'6px' }}>
          <span style={{ color, fontSize:'14px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{weapon.name}</span>
          {enhancePlus > 0 && <span style={{ color:'#ffcc00', fontSize:'12px' }}>+{enhancePlus}</span>}
          <span style={{ color:'#445566', fontSize:'10px', marginLeft:'auto', whiteSpace:'nowrap' }}>{SLOT_LABELS[weapon.slot] || weapon.slot}</span>
        </div>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'3px' }}>
          {stats.map(([label, val, c], i) => (
            <span key={i} style={{ fontSize:'11px', color:c }}>{label}+{val}</span>
          ))}
        </div>
        {effectDesc && (
          <div style={{ fontSize:'10px', color:'#9a8fc4', marginTop:'3px' }}>✦ {effectDesc}</div>
        )}
      </div>
      {right && <div style={{ flexShrink:0 }}>{right}</div>}
    </div>
  )
}

// 直近1週間の取引統計表示
function PriceStats({ stat, base }) {
  return (
    <div style={{ fontSize:'10px', color:'#557799', marginTop:'4px', display:'flex', gap:'12px', flexWrap:'wrap' }}>
      <span>基準 <span style={{ color:'#aaccff' }}>{yen(base)}G</span></span>
      {stat && stat.count > 0 ? (
        <>
          <span>直近1週 平均 <span style={{ color:'#ffcc44' }}>{yen(Math.round(stat.avg))}G</span></span>
          <span>最近 <span style={{ color:'#88ccff' }}>{yen(stat.last)}G</span></span>
          <span>取引{stat.count}件</span>
        </>
      ) : (
        <span style={{ color:'#445566' }}>直近1週の取引なし</span>
      )}
    </div>
  )
}

const TABS = [
  { id:'buy',  label:'購入' },
  { id:'mine', label:'マイ出品' },
  { id:'sell', label:'出品する' },
]

export default function Marketplace() {
  const nav = useNavigate()
  const [tab, setTab] = useState('buy')
  const [userId, setUserId] = useState(null)
  const [gold, setGold] = useState(0)
  const [listings, setListings] = useState([])     // active 出品（全員）
  const [stats, setStats] = useState({})           // weapon_id -> {avg,count,last}
  const [myEquip, setMyEquip] = useState([])       // 自分の出品可能な装備
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [sellTarget, setSellTarget] = useState(null) // 出品ダイアログ対象
  const [sellPrice, setSellPrice] = useState(0)
  const [listResult, setListResult] = useState(null) // 出品完了ポップアップ { name, price, proceeds }
  const [rankFilter, setRankFilter] = useState('all')
  const [sortBy, setSortBy] = useState('obtained')

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    setUserId(user.id)
    await supabase.rpc('marketplace_expire')  // 期限切れを手元に戻す

    const [{ data: prof }, { data: active }, { data: sold }, { data: eq }] = await Promise.all([
      supabase.from('profiles').select('gold').eq('id', user.id).single(),
      supabase.from('marketplace_listings')
        .select('*, weapons(*), seller:profiles!marketplace_listings_seller_id_fkey(username)')
        .eq('status', 'active').order('listed_at', { ascending: false }),
      supabase.from('marketplace_listings')
        .select('weapon_id, price, sold_at')
        .eq('status', 'sold')
        .gte('sold_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id).order('obtained_at'),
    ])

    setGold(prof?.gold ?? 0)
    setListings(active || [])

    // 直近1週の統計
    const s = {}
    for (const r of (sold || [])) {
      const k = r.weapon_id
      if (!s[k]) s[k] = { sum:0, count:0, last:0, lastAt:0 }
      s[k].sum += r.price; s[k].count++
      const t = new Date(r.sold_at).getTime()
      if (t >= s[k].lastAt) { s[k].lastAt = t; s[k].last = r.price }
    }
    const stat = {}
    for (const k in s) stat[k] = { avg: s[k].sum / s[k].count, count: s[k].count, last: s[k].last }
    setStats(stat)

    // 出品可能な装備：未装備・未出品・未帰属・未強化・非アーティファクト・基準価格あり
    const sellable = (eq || []).filter(e =>
      !e.equipped && !e.listed && !e.is_bound &&
      (e.enhance_plus || 0) === 0 &&
      e.bonus_effect !== 'artifact' &&
      basePriceOf(e.weapons) != null
    )
    setMyEquip(sellable)
  }

  const flash = (text, color) => { setMsg({ text, color }); setTimeout(() => setMsg(null), 3500) }

  const handleBuy = async (l) => {
    if (!confirm(`「${l.weapons?.name}」を ${yen(l.price)}G で購入しますか？\n購入後は帰属（取引・加工不可）になります。`)) return
    setBusy(l.id)
    const { data, error } = await supabase.rpc('buy_marketplace_listing', { p_listing_id: l.id })
    setBusy(null)
    if (error || !data?.ok) { flash(data?.reason || 'エラーが発生しました', '#ff4444'); await init(); return }
    flash('購入しました！装備画面で確認できます', '#44ff88')
    await init()
  }

  const handleCancel = async (l) => {
    if (!confirm('この出品を取り消しますか？')) return
    setBusy(l.id)
    const { data, error } = await supabase.rpc('cancel_marketplace_listing', { p_listing_id: l.id })
    setBusy(null)
    if (error || !data?.ok) { flash(data?.reason || 'エラーが発生しました', '#ff4444'); await init(); return }
    flash('出品を取り消しました', '#88ccff')
    await init()
  }

  const openSell = (e) => {
    const base = basePriceOf(e.weapons)
    setSellTarget(e)
    setSellPrice(base)
  }

  const handleList = async () => {
    if (!sellTarget) return
    setBusy('sell')
    const { data, error } = await supabase.rpc('create_marketplace_listing', {
      p_equipment_id: sellTarget.id, p_price: sellPrice,
    })
    setBusy(null)
    if (error || !data?.ok) { flash(data?.reason || 'エラーが発生しました', '#ff4444'); return }
    const popup = { name: sellTarget.weapons?.name, price: sellPrice, proceeds: Math.floor((sellPrice || 0) * 0.8) }
    setSellTarget(null)
    setListResult(popup)
    await init()
  }

  const myListings = listings.filter(l => l.seller_id === userId)

  // ランク絞り込み＋ソート（購入一覧・出品候補で共用）。weaponGetter/priceGetterで対象差を吸収。
  const applyFilterSort = (arr, weaponGetter, priceGetter) => {
    let out = arr.filter(x => {
      if (rankFilter === 'all') return true
      return String(weaponGetter(x)?.rarity || '').toLowerCase() === rankFilter
    })
    const r = x => RARITY_ORDER[String(weaponGetter(x)?.rarity || '').toLowerCase()] ?? -1
    const p = x => priceGetter(x) ?? 0
    const byObtained = [...out] // 元配列順＝入手/出品順
    switch (sortBy) {
      case 'rank_desc':  out.sort((a, b) => r(b) - r(a)); break
      case 'rank_asc':   out.sort((a, b) => r(a) - r(b)); break
      case 'price_desc': out.sort((a, b) => p(b) - p(a)); break
      case 'price_asc':  out.sort((a, b) => p(a) - p(b)); break
      default:           out = byObtained
    }
    return out
  }

  const buyListings = applyFilterSort(
    listings.filter(l => l.seller_id !== userId),
    l => l.weapons, l => l.price,
  )
  const sellEquip = applyFilterSort(myEquip, e => e.weapons, e => basePriceOf(e.weapons))

  const base = { minHeight:'100vh', background:'#000820', color:'#aaccff', fontFamily:'monospace', padding:'16px', boxSizing:'border-box' }
  const sellBase = sellTarget ? basePriceOf(sellTarget.weapons) : 0
  const sellMin = Math.floor(sellBase * 0.5)
  const sellMax = Math.ceil(sellBase * 1.5)

  return (
    <div style={base}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
        <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
        <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
        <div style={{ color:'#44ddaa', fontSize:'14px' }}>🏷 取引所 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></div>
        <div style={{ color:'#ffcc44', fontSize:'12px' }}>所持金 {yen(gold)}G</div>
      </div>

      {/* タブ */}
      <div style={{ display:'flex', marginBottom:'16px', borderBottom:'1px solid #002244', maxWidth:'600px', margin:'0 auto 16px' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'8px 16px', background: tab === t.id ? '#001840' : 'none', border:'none',
            borderBottom: tab === t.id ? '2px solid #0088ff' : '2px solid transparent',
            color: tab === t.id ? '#88ccff' : '#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px',
          }}>{t.label}{t.id === 'mine' && myListings.length > 0 ? `(${myListings.length})` : ''}</button>
        ))}
      </div>

      {msg && (
        <div style={{ maxWidth:'600px', margin:'0 auto 12px', border:`1px solid ${msg.color}`, background:'#001020', padding:'10px', color:msg.color, fontSize:'12px' }}>{msg.text}</div>
      )}

      {/* 絞り込み・ソート（購入／出品タブ） */}
      {tab !== 'mine' && (
        <div style={{ maxWidth:'600px', margin:'0 auto 14px', display:'flex', flexWrap:'wrap', gap:'10px', alignItems:'center' }}>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', alignItems:'center' }}>
            <span style={{ color:'#446688', fontSize:'10px', marginRight:'2px' }}>ランク</span>
            {RANK_FILTERS.map(rk => {
              const on = rankFilter === rk
              const c = rk === 'all' ? '#88ccff' : (RARITY_COLORS[rk] || '#88ccff')
              return (
                <button key={rk} onClick={() => setRankFilter(rk)} style={{
                  padding:'3px 8px', background: on ? '#001840' : 'none',
                  border:`1px solid ${on ? c : '#223344'}`, color: on ? c : '#556677',
                  cursor:'pointer', fontFamily:'monospace', fontSize:'10px', borderRadius:'3px',
                }}>{rk === 'all' ? '全て' : RARITY_LABELS[rk]}</button>
              )
            })}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
            marginLeft:'auto', background:'#001028', border:'1px solid #0055aa', color:'#aaccff',
            fontFamily:'monospace', fontSize:'11px', padding:'4px 6px', borderRadius:'3px', cursor:'pointer',
          }}>
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      )}

      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        {/* 購入タブ */}
        {tab === 'buy' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {buyListings.map(l => {
              const canAfford = gold >= l.price
              return (
                <div key={l.id} style={{ border:`1px solid ${canAfford ? '#224433' : '#0055aa'}`, background:'#001028', padding:'12px' }}>
                  <WeaponCard weapon={l.weapons} bonusEffect={l.bonus_effect} />
                  <div style={{ fontSize:'10px', color:'#557799', marginTop:'8px', marginBottom:'4px' }}>出品者: <span style={{ color:'#88ccff' }}>{l.seller?.username || '???'}</span></div>
                  <PriceStats stat={stats[l.weapon_id]} base={l.base_price} />
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'8px' }}>
                    <div style={{ color:'#ffcc44', fontSize:'15px' }}>{yen(l.price)}G</div>
                    <button onClick={() => handleBuy(l)} disabled={!canAfford || busy === l.id}
                      style={{ padding:'8px 18px', background: canAfford ? '#001a00' : '#000e20', border:`1px solid ${canAfford ? '#44ff88' : '#002244'}`, color: canAfford ? '#44ff88' : '#335566', cursor: canAfford ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
                      {busy === l.id ? '処理中...' : canAfford ? '購入' : '所持金不足'}
                    </button>
                  </div>
                </div>
              )
            })}
            {buyListings.length === 0 && <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'40px' }}>現在出品されているアイテムはありません</div>}
          </div>
        )}

        {/* マイ出品タブ */}
        {tab === 'mine' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {myListings.map(l => {
              const days = Math.max(0, Math.ceil((new Date(l.expires_at).getTime() - Date.now()) / 86400000))
              return (
                <div key={l.id} style={{ border:'1px solid #334455', background:'#001028', padding:'12px' }}>
                  <WeaponCard weapon={l.weapons} bonusEffect={l.bonus_effect} />
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'8px' }}>
                    <div style={{ fontSize:'11px' }}>
                      <span style={{ color:'#ffcc44', fontSize:'14px' }}>{yen(l.price)}G</span>
                      <span style={{ color:'#557799', marginLeft:'8px' }}>手取り {yen(Math.floor(l.price * 0.8))}G</span>
                      <div style={{ color:'#445566', fontSize:'10px', marginTop:'2px' }}>残り約{days}日で手元に戻ります</div>
                    </div>
                    <button onClick={() => handleCancel(l)} disabled={busy === l.id}
                      style={{ padding:'8px 14px', background:'#1a0000', border:'1px solid #aa4444', color:'#ff6666', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                      {busy === l.id ? '処理中...' : '取消'}
                    </button>
                  </div>
                </div>
              )
            })}
            {myListings.length === 0 && <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'40px' }}>出品中のアイテムはありません</div>}
          </div>
        )}

        {/* 出品するタブ */}
        {tab === 'sell' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ color:'#445566', fontSize:'10px', marginBottom:'4px' }}>
              ※ 未強化・未装備の対象装備のみ出品できます（アーティファクト・帰属品は不可）。手数料20%。売れなければ14日で手元に戻ります。
            </div>
            {sellEquip.map(e => {
              const bp = basePriceOf(e.weapons)
              return (
                <div key={e.id} style={{ border:'1px solid #003366', background:'#001028', padding:'12px' }}>
                  <WeaponCard weapon={e.weapons} bonusEffect={e.bonus_effect} enhancePlus={e.enhance_plus}
                    right={<button onClick={() => openSell(e)}
                      style={{ padding:'7px 16px', background:'#001a00', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap' }}>出品</button>} />
                  <div style={{ fontSize:'10px', color:'#557799', marginTop:'6px' }}>基準 {yen(bp)}G（{yen(Math.floor(bp*0.5))}〜{yen(Math.ceil(bp*1.5))}G）</div>
                </div>
              )
            })}
            {myEquip.length === 0 && <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'40px' }}>出品できる装備がありません</div>}
            {myEquip.length > 0 && sellEquip.length === 0 && <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'40px' }}>条件に合う装備がありません</div>}
          </div>
        )}
      </div>

      {/* 出品完了ポップアップ（強化成功と同じ中央モーダル） */}
      {listResult && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,4,16,0.85)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }} onClick={() => setListResult(null)}>
          <div style={{ background:'#000e20', border:'1px solid #44ddaa', padding:'24px', maxWidth:'360px', width:'100%', fontFamily:'monospace', textAlign:'center' }} onClick={ev => ev.stopPropagation()}>
            <div style={{ fontSize:'30px', marginBottom:'10px' }}>🏷</div>
            <div style={{ color:'#44ddaa', fontSize:'16px', letterSpacing:'2px', marginBottom:'12px' }}>出品しました！</div>
            <div style={{ color:'#aaccff', fontSize:'13px', marginBottom:'6px' }}>{listResult.name}</div>
            <div style={{ color:'#ffcc44', fontSize:'15px', marginBottom:'4px' }}>{yen(listResult.price)}G</div>
            <div style={{ color:'#557799', fontSize:'11px', marginBottom:'4px' }}>売却時の手取り <span style={{ color:'#44ff88' }}>{yen(listResult.proceeds)}G</span>（手数料20%）</div>
            <div style={{ color:'#445566', fontSize:'10px', marginBottom:'18px' }}>14日間／売れなければ手元に戻ります</div>
            <button onClick={() => setListResult(null)}
              style={{ padding:'8px 20px', background:'#001a14', border:'1px solid #44ddaa', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>閉じる</button>
          </div>
        </div>
      )}

      {/* 出品ダイアログ */}
      {sellTarget && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }} onClick={() => setSellTarget(null)}>
          <div style={{ background:'#000e20', border:'1px solid #0066aa', padding:'20px', maxWidth:'360px', width:'90%' }} onClick={ev => ev.stopPropagation()}>
            <div style={{ color:'#44ddaa', fontSize:'14px', marginBottom:'14px', textAlign:'center', letterSpacing:'2px' }}>出品価格を設定</div>
            <WeaponCard weapon={sellTarget.weapons} bonusEffect={sellTarget.bonus_effect} />
            <PriceStats stat={stats[sellTarget.weapon_id]} base={sellBase} />
            <div style={{ margin:'14px 0 6px', fontSize:'11px', color:'#557799' }}>価格（{yen(sellMin)} 〜 {yen(sellMax)}G）</div>
            <input type="range" min={sellMin} max={sellMax} step={Math.max(1, Math.round((sellMax - sellMin) / 100))}
              value={sellPrice} onChange={ev => setSellPrice(Number(ev.target.value))} style={{ width:'100%' }} />
            <input type="number" min={sellMin} max={sellMax} value={sellPrice}
              onChange={ev => setSellPrice(Number(ev.target.value))}
              style={{ width:'100%', marginTop:'8px', background:'#001028', border:'1px solid #0055aa', color:'#ffcc44', fontFamily:'monospace', fontSize:'14px', padding:'6px', boxSizing:'border-box', textAlign:'center' }} />
            <div style={{ fontSize:'11px', color:'#557799', textAlign:'center', margin:'10px 0' }}>
              売却時の手取り <span style={{ color:'#44ff88', fontSize:'13px' }}>{yen(Math.floor((sellPrice || 0) * 0.8))}G</span>（手数料20%）
            </div>
            <div style={{ display:'flex', gap:'10px', marginTop:'8px' }}>
              <button onClick={() => setSellTarget(null)} style={{ flex:1, padding:'10px', background:'none', border:'1px solid #445566', color:'#778899', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>キャンセル</button>
              <button onClick={handleList} disabled={busy === 'sell' || sellPrice < sellMin || sellPrice > sellMax}
                style={{ flex:2, padding:'10px', background:'#001a00', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                {busy === 'sell' ? '処理中...' : 'この価格で出品'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
