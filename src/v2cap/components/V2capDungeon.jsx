import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capAtbFight from './V2capAtbFight.jsx'
import V2capBossReward from './V2capBossReward.jsx'
import V2capBossPick from './V2capBossPick.jsx'
import V2capBossEncounter from './V2capBossEncounter.jsx'
import { useBossEncounter } from '../lib/useBossEncounter.js'
import V2capReloadNote from './V2capReloadNote.jsx'
import { preloadArt } from '../lib/artPreload.js'
import { box, miniBtn, TEXT } from './v2ui.js'
import { calcPower } from '../core/stats.js'
import { itemsUsedOf } from '../core/atb.js'
import { loadPref } from '../core/prefs.js'
import { macrosOf } from '../lib/atbMacro.js'
import { damageOf, startTryAtb } from '../lib/dungeonVerify.js'
import { callVerify, isStaleBuild } from '../lib/dungeonVerifyCall.js'
import { totalStats } from '../lib/loadout.js'
import { openAreaOf } from '../lib/sortie.js'
import { motionOf } from '../lib/motionArt.js'
import { homeIconOf } from '../lib/classArt.js'
import { artGenderOf } from '../lib/gender.js'
import { CLASS_BY_ID } from '../lib/jobs.js'
import { bossArtOf, bossEncounterOf, bossFaceOf, bossNamePartsOf, bossThumbOf, bossTintOf } from '../lib/bossArt.js'
import { bossIllustOf } from '../lib/bossIllust.js'
import { menuHeadReady } from '../lib/menuHead.js'
import { MenuHead } from './V2Status.jsx'
import {
  CHALLENGE_CATS, DUNGEON_BOSSES, DIFF_COLOR, HELPERS_MAX, STAMINA_HELPER,
  contributionPctOf, diffOf, summonBlockOf, tryStaminaOf, msLeftOf, stateWithRunOf,
} from '../lib/dungeon.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦（ボスを呼び、HPを持ち越して倒す・ATB戦闘）
// ------------------------------------------------------------
// 【確定】2026-10-29 ユーザー選択（決まりの正は lib/dungeon.js・サーバーは SQL §23）：
//   ・入口で難易度を選んで**自分で呼ぶ**（全部の難易度を合わせて1日1回・朝5時に戻る）。呼んだときから90分
//   ・**HPは持ち越し**：負けても残ったHPから挑み直せる。挑戦1回は ATB 戦闘（画面は V2capAtbFight.jsx・試し撃ちと同じ）。時間制限は無し（2026-11-06〜・念のための上限は lib/dungeon.js の DUNGEON_TRY_SEC）
//   ・スタミナ：呼んだ人は最初の1回0・そのあと3／救援で入った人は毎回5
//   ・**救援信号**を出すと、入口の「救援の一覧」に出て、だれでも先着5人まで入れる（それぞれ自分の画面で同じボスを殴る）
//   ・難易度はそのエリアに着いたら呼べる（②ノーマル・⑤ハード）。エキスパート・マスターは準備中
//   ・報酬はボスの専用の装備（あとで）と、削った量での差
// 【確定】2026-10-31 ユーザー「これは『挑戦』にして」「ここに『強敵』ってカテゴリを作って、ここにヴァルゼノクとあまざ入れて」＋選択「ボスごとに1日1回」：
//   メニューの名前は「挑戦」。入口はカテゴリごと（lib/dungeon.js の CHALLENGE_CATS）にボスを並べ、押すと難易度が開く。呼べるのはボスごとに1日1回・同時に1体
// 【確定】2026-10-31 ユーザー「この履歴いらない」「ここら辺の説明いらない」「ボスは1体ずつ挑戦できる」「呼ぶじゃなくて挑戦する にして」「開発用に挑戦回数resetできるように」：
//   倒した・時間切れのボスと説明は出さない。「挑戦する」でボスを出してそのまま戦闘へ（負けたら入口に残り、続きから挑む）。コードと DB の summon の名前はそのまま。回数を戻すのは開発用のボタン
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」：
//   倒したら 倒れる動き → 討伐完了のテロップ（V2capAtbFight.jsx）→ 報酬画面（V2capBossReward.jsx）。ほかの人が先に倒していたら、自分の決着のすぐあとに報酬画面。負けと時間切れは今までどおり
//   【確定】同じ日 ユーザー選択「EXPとGoldを渡す」：その場にいなかった人は、入口の「報酬を受け取る」から同じ報酬画面へ（決まりは lib/dungeon.js）
//   【確定】2026-11-01 ユーザー「プレイヤーが敗北したときのテロップも欲しい、画面遷移も」「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」：
//     負けと時間切れも テロップ → 結果の画面（同じ部品・ボスの残りHP・貢献度・もう一度挑戦する）。入っているボスの行にも貢献度
//   【確定】同じ日 ユーザー「挑戦を押してから若干ラグがあってから始まるから、スムーズに遷移させるようにして」「挑戦したら遭遇のイラストがどん！って出るようにしてほしい」：
//     押した瞬間に遭遇のイラスト（V2capBossEncounter.jsx）。サーバーの返事と絵は裏で待つ（lib/useBossEncounter.js）。絵は押すまで出たまま。始められなかったら入口へ
//     遭遇のイラストはどの画面でも同じ所に置く（{encounter} を一番上に）＝裏で入口から戦闘へ変わっても作り直さない（作り直すと、どん！がもう一度出る）
//     版の確かめ（isStaleBuild）はボスを開いたときに済ませておく＝押してから聞かない（staleNow）
//     遭遇のイラストを押したのにサーバーの返事がまだなら、手元の値で作った見た目だけの戦闘（earlyFight）を先に出す。時計は動かず、返事が来たら本物に差し替える（ユーザー「遭遇時にタップ押したら画面遷移ができてない」）
//   【確定】同じ日 ユーザー「挑戦するキャラを選択したらそこでポップアップが出て難易度選択して挑戦するようにして」「持っていくアイテムも表示されるように」：
//     ボスを押すとポップアップ（V2capBossPick.jsx）。難易度と持ち込む薬はそこで選ぶ（入口の上の薬の欄はやめた）。
//     入っているボスの「挑戦する」と結果の画面の「もう一度挑戦する」も同じポップアップ（難易度は決まっている・薬は選び直せる）。
//   【確定】同じ日 ユーザー「難易度選択のポップアップはただイラスト表示させるだけでいい、挑戦する押した後いつも通りの遭遇の演出はいるようにして」：
//     ポップアップの絵は出すだけ。ポップアップの「挑戦する」を押すと、ポップアップを閉じて全画面の遭遇のイラストへ（押すと戦闘の画面へ）
// 【確定】同じ日 ユーザー選択「サーバーの計算で入れる」：戦闘はサーバーが決めた種と写しで作り、終わったら押した記録を預ける（v2cap_dungeon_try_end）。
//   サーバーが同じ戦闘を回し直して結果を入れる（lib/dungeonVerify.js）。挑戦の途中で画面を離れたら、そこまでの記録を預ける。確かめられないまま戻ったら入口で確かめ直す
// 【確定】同じ日 ユーザー「アイテムは4つまでしか持てないようにして、全部で合計4つ」「装備は挑戦タブから設定できるように」：ポップアップで持ち込む薬を選ぶ（V2capItemLoadout.jsx）
// 【確定】2026-11-05 ユーザー「これ 2列2行にして」：入口のカテゴリの中のボスは2列の格子
//   → 2026-11-06 ユーザー「一旦1列に戻して、ここの部分は顔付近だけ表示されるようにして※クラスの顔アイコンみたいな感じ」で1列（1行に1体・左に顔のアップ）に戻した
//   → 同じ日 ユーザー「ここ同じ高さで2列にして」：顔のアップの枠のまま2列。全部の枠を同じ高さに
// 【確定】同じ日 ユーザー「あと敵のHPの数値は見れないようにして」：ボスのHPは数字も割合も出さず、バーだけ
//   （戦闘の舞台と見出し・入っているボスの行・救援の一覧・ポップアップ・結果の画面）。削った割合も出さない（V2capAtbFight.jsx）。
//   与えたダメージと貢献度（2026-11-01 にユーザーが頼んだ物）はそのまま
// 【確定】2026-11-06 ユーザー「黒龍 あか・あまざ あお・ゼルギアス 黄色・閻魔 紫 の薄い背景にしてほしい、文字やイラストが見づらくならない程度に」：
//   入口のボスの枠にボスの色を薄く敷く（bossCardBg・色は lib/bossArt.js の bossTintOf）。「今後4強以外にもいろいろ出す予定」＝ボスを足すときは色も決める
// ============================================================

const POLL_MS = 15000
const STALE_ASK_MS = 60000
const DEV = '#ff88cc'
const NO_SQL = 'サーバーにまだこの仕組みがありません（SQL を流すと使えます）'
const VERIFY_LATER = '結果を確かめられませんでした（入口に戻ると確かめ直します）'
const errText = (error, data) => (/could not find the function/i.test(error?.message || '') ? NO_SQL : (error?.message || data?.error || 'うまくいきませんでした'))
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const Bar = ({ pct, color, h = 10 }) => (
  <div style={{ height:`${h}px`, background:'#000818', border:'1px solid #13405f' }}>
    <div style={{ width:`${Math.max(0, Math.min(100, pct))}%`, height:'100%', background: color }} />
  </div>
)
// 文の中に置く小さいHPのバー（救援の一覧・ボスのHPは数字を出さない）。「HP」の文字と別の行に分かれないよう、文字ごと nowrap で包む（スマホの幅で分かれた）
const MiniBar = ({ pct }) => (
  <span style={{ display:'inline-block', width:'40px', height:'6px', verticalAlign:'middle', background:'#000818', border:'1px solid #13405f' }}>
    <span style={{ display:'block', width:`${Math.max(0, Math.min(100, pct))}%`, height:'100%', background:'#cc3344' }} />
  </span>
)
// 入口のボスの顔のアップ（神殿のクラスの顔アイコンと同じ形＝60pxの正方形・顔を全面に・後ろにボスの色）。顔のアップが無いボスは一覧の小さい絵を縮めて出す
//   2列（2026-11-06〜）のスマホの幅では少し小さく（375px で約52px・いちばん小さくて48px）＝名前が言葉の切れ目で2行に収まる（本番で 320〜478px の幅を測った）
const FACE_SIZE = 'clamp(48px, 14vw, 60px)'
const BossFace = ({ bossKey }) => {
  const face = bossFaceOf(bossKey), src = face || bossThumbOf(bossKey), tint = bossTintOf(bossKey)
  if (!src) return null
  return (
    <div style={{ width: FACE_SIZE, height: FACE_SIZE, flexShrink:0, overflow:'hidden', background: tint ? `${tint}30` : '#0b1a2e', border:'1px solid #002244', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <img src={src} alt="" draggable={false} style={{ width:'100%', height:'100%', objectFit: face ? 'cover' : 'contain' }} />
    </div>
  )
}
// 入口のボスの枠の背景：ボスの色（lib/bossArt.js の bossTintOf）を薄く敷く。左の顔の後ろを少し濃く、右へ薄く（顔のアップの枠・2026-11-06〜）。
//   下地は色のない暗い色（紺の上に重ねると黄色が灰色にくすんだ・本番で見比べた）。color はなぞったときの光（src/dev-ui.css の currentColor）
//   色の無いボスは前のまま（背景なし）
const bossCardBg = (tint) => (tint
  ? { background:`radial-gradient(ellipse 45% 120% at 10% 50%, ${tint}47, transparent 75%), linear-gradient(${tint}1a, ${tint}1a), #0b0c14`, border:`1px solid ${tint}66`, color: tint }
  : { background:'none', border:'none' })
// ボスの絵：イラスト版（無ければドット絵版）。試し撃ちで選んだ版を使う
const artMemo = new Map()
const artOfBoss = (key) => {
  const ver = loadPref('capBossArtVer', 'illust'), id = `${ver}:${key}`
  if (!artMemo.has(id)) artMemo.set(id, (ver === 'illust' && bossIllustOf(key)) || bossArtOf(key) || bossIllustOf(key) || null)
  return artMemo.get(id)
}

// onGo … 画面を切り替える（持ち込む薬の「商店で買う」）
export default function V2capDungeon({ prof, inventory, onProfile, onGo, dev = false }) {
  const [state, setState] = useState(null)        // v2cap_dungeon_state の返事
  const [msg, setMsg] = useState(null)            // { ok, text }
  const [busy, setBusy] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())
  const [fight, setFight] = useState(null)        // { run, st, runKey, result, ended（決着のテロップが終わった） }
  const [pick, setPick] = useState(null)          // 開いているポップアップ { boss, run（もう入っているボス・新しく挑戦するときは無し） }
  const [claimed, setClaimed] = useState(null)    // 入口で受け取った報酬（v2cap_dungeon_claim の返事）
  const [stale, setStale] = useState(false)       // 画面が古い（読み直すまで挑戦しない）
  const pending = useRef(null)                    // 送っていない挑戦（画面を離れたら送る）
  const enc = useBossEncounter()                  // 遭遇のイラスト
  const staleAsked = useRef(null)                 // 版の確かめ { at, ask }
  const settling = useRef(false)                  // 結果を確かめてもらっているあいだ（入口の確かめ直しと重ねない）
  const loadoutSave = useRef(Promise.resolve())   // 持ち込む薬の保存（送っている途中なら、挑戦を始める前に待つ）
  const onProfileRef = useRef(onProfile)
  onProfileRef.current = onProfile

  const myPower = useMemo(() => calcPower(totalStats(prof, inventory)), [prof, inventory])
  const reached = openAreaOf(prof?.cleared_spots)
  const macros = useMemo(() => macrosOf(prof), [prof])
  const myGender = artGenderOf(prof, loadPref('capArtGender', 'm'))
  const baseCls = CLASS_BY_ID[prof?.class]?.req?.cls
  const playerSrc = useMemo(() => homeIconOf(prof?.class, myGender, baseCls), [prof?.class, myGender, baseCls])
  const playerMotion = useMemo(() => motionOf(prof?.class, myGender, 'attack', baseCls), [prof?.class, myGender, baseCls])
  // 開いたボスと入っているボスの戦闘の絵を先に読む（押してから待たない）。遭遇のイラストは全部のボス＝ポップアップを開いた瞬間に大きな絵で出す
  const pickBoss = pick?.boss
  const motionSrc = playerMotion?.src
  const runBosses = (state?.runs || []).map(r => r.boss).join(',')
  useEffect(() => { preloadArt(Object.keys(DUNGEON_BOSSES).map(bossEncounterOf).filter(Boolean)) }, [])
  useEffect(() => {
    for (const key of new Set([pickBoss, ...runBosses.split(',')])) {
      const art = key && artOfBoss(key)
      if (art) preloadArt([...art.srcs, playerSrc, motionSrc].filter(Boolean))
    }
    if (pickBoss || runBosses) staleAsked.current = { at: Date.now(), ask: isStaleBuild() }
  }, [pickBoss, runBosses, playerSrc, motionSrc])
  // 版の確かめ（STALE_ASK_MS 以内に聞いたならその答え＝押してから待たない）
  const staleNow = () => (staleAsked.current && Date.now() - staleAsked.current.at < STALE_ASK_MS ? staleAsked.current.ask : isStaleBuild())

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('v2cap_dungeon_state')
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return }
    setState(data)
    // 記録を預けたまま確かめられていない挑戦（通信が切れた・閉じた）を確かめ直す。届かなければ次の読み直しでもう一度
    if (!data.pending?.length || settling.current) return
    settling.current = true
    let done = false
    for (const id of data.pending) {
      const r = await callVerify({ run: id, player: data.me }, { retryMs: [] })
      if (!r?.ok) continue
      done = true
      onProfileRef.current?.()   // 報酬・飲んだ薬で持ち物が変わる
      if (r.reward) setClaimed(r)
      else setMsg({ ok: true, text: `前の挑戦の結果：${Number(r.damage).toLocaleString()}ダメージを入れました` })
    }
    settling.current = false
    if (done) load()
  }, [])
  useEffect(() => { load() }, [load])
  // 入口にいるあいだは、ほかの人の削り・救援の一覧を取り直す（戦っているあいだは取らない）
  useEffect(() => {
    if (fight) return
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [fight, load])
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id) }, [])
  // 入口の一言はいちばん上に出る＝下まで動かしたままだと上の帯に隠れるので、出すたびに上へ戻す
  useEffect(() => { if (msg?.text) window.scrollTo(0, 0) }, [msg?.text])

  const call = async (fn, args, after) => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return null }
    if (after) after(data)
    return data
  }
  const rescue =(run) => call('v2cap_dungeon_rescue', { p_run: run.id }, () => { setMsg({ ok: true, text: '救援信号を出しました（入口の「救援の一覧」に出ます）' }); load() })
  const join = (run) => call('v2cap_dungeon_join', { p_run: run.id }, () => { setMsg({ ok: true, text: `${run.owner}さんの救援に入りました` }); load() })
  // 報酬を受け取る（自分が挑戦していないあいだにボスが倒れたとき）
  const claim = (run) => call('v2cap_dungeon_claim', { p_run: run.id }, (data) => { setClaimed(data); onProfile?.(); load() })

  // ===== 挑む =====
  const start = async (run) => {
    // 画面が古いままだと、サーバーの回し直しとずれる（スタミナを使う前に見る）
    setBusy(true)
    if (await staleNow()) { setBusy(false); setStale(true); return false }
    await loadoutSave.current   // 選んだばかりの持ち込む薬を、この挑戦の写しに入れる
    const data = await call('v2cap_dungeon_try_start', { p_run: run.id })
    if (!data) { load(); return false }
    // ★サーバーが決めた種と、サーバーが写し取った自分で戦う（回し直しも同じものから作る）
    const st = startTryAtb(data)
    if (!st) { setMsg({ ok: false, text: 'このボスはまだ戦えません' }); return false }
    pending.current = { runId: run.id, st }
    setFight(f => ({ run, st, runKey: (f?.runKey || 0) + 1, result: null }))
    onProfile?.()   // スタミナが減った
    window.scrollTo(0, 0)
    return true
  }
  // 入っているボスにもう一度挑む（入口の行からも、結果の画面からも）。始められなかったら入口へ（わけは入口に出る）
  const enter = async (run) => {
    enc.begin(run.boss, run.diff, [], run.hp)
    if (await start(run)) { enc.finish(); return }
    enc.cancel()
    setFight(null)
    window.scrollTo(0, 0)
  }
  // 挑戦する：ボスを出して、そのまま戦闘へ（始められなかったら入口に残る）
  const challenge = async (bossKey, diff) => {
    enc.begin(bossKey, diff)
    const data = await call('v2cap_dungeon_summon', { p_boss: bossKey, p_diff: diff })
    if (!data) { enc.cancel(); return }
    if (await start(data.run)) enc.finish()
    else enc.cancel()
    load()
  }
  // ポップアップを開く（スタミナと挑戦済みを読み直す＝結果の画面から開いたときは、戦闘の前の数字のまま）
  const openPick = (boss, run = null) => { setPick({ boss, run }); load() }
  const closePick = useCallback(() => setPick(null), [])
  // ポップアップの「挑戦する」：閉じて、押した瞬間に遭遇のイラストへ（戦闘の絵はポップアップを開いたときに読み始めている）
  const startPick = (diff) => {
    const { boss, run } = pick
    setPick(null)
    if (run) enter(run)
    else challenge(boss, diff)
  }
  // 開発用：きょうの挑戦回数を戻す（サーバーも開発者だけ）
  const resetTries = () => call('v2cap_dev_dungeon_reset', {}, () => { setMsg({ ok: true, text: '挑戦回数を戻しました' }); load() })
  // 押した記録を預けて、結果を確かめてもらう（1回だけ）。決着・あきらめる・画面を離れる、のどれか
  const report = useCallback(async () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    settling.current = true
    try {
      const { data, error } = await supabase.rpc('v2cap_dungeon_try_end', { p_run: p.runId, p_inputs: p.st.inputs, p_end_step: p.st.steps, p_claim: damageOf(p.st) })
      if (error || !data?.ok) return { ok: false, text: errText(error, data) }
      const r = await callVerify({ run: p.runId, player: data.player })
      if (!r?.ok) return { ok: false, text: VERIFY_LATER }
      if (itemsUsedOf(p.st)) onProfileRef.current?.()   // 飲んだ薬が持ち物から減った（商店の持っている数）
      return { ok: true, damage: r.damage, run: r.run, reward: r.reward, corrected: r.corrected }
    } finally {
      settling.current = false
    }
  }, [])
  // 結果が届いたら、入口のそのボスの行もすぐ直す（倒したボスが、戻った瞬間に「挑戦中」の行で出ない・stateWithRunOf）
  const onOver = async () => {
    const r = await report()
    if (r?.ok) setState(s => stateWithRunOf(s, r.run))
    if (r) setFight(f => (f ? { ...f, result: r } : f))
    if (r?.reward) onProfile?.()   // EXP と Gold が増えた
  }
  const onEnded = () => setFight(f => (f ? { ...f, ended: true } : f))
  const giveUp = async () => {
    const r = await report()
    if (r?.ok) setState(s => stateWithRunOf(s, r.run))
    // やめた所で、ほかの人がもう倒していたら報酬画面へ（その場で報酬が入る）
    if (r?.ok && r.run.cleared) { setFight(f => (f ? { ...f, result: r } : f)); if (r.reward) onProfile?.(); return }
    setFight(null)
    if (r) setMsg(r.ok ? { ok: true, text: `挑戦をやめました（${r.damage.toLocaleString()}ダメージを入れた）` } : { ok: false, text: r.text })
    load()
  }
  // 戦っている途中で画面を離れたら、そこまでの量を送る
  useEffect(() => () => { report() }, [report])

  const encounter = enc.enc && <V2capBossEncounter key={enc.enc.id} bossKey={enc.enc.bossKey} diffKey={enc.enc.diffKey} out={enc.enc.out} onTap={enc.skip} />
  // 遭遇のイラストを押したのにサーバーの返事がまだ：見た目だけの戦闘（時計は動かない・押した記録も送らない・返事が来たら捨てる）
  const earlyOn = !!enc.enc?.early
  const earlyFight = useMemo(() => {
    if (!earlyOn) return null
    const { bossKey: boss, diffKey: diff, hp } = enc.enc
    const st = startTryAtb({ boss, diff, hp, seed: 0, snap: { prof, inv: inventory, at: Date.now() } })
    return st && { run: { boss, diff }, st, runKey: 0 }
  }, [earlyOn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (earlyOn) window.scrollTo(0, 0) }, [earlyOn])

  const stam =state?.stamina ?? prof?.stamina ?? 0
  const runs = state?.runs || []
  const active = runs.filter(r => !r.cleared && msLeftOf(r.ends_at, nowMs) > 0)
  const ownActive = active.some(r => r.mine)
  // きょうこのボスを呼んだか（SQL をまだ流していないサーバーは全部まとめて1回）
  const summonedOf = (key) => (state?.summoned_bosses ? state.summoned_bosses.includes(key) : !!state?.summoned_today)
  const blockOf = (key) => summonBlockOf(key, { summoned: summonedOf(key), ownActive, reached })

  const popup = pick && (
    <V2capBossPick bossKey={pick.boss} run={pick.run} reached={reached} myPower={myPower} block={state ? blockOf(pick.boss) : '読み込み中...'}
      cost={pick.run ? tryStaminaOf(pick.run.mine, pick.run.my_tries) : 0} stam={stam} busy={busy}
      prof={prof} onProfile={onProfile} onGo={onGo} saveRef={loadoutSave} onStart={startPick} onClose={closePick} />
  )

  // ===== 入口で受け取った報酬 =====
  if (claimed) {
    return <V2capBossReward bossKey={claimed.run.boss} diffKey={claimed.run.diff} cls={prof?.class} result={{ ok: true, ...claimed }}
      onBack={() => { setClaimed(null); window.scrollTo(0, 0) }} />
  }

  // ===== 戦闘 =====
  const shown = earlyFight || fight
  if (shown) {
    const r = shown.result
    const boss = DUNGEON_BOSSES[shown.run.boss]
    // 結果の画面：決着のテロップが終わったら（討伐も負けも時間切れも）。やめた所でもう倒されていたら、すぐ
    if (shown.ended || (!shown.st.over && r?.ok && r.run.cleared)) {
      const canRetry = r?.ok && !r.run.cleared && msLeftOf(r.run.ends_at, nowMs) > 0
      return <>
        {encounter}
        {popup}
        <V2capBossReward bossKey={fight.run.boss} diffKey={fight.run.diff} cls={prof?.class} st={fight.st} result={r} busy={busy}
          leftText={r?.ok && !r.run.cleared ? mmss(msLeftOf(r.run.ends_at, nowMs)) : null}
          onRetry={canRetry ? () => openPick(fight.run.boss, { ...fight.run, ...r.run }) : null} retryCost={canRetry ? tryStaminaOf(r.run.mine, r.run.my_tries) : 0}
          onBack={() => { setFight(null); load(); window.scrollTo(0, 0) }} />
      </>
    }
    return <>
      {encounter}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#ff8866', fontSize:'12px', marginBottom:'6px' }}>
          {boss.name}（{diffOf(shown.run.boss, shown.run.diff)?.label}）
        </div>
        <V2capAtbFight st={shown.st} runKey={shown.runKey} macros={macros} playerSrc={playerSrc} playerMotion={playerMotion}
          bossArt={artOfBoss(shown.run.boss)} onOver={onOver} onEnded={onEnded} hold={enc.hold}
          footer={earlyFight || shown.st.over ? null
            : <button onClick={giveUp} style={{ ...miniBtn('#ff8888'), flex:1, padding:'8px' }}>挑戦をやめる（ここまでの削りを入れる）</button>} />
      </div>
    </>
  }

  // ===== 入口 =====
  return <>
    {encounter}
    {popup}
    <div>
      {msg && <div style={{ fontSize:'11px', marginBottom:'8px', color: msg.ok ? '#88ffaa' : '#ff8888' }}>{msg.text}</div>}
      {!state && !msg && <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'8px' }}>読み込み中...</div>}
      {stale && <V2capReloadNote />}

      {/* 受け取っていない報酬（自分が挑戦していないあいだに倒れたボス） */}
      {(state?.rewards || []).map(run => (
        <div key={run.id} style={{ ...box, padding:'10px', marginBottom:'10px', borderColor:'#8a6a2a', display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <span style={{ flex:1, minWidth:'60%', fontSize:'12px' }}>
            <b style={{ color: DIFF_COLOR[run.diff] }}>［{diffOf(run.boss, run.diff)?.label}］</b> <span style={{ color:'#ff8866' }}>{DUNGEON_BOSSES[run.boss]?.name}</span>
            <span style={{ color:'#ffd27a', fontSize:'10px' }}>　報酬があります</span>
          </span>
          <button onClick={() => claim(run)} disabled={busy} style={{ ...miniBtn('#ffd27a'), padding:'8px 12px', whiteSpace:'nowrap' }}>🎁 報酬を受け取る</button>
        </div>
      ))}

      {/* 入っているボス（挑戦中・救援）。倒した・時間切れのボスは出さない */}
      {active.map(run => {
        const left = msLeftOf(run.ends_at, nowMs)
        const d = diffOf(run.boss, run.diff)
        const cost = tryStaminaOf(run.mine, run.my_tries)
        return (
          <div key={run.id} style={{ ...box, padding:'10px', marginBottom:'10px', borderColor: run.mine ? '#aa4433' : '#336699' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', flexWrap:'wrap', fontSize:'12px' }}>
              <span>
                <b style={{ color: DIFF_COLOR[run.diff] }}>［{d?.label}］</b> <span style={{ color:'#ff8866' }}>{DUNGEON_BOSSES[run.boss]?.name}</span>
                <span style={{ color: TEXT.label, fontSize:'10px' }}>　{run.mine ? '挑戦中' : `${run.owner}さんの救援`}</span>
              </span>
              <span style={{ color: left < 10 * 60000 ? '#ff8866' : TEXT.body }}>残り {mmss(left)}</span>
            </div>
            {/* ボスのHPは数字を出さない＝バーだけ */}
            <div style={{ fontSize:'10px', color: TEXT.label, margin:'4px 0 2px' }}>HP</div>
            <Bar pct={(run.hp / run.hp_max) * 100} color="#cc3344" />
            <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px', fontSize:'10px', color: TEXT.sub, margin:'6px 0' }}>
              {run.members.map(m => (
                <span key={m.name} style={{ color: m.me ? '#88ccff' : TEXT.sub }}>
                  {m.owner ? '👑' : '🤝'}{m.name}：{Number(m.damage).toLocaleString()}（貢献度{contributionPctOf(m.damage, run.hp_max).toFixed(1)}%・{m.tries}回）
                </span>
              ))}
            </div>
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
              <button onClick={() => openPick(run.boss, run)} disabled={busy || stam < cost} style={{ ...miniBtn('#ff8866'), flex:1, padding:'8px' }}>
                ⚔ 挑戦する（スタミナ{cost}）
              </button>
              {/* 救援信号は1回挑戦してから（ユーザー選択「信号を出す人の条件」・サーバーも見る） */}
              {run.mine && !run.rescue_open && (run.my_tries > 0
                ? <button onClick={() => rescue(run)} disabled={busy} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>📣 救援信号を出す</button>
                : <span style={{ color: TEXT.label, fontSize:'10px', alignSelf:'center' }}>1回挑戦すると救援信号を出せます</span>)}
              {run.mine && run.rescue_open && <span style={{ color:'#44ddff', fontSize:'10px', alignSelf:'center' }}>📣 救援信号を出しています（{run.members.length - 1}/{HELPERS_MAX}人）</span>}
            </div>
            {stam < cost && <div style={{ color:'#ff8888', fontSize:'10px', marginTop:'4px' }}>スタミナが足りません</div>}
          </div>
        )
      })}

      {/* カテゴリごとのボス（押すとポップアップ。もう入っているボスは続きから）。2026-11-05 の2列 → 11-06 に1列（顔のアップ）→ 同じ日 顔のアップの枠のまま2列（下） */}
      {CHALLENGE_CATS.map(cat => (
        <div key={cat.key} style={{ ...box, padding:'10px', marginBottom:'10px' }}>
          {/* 【確定】2026-11-06 ユーザー「四凶のところ、ちょっとアイコン？バナーみたいなの差し込みたい」→選んだ「見出しの帯」：ホームの見出しと同じ帯（lib/menuHead.js の CAT_HEAD_DEFS）。
              絵が届くまでは今までどおり文字だけ */}
          {cat.head && menuHeadReady(cat.head) ? <MenuHead head={cat.head} title={cat.label} />
            : <div style={{ color:'#ff8866', fontSize:'13px', fontWeight:'bold', marginBottom:'8px' }}>{cat.label}</div>}
          {/* 【確定】2026-11-06 ユーザー「一旦1列に戻して、ここの部分は顔付近だけ表示されるようにして※クラスの顔アイコンみたいな感じ」：
              1つの枠は 左に顔のアップ（BossFace）・名前と挑戦できるか。ボスの色の背景（bossCardBg）はそのまま
              → 同じ日 ユーザー「ここ同じ高さで2列にして」：この枠のまま2列の格子に。全部の枠を同じ高さ（gridAutoRows:'1fr'＝名前や言葉が折れて高くなる枠があっても、ほかの行の枠もそろう）。
              スマホの幅では名前が2行になる＝漢字からカタカナに変わる所だけで折る（bossNamePartsOf・keep-all＋wbr・それでも入らないとても細い幅は語の中で折る＝anywhere）。
              1列のときの右の › は外した（2列では名前の幅が足りず「雷鋼機神ゼルギア｜ス」と折れた・ホームの2列のボタンにも › は無い）。
              前の2列（2026-11-05）は 絵・名前・挑戦できるか を上から並べた背の高い枠だった */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gridAutoRows:'1fr', gap:'6px' }}>
            {cat.bosses.map(key => {
              const boss = DUNGEON_BOSSES[key]
              return (
                <button key={key} onClick={() => openPick(key, active.find(r => r.mine && r.boss === key) || null)}
                  style={{ display:'flex', alignItems:'center', gap:'6px', width:'100%', minWidth:0, boxSizing:'border-box', padding:'6px', ...bossCardBg(bossTintOf(key)), cursor:'pointer', textAlign:'left' }}>
                  <BossFace bossKey={key} />
                  <span style={{ flex:1, minWidth:0 }}>
                    <b style={{ color:'#ff8866', fontSize:'13px', wordBreak:'keep-all', overflowWrap:'anywhere' }}>
                      {bossNamePartsOf(boss.name).map((p, i) => <span key={i}>{i > 0 && <wbr />}{p}</span>)}
                    </b><br />
                    <span style={{ color: TEXT.label, fontSize:'10px' }}>{state && (blockOf(key) || '挑戦可能')}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* 救援の一覧 */}
      <div style={{ ...box, padding:'10px' }}>
        <div style={{ color:'#44ddff', fontSize:'12px', marginBottom:'6px' }}>
          救援の一覧 <span style={{ color: TEXT.label, fontSize:'10px' }}>（入ると、挑むたびにスタミナ{STAMINA_HELPER}）</span>
        </div>
        {!(state?.rescues || []).length && <div style={{ color: TEXT.empty, fontSize:'10px' }}>いまは救援信号が出ていません</div>}
        {(state?.rescues || []).map(run => (
          <div key={run.id} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 0', borderTop:'1px solid #001428', fontSize:'10px' }}>
            <b style={{ color: DIFF_COLOR[run.diff], flexShrink:0 }}>{diffOf(run.boss, run.diff)?.label}</b>
            <span style={{ flex:1, minWidth:0, color: TEXT.sub }}>
              <span style={{ color:'#ff8866' }}>{DUNGEON_BOSSES[run.boss]?.name}</span>・{run.owner}さん・<span style={{ whiteSpace:'nowrap' }}>HP <MiniBar pct={(run.hp / run.hp_max) * 100} /></span>・残り {mmss(msLeftOf(run.ends_at, nowMs))}・{run.members.length}/{HELPERS_MAX + 1}人
            </span>
            <button onClick={() => join(run)} disabled={busy} style={{ ...miniBtn('#44ddff'), padding:'6px 10px' }}>救援に入る</button>
          </div>
        ))}
      </div>

      {dev && (
        <button onClick={resetTries} disabled={busy} style={{ ...miniBtn(DEV), width:'100%', padding:'8px', marginTop:'10px' }}>🧪 きょうの挑戦回数を戻す［開発］</button>
      )}
    </div>
  </>
}
