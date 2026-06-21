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
  'open_atk_20_1t':  'バトル開始時、1ターンの間攻撃力+20%',
  'open_def_10_2t':  'バトル開始時、2ターンの間防御力+10%',
  'open_def_20_1t':  'バトル開始時、1ターンの間防御力+20%',
  'open_matk_10_2t': 'バトル開始時、2ターンの間特殊攻撃力+10%',
  'open_matk_20_1t': 'バトル開始時、1ターンの間特殊攻撃力+20%',
  'open_mdef_10_2t': 'バトル開始時、2ターンの間特殊防御力+10%',
  'open_mdef_20_1t': 'バトル開始時、1ターンの間特殊防御力+20%',
  'open_spd_10_2t':  'バトル開始時、2ターンの間素早さ+10%',
  'open_spd_20_1t':  'バトル開始時、1ターンの間素早さ+20%',
  'regen_heal_5_3t': 'バトル開始時、3ターンの間毎ターンHP5%回復',
  'delay_heal_10':   'バトル開始時、3ターン後にHP10%回復',
  'artifact':        'アーティファクト（MP消費2倍・与ダメージ1.2倍）',
  'hit_spd_down_5':  '攻撃ヒット時、対象の素早さ-5%',
  'battle_start_ailment_shield': '戦闘開始時、1回だけ状態異常を無効化',
  'mdef_pen_5':      '魔法防御貫通+5%',
  'ondmg_spd_up_5_2t':     '被ダメージ時、2ターンの間素早さ+5%',
  'extra_hit_paralysis_30':'追加行動の攻撃ヒット時、30%で相手を麻痺',
}

function WeaponCard({ weapon, bonusEffect }) {
  if (!weapon) return null
  const rarity = weapon.rarity?.toLowerCase() || 'f'
  const color = RARITY_COLORS[rarity] || '#888888'
  const effectDesc = BONUS_EFFECT_DESC[bonusEffect] || null

  return (
    <div style={{ border: `1px solid #0055aa`, background: '#001028', padding: '10px', marginBottom: '10px' }}>
      <div style={{ color: '#446688', fontSize: '10px', marginBottom: '4px' }}>
        {SLOT_LABELS[weapon.slot] || weapon.slot}
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '9px', padding: '1px 4px', color: color, border: `1px solid ${color}` }}>
          {RARITY_LABELS[rarity] || rarity.toUpperCase()}
        </span>
        <span style={{ color: color, fontSize: '13px' }}>{weapon.name}</span>
      </div>
      <div style={{ fontSize: '10px', marginBottom: '4px' }}>
        {weapon.atk_bonus   > 0 && <span style={{ color: '#ffcc00' }}>攻撃力+{weapon.atk_bonus} </span>}
        {weapon.def_bonus   > 0 && <span style={{ color: '#88aaff' }}>防御力+{weapon.def_bonus} </span>}
        {weapon.matk_bonus  > 0 && <span style={{ color: '#cc44ff' }}>特殊攻撃力+{weapon.matk_bonus} </span>}
        {weapon.mdef_bonus  > 0 && <span style={{ color: '#44ccff' }}>特殊防御力+{weapon.mdef_bonus} </span>}
        {weapon.spd_bonus   > 0 && <span style={{ color: '#ff8844' }}>素早さ+{weapon.spd_bonus} </span>}
        {weapon.hp_bonus    > 0 && <span style={{ color: '#44ff88' }}>HP+{weapon.hp_bonus} </span>}
        {weapon.mp_bonus    > 0 && <span style={{ color: '#4488ff' }}>MP+{weapon.mp_bonus} </span>}
        {weapon.spd_bonus_pct  > 0 && <span style={{ color: '#ff8844' }}>素早さ+{weapon.spd_bonus_pct}% </span>}
        {weapon.hp_bonus_pct   > 0 && <span style={{ color: '#44ff88' }}>HP+{weapon.hp_bonus_pct}% </span>}
        {weapon.mp_bonus_pct   > 0 && <span style={{ color: '#4488ff' }}>MP+{weapon.mp_bonus_pct}% </span>}
        {weapon.atk_bonus_pct  > 0 && <span style={{ color: '#ffcc00' }}>攻撃力+{weapon.atk_bonus_pct}% </span>}
        {weapon.matk_bonus_pct > 0 && <span style={{ color: '#cc44ff' }}>特殊攻撃力+{weapon.matk_bonus_pct}% </span>}
        {weapon.hit_bonus   > 0 && <span style={{ color: '#ffaa44' }}>命中+{weapon.hit_bonus}% </span>}
        {weapon.crit_bonus  > 0 && <span style={{ color: '#ff6688' }}>クリ率+{weapon.crit_bonus}% </span>}
        {weapon.crit_resist > 0 && <span style={{ color: '#66ccff' }}>クリ抵抗+{weapon.crit_resist}% </span>}
      </div>
      {effectDesc && (
        <div style={{ fontSize: '10px', color: '#446688', marginTop: '4px' }}>
          <span style={{ color: '#cc88ff' }}>【特殊能力】</span>
          <span style={{ color: '#aaaaff', marginLeft: '4px' }}>{effectDesc}</span>
        </div>
      )}
    </div>
  )
}

const TABS = ['レイドボス']

export default function Exchange() {
  const nav = useNavigate()
  const [activeTab, setActiveTab] = useState('レイドボス')
  const [shopItems, setShopItems] = useState([])
  const [weaponMap, setWeaponMap] = useState({})
  const [records, setRecords] = useState([])
  const [materials, setMaterials] = useState({})
  const [exchanging, setExchanging] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    setUserId(user.id)

    const [{ data: prof }, { data: shop }, { data: recs }, { data: mats }] = await Promise.all([
      supabase.from('profiles').select('id').eq('id', user.id).single(),
      supabase.from('exchange_shop').select('*').eq('active', true).order('sort_order'),
      supabase.from('exchange_records').select('shop_id, exchange_count').eq('player_id', user.id),
      supabase.from('player_items').select('quantity, items(name)').eq('player_id', user.id),
    ])

    if (!prof) { nav('/create'); return }
    const items = shop || []
    setShopItems(items)
    // shop_id → 交換済み回数のマップ
    const recMap = {}
    for (const r of (recs || [])) recMap[r.shop_id] = (recMap[r.shop_id] || 0) + (r.exchange_count || 1)
    setRecords(recMap)

    const matMap = {}
    for (const m of (mats || [])) {
      if (m.items?.name) matMap[m.items.name] = m.quantity
    }
    setMaterials(matMap)

    // 武器データを一括取得
    const weaponNames = [...new Set(items.map(i => i.reward_weapon_name).filter(Boolean))]
    if (weaponNames.length > 0) {
      const { data: weapons } = await supabase
        .from('weapons')
        .select('*')
        .in('name', weaponNames)
      const wMap = {}
      for (const w of (weapons || [])) wMap[w.name] = w
      setWeaponMap(wMap)
    }
  }

  const handleExchange = async (shopId) => {
    setExchanging(shopId)
    setError(null)
    setResult(null)
    const { data, error: err } = await supabase.rpc('do_exchange', { p_shop_id: shopId })
    if (err || data?.error) {
      setError(data?.error || 'エラーが発生しました')
    } else {
      setResult({ ...data, shopId })
      await init()
    }
    setExchanging(null)
  }

  const tabItems = shopItems.filter(i => (i.tab || 'レイドボス') === activeTab)

  const base = {
    minHeight: '100vh',
    background: '#000820',
    color: '#aaccff',
    fontFamily: 'monospace',
    padding: '16px',
    boxSizing: 'border-box',
  }

  return (
    <div style={base}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
        <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
        <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
      </div>
      <div style={{ color:'#ff6644', fontSize:'14px', marginBottom:'12px' }}>🔄 交換所</div>

      {/* タブ */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderBottom: '1px solid #002244', maxWidth: '600px', margin: '0 auto 16px' }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setResult(null); setError(null) }}
            style={{
              padding: '8px 16px',
              background: activeTab === tab ? '#001840' : 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #0088ff' : '2px solid transparent',
              color: activeTab === tab ? '#88ccff' : '#446688',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>
            {tab}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* 所持素材 */}
        {activeTab === 'レイドボス' && (
          <div style={{ border: '1px solid #002244', background: '#000e20', padding: '10px', marginBottom: '14px' }}>
            <div style={{ color: '#446688', fontSize: '10px', marginBottom: '6px' }}>所持素材</div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {['黒龍の鱗', '黒龍の逆鱗', '水禍の雫', '雨禍の心核'].map(name => (
                <div key={name} style={{ fontSize: '12px' }}>
                  <span style={{ color: '#556677' }}>{name}: </span>
                  <span style={{ color: (materials[name] || 0) > 0 ? '#ffcc44' : '#334455' }}>
                    {materials[name] || 0}個
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 結果・エラー */}
        {result && (
          <div style={{ border: '1px solid #224422', background: '#001a00', padding: '10px', marginBottom: '12px', color: '#44ff88', fontSize: '12px' }}>
            ✓ 交換成功！「{result.reward_name}」を入手しました。装備画面で確認できます。
          </div>
        )}
        {error && (
          <div style={{ border: '1px solid #440000', background: '#1a0000', padding: '10px', marginBottom: '12px', color: '#ff4444', fontSize: '12px' }}>
            {error}
          </div>
        )}

        {/* 交換リスト */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {tabItems.map(item => {
            const costs = item.cost_items
            const doneCount = records[item.id] || 0
            const isUnlimited = item.max_per_player == null
            const alreadyDone = !isUnlimited && doneCount >= item.max_per_player
            const remaining = isUnlimited ? null : item.max_per_player - doneCount
            const canAfford = !alreadyDone && costs.every(c => (materials[c.item_name] || 0) >= c.quantity)
            const weapon = weaponMap[item.reward_weapon_name]

            // アイテム報酬（強化石など）は賭博場の景品風スリム表示
            if (item.reward_type === 'item') {
              return (
                <div key={item.id} style={{ border: `1px solid ${canAfford ? '#224433' : '#003366'}`, background: '#001028', padding: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#88ccff', fontSize: '12px' }}>{item.reward_weapon_name}</div>
                      <div style={{ fontSize: '10px', marginTop: '2px' }}>
                        {costs.map((c, i) => {
                          const held = materials[c.item_name] || 0
                          const ok = held >= c.quantity
                          return (
                            <span key={c.item_name} style={{ color: '#557799' }}>
                              {i > 0 && ' / '}{c.item_name}×{c.quantity}
                              <span style={{ color: ok ? '#44ff88' : '#ff4444' }}>（{held}所持）</span>
                            </span>
                          )
                        })}
                      </div>
                      <div style={{ color: '#446688', fontSize: '10px', marginTop: '2px' }}>
                        {isUnlimited ? `何度でも交換可（${doneCount}回交換済み）` : `${item.max_per_player}回まで（残り${remaining}回）`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleExchange(item.id)}
                      disabled={!canAfford || exchanging === item.id}
                      style={{ padding: '8px 14px', background: canAfford ? '#001a00' : '#000e20', border: `1px solid ${canAfford ? '#44ff88' : '#002244'}`, color: canAfford ? '#44ff88' : '#335566', cursor: canAfford ? 'pointer' : 'not-allowed', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {exchanging === item.id ? '処理中...' : alreadyDone ? '上限' : canAfford ? '交換' : '素材不足'}
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div key={item.id} style={{
                border: `1px solid ${alreadyDone ? '#1a3344' : canAfford ? '#224433' : '#0055aa'}`,
                background: alreadyDone ? '#080f0f' : '#001028',
                padding: '14px',
              }}>
                {/* 装備カード */}
                <WeaponCard weapon={weapon} bonusEffect={item.reward_bonus_effect} />

                {/* 必要素材 */}
                <div style={{ borderTop: '1px solid #0a1828', paddingTop: '10px', marginBottom: '10px' }}>
                  <div style={{ color: '#335566', fontSize: '10px', marginBottom: '6px' }}>必要素材</div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {costs.map(c => {
                      const held = materials[c.item_name] || 0
                      const ok = held >= c.quantity
                      return (
                        <div key={c.item_name} style={{ fontSize: '12px' }}>
                          <span style={{ color: '#778899' }}>{c.item_name} × {c.quantity}</span>
                          <span style={{ color: ok ? '#44ff88' : '#ff4444', marginLeft: '6px', fontSize: '11px' }}>
                            ({held}/{c.quantity})
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {isUnlimited ? (
                  <div style={{ color: '#335566', fontSize: '10px', marginBottom: '8px' }}>※ 何度でも交換可（{doneCount}回交換済み）</div>
                ) : (
                  <div style={{ color: alreadyDone ? '#ff4444' : '#335566', fontSize: '10px', marginBottom: '8px' }}>
                    ※ {item.max_per_player}回まで（残り{remaining}回）
                  </div>
                )}

                <button
                  onClick={() => handleExchange(item.id)}
                  disabled={!canAfford || exchanging === item.id}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: alreadyDone ? '#080f0f' : canAfford ? '#001a00' : '#000e20',
                    border: `1px solid ${alreadyDone ? '#1a3333' : canAfford ? '#44ff88' : '#002244'}`,
                    color: alreadyDone ? '#334455' : canAfford ? '#44ff88' : '#335566',
                    cursor: canAfford ? 'pointer' : 'not-allowed',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                  }}
                >
                  {alreadyDone ? '✓ 交換上限に達しました' : exchanging === item.id ? '処理中...' : canAfford ? '交換する' : '素材不足'}
                </button>
              </div>
            )
          })}

          {tabItems.length === 0 && (
            <div style={{ color: '#446688', fontSize: '12px', textAlign: 'center', padding: '40px' }}>
              現在交換できるアイテムはありません
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
