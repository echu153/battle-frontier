import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { validateName } from '../../lib/nameFilter'
import { reportDevAccess } from '../../lib/devAccess'
import V2Modal from '../components/V2Modal.jsx'
import { V2Menu } from '../components/V2Status.jsx'
import { box, btn, miniBtn, TEXT } from '../components/v2ui.js'
import { useCapFold } from '../components/useCapFold.js'
import V2capStatus from '../components/V2capStatus.jsx'
import V2capSortie from '../components/V2capSortie.jsx'
import V2capEquip from '../components/V2capEquip.jsx'
import V2capSmith from '../components/V2capSmith.jsx'
import V2capSkills from '../components/V2capSkills.jsx'
import V2capTemple from '../components/V2capTemple.jsx'
import V2capMuseum from '../components/V2capMuseum.jsx'
import V2capBurger from '../components/V2capBurger.jsx'
import V2capDaily from '../components/V2capDaily.jsx'
import V2capProfile from '../components/V2capProfile.jsx'
import V2capTree from '../components/V2capTree.jsx'
import V2capDex from '../components/V2capDex.jsx'
import V2capCasino from '../components/V2capCasino.jsx'
import V2capAscension from '../components/V2capAscension.jsx'
import V2capTower from '../components/V2capTower.jsx'
import V2capUniqueCheck from '../components/V2capUniqueCheck.jsx'
import { START_CLASSES, weaponsOf, attackKindOf, classDescOf } from '../lib/jobs.js'
import { apLeftOf } from '../lib/ascension.js'
import { TOWER_NAME, floorLabel, clampFloor } from '../lib/tower.js'
import { openUntilOf } from '../lib/sortie.js'
import { spotLabel } from '../lib/areas.js'
import { RARITY_COLOR } from '../lib/equipment.js'
import { GENDER_BY_KEY, genderOf } from '../lib/gender.js'
import { SHOP_NAME, MEAL_COLOR, activeMealOf, leftText } from '../lib/burger.js'
import { MARK_SRC } from '../lib/clerk.js'

// ニャーガーキングのマーク（メニューと店の題で🍔の代わり。文字と同じ高さに並べる）
function ShopMark({ size = 16 }) {
  return <img src={MARK_SRC} alt="" width={size} height={size} style={{ verticalAlign:'-3px' }} />
}
import V2capGenderPick from '../components/V2capGenderPick.jsx'
import { CarryLines } from '../components/V2capV1Carry.jsx'

// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版 — ホーム（開発限定）
// ------------------------------------------------------------
// 2026-10-09 着手。今のⅡ（/v2）は仮として残し、別のキャラ・別のデータで作る。
// 設計は docs/v2cap-design.md。入れるのは is_admin だけ（サーバーの v2cap_is_dev も同じ）。
// 【確定】2026-10-11 ユーザー指示「UIはV2みたいにこんな感じにしてほしい」：今のⅡのホーム（V2Home.jsx）と同じ形にした
//   ・上に貼り付く細い帯（BATTLE FRONTIER Ⅱ・旧版へ戻る）
//   ・ホームは左右2列（左＝ステータス 340px／右＝今日のミッション→出撃→メニュー）。最大980px・狭いと1列に折り返す
//   ・メニューは今のⅡと同じ部品（V2Menu：2列・まとまりごと・色つきの枠・「メニューを閉じる」）。この版にある施設だけ並べる
//   ・施設は別の画面（ステータスは出さない・横いっぱい）。「← ホームへ」で戻る
//   ・ステータスとメニュー（と今日のミッション）の開け閉めは覚えておく（今のⅡとは別のキー・2026-10-15 からキャラのデータにも）
//   ・出撃のタブ（アリーナ・ATB）はこの版に無いので出さない
// ============================================================
const MENU = [
  [
    { key:'profile', label:'プロフィール', icon:'👤', color:'#88aaff', action:'アイコン・ステの内訳' },
    { key:'skills',  label:'スキルセット', icon:'📖', color:'#44ff88', action:'編成する' },
    { key:'equip',   label:'装備',         icon:'🛡', color:'#88ccff', action:'着ける・外す' },
    { key:'dex',     label:'モンスター図鑑', icon:'📕', color:'#c0b0ff', action:'敵とドロップを見る' },
  ],
  [
    { key:'smith',  label:'鍛冶屋', icon:'🔨', color:'#ffcc00', action:'強化・分解・作成' },
    { key:'temple', label:'神殿',   icon:'🏛', color:'#ff88cc', action:'転職する' },
  ],
  // 【確定】2026-10-22 博物館（装備の寄贈・V1と同じ形の土台。登録でもらえる能力はあとで）
  // 【確定】2026-10-25 ハンバーガー屋「ニャーガーキング」（食べると60分ステ+10%・トッピングで状態異常にかかりにくく）。説明は食事中なら残り時間（menuOf）
  //   アイコンは店のマーク（ワッペン＝猫耳としっぽのついたハンバーガー・lib/clerk.js の MARK_SRC）。ユーザー選択「メニューの🍔の代わりに使う」
  [
    { key:'museum', label:'博物館', icon:'🏺', color:'#d8b070', action:'装備を寄贈する' },
    { key:'burger', label: SHOP_NAME, icon: <ShopMark />, color: MEAL_COLOR, action:'バーガーを食べる' },
  ],
  // 【確定】2026-10-13 アセンション（スキルツリー）。説明は残りのAPで変わる（menuOf）
  [
    { key:'asc', label:'アセンション', icon:'✨', color:'#ffaa44', action:'APを振る' },
  ],
  // 【確定】2026-10-14 塔（あるけみすと型の対人・1〜100層）。説明はいまの層で変わる（menuOf）
  [
    { key:'tower', label: TOWER_NAME, icon:'🗼', color:'#b48cff', action:'階層守護者に挑む' },
  ],
  // 宝樹は1つだけのまとまり＝横いっぱい（今のⅡと同じ並び方）
  [
    { key:'tree', label:'ユグレシアの宝樹', icon:'🌳', color:'#44dd99', action:'祈る' },
  ],
  // 【確定】2026-10-13 賭博場（スロット・ハイ&ロー・ルーレット・両替所）。景品の交換所はあとで
  [
    { key:'casino', label:'賭博場', icon:'🎰', color:'#ff4fa3', action:'スロット・ハイ&ロー・ルーレット' },
  ],
]
const SCREEN_TITLE = { profile:'👤 プロフィール', skills:'📖 スキルセット', equip:'🛡 装備', dex:'📕 モンスター図鑑', smith:'🔨 鍛冶屋', temple:'🏛 神殿', museum:'🏺 博物館', burger: <><ShopMark size={18} /> {SHOP_NAME}</>, asc:'✨ アセンション', tree:'🌳 ユグレシアの宝樹', casino:'🎰 賭博場', tower:`🗼 ${TOWER_NAME}`,
  uniqueCheck:'💎 ユニークの能力の確かめ［開発］' }
// メニューの説明に、いまの職業で残っているAPを出す（振り忘れに気づけるように）。塔はいまの層（守っていればその層）
const towerActionOf = (prof) => (prof?.tower_guard
  ? `👑 ${floorLabel(prof.tower_guard)}を守っている`
  : `${floorLabel(clampFloor(prof?.tower_floor || 1))}の階層守護者に挑む`)
const menuOf = (prof) => {
  const left = Math.max(0, apLeftOf(prof))
  const meal = activeMealOf(prof)
  return MENU.map(g => g.map(m => {
    if (m.key === 'asc' && left > 0) return { ...m, action:`APを振る（残り${left}）` }
    if (m.key === 'tower') return { ...m, action: towerActionOf(prof) }
    if (m.key === 'burger' && meal) return { ...m, action:`食事中（${leftText(meal.leftMs)}）` }
    return m
  }))
}

// 今のⅡと同じ2列（grid の auto-fit は列を同じ幅にしかできないので flex で組む）
//   左 … flex:'1 1 340px'／右 … flex:'999 1 340px'＝余った幅はほぼ右へ。688px より狭いと折り返して1列
const TWO_COLUMN = { display:'flex', flexWrap:'wrap', gap:'8px', alignItems:'flex-start', maxWidth:'980px', margin:'0 auto' }

// ★開いたときの待ちを減らす（2026-10-25 ユーザー指示「V2のホームが表示前に待つ問い合わせを減らして（約5回→2〜3回）」）：
//   ・だれがログインしているかは端末に残っているセッションで見る（getSession＝サーバーへ行かない）。前の getUser は毎回サーバーへ聞きに行き、
//     このPCからは1回およそ0.3秒かかっていた。権限はサーバー（表の RLS・各RPCの v2cap_is_dev）が確かめるので、画面の確かめは端末のもので足りる
//   ・管理者かどうか（profiles）と、この版のキャラ・持ち物を同時に聞く。前は「確かめ→管理者→確かめ→キャラと持ち物」の4回を順番に待っていた
//   → 開くときに待つのは、入口（App.jsx の checkChar）の1回と、ここの1回の合わせて2回（homeLoad.test.js が見張る）。子の画面から取り直すとき（refresh）も1回
const sessionUserId = async () => (await supabase.auth.getSession()).data.session?.user?.id || null
const fetchCap = (uid) => Promise.all([
  supabase.from('v2cap_profiles').select('*').eq('id', uid).maybeSingle(),
  supabase.from('v2cap_inventory').select('*').order('id', { ascending:false }),
])
const COL_LEFT  = { flex:'1 1 340px', minWidth:0 }
const COL_RIGHT = { flex:'999 1 340px', minWidth:0 }

export default function V2capHome() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [sqlError, setSqlError] = useState('')
  const [prof, setProf] = useState(null)
  const [inventory, setInventory] = useState([])
  const [screen, setScreen] = useState('home')
  const [inBattle, setInBattle] = useState(false)
  const [name, setName] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)   // 宝樹を何回でも祈れる（2026-10-13・開発中）
  const [pick, setPick] = useState('戦士')
  const [sex, setSex] = useState('m')   // 性別（キャラ作成と、性別が無い前からのキャラの1回だけの選択・2026-10-21）
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devMsg, setDevMsg] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [carry, setCarry] = useState(null)   // 作成したときに V1 から引き継いだもの（作成の直後に1回だけ知らせる・2026-10-23）
  // ★開け閉めは覚えておく。今のⅡ（v2:openStatus・v2:openMenu）とは別のキー。
  //   【確定】2026-10-15 ユーザー指示「閉じたら閉じる、開いたら開くを継続させて」：端末だけでなくキャラのデータにも覚える（useCapFold）。
  //   今日のミッションの開け閉めも同じに覚える（前は毎回畳んで始めていた）
  const [openStatus, toggleStatus] = useCapFold(prof, 'openStatus')
  const [openMenu, toggleMenu] = useCapFold(prof, 'openMenu')
  const [openDaily, toggleDaily] = useCapFold(prof, 'openDaily')

  // この版のキャラと持ち物を入れる（fetchCap の返り値）。読めなければ投げる（SQLがまだ流されていない など）
  const applyCap = useCallback(([{ data: p, error: e1 }, { data: inv, error: e2 }]) => {
    if (e1 || e2) throw new Error((e1 || e2).message || String(e1 || e2))
    setProf(p || null)
    setInventory(inv || [])
    return p
  }, [])
  const load = useCallback(async () => {
    const uid = await sessionUserId()
    if (!uid) return null
    return applyCap(await fetchCap(uid))
  }, [applyCap])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const uid = await sessionUserId()
        if (!uid) { nav('/login'); return }
        // 管理者かどうかと、この版のキャラ・持ち物を同時に聞く（下の fetchCap の注）
        const [{ data: p }, cap] = await Promise.all([
          supabase.from('profiles').select('username, is_admin').eq('id', uid).maybeSingle(),
          fetchCap(uid),
        ])
        // ★開発限定。管理者以外は旧版へ戻す（アクセスは管理者へ通知）
        if (!p?.is_admin) { reportDevAccess('v2cap', 'V2レベルキャップあり[開発]'); nav('/game'); return }
        if (!alive) return
        setName(p?.username || '')
        setIsAdmin(!!p?.is_admin)
        applyCap(cap)
      } catch (err) {
        if (alive) setSqlError(err.message || String(err))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [nav, applyCap])

  // 子の画面から呼ぶ。サーバーから取り直す
  const refresh = useCallback(async () => {
    try { await load() } catch (err) { setError(err.message || String(err)) }
  }, [load])
  const onScene = useCallback((s) => setInBattle(s === 'battle'), [])
  const goHome = () => setScreen('home')
  // 画面を切り替えたら一番上から見せる（ホームへ戻るときも）。
  // 【確定】2026-10-14 ユーザー指示「装備押すと中途半端なところで遷移する、一番上で遷移するようにして」
  //   ＝ページ全体（window）のスクロールが前の画面の位置のまま残っていた（ホームの下のメニューから開くと途中から見える）。
  //   描く前（useLayoutEffect）に戻すので、途中の位置は一瞬も見えない
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [screen])

  const create = async (e) => {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) { setError(nameErr); return }
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_create_character', { p_username: name.trim(), p_class: pick, p_gender: sex })
    setBusy(false)
    if (rpcErr || !data?.ok) { setError(rpcErr?.message || data?.error || '作成に失敗しました'); return }
    setProf(data.profile)
    setInventory([])
    // ★V1からの引き継ぎ（サーバーの v2cap_v1_carry が作成のときに入れる）：受け取ったものを知らせ、ユニークが入った持ち物を読み直す
    if (data.carry) setCarry(data.carry)
    refresh()
  }
  // 性別を持たない前からのキャラが、ホームで1回だけ選ぶ（サーバーは性別が空のときだけ通す）
  const saveGender = async () => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_set_gender', { p_gender: sex })
    setBusy(false)
    if (rpcErr || !data?.ok) { setError(rpcErr?.message || data?.error || '保存に失敗しました'); return }
    setProf(data.profile)
  }

  const gainExp = async (amount) => {
    setBusy(true); setDevMsg('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_gain_exp', { p_amount: amount })
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(data.profile)
    const parts = [`EXP+${amount.toLocaleString()}`]
    if (data.level_ups > 0) parts.push(`LV${data.lv}（+${data.level_ups}）`)
    if (data.points > 0) parts.push(`ステータスポイント+${data.points}`)
    if (data.job_ups > 0) parts.push(`CLASS LV${data.jlv}（+${data.job_ups}）`)
    if ((data.learned || []).length) parts.push(`スキル「${data.learned.join('」「')}」`)
    setDevMsg(parts.join('　'))
  }
  const gainMedals = async (amount) => {
    setBusy(true); setDevMsg('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_gain_medals', { p_amount: amount })
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setDevMsg(`メダル+${data.got.toLocaleString()}（${Number(data.medals).toLocaleString()}枚）`)
    await refresh()
  }
  // 安息の祠を出す（2026-10-13・演出を試す用）：出撃で選んでいる場所（開いていなければ開いている一番先）に置く
  const placeShrine = async () => {
    setBusy(true); setDevMsg('')
    const open = openUntilOf(prof?.cleared_spots)
    let picked = 1
    try { picked = Number(localStorage.getItem('v2capSelectedSpot')) || 1 } catch { /* 読めなければ①-① */ }
    const spot = picked >= 1 && picked <= open ? picked : open
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_shrine', { p_spot: spot })
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(data.profile)
    setDevMsg(`安息の祠を置いた（${spotLabel(spot)}）`)
  }
  // 次の出撃で安息の祠を見つける（2026-10-14 ユーザー「出撃で見つけたときの挙動確認したい」→「本物の精算で必ず見つける」を選んだ）：
  //   サーバーに印を付けるだけ。次の祠の外の出撃の精算が 0.1% の代わりに必ず見つける
  const shrineNext = async () => {
    setBusy(true); setDevMsg('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_shrine_next')
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(data.profile)
    setDevMsg(data.in_shrine ? 'いまの祠を出たあと、次の出撃で安息の祠を見つけます' : '次の出撃で安息の祠を見つけます')
  }
  // ユニーク（2026-10-21・効果を試す用）：持っていないものを60個ぜんぶもらう／次にボスに勝ったとき必ず落とす
  const giveUniques = async () => {
    setBusy(true); setDevMsg('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_give_uniques', { p_ids: null })
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setDevMsg(data.got > 0 ? `ユニークを${data.got}個もらった（装備の画面で着けられます）` : 'ユニークはもう全部持っています')
    await refresh()
  }
  const uniqueNext = async () => {
    setBusy(true); setDevMsg('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_unique_next')
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(data.profile)
    setDevMsg('次にボスに勝ったとき、必ずユニークを落とします')
  }
  const resetChar = async () => {
    setBusy(true)
    const { data, error: rpcErr } = await supabase.rpc('v2cap_dev_reset')
    setBusy(false); setConfirmReset(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(null); setInventory([]); setScreen('home'); setDevMsg('')
  }

  // index.css の #root が text-align:center なので、この版の中は左揃えに戻す（今のⅡと同じ）
  const page = { minHeight:'100vh', background:'#000820', color:'#88ccff', fontFamily:'monospace', textAlign:'left' }
  // ヘッダ。今のⅡと同じで、上に貼り付く細い帯（枠では囲まない）
  const header = (
    <div style={{ background:'#000820', borderBottom:'1px solid #003366', padding:'6px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', position:'sticky', top:0, zIndex:100 }}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', minWidth:0 }}>
        <div style={{ color:'#ffcc00', fontSize:'13px', letterSpacing:'2px' }}>BATTLE FRONTIER Ⅱ</div>
        <span style={{ color:'#ff88cc', fontSize:'10px' }}>レベルキャップあり</span>
        <span style={{ color:'#a89ccc', fontSize:'10px' }}>[開発]</span>
      </div>
      <button onClick={() => nav('/game')}
        style={{ background:'none', border:'1px solid #7fa6d0', color:'#7fa6d0', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', flexShrink:0 }}>
        ← 旧版へ戻る
      </button>
    </div>
  )

  if (loading) return <div style={{ ...page, textAlign:'center', paddingTop:'40px', color:'#0088ff' }}>読み込み中...</div>

  if (sqlError) {
    return (
      <div style={page}>
        {header}
        <div style={{ padding:'8px 12px', maxWidth:'640px', margin:'0 auto' }}>
          <div style={{ ...box, padding:'14px', borderColor:'#ff8844' }}>
            <div style={{ color:'#ff8844', marginBottom:'6px' }}>⚠ データを読み込めませんでした</div>
            <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.8 }}>
              supabase_v2cap_core.sql がまだ流されていない可能性があります。SupabaseのSQL Editorで全文を流してから開き直してください。
            </div>
            <div style={{ color: TEXT.empty, fontSize:'10px', marginTop:'6px' }}>{sqlError}</div>
          </div>
        </div>
      </div>
    )
  }

  // ===== キャラ作成 =====
  if (!prof) {
    return (
      <div style={page}>
        {header}
        <div style={{ padding:'8px 12px', maxWidth:'760px', margin:'0 auto' }}>
          {/* ★見せるのは「キャラクター名」と「性別」と「クラス選択」だけ（2026-10-09 ユーザー指示・性別は 2026-10-21 ユーザー指示で足した）。
               カードは職業名・物理／魔法・武器・特徴の説明1行（クラスのステや技の一覧は神殿で見る）。
               性別は「♂ 男性＝与えるダメージ+2%／♀ 女性＝受けるダメージ−2%」（lib/gender.js）。作成のあとは変えられない（変えるアイテムはあとで） */}
          <form onSubmit={create} style={{ ...box, padding:'14px' }}>
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>キャラクター名</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={16} placeholder="名前（1〜16文字）"
              style={{ width:'100%', boxSizing:'border-box', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'14px' }} />
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>
              性別<span style={{ color: TEXT.label, fontSize:'10px' }}>※あとから変えるにはアイテムが必要</span>
            </div>
            <div style={{ marginBottom:'14px' }}><V2capGenderPick value={sex} onChange={setSex} disabled={busy} /></div>
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>
              クラス選択<span style={{ color: TEXT.label, fontSize:'10px' }}>※いつでも変更可能</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'6px', marginBottom:'10px' }}>
              {START_CLASSES.map(c => {
                const on = pick === c
                return (
                  <button type="button" key={c} onClick={() => setPick(c)}
                    style={{ textAlign:'left', background: on ? '#001840' : '#000818', border:`1px solid ${on ? '#ffcc00' : '#002244'}`,
                      color:'#88ccff', padding:'8px', cursor:'pointer', fontFamily:'monospace' }}>
                    <div style={{ color: on ? '#ffcc00' : '#cfe2ff', fontSize:'12px', marginBottom:'4px' }}>
                      {c}
                      <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{attackKindOf(c) === 'mag' ? '魔法' : '物理'}</span>
                    </div>
                    <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7 }}>
                      <div>武器：<span style={{ color:'#cfe2ff' }}>{weaponsOf(c).join('・')}</span></div>
                      <div style={{ color:'#9fb8d0', marginTop:'2px' }}>{classDescOf(c)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'10px' }}>
              {busy ? '作成中...' : `${pick}で始める`}
            </button>
          </form>
        </div>
      </div>
    )
  }

  const isHome = screen === 'home'
  return (
    <div style={page}>
      {confirmReset && (
        <V2Modal title="キャラクターを作り直す［開発］" color="#ff8844" danger busy={busy}
          confirmLabel="消して作り直す" onConfirm={resetChar} onClose={() => setConfirmReset(false)}>
          この版のキャラクターと装備を消します（今のⅡ・旧版のデータには触りません）。元には戻せません。
        </V2Modal>
      )}
      {carry && (
        <V2Modal title="🔁 V1からの引き継ぎ" color="#88aaff" onClose={() => setCarry(null)}>
          <div style={{ color: TEXT.sub, fontSize:'11px', marginBottom:'6px' }}>バトルフロンティアで遊んだ記録から、次のものを引き継ぎました。</div>
          <CarryLines carry={carry} />
          <div style={{ color: TEXT.label, fontSize:'10px', marginTop:'6px' }}>あとからプロフィールでも見られます。</div>
        </V2Modal>
      )}
      {header}
      <div style={{ padding:'8px 12px' }}>
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
        {/* ★性別を持たない前からのキャラ（2026-10-21 より前に作った）は、ホームの上で1回だけ選ぶ。選ぶまで性能差は付かない */}
        {isHome && !genderOf(prof) && (
          <div style={{ ...box, padding:'12px', marginBottom:'8px', border:'1px solid #ffcc00' }}>
            <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'4px' }}>性別を選んでください</div>
            <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.6 }}>
              キャラクターに性別ができました。ここで1回だけ選べます（あとから変えるにはアイテムが必要）
            </div>
            <V2capGenderPick value={sex} onChange={setSex} disabled={busy} />
            <button onClick={saveGender} disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'8px', marginTop:'8px' }}>
              {busy ? '保存中...' : `${GENDER_BY_KEY[sex]?.label || ''}にする`}
            </button>
          </div>
        )}
        {isHome ? (
          <div style={TWO_COLUMN}>
            {/* ===== 左：キャラクターの状態（ホームだけ） ===== */}
            <div style={COL_LEFT}>
              <V2capStatus prof={prof} inventory={inventory} onProfile={refresh}
                open={openStatus} onToggle={toggleStatus} onAvatar={() => setScreen('profile')} />
            </div>

            {/* ===== 右：やること（今日のミッション・出撃・メニュー・開発用） ===== */}
            <div style={COL_RIGHT}>
              {!inBattle && <V2capDaily prof={prof} onProfile={refresh} open={openDaily} onToggle={toggleDaily} />}
              <div style={{ marginBottom:'8px' }}>
                <V2capSortie prof={prof} inventory={inventory} onProfile={refresh} onScene={onScene} />
              </div>
              {!inBattle && (
                <>
                  <V2Menu groups={menuOf(prof)} open={openMenu} onToggle={toggleMenu} onPick={setScreen} />
                  <div style={{ ...box, padding:'10px', borderColor:'#553366' }}>
                    <div style={{ color:'#ff88cc', fontSize:'11px', marginBottom:'6px' }}>🧪 開発用</div>
                    <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                      {[100, 10000, 1000000].map(n => (
                        <button key={n} onClick={() => gainExp(n)} disabled={busy} style={miniBtn('#44ff88')}>
                          EXP+{n.toLocaleString()}
                        </button>
                      ))}
                      {[1000, 100000].map(n => (
                        <button key={`m${n}`} onClick={() => gainMedals(n)} disabled={busy} style={miniBtn('#ffcc00')}>
                          メダル+{n.toLocaleString()}
                        </button>
                      ))}
                      <button onClick={shrineNext} disabled={busy || prof?.shrine_force} style={miniBtn('#9fe8ff')}>
                        {prof?.shrine_force ? '⛲ 次の出撃で祠を見つける（待機中）' : '⛲ 次の出撃で祠を見つける'}
                      </button>
                      <button onClick={placeShrine} disabled={busy} style={miniBtn('#9fe8ff')}>⛲ 安息の祠を出す</button>
                      {/* ユニーク（2026-10-21）：もらう・次のボスで必ず落とす・60個の能力の確かめ */}
                      <button onClick={giveUniques} disabled={busy} style={miniBtn(RARITY_COLOR.U)}>💎 ユニークを全部もらう</button>
                      <button onClick={uniqueNext} disabled={busy || prof?.unique_force} style={miniBtn(RARITY_COLOR.U)}>
                        {prof?.unique_force ? '💎 次のボスでユニーク（待機中）' : '💎 次のボスでユニークを落とす'}
                      </button>
                      <button onClick={() => setScreen('uniqueCheck')} style={miniBtn(RARITY_COLOR.U)}>💎 ユニークの能力を確かめる</button>
                      <button onClick={() => setConfirmReset(true)} disabled={busy} style={miniBtn('#ff8844')}>キャラを作り直す</button>
                    </div>
                    {/* ★「EXPは戦闘と同じ扱い（いまの職業のClassEXPにも同じ量が入る）」の説明は出さない（2026-10-12 ユーザー指示＝出撃の「（ClassEXP +◯）」と一緒に外した） */}
                    {devMsg &&<div style={{ color:'#cfe2ff', fontSize:'10px', marginTop:'4px' }}>{devMsg}</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          // ===== 施設（ステータスは出さない・横いっぱい） =====
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
              <button onClick={goHome} style={miniBtn('#88aaff')}>← ホームへ</button>
              <span style={{ color:'#88ccff', fontSize:'13px' }}>{SCREEN_TITLE[screen]}</span>
            </div>
            {screen === 'profile' && <V2capProfile prof={prof} inventory={inventory} onProfile={refresh} />}
            {screen === 'equip' && <V2capEquip prof={prof} inventory={inventory} onProfile={refresh} onGo={setScreen} />}
            {screen === 'smith' && <V2capSmith prof={prof} inventory={inventory} onProfile={refresh} onGo={setScreen} dev={isAdmin} />}
            {screen === 'skills' && <V2capSkills prof={prof} inventory={inventory} onProfile={refresh} />}
            {screen === 'temple' && <V2capTemple prof={prof} inventory={inventory} onProfile={refresh} />}
            {screen === 'museum' && <V2capMuseum prof={prof} inventory={inventory} onProfile={refresh} />}
            {screen === 'burger' && <V2capBurger prof={prof} onProfile={refresh} dev={isAdmin} />}
            {screen === 'asc' && <V2capAscension prof={prof} onProfile={refresh} />}
            {screen === 'tree' && <V2capTree prof={prof} onProfile={refresh} unlimited={isAdmin} />}
            {screen === 'dex' && <V2capDex prof={prof} />}
            {screen === 'casino' && <V2capCasino prof={prof} onProfile={refresh} />}
            {screen === 'tower' && <V2capTower prof={prof} inventory={inventory} onProfile={refresh} />}
            {screen === 'uniqueCheck' && <V2capUniqueCheck prof={prof} inventory={inventory} />}
          </div>
        )}
      </div>
    </div>
  )
}
