import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capLogLine from './V2capLogLine.jsx'
import { runBattle } from '../../v2/lib/battle.js'
import { LOG_PLAIN } from '../../v2/components/v2ui.js'
import { loadPref, savePref } from '../../v2/lib/prefs.js'
import { SPOTS, spotOf, spotLabel, recLvText, toFighter as enemyFighter } from '../lib/areas.js'
import {
  pickEncounter, rollEquipDrop, nextBossRate, isSpotUnlocked, isSpotCleared, openUntilOf, SORTIE_CD,
} from '../lib/sortie.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { staminaMaxOf, MAX_LV, rollStamina } from '../lib/level.js'
import { jobUpHead, jobUpNote } from '../lib/jobs.js'
import { RARITY_COLOR } from '../lib/equipment.js'
import { buildCapBattleView } from '../lib/battleView.js'
import { enemyArtSrc } from '../lib/enemyArt.js'
import { battleIconOf } from '../lib/classArt.js'
import { shrineOf, shrineEncounterOf, SHRINE_NAME } from '../lib/shrine.js'
import { SHRINE_ART, SHRINE_TEXT, MINCHO } from '../lib/fxStyle.js'
import V2capShrineFx from './V2capShrineFx.jsx'

// ============================================================
// 「レベルキャップあり」版 — 出撃（ホームの右）
//   作りは今のⅡの出撃（V2Sortie.jsx）と同じ：10秒に1回・オートはスタミナ1／回・手動は無消費。
//   違うのは（2026-10-09 エリアの作り替え）：
//   ・場所（15エリア×①②③）を1本道で進む。**その場所のボスを倒すと次の場所が開く**
//   ・敵が**LV**を持つ（場所のLV帯の中で、敵ごとに決まっている）
//   ・**EXPとGoldはサーバーが場所の表から決める**（朝昼晩1.5倍・レア3倍・ボス5倍）＝ログは精算の返事を出す
//   ・ClassLVアップ／スキル習得もサーバーの返事から出す
//   ・落ちる装備は**そのエリアの装備**で、レア度はノーマル・レア・エピック・レジェンダリー
//     （エピックはレアとボスから・レジェンダリーはボスからだけ）。武器はいまの職業が装備できる種類（3種）から（sortie.js）
//   ・落ちた装備の**アイテムLV**＝その装備の必要LV（エリア×レア度・ユーザーの表）
//   ・【確定】2026-10-10 ユーザー指示：戦闘ログは**自動で一番下へ**送る。チェックでオン・オフできる（最初はオン・この端末で覚えておく）。
//     動かすのはログの枠の中だけ（scrollIntoView はページごと動いてしまうので使わない）。
//     オフのときは、新しい戦闘のたびに一番上から出す
//   ・【確定】2026-10-12 ユーザー指示：戦闘ログは**あるけみすと風**（ターンの頭に両方のアイコン＋HPの表・
//     行動ごとに動いた側のアイコン）。並びは battleView.js・見た目は V2capLogLine.jsx。
//     敵のアイコンは enemyArt.js（エリア①から絵を足していく）、自分のアイコンは classArt.js の battleIconOf
//     （SDの絵 → 無ければ顔のアップ。男女は神殿の切り替えと同じ capArtGender）
//   ・【確定】2026-10-13 ユーザー指示「安息の祠を追加」（決まりは lib/shrine.js・決めるのはサーバー）：
//     精算の返事（shrine）で祠を見つけたら、次の出撃から祠の中＝見つけた場所でハピネスフェアリーと戦う（場所は選べない）。
//     最後の1戦のあとは最深部の演出（V2capShrineFx）。祠のことはプロフィールの列（shrine_spot・shrine_left・shrine_total）でも持つ
// ============================================================
// ★ログに注記は付けない（2026-10-10 ユーザー指示「（朝だけ）とか（時間帯限定で1.5倍）とか倒した時の（1ターン）の部分いらない」）：
//   時間帯の敵の「（朝だけ）」・報酬の「（ボスで5倍）（レアで3倍）（時間帯限定で1.5倍）」・勝ち負けの「（◯ターン）」は出さない
//   ＋EXPの「（ClassEXP +5）」も出さない（2026-10-12 ユーザー指示「この表記なくして（経験値はどっちにも入る）」）
const ROLE_LINE = {
  boss:  (foe, lv) => ({ text:`⚠ ボス出現！ ${foe}（LV${lv}）が現れた！`, color:'#ff4444' }),
  rare:  (foe, lv) => ({ text:`✨ レアモンスター！ ${foe}（LV${lv}）が現れた！`, color:'#ffcc00' }),
  timed: (foe, lv) => ({ text:`${foe}（LV${lv}）が現れた！`, color:'#aaddff' }),
  normal: (foe, lv) => ({ text:`${foe}（LV${lv}）が現れた！`, color:'#88ccff' }),
  shrine: (foe, lv) => ({ text:`${foe}（LV${lv}）が現れた！`, color:'#ffb8e8' }),
}
// ログを自動で一番下へ送るか（この端末で覚えておく。読めない・書けないときはオンのまま動く）
// 右下の出撃ボタンを出すか（この端末で覚えておく・最初は出す）
//   【確定】2026-10-12 ユーザー指示「基本ステータスを閉じてもらう想定だけど、右下の方に独立して出撃ボタン設置して、
//   押したら設定している出撃ボタンと同じ、オンオフで表示切り替えられるように」
const FAB_PREF = 'capSortieFab'
const LOG_FOLLOW_KEY = 'v2capLogFollow'
const readFollow = () => { try { return localStorage.getItem(LOG_FOLLOW_KEY) !== '0' } catch { return true } }
const saveFollow = (on) => { try { localStorage.setItem(LOG_FOLLOW_KEY, on ? '1' : '0') } catch { /* 覚えられなくても切り替えは効く */ } }

export default function V2capSortie({ prof, inventory, onProfile, onScene }) {
  const [scene, setScene] = useState('town')
  const [selectedSpot, setSelectedSpot] = useState(() => Number(localStorage.getItem('v2capSelectedSpot')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(false)   // ★覚えておかない（リロードで勝手に走らないように）
  const [stam, setStam] = useState(() => ({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }))
  const [follow, setFollow] = useState(readFollow)   // ログを自動で一番下へ
  const [fabOn, setFabOn] = useState(() => loadPref(FAB_PREF, true) !== false)   // 右下の出撃ボタン
  const [battleNo, setBattleNo] = useState(0)         // 何戦目か（オフのとき、新しい戦闘で一番上に戻すため）
  const [art, setArt] = useState(null)                // 戦闘ログのアイコン（{ me:{ src, name }, foe:{ src, name } }）
  const [shrine, setShrine] = useState(() => shrineOf(prof))   // 安息の祠（いなければ null）。精算の返事とプロフィールから
  const [shrineBattle, setShrineBattle] = useState(false)   // 表示中の戦闘が祠の中か（何戦目かは出さない）
  const [fx, setFx] = useState(null)                  // 祠の演出（{ kind:'found'|'deepest', … }）
  const lastAt = useRef(0)
  const busy = useRef(false)
  const logBox = useRef(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  // オン：行が増えるたび（精算の行が後から足されたときも）枠の一番下へ
  useEffect(() => {
    const el = logBox.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [logs, follow])
  // オフ：新しい戦闘のたびに一番上から（前の戦闘で下まで読んだ位置のままにしない）
  useEffect(() => {
    const el = logBox.current
    if (el && !follow) el.scrollTop = 0
  }, [battleNo])   // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFollow = (on) => { setFollow(on); saveFollow(on) }
  const toggleFab = (on) => { setFabOn(on); savePref(FAB_PREF, on) }
  useEffect(() => { onScene?.(scene) }, [scene, onScene])
  useEffect(() => { setStam({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }) }, [prof?.stamina, prof?.stamina_at])
  useEffect(() => { setBossRate(prof?.boss_rate || 0) }, [prof?.boss_rate])
  useEffect(() => { setShrine(shrineOf(prof)) }, [prof?.shrine_spot, prof?.shrine_left, prof?.shrine_total])   // eslint-disable-line react-hooks/exhaustive-deps

  const cleared = prof?.cleared_spots || []
  const availableSpots = SPOTS.filter(s => isSpotUnlocked(cleared, s.id))
  // 選んでいた場所がまだ開いていなければ、開いている一番先の場所
  const spot = availableSpots.find(s => s.id === selectedSpot) || spotOf(openUntilOf(cleared))
  const elapsed = (now - lastAt.current) / 1000
  const remaining = Math.max(0, SORTIE_CD - elapsed)
  const canAct = remaining <= 0 && !loading && !fx   // 祠の演出の間は押せない（右下のボタンも）
  const timerPct = Math.min(100, (elapsed / SORTIE_CD) * 100)
  const stamMax = staminaMaxOf(prof?.lv)
  const stamNow = rollStamina(stam.n, stam.at, stamMax, now).n

  const doBattle = async (isAuto = false) => {
    // ★祠の演出が出ている間は出撃しない（オートも手動も・2026-10-14 ユーザー指示「演出が入ってるとき、オートでも出撃進まないようにして」）
    if (busy.current || !spot || fx) return
    if (Date.now() - lastAt.current < SORTIE_CD * 1000) return
    busy.current = true
    lastAt.current = Date.now()
    setLoading(true); setScene('battle'); setLogs([]); setBattleNo(n => n + 1)
    try {
      const me = playerFighter(prof, inventory)
      // 安息の祠の中なら、祠のある場所でハピネスフェアリーと戦う（装備は落ちない・ボスの出やすさは変わらない）
      const sh = shrine
      const enc = sh ? shrineEncounterOf(sh.spot) : pickEncounter(spot.id, bossRate, new Date())
      const r = runBattle(me, { ...(sh ? enemyFighter(enc.enemy, 8, enc.power) : enemyFighter(enc.enemy, 8)), boss: enc.isBoss })
      const win = r.winner === 'a'
      const drop = win && !sh ? rollEquipDrop(enc, prof.class, new Date()) : null
      if (!sh) setBossRate(nextBossRate(bossRate, enc.isBoss))
      setShrineBattle(!!sh)
      const stamBefore = Math.max(0, stamNow - (isAuto ? 1 : 0))   // 最深部の演出でゲージを満たし始める値

      const foe = enc.enemy.name
      const you = me.name
      // 自分のアイコンの男女は神殿の切り替えと同じ（戦闘のたびに読む＝神殿で変えたら次の戦闘から）
      const gender = loadPref('capArtGender', 'm')
      setArt({ me: { src: battleIconOf(prof.class, gender), name: you }, foe: { src: enemyArtSrc(foe), name: foe } })
      const out = []
      // 「◯◯が現れた！」も敵のアイコンを付けて出す（あるけみすとの「◯◯が襲いかかってきた！」の形）
      out.push({ kind:'act', who:'foe', appear: true, lines: [ROLE_LINE[enc.role](foe, enc.lv)] })
      out.push(...buildCapBattleView(r, you, foe))
      // ★勝ち負けの行は大きく出す（big・V2capLogLine。2026-10-10 ユーザー指示「倒した時のテロップ、わかりやすいように他よりも大きく」）
      out.push(win
        ? { text:`${foe}を倒した！`, color:'#ffcc00', big: true }
        : { text:'敗北…', color:'#ff4444', big: true })
      setLogs(out)

      // ★1戦ごとにその場で反映する。EXP・Gold・アイテムLVはサーバーが場所の表から決める
      const { data, error } = await supabase.rpc('v2cap_sortie_settle', {
        p_spot: sh ? sh.spot : spot.id, p_enemy: foe, p_win: win, p_drop: drop ? drop.item.id : null, p_auto: !!isAuto,
      })
      if (data && data.stamina != null) setStam({ n: data.stamina, at: data.stamina_at || new Date().toISOString() })
      if (error || !data?.ok) {
        setAuto(false)
        setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
        if (sh) onProfile(null)   // 祠のことがサーバーと食い違っていたら（別の画面で進めた など）取り直す
        return
      }
      const lv = data.level || {}
      const after = []
      // ★LV100のぶんは入らないので、そう出す。ClassEXPは書かない（同じ量がいまの職業にも入る＝ユーザー指示で表記を外した）
      const lvMax = prof.lv >= MAX_LV
      const expText = `EXP +${data.exp}${lvMax ? '（LV上限のため入らない）' : ''}`
      if (win) {
        after.push({ text:`${expText}　Gold +${data.gold}`, color:'#ffcc00' })
      } else if (data.exp > 0) {
        // 【確定】負けても経験値はその場所の最低値が入る（倍率なし・Goldは入らない・2026-10-09 ユーザー指示）。
        //   文言は「EXP +2」だけ（「負けても最低値は入る」「（ClassEXP +2）」の添え書きはユーザー指示で外した）
        after.push({ text: expText, color:'#c8a050' })
      }
      // 負けたときの経験値でもLVは上がりうる
      // LVアップではステは上がらず、ステータスポイントが入る（ステータス欄の「振る」から振る）。
      // サーバーが前の版（points を返さない）のあいだは数を出さない
      // ★レベルアップは英語で出す（2026-10-12 ユーザー指示「レベルアップするとき英語表記で」・ClassLVは「CLASS LEVEL UP！」を選んだ）
      if (lv.level_ups > 0) {
        const pts = typeof lv.points === 'number' ? `（ステータスポイント+${lv.points}）` : ''
        after.push({ text:`🆙 LEVEL UP！ LV${lv.lv}${pts}`, color:'#44ff88' })
      }
      // ★上がったクラスのステも書く（2026-10-12 ユーザー指示「クラスレベルアップしたときはステータスの上昇値も記載すること」・2つ以上なら合計）
      // 「⭐ CLASS LEVEL UP！盗賊　LV3 → 4」の次の行に「（HP+14・…）」（2026-10-12 ユーザー指示の表記）
      if (lv.job_ups > 0) {
        after.push({ text: jobUpHead(prof.class, lv), color:'#ffcc00' })
        const note = jobUpNote(prof.class, lv)
        if (note) after.push({ text: note, color:'#ffcc00' })
      }
      // 編成の空き枠に入ったか（2026-10-12 ユーザー指示「スキルスロット余ってる場合はうめるようにして」＝サーバーが set_added で返す）
      for (const name of lv.learned || []) {
        const into = (lv.set_added || []).includes(name)
        after.push({ text:`📖 スキル「${name}」を覚えた！${into ? '（スキルセットの空き枠に入れた）' : '（スキルセットで編成できる）'}`, color:'#44ddff' })
      }
      if (win) {
        if (data.drop && drop) {
          // ★装備名だけをレア度の色で（【レア】のような頭の表記は付けない＝2026-10-13 ユーザーが「ログも外す」を選んだ）。
          //   「必要LVに足りない＝効果◯%」も「（LV◯）」も出さない（2026-10-12 ユーザー指示「ここで説明しなくていい」
          //   「装備ドロップしたとき要求レベル書かなくていい」）
          const color = RARITY_COLOR[drop.item.rarity]
          after.push({ color: LOG_PLAIN, parts: [
            { text:'🎁 「' }, { text: drop.item.name, color },
            { text:'」を入手！' },
          ] })
        }
        // ボスを倒すと次の場所が開く（1本道）。開いたかどうかはサーバーの返事で見る
        if (enc.isBoss && Number(data.open_until) > openUntilOf(cleared)) {
          after.push({ text:`🔓 ${spotLabel(data.open_until)}が解放された！`, color:'#44ff88' })
        }
      }
      // 安息の祠（サーバーが前の版のあいだは shrine が無い＝何も出さない）
      // ★最深部まであと何回かは出さない（2026-10-14 ユーザー指示「最深部まであといくつかは記載しなくていい」）
      const sr = data.shrine
      if (sr) {
        const next = shrineOf(sr)
        setShrine(next)
        if (sr.found && next) {
          after.push({ text:`⛲ ${SHRINE_TEXT.found}`, color:'#9fe8ff', big: true })
          setFx({ kind:'found', place: spotLabel(next.spot), key: Date.now() })
        } else if (sr.deepest) {
          after.push({ text:`⛲ ${SHRINE_TEXT.deepest}`, color:'#9fe8ff', big: true })
          after.push({ text:`⚡ ${SHRINE_TEXT.healed}（${data.stamina}/${data.stamina_max}）`, color:'#44ff88' })
          setFx({ kind:'deepest', stamina: { before: stamBefore, after: data.stamina, max: data.stamina_max }, key: Date.now() })
        } else if (sh && next) {
          after.push({ text:'⛲ 祠の奥へ進んだ…', color:'#9fe8ff' })
        }
      }
      if (after.length) setLogs(l => [...l, ...after])
      onProfile(null)
    } finally {
      // ★10秒は「精算が返ってきた時点」から数え直す。サーバーも前回の精算から8秒空いているかを見るので、
      //   出撃を押した時点から数えると、通信が遅かった回の次で弾かれることがある
      lastAt.current = Date.now()
      busy.current = false
      setLoading(false)
    }
  }

  // オート出撃。クールタイムが明けるたびに、スタミナを1使って勝手に出撃する
  // ★祠の演出が出ている間は止まって待つ（オートは切らない＝閉じたら続きから・2026-10-14 ユーザー指示）
  useEffect(() => {
    if (!auto || loading || !spot || remaining > 0 || fx) return
    if (stamNow < 1) {
      setAuto(false)
      // 「ここからは自分で出撃する」は付けない（2026-10-12 ユーザー指示）
      setLogs(l => [...l, { text:'⚡ スタミナ切れ', color:'#ffcc00' }])
      return
    }
    doBattle(true)
  }, [auto, now, loading, spot, remaining, stamNow, fx])   // eslint-disable-line react-hooks/exhaustive-deps

  const timerRow = (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
        <span style={{ color:'#7fa6d0' }}>次の行動まで</span>
        <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>{canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}</span>
      </div>
      <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'10px' }}>
        <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
      </div>
    </>
  )

  // 右下に浮かぶ出撃ボタン（街でも戦闘中でも出す）。押すと上の「出撃！／再出撃！」と同じ（手動の出撃・スタミナは使わない）。
  // 押せるときは黄色く光る。押せないとき（待ち時間・精算中・オート中）は**暗くするだけ**（秒数もゲージも出さない）。
  //   【確定】2026-10-12 ユーザー指示「やっぱ押せるときに押せるように、押せないときは非アクティブにするだけでいいや」
  //   （前は残りの秒数→下から上へ貯まるゲージ）。オートのあいだは上のボタンも出ていないので同じく押せない
  const fabReady = canAct && !auto
  const fab = fabOn && spot && (
    <button onClick={() => doBattle(false)} disabled={!fabReady} aria-label="出撃"
      title={auto ? 'オート出撃中' : shrine ? `${SHRINE_NAME}の奥へ進む（上の出撃ボタンと同じ）` : `${spot.name}へ出撃（上の出撃ボタンと同じ）`}
      style={{ position:'fixed', right:'16px', bottom:'calc(16px + env(safe-area-inset-bottom, 0px))', zIndex:300,
        width:'64px', height:'64px', borderRadius:'50%', padding:0, fontFamily:'monospace', lineHeight:1.15,
        background: fabReady ? '#001840' : '#000c1c', border:`2px solid ${fabReady ? '#ffcc00' : '#2a4a66'}`,
        color: fabReady ? '#ffcc00' : '#4d6f92', cursor: fabReady ? 'pointer' : 'not-allowed',
        boxShadow: fabReady ? '0 0 12px rgba(255,204,0,0.45), 0 4px 12px rgba(0,0,0,0.6)' : '0 4px 12px rgba(0,0,0,0.6)' }}>
      <span style={{ fontSize:'20px' }}>⚔</span><br /><span style={{ fontSize:'11px' }}>出撃</span>
    </button>
  )
  // 安息の祠の演出（見つけたとき・最深部）。出撃の画面の上に重ねる。出ている間はオートも止まって待ち、閉じると続きから
  const fxLayer = fx && (
    <V2capShrineFx key={fx.key} kind={fx.kind} place={fx.place} stamina={fx.stamina} onClose={() => setFx(null)} />
  )
  // 祠にいる間の出撃のボタン
  const shrineGo = '⛲ 祠の奥へ進む！'

  if (scene === 'battle') {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', fontFamily:'monospace' }}>
        {fab}
        {fxLayer}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px', gap:'8px', flexWrap:'wrap' }}>
          {shrineBattle
            ? <span style={{ color:'#9fe8ff', fontSize:'13px' }}>⛲ {SHRINE_NAME}</span>
            : <span style={{ color:'#ff6644', fontSize:'13px' }}>⚔ バトル！</span>}
          <span style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
            {auto && <span style={{ color:'#44ff88', fontSize:'11px' }}>▶ オート出撃中（⚡{stamNow}）</span>}
            <label style={{ display:'flex', alignItems:'center', gap:'4px', color:'#93a9be', fontSize:'10px', cursor:'pointer' }}>
              <input type="checkbox" checked={follow} onChange={e => toggleFollow(e.target.checked)}
                style={{ accentColor:'#44ff88', margin:0, cursor:'pointer' }} />
              ログを自動で一番下へ
            </label>
          </span>
        </div>
        <div ref={logBox} style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2capLogLine key={i} l={l} art={art} />)}
        </div>
        {timerRow}
        {auto && (
          <button onClick={() => setAuto(false)}
            style={{ width:'100%', padding:'10px', background:'#1a0a20', border:'1px solid #ff88cc',
              color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
            ■ オートを止める
          </button>
        )}
        {!auto && (
          <button onClick={() => doBattle(false)} disabled={!canAct}
            style={{ width:'100%', padding:'10px', background:'#001840',
              border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
              color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
              fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
            {!canAct ? '⏳ 待機中...' : shrine ? shrineGo : `⚔ ${spot?.name}へ再出撃！`}
          </button>
        )}
        <button onClick={() => { setAuto(false); setScene('town') }} disabled={loading}
          style={{ width:'100%', padding:'10px', background: loading ? '#000a18' : '#001840',
            border:`1px solid ${loading ? '#13405f' : '#0088ff'}`, color: loading ? '#2a4a66' : '#0088ff',
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'13px' }}>
          🏰 街に戻る
        </button>
      </div>
    )
  }

  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', fontFamily:'monospace' }}>
      {fab}
      {fxLayer}
      {timerRow}
      {shrine ? (
        // ★祠にいる間は場所を選べない（見つけた場所の祠で戦う）。入口の絵を敷いて、祠の名前と場所を出す
        //   （最深部まであと何回かは出さない＝2026-10-14 ユーザー指示）
        <div style={{ position:'relative', minHeight:'64px', marginBottom:'8px', border:'1px solid #2a7fa0', padding:'12px',
          backgroundImage:`linear-gradient(90deg, rgba(0,10,26,0.94) 0%, rgba(0,10,26,0.7) 48%, rgba(0,10,26,0.15) 100%), url(${SHRINE_ART})`,
          backgroundSize:'cover', backgroundPosition:'60% 58%', boxShadow:'inset 0 0 18px rgba(79,216,255,0.18)' }}>
          <div style={{ color:'#d8f7ff', fontFamily: MINCHO, fontWeight:'bold', fontSize:'16px', letterSpacing:'3px', textShadow:'0 0 8px #3fb8ff' }}>⛲ {SHRINE_NAME}</div>
          <div style={{ color:'#9fb8d0', fontSize:'10px', marginTop:'4px' }}>{spotLabel(shrine.spot)}</div>
        </div>
      ) : (
        <select value={spot?.id || 1}
          onChange={e => { const v = Number(e.target.value); setSelectedSpot(v); localStorage.setItem('v2capSelectedSpot', v) }}
          style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
          {/* ★開いている場所だけ（1本道）。推奨LV（上限＝ボスを倒せる目安・2026-10-12 ユーザー指示）も出す */}
          {availableSpots.map(s => (
            <option key={s.id} value={s.id}>
              {spotLabel(s)}　{recLvText(s.id)}{isSpotCleared(cleared, s.id) ? '　✔' : ''}
            </option>
          ))}
        </select>
      )}
      {/* ★場所の説明（敵のLV・装備の必要LV・落とすレア度・1体あたりのEXPとGold・「ボスを倒すと次の場所が開く」）は出さない
           （2026-10-12 ユーザー指示「画像の部分いらない」）。場所の推奨LVは上の選択肢に出ている */}
      <button onClick={() => doBattle(false)} disabled={!canAct}
        style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
          color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
        {!canAct ? '⏳ 待機中...' : shrine ? shrineGo : `⚔ ${spot?.name}へ出撃！`}
      </button>
      <button onClick={() => setAuto(true)} disabled={stamNow < 1}
        style={{ width:'100%', padding:'8px', background: stamNow > 0 ? '#00281a' : '#000818',
          border:`1px solid ${stamNow > 0 ? '#44ff88' : '#2a4a66'}`, color: stamNow > 0 ? '#44ff88' : '#2a4a66',
          cursor: stamNow > 0 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
        {stamNow > 0 ? `▶ オート出撃（あと${stamNow}回）` : '⚡ スタミナ切れ'}
      </button>
      {/* 「スタミナ1につき1回、10秒ごとに自動で出撃します」は出さない（2026-10-12 ユーザー指示）。スタミナ切れのときの案内だけ残す */}
      {stamNow < 1 && (
        <div style={{ color:'#4d6f92', fontSize:'10px', marginTop:'5px', textAlign:'center' }}>自分でクリックする出撃はスタミナを使いません</div>
      )}
      <label style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', color:'#93a9be', fontSize:'10px', cursor:'pointer', marginTop:'6px' }}>
        <input type="checkbox" checked={fabOn} onChange={e => toggleFab(e.target.checked)}
          style={{ accentColor:'#ffcc00', margin:0, cursor:'pointer' }} />
        右下に出撃ボタンを出す
      </label>
    </div>
  )
}
