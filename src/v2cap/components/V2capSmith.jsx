import { useCallback, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import V2capSmithMaster, { MasterSays, MASTER_CSS } from './V2capSmithMaster.jsx'
import { useStored } from '../core/prefs.js'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import { ITEMS, ITEM_BY_ID, PARTS, SLOTS, RARITIES, ALL_RARITIES, RARITY_COLOR, ARMOR_EFFECT, kindLabel, partLabel, rarityLabel, needLvOf } from '../lib/equipment.js'
import { openAreaOf } from '../lib/sortie.js'
import { canEquipType } from '../lib/jobs.js'
import { wornIdsOf } from '../lib/loadout.js'
import { powerAt, statsAt, effectivePowerAt, syncLabelOf } from '../lib/gear.js'
import {
  PLUS_MAX, plusOf, scrapNameOf, scrapOf, scrapAreaOf, dismantleGainOf, bulkPickable, enhanceCostOf, enhanceErrorOf,
  SCRAP_YIELD, CRAFT_RARITIES, craftCostOf, craftErrorOf,
  STONE_NAME, ENHANCE_STONE, ENHANCE_SCRAP_FROM, stoneOf, enhanceSpentText,
  STONE2_NAME, STONE2_FROM, STONE_CRAFT, stoneHaveOf, stone2Of, stoneCraftMaxOf,
} from '../lib/smith.js'
import { statLine, nameColor, PLUS_COLOR, gainText, areaOptionLabel, filterSelect, optionStyle, useGearRows, useFavToggle, withFavs } from './v2capGearView.js'
import { PlusTag, GearFilterBar, StatChange, FavStar } from './v2capGear.jsx'
import { saveGearFav } from './v2capGearFav.js'
import V2capEnhanceFx from './V2capEnhanceFx.jsx'
import V2capCraftFx from './V2capCraftFx.jsx'
import { ticketOf, canUseTicket } from '../lib/v1carry.js'
import { pickLine, enterKindOf, enhanceKindOf, shortWhatOf, varsOf, isNight, nextStreak, tapKindOf } from '../lib/smithMaster.js'
import { SHINKA_ON, SHINKA_MAX, isShinka, shinkaNameOf } from '../lib/shinka.js'
import { ShinkaTab, ShinkaNote } from './V2capShinka.jsx'
import { ChallengeNote } from './V2capChallengeGear.jsx'
import { CHALLENGE_CATS, DUNGEON_BOSSES } from '../lib/dungeon.js'
import { CH_CRAFT_MATS, challengeItemsOf, chMatsOf, chCraftCostOf, chCraftErrorOf, chCraftTimesOf } from '../lib/challenge.js'

// ============================================================
// 「レベルキャップあり」版 — 鍛冶屋（強化・分解・作成）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザー指示「鍛冶屋を追加、ここで装備の強化・分解・作成が可能」。数の正は src/v2cap/lib/smith.js
//   ・強化 … Goldと強化石で+1（+10まで・+1ごとに強さ+10%・最低でも戦闘力+1）。失敗すると使ったものはなくなり、強化値はそのまま。
//            【確定】2026-11-08 強化石はどの段も1個・+6からはその装備のエリアの残骸も（ノーマルは残骸なし）・
//            挑戦の装備は+6から残骸の代わりにそのボスの素材1個（ユーザー指示・smith.js の「強化」）。前は Goldと残骸・ノーマルはGoldだけ
//   ・分解 … 装備をその装備のエリアの残骸にする（ノーマル1・レア5・エピック10・レジェンダリー25）。
//            まとめて選べる（レア度で・チェックで・表示中を全部。まとめて選ぶときは装備中と強化したものは選ばない）。
//            お気に入り（★）の装備は分解できない（2026-10-26 ユーザー指示「お気に入りされた武器は分解できないように」・サーバーの v2cap_dismantle も飛ばす）
//   ・作成 … レア・エピック・レジェンダリーを、Goldとそのエリアの残骸で作る（残骸30／100／300・Gold 必要LV×50／100／200）。
//            必ずできる・+0で持ち物に入る。武器は14種どれでも作れる（ユーザー決定）。作れるのは行ったことのあるエリアまで
//   ・強化と分解は鍛冶屋だけ（装備画面は着ける・外すだけ・ユーザー決定）
// 【確定】2026-10-26 親方トルステン（ユーザー指示「ニャーガーキングの看板娘と同じ形で、鍛冶屋のキャラのイラストを入れたい」・lib/smithMaster.js）：
//   右に親方を立たせる（スマホは上）。タップ・強化と作成の結果・分解・足りなくて強化できないときにセリフと表情が変わる（ユーザー選択）。
//   強化と作成の結果のポップアップ・足りないときの強化の画面にも親方を出す。好感度は無し（ユーザー指示「鍛冶屋のおっちゃんは好感度システムいらないや」）
// 【確定】2026-10-26 武器の真化（ユーザー指示「戦闘スタイルによって武器に特殊能力がつくシステム」・lib/shinka.js・タブは V2capShinka.jsx）：
//   熟練度が MAX の武器をここで真化する。抽選はサーバー（v2cap_shinka）
// ============================================================
// help＝決まりの説明。タブの下には出さず、❓ HELP にまとめる（2026-10-26 ユーザー指示「ここの説明はHELPにまとめて、強化分解作成すべてここの部分いらない」）
const TABS = [
  // 2026-11-09〜 強化石は段ごと（+5まで強化石・+6から良質な強化石・smith.js の STONE_TIERS）
  { key:'enhance',   label:'強化', help:`Goldと強化石${ENHANCE_STONE}個で強化値を+1（+${PLUS_MAX}まで・+1ごとに強さ+10%・最低でも戦闘力+1）。+${STONE2_FROM - 1}までは${STONE_NAME}、+${STONE2_FROM}からは${STONE2_NAME}を使います。${STONE2_NAME}は、強化の一覧の上の「作る」で${STONE_NAME}${STONE_CRAFT}個から作れます。+${ENHANCE_SCRAP_FROM}からは、その装備のエリアの残骸も使います（ノーマルの装備は残骸を使いません）。挑戦の装備は、残骸の代わりにそのボスの素材を使います。${STONE_NAME}は出撃で敵を倒すと、ときどき手に入ります（${STONE2_NAME}はまれです）。失敗すると使った素材とGoldはなくなり、強化値はそのままです。着けている装備も強化できます。` },
  { key:'dismantle', label:'分解', help:`装備を、その装備のエリアの残骸にします（${ALL_RARITIES.map(r => `${rarityLabel(r)}${SCRAP_YIELD[r]}`).join('・')}個）。着けている装備とお気に入り（★）の装備は分解できません。ユニークと挑戦の専用装備はまとめての分解に入りません（1つずつなら分解できます）。` },
  { key:'craft',     label:'作成', help:`「エリア装備」は、レア・エピック・レジェンダリーの装備を、Goldとそのエリアの残骸で作ります。「挑戦装備」は、挑戦の四凶の専用装備を、そのボスを倒すと手に入る素材${CH_CRAFT_MATS}個とGoldで作ります。どちらも必ずできて、+0で持ち物に入ります。武器はどの職業のものでも作れます。` },
  // 武器の真化（2026-10-26・lib/shinka.js）。代償が付くこともあるのは HELP に書く（ユーザー指示「真化するときにデメリットがつくこともあることを伝える」）
  // ★お蔵入り（SHINKA_ON=false・2026-10-26 ユーザー指示「一旦お蔵入り」）のあいだはタブも HELP も出さない（下の filter）
  { key:'shinka',    label:'真化', help:`着けている武器で戦うと、1戦ごとに熟練度が1上がります（勝ち負けとも）。熟練度が${SHINKA_MAX.toLocaleString()}になった武器は、ここで真化できます。真化すると、その武器での戦い方（クリティカルがよく出た・ある種族の敵を多く倒した・よくかわした など）から能力が1つ付きます。どれが付くかは、その武器の戦い方の中から選ばれます。代償（デメリット）が付く能力もあります。真化は1本につき1回だけで、やり直せません。真化した武器を分解すると能力も消えます（まとめての分解と博物館への寄贈には入りません）。` },
].filter(t => SHINKA_ON || t.key !== 'shinka')
const FAV_HELP = '装備の★を押すとお気に入りになります（もう一度押すと外れます）。お気に入りの装備は分解も博物館への寄贈もできません。並べ替えの「お気に入り」で上に集まります。'
const HELP_HEAD = { color:'#ffaa44', fontSize:'12px', marginBottom:'2px' }
const rowBox = (border, bg = '#000818') => ({ background: bg, border:`1px solid ${border}`, padding:'6px 8px' })
const SHORT = '#ff8844'
// 強化石の段ごとの色（0＝強化石・1＝良質な強化石・2026-11-09）
const STONE_COLOR = ['#9fd8ff', '#c9a6ff']

export default function V2capSmith({ prof, inventory, onProfile, onGo }) {
  const [tab, setTab] = useState('enhance')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [help, setHelp] = useState(false)
  const wornIds = wornIdsOf(prof, inventory)
  // お気に入りの★は押した瞬間に変え、サーバー（v2cap_gear_fav）には後ろで送る（2026-10-26 ユーザー指示「登録されるまでラグがある」・useFavToggle）
  const fav = useFavToggle({ save: saveGearFav, refresh: () => onProfile(null), onError: setError })
  const all = useMemo(() => withFavs(inventory, fav.over)
    .map(inv => ({ inv, item: ITEM_BY_ID[inv.base_id] }))
    .filter(r => r.item), [inventory, fav.over])
  const list = useGearRows(all, prof.lv, openAreaOf(prof.cleared_spots))   // 強化と分解で同じ絞り込み・並べ替えを使う（エリアは行ったことのあるところまで）

  // RPCを呼び、うまくいったらサーバーから取り直す。返すのは { data } か { error }
  const call = async (fn, args) => {
    setBusy(true); setError(''); setNotice('')
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e || !data?.ok) { setBusy(false); return { error: e?.message || data?.error || '失敗しました' } }
    await onProfile(null)
    setBusy(false)
    return { data }
  }
  const switchTab = (key) => { setTab(key); setError(''); setNotice('') }
  const toggleFav = fav.toggle

  // ===== 親方トルステン（lib/smithMaster.js）=====
  // 呼び方（兄ちゃん／嬢ちゃん／お前さん）を say が見られるように控える（say は作り直さない）
  const vars = useRef(varsOf(prof))
  vars.current = varsOf(prof)
  const [master, setMaster] = useState(() => ({ ...pickLine(enterKindOf(), { vars: varsOf(prof) }), tick: 0 }))
  const lastText = useRef(master.text)
  // 場面 kind のセリフを選んで吹き出しに出し、選んだもの { face, text } を返す（強化・作成の結果のポップアップにも同じものを出す）
  const say = useCallback((kind, more) => {
    const line = pickLine(kind, { last: lastText.current, vars: { ...vars.current, ...more } })
    lastText.current = line.text
    setMaster(c => ({ ...line, tick: c.tick + 1 }))
    return line
  }, [])
  const streak = useRef(null)
  const tapMaster = () => {
    streak.current = nextStreak(streak.current, Date.now())
    say(tapKindOf(streak.current.n, isNight()))
  }
  const shared = { prof, all, wornIds, list, busy, call, setError, setNotice, say, toggleFav }

  return (
    <div style={{ fontFamily:'monospace' }}>
      <style>{MASTER_CSS}</style>
      {help && (
        <V2Modal title="❓ HELP" color="#ffaa44" keepScroll onClose={() => setHelp(false)}>
          {TABS.map((t, i) => (
            <div key={t.key} style={{ marginTop: i ? '10px' : 0 }}>
              <div style={HELP_HEAD}>{t.label}</div>
              <div>{t.help}</div>
            </div>
          ))}
          <div style={{ ...HELP_HEAD, marginTop:'10px' }}>お気に入り</div>
          <div>{FAV_HELP}</div>
        </V2Modal>
      )}
      <div className="smm-cols">
        {/* 親方（広い画面は右・狭い画面は上） */}
        <div className="smm-side">
          <V2capSmithMaster face={master.face} line={master.text} tick={master.tick} onTap={tapMaster} />
        </div>

        <div className="smm-main">
          {/* 持っているGold（2026-10-26 ユーザー指示「この部分（持っている残骸の一覧）は丸ごといらない、所持してるGoldだけでいい」） */}
          <div style={{ ...box, padding:'8px 12px', marginBottom:'10px', fontSize:'12px', color: TEXT.label }}>
            💰 Gold <span style={{ color:'#ffcc00' }}>{Number(prof.gold || 0).toLocaleString()}</span>
          </div>

          <div style={{ ...box, padding:'12px' }}>
            <div style={{ display:'flex', gap:'4px', marginBottom:'8px', flexWrap:'wrap', alignItems:'center' }}>
              {TABS.map(t => (
                <button key={t.key} onClick={() => switchTab(t.key)} disabled={busy}
                  style={{ ...btn(tab === t.key ? '#ffaa44' : '#62789a'), padding:'6px 14px', color: tab === t.key ? '#ffcc66' : '#93a9be' }}>
                  {t.label}
                </button>
              ))}
              <button type="button" onClick={() => setHelp(true)} style={{ ...miniBtn('#88aaff'), marginLeft:'auto' }}>❓ HELP</button>
              {onGo && <button onClick={() => onGo('equip')} style={miniBtn('#88ccff')}>🛡 装備へ</button>}
            </div>
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
            {notice && <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'6px' }}>{notice}</div>}
            {tab === 'enhance' && <EnhanceTab {...shared} />}
            {tab === 'dismantle' && <DismantleTab {...shared} />}
            {tab === 'craft' && <CraftTab {...shared} />}
            {SHINKA_ON && tab === 'shinka' && <ShinkaTab {...shared} Head={ItemHead} Stats={ItemStats} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== 強化 =====
function EnhanceTab({ prof, all, wornIds, list, busy, call, say, toggleFav }) {
  const [smithId, setSmithId] = useState(null)   // 強化の画面を開いている持ち物のID
  const [msg, setMsg] = useState(null)           // 直前の強化の結果 { ok, text }
  const [shortLine, setShortLine] = useState(null) // 足りなくて強化できない装備を開いたときの親方のひとこと（強化の画面にも出す）
  const [ticketId, setTicketId] = useState(null) // 強化券を使う確認を開いている持ち物のID
  const [ticketMsg, setTicketMsg] = useState(null)
  const [craftOpen, setCraftOpen] = useState(false)   // 良質な強化石を作る画面（2026-11-09）
  const [craftMsg, setCraftMsg] = useState(null)
  // 【確定】2026-10-13 ユーザー指示「黒い砂漠の強化みたいな演出」「強化の成否もポップアップ」＝強化の演出（V2capEnhanceFx.jsx）
  //   押した時点の装備の様子を job に写して演出を始め、サーバーの結果が届いたら job.result に入れる
  const [fxJob, setFxJob] = useState(null)
  const row = smithId === null ? null : all.find(r => String(r.inv.id) === smithId) || null
  // 【確定】2026-10-13 ユーザー指示「強化は装備している装備を上に優先して表示させて」：
  //   着けている装備を上に（武器→頭→鎧→腕→足→装飾品①②の順）。そのほかは絞り込み・並べ替えのとおり
  const wornRank = Object.fromEntries(SLOTS.map((slot, i) => [String(prof.equipped?.[slot]), i]))
  const rows = [
    ...list.rows.filter(r => wornIds.has(String(r.inv.id))).sort((a, b) => wornRank[String(a.inv.id)] - wornRank[String(b.inv.id)]),
    ...list.rows.filter(r => !wornIds.has(String(r.inv.id))),
  ]
  const enhance = async () => {
    if (!row || busy) return
    const { inv, item } = row
    const cost = enhanceCostOf(item, inv)
    if (!cost || enhanceErrorOf(item, inv, prof)) return
    const plus = plusOf(inv)
    const job = {
      id: Date.now(), name: item.name, color: nameColor(item), part: item.part, plusFrom: plus, plusTo: cost.next, rate: cost.rate,
      powerFrom: powerAt(item, inv.ilv, plus), powerTo: powerAt(item, inv.ilv, cost.next), scrapName: scrapNameOf(cost.area), result: null,
      // 上がるステ（戦闘力と同じく必要LVに足りないときの弱まりは入れない＝装備そのものの強さ）
      statsFrom: statsAt(item, inv.ilv, null, plus), statsTo: statsAt(item, inv.ilv, null, cost.next),
    }
    setMsg(null); setFxJob(job)
    const { data, error } = await call('v2cap_enhance', { p_inventory_id: inv.id })
    if (error) { setFxJob(null); setMsg({ ok: false, text: `⚠ ${error}` }); say('error'); return }
    // 親方のひとこと（吹き出しと、結果のポップアップの両方に出す）
    const line = say(enhanceKindOf(data.success, data.plus))
    setFxJob(j => (j && j.id === job.id ? { ...j, result: data, say: line } : j))
    setMsg(data.success
      ? { ok: true, text: `✨ 成功！ +${data.plus} になりました` }
      : { ok: false, text: `💥 失敗… +${data.plus} のまま（${enhanceSpentText(data)} はなくなりました）` })
  }
  // 【確定】2026-10-23 V1からの引き継ぎの強化券（v1carry.js）：ユニークの装備1つを、すぐ券の強化値にする（1回だけ・失敗なし・Goldも残骸も使わない）
  const ticket = ticketOf(prof)
  const ticketRow = ticketId === null ? null : all.find(r => String(r.inv.id) === ticketId) || null
  const applyTicket = async () => {
    if (!ticketRow || busy) return
    const { data, error } = await call('v2cap_v1_ticket_use', { p_inv: ticketRow.inv.id })
    setTicketId(null)
    setTicketMsg(error ? { ok: false, text: `⚠ ${error}` } : { ok: true, text: `🎫 「${ticketRow.item.name}」が +${data.plus} になりました` })
  }
  // 良質な強化石を作る（2026-11-09・サーバーの v2cap_stone_craft）：強化石10個で1個・必ずできる
  const craftStone = async (n) => {
    if (busy || !(n > 0)) return
    setCraftMsg(null)
    const { data, error } = await call('v2cap_stone_craft', { p_qty: n })
    if (error) { setCraftMsg({ ok: false, text: `⚠ ${error}` }); say('error'); return }
    setCraftMsg({ ok: true, text: `💠 ${STONE2_NAME}を${Number(data.got).toLocaleString()}個作りました` })
    say('stoneCraft')
  }
  // 結果のポップアップの「続けて +N にする」（次も強化できるときだけ）
  const nextCost = row ? enhanceCostOf(row.item, row.inv) : null
  const nextErr = row && nextCost ? enhanceErrorOf(row.item, row.inv, prof) : null
  // 強化の画面を開く。残骸かGoldが足りなければ親方がひとこと
  const open = (item, inv) => {
    setSmithId(String(inv.id)); setMsg(null)
    const what = shortWhatOf(enhanceErrorOf(item, inv, prof))
    setShortLine(what ? say('short', { what }) : null)
  }
  return (
    <>
      {row && (
        <SmithModal row={row} prof={prof} busy={busy} msg={msg} say={shortLine}
          onEnhance={enhance} onClose={() => { if (!busy) { setSmithId(null); setMsg(null) } }} />
      )}
      {fxJob && (
        <V2capEnhanceFx job={fxJob} say={fxJob.say && <MasterSays face={fxJob.say.face} line={fxJob.say.text} />}
          nextLabel={nextCost && !nextErr ? `+${nextCost.next}に強化する` : null}
          nextReason={!nextCost ? `強化値は+${PLUS_MAX}（上限）です` : nextErr ? `次の強化：${nextErr}` : ''}
          onAgain={enhance} onClose={() => setFxJob(null)} />
      )}
      {ticketRow && (
        <V2Modal title="🎫 強化券を使う" color="#ffcc00" busy={busy}
          confirmLabel={`+${ticket}にする`} cancelLabel="やめる" onConfirm={applyTicket} onClose={() => { if (!busy) setTicketId(null) }}>
          <div><span style={{ color: nameColor(ticketRow.item) }}>{ticketRow.item.name}</span><PlusTag inv={ticketRow.inv} /></div>
          <div>強化値 +{plusOf(ticketRow.inv)} → <span style={{ color: PLUS_COLOR }}>+{ticket}</span></div>
          <div>戦闘力 {powerAt(ticketRow.item, ticketRow.inv.ilv, plusOf(ticketRow.inv))} → <span style={{ color:'#44ff88' }}>{powerAt(ticketRow.item, ticketRow.inv.ilv, ticket)}</span></div>
          <StatChange from={statsAt(ticketRow.item, ticketRow.inv.ilv, null, plusOf(ticketRow.inv))} to={statsAt(ticketRow.item, ticketRow.inv.ilv, null, ticket)} />
          <div style={{ color: TEXT.sub, fontSize:'11px' }}>必ず成功します（Gold・{STONE_NAME}・残骸は使いません）。強化券は1枚だけで、使うとなくなります。</div>
        </V2Modal>
      )}
      {ticket > 0 && (
        <div style={{ ...rowBox('#aa8800', '#141000'), marginBottom:'6px', fontSize:'11px', color:'#ffcc00', lineHeight:1.7 }}>
          🎫 V1からの強化券（+{ticket}）を持っています。ユニークの装備1つを、すぐ+{ticket}にできます（1回だけ・失敗なし）。
          <span style={{ color: TEXT.sub }}>ふつうの強化は+{PLUS_MAX}までです。</span>
        </div>
      )}
      {ticketMsg && <div style={{ color: ticketMsg.ok ? '#44ff88' : SHORT, fontSize:'11px', marginBottom:'6px' }}>{ticketMsg.text}</div>}
      {craftOpen && (
        <StoneCraftModal prof={prof} busy={busy} msg={craftMsg} onCraft={craftStone}
          onClose={() => { if (!busy) { setCraftOpen(false); setCraftMsg(null) } }} />
      )}
      {/* 持っている強化石（2026-11-09〜 段ごと）と、良質な強化石を作るボタンを1行に */}
      <div style={{ ...rowBox('#2a4466'), marginBottom:'6px', fontSize:'11px', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
        <span style={{ color: STONE_COLOR[0] }}>💎 {STONE_NAME} ×{stoneOf(prof).toLocaleString()}</span>
        <span style={{ color: STONE_COLOR[1] }}>💠 {STONE2_NAME} ×{stone2Of(prof).toLocaleString()}</span>
        <button onClick={() => { setCraftOpen(true); setCraftMsg(null) }} disabled={busy}
          style={{ ...miniBtn(STONE_COLOR[1]), marginLeft:'auto', flexShrink:0 }}>💠 作る</button>
      </div>
      <GearFilterBar g={list} />
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {rows.length === 0 && <Empty all={all} />}
        {rows.map(({ inv, item }) => {
          const cost = enhanceCostOf(item, inv)
          const isWorn = wornIds.has(String(inv.id))
          return (
            <div key={inv.id} style={rowBox(isWorn ? '#0055aa' : '#002244')}>
              <ItemHead inv={inv} item={item} lv={prof.lv} isWorn={isWorn} star={<FavStar inv={inv} busy={busy} onToggle={toggleFav} />} />
              {/* 「次は +9：残骸・Gold・成功率」の行は出さない（2026-10-26 ユーザー指示「この行いらない、強化ボタン押したら成功率とか必要素材が表示されればいい」）。
                  強化のボタンはステの行の右。上限のときはボタンの代わりに「上限」 */}
              <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                <ItemStats inv={inv} item={item} lv={prof.lv} isWorn={isWorn} />
                {canUseTicket(item, plusOf(inv), prof) && (
                  <button onClick={() => { setTicketId(String(inv.id)); setTicketMsg(null) }} disabled={busy} style={{ ...miniBtn('#ffcc00'), flexShrink:0 }}>🎫 +{ticket}にする</button>
                )}
                {cost
                  ? <button onClick={() => open(item, inv)} disabled={busy} style={{ ...miniBtn('#ffcc00'), flexShrink:0 }}>強化</button>
                  : <span style={{ color: PLUS_COLOR, fontSize:'10px', flexShrink:0 }}>上限</span>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 分解 =====
function DismantleTab({ all, wornIds, list, busy, call, setError, setNotice, say, toggleFav }) {
  const [picked, setPicked] = useState(() => new Set())   // 分解に選んだ持ち物のID（文字列）
  const [confirm, setConfirm] = useState(null)             // 分解の確認 [{ inv, item }]
  const pickedRows = all.filter(r => picked.has(String(r.inv.id)) && !wornIds.has(String(r.inv.id)) && !r.inv.fav)
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const pickAll = (rows) => setPicked(prev => new Set([...prev, ...rows.filter(r => bulkPickable(r, wornIds)).map(r => String(r.inv.id))]))
  const dismantle = async () => {
    const target = confirm || []
    const { data, error } = await call('v2cap_dismantle', { p_ids: target.map(r => r.inv.id) })
    setConfirm(null)
    if (error) { setError(error); say('error'); return }
    setNotice(`🔨 ${data.dismantled}個を分解しました${Object.keys(data.gained || {}).length ? `：${gainText(data.gained)}` : ''}`)
    say('dismantle', { n: data.dismantled })
    setPicked(prev => new Set([...prev].filter(id => !target.some(r => String(r.inv.id) === id))))
  }
  return (
    <>
      {confirm && <DismantleModal list={confirm} busy={busy} onConfirm={dismantle} onClose={() => setConfirm(null)} />}
      <GearFilterBar g={list} />
      <div style={{ background:'#000818', border:'1px solid #553322', padding:'7px 8px', marginBottom:'8px', fontSize:'10px' }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center', marginBottom:'5px' }}>
          <span style={{ color: TEXT.label }}>まとめて選ぶ</span>
          {RARITIES.map(r => {
            const rows = all.filter(x => x.item.rarity === r && bulkPickable(x, wornIds))
            return (
              <button key={r} onClick={() => pickAll(rows)} disabled={busy || rows.length === 0}
                style={{ ...miniBtn(rows.length ? RARITY_COLOR[r] : '#62789a'), color: rows.length ? RARITY_COLOR[r] : TEXT.empty }}>
                {rarityLabel(r)}を全部（{rows.length}）
              </button>
            )
          })}
          <button onClick={() => pickAll(list.rows)} disabled={busy || list.rows.length === 0} style={miniBtn('#88ccff')}>表示中をすべて</button>
          <button onClick={() => setPicked(new Set())} disabled={busy || picked.size === 0} style={miniBtn('#62789a')}>選択を外す</button>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', alignItems:'center' }}>
          <span style={{ color:'#cfe2ff' }}>選んだ {pickedRows.length}個</span>
          {pickedRows.length > 0 && <span style={{ color: TEXT.sub }}>→ {gainText(dismantleGainOf(pickedRows))}</span>}
          <button onClick={() => setConfirm(pickedRows)} disabled={busy || pickedRows.length === 0} style={miniBtn('#ff8844')}>
            選んだ{pickedRows.length}個を分解
          </button>
        </div>
        <div style={{ color: TEXT.sub, marginTop:'4px' }}>
          {SHINKA_ON
            ? 'まとめて選ぶときは、装備中・お気に入り（★）・強化した装備・真化した武器は選びません（強化した装備と真化した武器はチェックで1つずつなら選べます）'
            : 'まとめて選ぶときは、装備中・お気に入り（★）・強化した装備は選びません（強化した装備はチェックで1つずつなら選べます）'}
        </div>
      </div>
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {list.rows.length === 0 && <Empty all={all} />}
        {list.rows.map(({ inv, item }) => {
          const isWorn = wornIds.has(String(inv.id))
          const isFav = !!inv.fav   // お気に入りは分解できない（2026-10-26 ユーザー指示）
          const isPicked = !isWorn && !isFav && picked.has(String(inv.id))
          return (
            <div key={inv.id} style={rowBox(isPicked ? '#aa5533' : isWorn ? '#0055aa' : '#002244', isPicked ? '#1a0c08' : '#000818')}>
              <ItemHead inv={inv} item={item} isWorn={isWorn} star={<FavStar inv={inv} busy={busy} onToggle={toggleFav} />}
                check={<input type="checkbox" checked={isPicked} disabled={isWorn || isFav || busy} onChange={() => toggle(String(inv.id))}
                  title={isWorn ? '着けている装備は分解できません' : isFav ? 'お気に入りの装備は分解できません' : '分解に選ぶ'} style={{ accentColor:'#ff8844', margin:0, flexShrink:0 }} />} />
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', fontSize:'10px' }}>
                <span style={{ color: TEXT.sub, flex:1, minWidth:0 }}>
                  分解すると <span style={{ color:'#cfe2ff' }}>{scrapNameOf(scrapAreaOf(item))} +{SCRAP_YIELD[item.rarity]}</span>
                </span>
                {isWorn
                  ? <span style={{ color: TEXT.empty }}>装備中は分解できない</span>
                  : isFav
                    ? <span style={{ color: TEXT.empty }}>お気に入りは分解できない</span>
                    : <button onClick={() => setConfirm([{ inv, item }])} disabled={busy} style={miniBtn('#aa5566')}>分解</button>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 作成 =====
// 【確定】2026-11-06 ユーザー「鍛冶屋に作成にエリア装備と挑戦装備分けて作成できるように」：
//   作成の中を「エリア装備」（残骸で作る今までの作成）と「挑戦装備」（四凶の特別な素材で専用装備を作る・lib/challenge.js）に分ける。どちらを開くかは端末で覚えておく
const CRAFT_KINDS = [{ key:'area', label:'エリア装備' }, { key:'challenge', label:'挑戦装備' }]
function CraftTab(props) {
  const [kind, setKind] = useStored('capCraftKind', 'area')
  const pick = (k) => { setKind(k); props.setError(''); props.setNotice('') }
  return (
    <>
      <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
        {CRAFT_KINDS.map(k => (
          <button key={k.key} type="button" onClick={() => pick(k.key)} disabled={props.busy}
            style={{ ...miniBtn(kind === k.key ? '#ffaa44' : '#62789a'), color: kind === k.key ? '#ffcc66' : '#93a9be' }}>
            {k.label}
          </button>
        ))}
      </div>
      {kind === 'challenge' ? <ChallengeCraft {...props} /> : <AreaCraft {...props} />}
    </>
  )
}

// エリア装備：レア・エピック・レジェンダリーを、Goldとそのエリアの残骸で作る
function AreaCraft({ prof, all, busy, call, setError, setNotice, say }) {
  // 作れるのは行ったことのあるエリアまで（残骸もそのエリアの装備からしか出ない）
  const maxArea = openAreaOf(prof.cleared_spots)
  const [area, setArea] = useState(maxArea)
  const [rarity, setRarity] = useState('R')
  const [part, setPart] = useState('all')
  const [confirm, setConfirm] = useState(null)   // 作る装備（item）
  // 【確定】2026-10-13 ユーザー指示「作成はその時装備できる武器種、防具の表示させるようにして、チェックのオンオフで変えれるように」：
  //   オン（最初）＝いまの職業で装備できる武器種だけ。防具・装飾品はどの職業も着けられるので全部出す。オフ＝全部。端末で覚えておく
  const [usableOnly, setUsableOnly] = useStored('capCraftUsableOnly', true)
  const items = ITEMS.filter(i => i.area === area && i.rarity === rarity && (part === 'all' || i.part === part)
    && (!usableOnly || i.part !== '武器' || canEquipType(prof.class, i.type)))
  const cost = craftCostOf(ITEMS.find(i => i.area === area && i.rarity === rarity))
  const have = scrapOf(prof.materials, area)
  const gold = Number(prof.gold) || 0
  const times = cost ? Math.min(Math.floor(have / cost.scrap), Math.floor(gold / cost.gold)) : 0
  const ownCount = useMemo(() => {
    const out = {}
    for (const r of all) out[r.item.id] = (out[r.item.id] || 0) + 1
    return out
  }, [all])
  // 【確定】2026-10-13 ユーザー指示「作成にも演出付けてほしい（具体的な装備のアイコンはないからそれを考慮して）」＝作成の演出（V2capCraftFx.jsx）
  //   確認の「作る」で演出を始め、サーバーの結果が届いたら job.result に入れる。演出の最後から「続けて作る」（同じ装備・確認なし）
  const [fxJob, setFxJob] = useState(null)
  const startCraft = async (item) => {
    if (!item || busy) return
    const c = craftCostOf(item)
    if (!c || craftErrorOf(item, prof)) return
    // 作ったばかりの装備は着けていない＝ふつうの（装備そのものの）戦闘力とステ（2026-10-26 ユーザー指示「装備していない装備は普通のステータスが表示されるようにして」。
    // 前はステだけいまのLV相当に下げていた）。「（要求LV不足）」は前のユーザー指示どおり出す
    const job = {
      id: Date.now(), item, name: item.name, rarity: item.rarity, part: item.part, kind: kindLabel(item), lv: needLvOf(item),
      power: powerAt(item, item.lv, 0), sync: syncLabelOf(item, item.lv, prof.lv), statText: statLine(statsAt(item, item.lv, null, 0)), scrapName: scrapNameOf(c.area), scrap: c.scrap, gold: c.gold, result: null,
    }
    setConfirm(null); setFxJob(job)
    const { data, error } = await call('v2cap_craft', { p_equip_id: item.id })
    if (error) { setFxJob(null); setError(error); say('error'); return }
    const line = say('craft', { item: item.name })   // 親方のひとこと（吹き出しと、結果のポップアップの両方）
    setFxJob(j => (j && j.id === job.id ? { ...j, result: data, say: line } : j))
    setNotice(`🔨 ${item.name}（LV${needLvOf(item, data.ilv)}）を作りました`)
  }
  const craft = () => startCraft(confirm)
  // 演出の最後の「続けて作成」（同じ装備をもう1つ。作れる数も出す・2026-10-26 ユーザー指示で「続けて作る」から）
  const again = fxJob ? craftErrorOf(fxJob.item, prof) : null
  const againCost = fxJob ? craftCostOf(fxJob.item) : null
  const againTimes = againCost ? Math.min(Math.floor(scrapOf(prof.materials, againCost.area) / againCost.scrap), Math.floor((Number(prof.gold) || 0) / againCost.gold)) : 0
  return (
    <>
      {confirm && <CraftModal item={confirm} prof={prof} busy={busy} onConfirm={craft} onClose={() => setConfirm(null)} />}
      {fxJob && (
        <V2capCraftFx job={fxJob} say={fxJob.say && <MasterSays face={fxJob.say.face} line={fxJob.say.text} />}
          nextLabel={!again && againTimes > 0 ? `続けて作成（あと${againTimes}個）` : null}
          nextReason={again ? `続けて作成するには：${again}` : ''}
          onAgain={() => startCraft(fxJob.item)} onClose={() => setFxJob(null)} />
      )}
      {/* 【確定】2026-10-14 ユーザー指示「作成もプルダウンの横並びで」＝持ち物の絞り込み（GearFilterBar）と同じ 部位・レア度・エリア の順。
           レア度とエリアは「すべて」なし（作るものを1つに決める）なので、いつも選んでいる色 */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'6px' }}>
        <select value={part} onChange={e => setPart(e.target.value)} style={filterSelect(part !== 'all')}>
          <option value="all" style={optionStyle(TEXT.sub)}>すべての部位</option>
          {PARTS.map(p => <option key={p} value={p} style={optionStyle()}>{partLabel(p)}</option>)}
        </select>
        <select value={rarity} onChange={e => setRarity(e.target.value)} style={filterSelect(true, RARITY_COLOR[rarity])}>
          {CRAFT_RARITIES.map(r => <option key={r} value={r} style={optionStyle(RARITY_COLOR[r])}>{rarityLabel(r)}</option>)}
        </select>
        <select value={area} onChange={e => setArea(Number(e.target.value))} style={filterSelect(true)}>
          {Array.from({ length: maxArea }, (_, i) => i + 1).map(a => <option key={a} value={a} style={optionStyle()}>{areaOptionLabel(a)}</option>)}
        </select>
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color: TEXT.label, marginBottom:'6px', cursor:'pointer', width:'fit-content' }}>
        <input type="checkbox" checked={usableOnly} onChange={e => setUsableOnly(e.target.checked)} style={{ accentColor:'#ffaa44', margin:0 }} />
        いまの職業（{prof.class}）で装備できるものだけ
      </label>
      {/* 2026-10-26 ユーザー指示「作成の画面も…「持っている」を「所持数：」にそろえて」 */}
      {cost && (
        <div style={{ background:'#000818', border:'1px solid #553322', padding:'6px 8px', marginBottom:'8px', fontSize:'10px', color: TEXT.sub, lineHeight:1.7 }}>
          1つ作るのに：<span style={{ color: have < cost.scrap ? SHORT : '#cfe2ff' }}>{scrapNameOf(area)} {cost.scrap}個</span>（所持数：{have.toLocaleString()}）・
          <span style={{ color: gold < cost.gold ? SHORT : '#ffcc00' }}>Gold {cost.gold.toLocaleString()}</span>（所持数：{gold.toLocaleString()}）
          <span style={{ color: times > 0 ? '#44ff88' : TEXT.empty }}>　いま作れるのは {times}個</span>
        </div>
      )}
      <div style={{ display:'grid', gap:'4px', maxHeight:'560px', overflowY:'auto' }}>
        {items.map(item => {
          const usable = item.part !== '武器' || canEquipType(prof.class, item.type)
          const err = craftErrorOf(item, prof)
          const n = ownCount[item.id] || 0
          return (
            <div key={item.id} style={rowBox('#002244')}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
                  {item.name}
                  <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
                  {item.line && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{ARMOR_EFFECT[item.line]?.label}</span>}
                  {/* 2026-10-13 ユーザー指示「持っている 1 じゃなくて〇個所持って表示させて」 */}
                  {n > 0 && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>{n}個所持</span>}
                </span>
                <span style={{ color: needLvOf(item) > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px', whiteSpace:'nowrap' }}>要求レベル{needLvOf(item)}LV</span>
              </div>
              <ItemStats inv={{ ilv: item.lv, plus: 0 }} item={item} lv={prof.lv} />
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', fontSize:'10px' }}>
                <span style={{ flex:1, minWidth:0, color:'#c69a5c' }}>{usable ? '' : `${prof.class}は${item.type}を装備できない（作ることはできる）`}</span>
                <button onClick={() => setConfirm(item)} disabled={busy || !!err} title={err || ''} style={miniBtn('#ffaa44')}>作る</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// 挑戦装備：四凶の専用装備を、そのボスの特別な素材50個とGoldで作る（lib/challenge.js・サーバーの v2cap_craft_challenge）
//   ボスを選ぶと、そのボスの3つ（必要LV70）が並ぶ。【2026-11-06】専用装備も素材もボスごとに1つ（ユーザー「なんで難易度ごとに素材わかれてるの？
//   専用装備、アイテムは全部一緒」）＝前の「使う素材（ノーマル／ハード）」のプルダウンはやめた
function ChallengeCraft({ prof, all, busy, call, setError, setNotice, say }) {
  const bosses = CHALLENGE_CATS.flatMap(c => c.bosses)
  const [boss, setBoss] = useStored('capChCraftBoss', bosses[0])
  const bossKey = bosses.includes(boss) ? boss : bosses[0]
  const items = challengeItemsOf(bossKey)
  const [confirm, setConfirm] = useState(null)
  const have = chMatsOf(prof.challenge_mats, bossKey)
  const gold = Number(prof.gold) || 0
  const cost = items[0] ? chCraftCostOf(items[0]) : null
  const times = items[0] ? chCraftTimesOf(items[0], prof) : 0
  const ownCount = useMemo(() => {
    const out = {}
    for (const r of all) out[r.item.id] = (out[r.item.id] || 0) + 1
    return out
  }, [all])
  // 作成の演出はエリア装備と同じ（V2capCraftFx）。job の scrapName・scrap に素材の名前と数を入れる
  const [fxJob, setFxJob] = useState(null)
  const startCraft = async (item) => {
    if (!item || busy) return
    const c = chCraftCostOf(item)
    if (!c || chCraftErrorOf(item, prof)) return
    const job = {
      id: Date.now(), item, name: item.name, rarity: item.rarity, part: item.part, kind: kindLabel(item), lv: needLvOf(item),
      power: powerAt(item, item.lv, 0), sync: syncLabelOf(item, item.lv, prof.lv), statText: statLine(statsAt(item, item.lv, null, 0)),
      scrapName: c.name, scrap: c.mats, gold: c.gold, result: null,
    }
    setConfirm(null); setFxJob(job)
    const { data, error } = await call('v2cap_craft_challenge', { p_equip_id: item.id })
    if (error) { setFxJob(null); setError(error); say('error'); return }
    const line = say('craft', { item: item.name })
    setFxJob(j => (j && j.id === job.id ? { ...j, result: data, say: line } : j))
    setNotice(`🔨 ${item.name}（LV${needLvOf(item, data.ilv)}）を作りました`)
  }
  const again = fxJob ? chCraftErrorOf(fxJob.item, prof) : null
  const againTimes = fxJob ? chCraftTimesOf(fxJob.item, prof) : 0
  return (
    <>
      {confirm && <ChallengeCraftModal item={confirm} prof={prof} busy={busy} onConfirm={() => startCraft(confirm)} onClose={() => setConfirm(null)} />}
      {fxJob && (
        <V2capCraftFx job={fxJob} say={fxJob.say && <MasterSays face={fxJob.say.face} line={fxJob.say.text} />}
          nextLabel={!again && againTimes > 0 ? `続けて作成（あと${againTimes}個）` : null}
          nextReason={again ? `続けて作成するには：${again}` : ''}
          onAgain={() => startCraft(fxJob.item)} onClose={() => setFxJob(null)} />
      )}
      <div style={{ display:'flex', gap:'4px', marginBottom:'6px' }}>
        <select value={bossKey} onChange={e => setBoss(e.target.value)} style={filterSelect(true)}>
          {bosses.map(b => <option key={b} value={b} style={optionStyle()}>{DUNGEON_BOSSES[b].name}</option>)}
        </select>
      </div>
      {cost && (
        <div style={{ background:'#000818', border:'1px solid #553322', padding:'6px 8px', marginBottom:'8px', fontSize:'10px', color: TEXT.sub, lineHeight:1.7 }}>
          1つ作るのに：<span style={{ color: have < cost.mats ? SHORT : '#cfe2ff' }}>{cost.name} {cost.mats}個</span>（所持数：{have.toLocaleString()}）・
          <span style={{ color: gold < cost.gold ? SHORT : '#ffcc00' }}>Gold {cost.gold.toLocaleString()}</span>（所持数：{gold.toLocaleString()}）
          <span style={{ color: times > 0 ? '#44ff88' : TEXT.empty }}>　いま作れるのは {times}個</span>
        </div>
      )}
      <div style={{ display:'grid', gap:'4px' }}>
        {items.map(item => {
          const usable = item.part !== '武器' || canEquipType(prof.class, item.type)
          const err = chCraftErrorOf(item, prof)
          const n = ownCount[item.id] || 0
          return (
            <div key={item.id} style={rowBox('#002244')}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
                  {item.name}
                  <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
                  {item.line && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{ARMOR_EFFECT[item.line]?.label}</span>}
                  {n > 0 && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>{n}個所持</span>}
                </span>
                <span style={{ color: needLvOf(item) > prof.lv ? '#ff8844' : '#cfe2ff', fontSize:'11px', whiteSpace:'nowrap' }}>要求レベル{needLvOf(item)}LV</span>
              </div>
              <ItemStats inv={{ ilv: item.lv, plus: 0 }} item={item} lv={prof.lv} />
              <ChallengeNote item={item} />
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', fontSize:'10px' }}>
                <span style={{ flex:1, minWidth:0, color:'#c69a5c' }}>{usable ? '' : `${prof.class}は${item.type}を装備できない（作ることはできる）`}</span>
                <button onClick={() => setConfirm(item)} disabled={busy || !!err} title={err || ''} style={miniBtn('#ffaa44')}>作る</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 部品 =====
// 名前の行（分解のチェック・お気に入りの★・レア度・名前・強化値・種類・防具の効果・装備中・要求レベル）
// ★一覧の右は「要求レベル〇LV」（2026-10-14 ユーザーが装備画面にそろえるを選んだ）。確認の画面の「（LV〇）」はそのまま
function ItemHead({ inv, item, lv, isWorn, check, star }) {
  const effect = item.line ? ARMOR_EFFECT[item.line]?.label : null
  // 着けていて要求LVが足りないときは、装備中の右に（要求LV不足）（2026-10-26 ユーザー指示「装備中の右に（要求LV不足）って表示されるようにして」）
  const sync = isWorn && lv ? syncLabelOf(item, inv.ilv, lv) : ''
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
      {check}
      <span style={{ color: nameColor(item), flex:1, minWidth:0 }}>
        {item.name}<PlusTag inv={inv} />
        <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'5px' }}>{kindLabel(item)}</span>
        {effect && <span style={{ color:'#88ddaa', fontSize:'10px', marginLeft:'5px' }}>{effect}</span>}
        {isWorn && <span style={{ color:'#44aaff', fontSize:'10px', marginLeft:'5px' }}>装備中</span>}
        {sync && <span style={{ color: SHORT, fontSize:'10px', marginLeft:'3px' }}>（{sync}）</span>}
        {/* 武器の真化（2026-10-26）：真化した武器は能力の名前（カーソルで中身） */}
        {SHINKA_ON && isShinka(inv.shinka) && <span style={{ marginLeft:'5px' }}><ShinkaNote inv={inv} item={item} /></span>}
      </span>
      <span style={{ color: lv && needLvOf(item, inv.ilv) > lv ? '#ff8844' : '#cfe2ff', fontSize:'11px', whiteSpace:'nowrap' }}>要求レベル{needLvOf(item, inv.ilv)}LV</span>
      {/* お気に入りの★は右上（2026-10-26 ユーザー指示「お気に入りのボタンは右上にして」） */}
      {star}
    </div>
  )
}
// 戦闘力とステ（強化値込み）。【確定】2026-10-26 ユーザー指示：
//   ・着けていて要求LVが足りない装備は、いまの（LV相当の）戦闘力とステを同じ橙で出す（「要求レベル不足してるときはその時の戦闘力だけ書いて、STRとかのステータスも同じ色で表示」）。
//     「（要求LV不足）」はこの行に書かず、名前の行の装備中の右（ItemHead）に出す（「戦闘力 125　STR+31…こんな感じにして、装備中の右に（要求LV不足）」）
//   ・着けていない装備は、ふつうの（装備そのものの）戦闘力とステ（「装備していない装備は普通のステータスが表示されるようにして」）
function ItemStats({ inv, item, lv, isWorn = false }) {
  const sync = isWorn ? syncLabelOf(item, inv.ilv, lv) : ''
  const power = sync ? effectivePowerAt(item, inv.ilv, lv, plusOf(inv)) : powerAt(item, inv.ilv, plusOf(inv))
  return (
    <div style={{ fontSize:'10px', color: sync ? SHORT : TEXT.sub, margin:'3px 0', display:'flex', gap:'8px', flexWrap:'wrap', flex:1, minWidth:0 }}>
      <span>戦闘力 {power}</span>
      <span>{statLine(statsAt(item, inv.ilv, isWorn ? lv : null, plusOf(inv)))}</span>
    </div>
  )
}
function Empty({ all }) {
  return (
    <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>
      {all.length === 0 ? '装備がありません（出撃で勝つと落ちることがあります。「作成」で作ることもできます）' : 'この絞り込みに当てはまる装備はありません'}
    </div>
  )
}

// 強化の画面。結果を出したまま続けて強化できる（閉じるまで開いたまま）。
// say＝開いたときに足りなかったら親方のひとこと { face, text }（足りないあいだだけ出す）
function SmithModal({ row, prof, busy, msg, say, onEnhance, onClose }) {
  const { inv, item } = row
  const plus = plusOf(inv)
  const cost = enhanceCostOf(item, inv)
  const err = enhanceErrorOf(item, inv, prof)
  const sync = syncLabelOf(item, inv.ilv, prof.lv)
  const now = powerAt(item, inv.ilv, plus)
  const have = cost ? scrapOf(prof.materials, cost.area) : 0
  const matHave = cost?.matKey ? chMatsOf(prof.challenge_mats, cost.matKey) : 0
  const gold = Number(prof.gold) || 0
  const short = { color: SHORT }
  return (
    <V2Modal title="🔨 装備の強化" color="#ffcc00" busy={busy}
      confirmLabel={cost ? `+${cost.next}に強化する` : '強化する'} cancelLabel="閉じる"
      onConfirm={err ? undefined : onEnhance} onClose={onClose}>
      {say && err && <MasterSays face={say.face} line={say.text} />}
      {/* 装備の名前は大きく（2026-10-26 ユーザー指示「強化選択時の装備名の文字大きく」） */}
      <div>
        <span style={{ fontSize:'16px' }}><span style={{ color: nameColor(item) }}>{item.name}</span><PlusTag inv={inv} /></span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（{kindLabel(item)}・LV{needLvOf(item, inv.ilv)}）</span>
      </div>
      {cost ? (
        <>
          {/* ★「強さ110%」のような%は出さない（弱い装備は最低+1のほうが大きく、%と合わない）。上がり幅は下の戦闘力で見せる */}
          <div>強化値 +{plus} → <span style={{ color: PLUS_COLOR }}>+{cost.next}</span></div>
          <div>戦闘力 {now} → <span style={{ color:'#44ff88' }}>{powerAt(item, inv.ilv, cost.next)}</span>
            {sync && <span style={{ color: SHORT, fontSize:'11px' }}>（{sync}）</span>}
          </div>
          {/* 上がるステ（2026-10-24 ユーザー指示「ちゃんと武器のステータスどのくらい上昇してるのかも記載するようにして」）。
              前は灰色の小さい字で「STR+5 DEX+3 → STR+6 DEX+4」。戦闘力と同じく装備そのものの強さ（必要LV不足の弱まりは入れない） */}
          <StatChange from={statsAt(item, inv.ilv, null, plus)} to={statsAt(item, inv.ilv, null, cost.next)} />
          {/* 2026-10-26 ユーザー指示「使うもの⇒強化素材・持っている⇒所持数：」「強化素材は1行ずつ書いて、Goldが一番上になるように」。
              2026-11-08〜 Goldの下に強化石（どの段も）、その下に+6からの残骸か、挑戦の装備ならボスの素材（smith.js の enhanceCostOf） */}
          <Materials label="強化素材" list={[
            { name:'Gold', n: cost.gold, unit:'', have: gold, color:'#ffcc00' },
            { name: cost.stoneName, n: cost.stone, unit:'個', have: stoneHaveOf(prof, cost.stoneTier), color: STONE_COLOR[cost.stoneTier] },
            ...(cost.scrap > 0 ? [{ name: scrapNameOf(cost.area), n: cost.scrap, unit:'個', have, color:'#cfe2ff' }] : []),
            ...(cost.mat > 0 ? [{ name: cost.matName, n: cost.mat, unit:'個', have: matHave, color:'#ffb088' }] : []),
          ]} />
          <div>成功率 <span style={{ color: cost.rate >= 50 ? '#44ff88' : SHORT }}>{cost.rate}%</span></div>
          {/* 「失敗すると残骸とGoldはなくなり、強化値はそのままです。」は出さない＝HELP の強化の説明にある（同じ日 ユーザー指示「この文言はいらない、Helpにいれて」） */}
          {err && <div style={short}>⚠ {err}</div>}
        </>
      ) : <div style={{ color: PLUS_COLOR }}>強化値は+{Math.max(PLUS_MAX, plus)}（上限）です</div>}
      {msg && <div style={{ color: msg.ok ? '#44ff88' : SHORT, marginTop:'6px' }}>{msg.text}</div>}
    </V2Modal>
  )
}

// 良質な強化石を作る画面（2026-11-09）：強化石10個で1個。数は 1・10・100・作れるだけ から選ぶ
function StoneCraftModal({ prof, busy, msg, onCraft, onClose }) {
  const max = stoneCraftMaxOf(prof)
  const [n, setN] = useState(1)
  const ok = !busy && n >= 1 && n <= max
  const pickStyle = (on) => ({ ...miniBtn(on ? STONE_COLOR[1] : '#62789a'), padding:'5px 8px' })
  return (
    <V2Modal title={`💠 ${STONE2_NAME}を作る`} color={STONE_COLOR[1]} busy={busy}
      confirmLabel={`${n.toLocaleString()}個作る`} cancelLabel="閉じる"
      onConfirm={ok ? () => onCraft(n) : undefined} onClose={onClose}>
      <div>{STONE_NAME}{STONE_CRAFT}個で、{STONE2_NAME}1個を作ります（必ずできます）。</div>
      <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', margin:'8px 0' }}>
        {[1, 10, 100].map(k => <button key={k} onClick={() => setN(k)} style={pickStyle(n === k)}>{k}個</button>)}
        <button onClick={() => setN(Math.max(1, max))} disabled={max < 1} style={pickStyle(max > 0 && n === max)}>作れるだけ（{max.toLocaleString()}個）</button>
      </div>
      <Materials label="作成素材" list={[{ name: STONE_NAME, n: n * STONE_CRAFT, unit:'個', have: stoneOf(prof), color: STONE_COLOR[0] }]} />
      <div style={{ marginTop:'4px' }}>できるもの：<span style={{ color: STONE_COLOR[1] }}>{STONE2_NAME} {n.toLocaleString()}個</span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（所持数：{stone2Of(prof).toLocaleString()}）</span></div>
      {n > max && <div style={{ color: SHORT }}>⚠ {STONE_NAME}が足りません</div>}
      {msg && <div style={{ color: msg.ok ? '#44ff88' : SHORT, marginTop:'6px' }}>{msg.text}</div>}
    </V2Modal>
  )
}

// 素材の行：1行に1つ・Gold がいちばん上（2026-10-26 ユーザー指示「強化素材は1行ずつ書いて、Goldが一番上になるように」・作成もそろえた）。
// list＝[{ name, n, unit, have, color }]。足りないものは橙
function Materials({ label, list }) {
  return (
    <div style={{ marginTop:'4px' }}>
      <div>{label}：</div>
      {list.map(m => (
        <div key={m.name} style={{ paddingLeft:'1em' }}>
          <span style={{ color: m.have < m.n ? SHORT : m.color }}>{m.name} {m.n.toLocaleString()}{m.unit}</span>
          <span style={{ color: TEXT.sub, fontSize:'11px' }}>（所持数：{m.have.toLocaleString()}）</span>
        </div>
      ))}
    </div>
  )
}

// 分解の確認。何個・どのレア度・どの残骸がいくつ入るかを出す
function DismantleModal({ list, busy, onConfirm, onClose }) {
  const counts = ALL_RARITIES.map(r => [r, list.filter(x => x.item.rarity === r).length]).filter(([, n]) => n > 0)
  const enhanced = list.filter(x => plusOf(x.inv) > 0).length
  const one = list.length === 1 ? list[0] : null
  return (
    <V2Modal title="🔨 装備を分解する" color={SHORT} danger busy={busy}
      confirmLabel={`${list.length}個を分解する`} onConfirm={onConfirm} onClose={onClose}>
      {one
        ? <div><span style={{ color: nameColor(one.item) }}>{one.item.name}</span><PlusTag inv={one.inv} />（LV{needLvOf(one.item, one.inv.ilv)}）を分解します。</div>
        : <div>{list.length}個を分解します。</div>}
      <div style={{ color: TEXT.sub }}>
        {counts.map(([r, n]) => <span key={r} style={{ marginRight:'8px' }}><span style={{ color: RARITY_COLOR[r] }}>{rarityLabel(r)}</span> {n}</span>)}
      </div>
      <div>手に入る残骸：<span style={{ color:'#ffcc00' }}>{gainText(dismantleGainOf(list))}</span></div>
      {enhanced > 0 && <div style={{ color: SHORT }}>⚠ 強化した装備が{enhanced}個入っています（強化に使った残骸とGoldは戻りません）</div>}
      {/* 武器の真化（2026-10-26）：真化した武器は能力も消える */}
      {SHINKA_ON && list.filter(x => isShinka(x.inv.shinka)).map(x => (
        <div key={x.inv.id} style={{ color: SHORT }}>⚠ {x.item.name}は真化しています（{shinkaNameOf(x.inv.shinka)}）。分解すると能力も消えます</div>
      ))}
      <div style={{ color: TEXT.sub }}>元には戻せません。</div>
    </V2Modal>
  )
}

// 作成の確認
function CraftModal({ item, prof, busy, onConfirm, onClose }) {
  const cost = craftCostOf(item)
  return (
    <V2Modal title="🔨 装備を作る" color="#ffaa44" busy={busy} confirmLabel="作る" onConfirm={onConfirm} onClose={onClose}>
      <div>
        <span style={{ color: nameColor(item) }}>{item.name}</span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（{kindLabel(item)}・LV{needLvOf(item)}）</span>を作ります。
      </div>
      <ItemStats inv={{ ilv: item.lv, plus: 0 }} item={item} lv={prof.lv} />
      {/* 2026-10-26 ユーザー指示「作成の画面も「使うもの」を「作成素材」、「持っている」を「所持数：」にそろえて」・
          強化と同じく1行ずつ・Gold がいちばん上（同じ日 ユーザー選択「そろえる」） */}
      <Materials label="作成素材" list={[
        { name:'Gold', n: cost.gold, unit:'', have: Number(prof.gold) || 0, color:'#ffcc00' },
        { name: scrapNameOf(item.area), n: cost.scrap, unit:'個', have: scrapOf(prof.materials, item.area), color:'#cfe2ff' },
      ]} />
      {/* 「+0で持ち物に入ります。」は出さない（2026-10-26 ユーザー指示。作成の結果のポップアップの「+0で持ち物に入りました」と同じ） */}
      <div style={{ color: TEXT.sub, fontSize:'11px' }}>必ずできます。</div>
    </V2Modal>
  )
}

// 挑戦装備の作成の確認（エリア装備の CraftModal と同じ形・素材は四凶の特別な素材）
function ChallengeCraftModal({ item, prof, busy, onConfirm, onClose }) {
  const cost = chCraftCostOf(item)
  if (!cost) return null
  return (
    <V2Modal title="🔨 装備を作る" color="#ffaa44" busy={busy} confirmLabel="作る" onConfirm={onConfirm} onClose={onClose}>
      <div>
        <span style={{ color: nameColor(item) }}>{item.name}</span>
        <span style={{ color: TEXT.sub, fontSize:'11px' }}>（{kindLabel(item)}・LV{needLvOf(item)}）</span>を作ります。
      </div>
      <ItemStats inv={{ ilv: item.lv, plus: 0 }} item={item} lv={prof.lv} />
      <ChallengeNote item={item} />
      <Materials label="作成素材" list={[
        { name:'Gold', n: cost.gold, unit:'', have: Number(prof.gold) || 0, color:'#ffcc00' },
        { name: cost.name, n: cost.mats, unit:'個', have: chMatsOf(prof.challenge_mats, item.bossKey), color:'#cfe2ff' },
      ]} />
      <div style={{ color: TEXT.sub, fontSize:'11px' }}>必ずできます。</div>
    </V2Modal>
  )
}
