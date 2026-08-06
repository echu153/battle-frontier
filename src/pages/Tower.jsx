// ============================================================
// エンドレスタワー
// ------------------------------------------------------------
// ・2026-08-04 一般公開。解放条件はキャラクターLV1000（サーバ側 tower_can_enter() が権威）
// ・入口は街メニューの「⚔ 挑戦」→「🗼 エンドレスタワー」（/tower の独立ページ）
// ・内部推奨戦闘力は開発上の目安であり、画面には出さない
// ============================================================
import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveStats } from '../lib/stats'
import { petPlayerBonus } from '../constants/pets'
import { loadCharmBonus, PET_STAT_SELECT } from '../lib/petBonus'
import { selectBattleSkillSets, pickTargetMode, TARGET_MODES } from '../lib/loadout'
import { BattleLogLine, effWait } from './Game'
import {
  getFloor, MAX_IMPLEMENTED_FLOOR, OPEN_MAX_FLOOR, BOSS_RUN_STAGES,
  TREE_NODES, TREE_LINES, TREE_MAX_STEPS, stepPctOf,
  maxStepsAt, nextUnlock, treeSpent, treeResetCost,
  MID_BOSS_RATE, isMonumentFloor, RUN_POTION_LIMIT, makeEnemy, floorPowerOf,
} from '../lib/tower'
import { simulateTowerBattle, buildStageEnemies, buildSortieEnemies, towerTreeEffects } from '../lib/towerBattle'
import { simulateAll } from '../lib/towerSim'

const fmt = (n) => Number(n || 0).toLocaleString()
const floorLabel = (n) => `${n}層`   // 分類名は「戦闘エリア」、個々は「N層」と呼ぶ

// 通信がハングしても「戦闘中...」で固まらないようにする
const withTimeout = (promise, ms = 15000) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const C = {
  bg: '#050810', panel: '#0b1020', line: '#26355c', text: '#9fb6e0',
  dim: '#5f7099', accent: '#7fd4ff', gold: '#ffcc66', ok: '#66dd99', ng: '#ff6688',
}

// ⚠以下のコンポーネントは Tower() の中で定義しないこと。
//   中で定義すると状態が変わるたびに型が変わり、中身が丸ごと作り直されて
//   プルダウンのフォーカスやスクロール位置が飛ぶ。

// HP/MPのバー（連戦の持ち越し表示に使う）
function StatBar({ label, cur, max, color, track }) {
  const pct = Math.max(0, Math.min(100, (cur / Math.max(1, max)) * 100))
  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#b8d0e8', gap: '4px' }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 'bold', flexShrink: 0 }}>{fmt(Math.max(0, cur))} / {fmt(max)}</span>
      </div>
      <div style={{ background: track, height: '6px', border: `1px solid ${C.line}` }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,#0a3,${color})` }} />
      </div>
    </div>
  )
}

// エンドポイントの説明文。全部同じ色だと読みにくいので、
//  1文目＝何が上がるか（明るい色）／2文目以降＝どこで効くかの補足（暗い色）
//  文中の「N層」だけ金色にして、対象の層をひと目で拾えるようにする
function NodeDesc({ text }) {
  const parts = String(text || '').split('。').filter(s => s.length > 0)
  const paint = (s) => s.split(/(\d+層)/).map((seg, j) => (
    /^\d+層$/.test(seg)
      ? <span key={j} style={{ color: C.gold }}>{seg}</span>
      : <span key={j}>{seg}</span>
  ))
  return (
    <div style={{ marginTop: '3px', fontSize: '10px', lineHeight: '1.6' }}>
      {parts.map((p, i) => (
        <div key={i} style={{ color: i === 0 ? '#9fb6e0' : C.dim }}>
          {i > 0 && <span style={{ color: '#3f5a86' }}>└ </span>}
          {paint(p)}
        </div>
      ))}
    </div>
  )
}

// 戦闘ログ。通常の出撃では画面を切り替えず、出撃パネルの下にそのまま出す
function BattleLog({ logs, busy, endRef }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, background: '#05070f', padding: '10px', maxHeight: '34vh', overflowY: 'auto', fontSize: '11px', lineHeight: '1.8' }}>
      {logs.length === 0 && !busy && <div style={{ color: C.dim }}>まだ戦っていません。</div>}
      {logs.map((l, i) => <BattleLogLine key={i} l={l} />)}
      <div ref={endRef} />
    </div>
  )
}

// 戦闘結果（出撃・連戦の両方で使う）
function ResultBox({ gain }) {
  if (!gain) return null
  return (
    <div style={{ border: `1px solid ${gain.win ? C.ok : C.ng}`, background: C.panel, padding: '10px', marginTop: '8px', fontSize: '11px', color: C.text, lineHeight: '1.9' }}>
      {gain.cleared ? (
        <>
          <div style={{ color: C.gold, fontSize: '13px' }}>👑 {gain.floor}層のエリアボスを撃破！</div>
          {gain.firstClear && <div style={{ color: C.ok }}>このエリアを初めて踏破した！ 次のエリアが解放された。</div>}
          {gain.monument && <div style={{ color: C.gold }}>🗿 石碑に名前が刻まれた！（サーバー最初の踏破者）</div>}
          <div>Gold +{fmt(gain.gold)} ／ EXP +{fmt(gain.exp)} ／ エンドEXP +{fmt(gain.towerExp)}</div>
        </>
      ) : gain.win === false ? (
        <div style={{ color: C.ng }}>敗北…{gain.stageLabel ? `（${gain.stageLabel}）` : ''}{gain.stageLabel ? ' 連戦は最初からやり直しになります。' : ''}</div>
      ) : gain.stageLabel ? (
        <>
          <div style={{ color: C.ok }}>{gain.stageLabel} を突破！</div>
          <div>残り HP {fmt(gain.hp)} ／ MP {fmt(gain.mp)}</div>
        </>
      ) : (
        <>
          <div style={{ color: C.ok }}>勝利！ Gold +{fmt(gain.gold)} ／ EXP +{fmt(gain.exp)} ／ エンドEXP +{fmt(gain.towerExp)}</div>
          {gain.mid && !gain.midCleared && <div style={{ color: C.ng }}>強敵が現れたが、退けられた…</div>}
          {gain.midCleared && (
            <div style={{
              border: `2px solid ${C.gold}`, background: '#1a1400', padding: '12px',
              marginTop: '8px', textAlign: 'center', lineHeight: '1.7',
            }}>
              <div style={{ color: C.gold, fontSize: '18px', letterSpacing: '2px' }}>⚔ 強敵 撃破！</div>
              <div style={{ color: '#ffe9a8', fontSize: '13px', marginTop: '4px' }}>
                エリアボスへの道が開かれた
              </div>
              <div style={{ color: C.dim, fontSize: '10px', marginTop: '6px' }}>
                下の「🗼 エリアボスに挑む」から挑戦できます
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ページのガワ（ヘッダ＋街に戻る）
function Shell({ nav, children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '12px', fontFamily: 'monospace' }}>
      {/* index.css の #root に text-align:center があるので、ここで左揃えに戻す。
          中央寄せしたい所（読み込み中・エリアボスの立ち絵など）は個別に指定している */}
      <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.line}`, paddingBottom: '8px', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 30, paddingTop: '8px', background: C.bg }}>
          <div style={{ color: C.accent, fontSize: '16px', letterSpacing: '3px' }}>🗼 エンドレスタワー</div>
          <button onClick={() => nav('/game')} style={{ background: 'none', border: `1px solid ${C.line}`, color: C.text, padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>🏰 街に戻る</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Tower() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [status, setStatus] = useState(null)
  const [tab, setTab] = useState('floors')       // floors | tree | monument（到達エリアランキングは /ranking のタブへ）
  const [scene, setScene] = useState('lobby')    // lobby | battle
  const [selFloor, setSelFloor] = useState(1)
  const [logs, setLogs] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [gain, setGain] = useState(null)
  const [runInfo, setRunInfo] = useState(null)   // { floor, stage, hp, mp, hpMax, mpMax, done }
  const [monument, setMonument] = useState(null)
  const [treeDraft, setTreeDraft] = useState(null)
  const [imgFail, setImgFail] = useState({})   // 画像が無い層は文字だけに戻す
  const [bossShot, setBossShot] = useState(null)   // 立ち絵を出す層（エリアボス戦を表示している間だけ入る）
  // 開発用のテスト対戦（is_admin限定）。相手を選んで1戦だけ試す
  const [devFloor, setDevFloor] = useState(1)
  const [devTarget, setDevTarget] = useState('boss')
  // 全上位職の一括シミュレーション（開発用）
  const [simRows, setSimRows] = useState(null)
  const [simBusy, setSimBusy] = useState(false)
  const [simProgress, setSimProgress] = useState('')
  const [simFrom, setSimFrom] = useState(5)
  const [simTo, setSimTo] = useState(7)
  const [simTries, setSimTries] = useState(10)
  const [targetOptions, setTargetOptions] = useState([])   // 狙う相手（スキル設定画面で決める）
  const [playerItem, setPlayerItem] = useState(null)       // 装備中のアイテム（タワーでも街と同じく使える）
  const logsEndRef = useRef(null)
  const floorPickedRef = useRef(false)   // 最前線への自動合わせは初回だけ
  const busyRef = useRef(false)          // 連打で二重に戦闘が走るのを防ぐ（stateは反映が1テンポ遅れる）
  const [remaining, setRemaining] = useState(0)  // 出撃のクールダウン残り秒
  const cdRef = useRef(null)

  useEffect(() => { init() }, [])

  // 出撃クールダウンのカウントダウン
  useEffect(() => {
    clearInterval(cdRef.current)
    if (remaining > 0) {
      cdRef.current = setInterval(() => {
        setRemaining(prev => { if (prev <= 0.2) { clearInterval(cdRef.current); return 0 } return prev - 0.2 })
      }, 200)
    }
    return () => clearInterval(cdRef.current)
  }, [remaining])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const [{ data: prof }, { data: eq }, { data: pr }, { data: ss }, { data: pi }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order'),
      supabase.from('player_items').select('*, items(*)').eq('player_id', user.id).eq('equipped', true).maybeSingle(),
    ])
    setPlayerItem(pi || null)
    if (!prof) { nav('/create'); return }
    let petCharm = null, petStat = null, activePet = null
    try {
      const { data: ap } = await supabase.from('pets').select(PET_STAT_SELECT).eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap) { activePet = ap; petStat = petPlayerBonus(ap); petCharm = await loadCharmBonus(ap) }
    } catch { /* ペット未導入なら無視 */ }
    let emblemAlloc = null
    try {
      const { data: em } = await supabase.from('player_emblem').select('alloc').eq('player_id', user.id).maybeSingle()
      if (em?.alloc && Object.keys(em.alloc).length > 0) emblemAlloc = em.alloc
    } catch { /* 紋章未導入なら無視 */ }
    setProfile({ ...prof, petCharm, petStat, activePet, emblemAlloc })
    setEquipment(eq || [])
    setProficiency(pr || [])
    setSkillSets(selectBattleSkillSets(ss, 'challenge'))
    try {
      const { data: opt } = await supabase.from('skill_set_options').select('set_type, target_mode').eq('player_id', user.id)
      setTargetOptions(opt || [])
    } catch { /* 未適用なら初期値(上から順番) */ }
    if (prof.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).single()
      setAbilityTitle(at || null)
    }
    await fetchStatus()
  }

  const fetchStatus = async () => {
    const { data, error } = await supabase.rpc('get_tower_status')
    if (error) { setStatus({ error: 'SQL未実行の可能性があります（supabase_tower.sql）' }); return }
    setStatus(data)
    if (data && !data.error) {
      // 選んでいる戦闘エリアは保つ。初回だけ最前線（まだエリアボスを倒していない一番手前のエリア）に合わせる。
      // 毎回上書きすると、踏破済みのエリアを周回しているときに勝手に飛ばされる。
      if (!floorPickedRef.current) {
        floorPickedRef.current = true
        const next = (data.floors || []).find(f => f.unlocked && !f.boss_cleared)
        setSelFloor(next ? next.floor : Math.min(OPEN_MAX_FLOOR, (data.max_floor || 0) + 1) || 1)
      }
      // 残りクールダウンはサーバーが秒数で返したものをそのまま使う。
      // ⚠端末の時計とサーバーの時刻を突き合わせてはいけない。
      //   端末が数秒進んでいると「出撃可能」と誤表示され、押した先でサーバーに弾かれる。
      if (data.cd_left != null) {
        const left = Number(data.cd_left)
        if (Number.isFinite(left) && left > 0) setRemaining(left)
      }
      if (data.run) {
        setRunInfo({ floor: data.run.floor, stage: data.run.stage, hp: Number(data.run.hp), mp: Number(data.run.mp), potionUsed: Number(data.run.potion || 0), resumed: true })
      } else {
        setRunInfo(null)
      }
      // 戦闘の結果を返さないまま離脱した連戦は、サーバー側で失敗として畳まれている
      if (data.run_dropped) setMsg('前の戦闘が中断されたため、連戦は最初からになります。')
    }
  }

  const buildEff = () => calcEffectiveStats(profile, equipment, proficiency, abilityTitle)

  // 使い切りアイテムを消費したらDBの数量を減らす（街の出撃と同じ）。
  // 無限ポーションは消費しないので何もしない。
  const consumeItem = async () => {
    const it = playerItem
    if (!it?.items) return
    const eff = it.items.effect
    if (eff === 'hp_pct_infinite' || eff === 'mp_pct_infinite') return
    const newQty = (it.quantity || 1) - 1
    try {
      if (newQty <= 0) {
        await supabase.from('player_items').delete().eq('id', it.id).gt('quantity', 0)
        setPlayerItem(null)
      } else {
        await supabase.from('player_items').update({ quantity: newQty }).eq('id', it.id).gte('quantity', it.quantity)
        setPlayerItem({ ...it, quantity: newQty })
      }
    } catch { /* 失敗しても戦闘結果は確定させる */ }
  }

  // 街の出撃と同じ排他（釣り／かかし／ペットダンジョン）。
  // 権威はサーバー側の各RPCだが、戦闘を回す前に弾いて空振りを防ぐ。
  const idleBlocked = async () => {
    try {
      const { data } = await withTimeout(supabase.rpc('tower_can_act'), 8000)
      if (data?.error) { setMsg(data.error); setScene('lobby'); return true }
    } catch { /* 通信不調ならサーバー側の判定に任せる */ }
    return false
  }

  const treeAlloc = status?.tree_alloc || {}
  // 狙う相手はスキル設定画面の「挑戦」セットの設定に従う（タワーは挑戦セットを使うため）
  const targetMode = pickTargetMode(targetOptions, 'challenge')
  const tr = towerTreeEffects(treeAlloc)
  // 連戦のHP/MPバー用の最大値。runInfo には再開時に入っていないことがあるので
  // プレイヤーの実効ステから毎回出す（エンドポイントの最大HP+も乗せる）
  const runMax = useMemo(() => {
    if (!profile) return { hp: 1, mp: 1 }
    const e = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
    return { hp: Math.floor(e.hp_max * tr.hpMult), mp: e.mp_max }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, equipment, proficiency, abilityTitle, tr.hpMult])
  // 出撃クールダウン（街の出撃と同じ effWait・アンカーも last_action_at を共有）
  const sortieWait = profile ? effWait(profile) : 20
  const canSortie = remaining <= 0 && !busy
  const timerPct = Math.min(100, ((sortieWait - remaining) / sortieWait) * 100)

  // ── 出撃（雑魚1体・HP/MP満タン） ──────────────────────────
  const doSortie = async (floor) => {
    if (busy || busyRef.current || remaining > 0) return
    const fd = getFloor(floor)
    if (!fd) return
    busyRef.current = true
    // 通常の出撃は画面を切り替えない。街の出撃と同じく、この画面の下にログを出す
    setBusy(true); setLogs([]); setMsg(null); setGain(null)
    try {
      if (await idleBlocked()) return
      // ★2026-08-04: クールダウンの確保はサーバー(tower_sortie_result)が条件付きUPDATEで行う。
      //   ここでの先行UPDATEは、改造クライアントが好きな基準時刻を送れば素通りできたので廃止した。
      //   下のタイマーは表示用（サーバーが弾いたら残り秒を戻す）。
      const fp = (status.floors || []).find(f => f.floor === floor)
      const midOpen = !!fp && !fp.mid_defeated && fp.sortie_count >= fp.need
      const { enemies, isMid } = buildSortieEnemies(fd, midOpen ? MID_BOSS_RATE : 0)
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode, playerItem,
      })
      setLogs(res.logs)
      // Gold・EXPはサーバーが決める（クライアントからは申告しない）
      const { data, error } = await withTimeout(supabase.rpc('tower_sortie_result', {
        p_floor: floor, p_won: res.win, p_mid_defeat: isMid && res.win,
      }))
      // ★アイテムの消費はサーバーが結果を受け付けてから。
      //   先に消すと、クールダウン等で弾かれたときに使い切りアイテムだけ失われる。
      if (!error && !data?.error && res.itemUsed) await consumeItem()
      if (error || data?.error) {
        setMsg(data?.error || error?.message || '結果の反映に失敗しました')
        // サーバーがクールダウンで弾いた場合は、残り時間を丸ごと待たせる（報酬も入らない）
        if (data?.cooldown) { setLogs([]); setRemaining(Math.max(1, Number(data.retry_after) || sortieWait)) }
      } else {
        setRemaining(data.wait || sortieWait)
        setProfile(p => ({ ...p, last_action_at: new Date().toISOString() }))
        setGain({ win: res.win, gold: data.gold, exp: data.exp, towerExp: data.tower_exp, count: data.sortie_count, need: data.need, mid: isMid, midCleared: isMid && res.win })
        await withTimeout(fetchStatus())
      }
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '戦闘処理でエラーが発生しました。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // ── エリアボス連戦：開始 ──────────────────────────────────────────
  const startRun = async (floor) => {
    if (busy || busyRef.current) return
    busyRef.current = true
    setBusy(true); setMsg(null); setGain(null); setLogs([])
    try {
      if (await idleBlocked()) return
      const eff = buildEff()
      const hpMax = Math.floor(eff.hp_max * tr.hpMult)
      const { data, error } = await withTimeout(supabase.rpc('tower_run_start', { p_floor: floor, p_hp: hpMax, p_mp: eff.mp_max }))
      if (error || data?.error) { setMsg(data?.error || error?.message || '連戦を開始できませんでした'); return }
      setBossShot(null)
      setRunInfo({ floor, stage: 0, hp: hpMax, mp: eff.mp_max, potionUsed: 0 })
      setScene('battle')
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '開始処理でエラーが発生しました。')
    } finally { busyRef.current = false; setBusy(false) }
  }

  // ── エリアボス連戦：1戦ぶん進める ─────────────────────────────────
  const runStage = async () => {
    if (busy || busyRef.current || !runInfo) return
    const fd = getFloor(runInfo.floor)
    if (!fd) return
    busyRef.current = true
    setBusy(true); setLogs([]); setMsg(null); setGain(null)
    try {
      // 連戦の途中でも毎戦チェックする（別端末で釣りを始める等の抜け道を塞ぐ）
      if (await idleBlocked()) return
      // ★2026-08-04: 戦闘の開始をサーバーに宣言してから戦う。
      //   結果を返さずに離脱した連戦は、次に開こうとした時点で失敗になる。
      {
        const { data: bg, error: bgErr } = await withTimeout(supabase.rpc('tower_run_begin'))
        if (bgErr || bg?.error) {
          setMsg(bg?.error || bgErr?.message || '連戦を続行できませんでした')
          if (bg?.aborted) { setRunInfo(null); setScene('lobby'); setBossShot(null) }
          await withTimeout(fetchStatus())
          return
        }
      }
      const stage = runInfo.stage
      // 立ち絵はエリアボス戦の間だけ出す。強敵を倒した直後に次がボスでも、まだ出さない
      setBossShot(BOSS_RUN_STAGES[stage]?.kind === 'boss' ? runInfo.floor : null)
      const enemies = buildStageEnemies(fd, stage)
      // アイテムは街の出撃と同じく「1戦闘に1個」。連戦の各戦で使える（使うたび在庫は減る）
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode,
        startHp: runInfo.hp, startMp: runInfo.mp, playerItem,
        potionUsed: runInfo.potionUsed || 0, potionLimit: RUN_POTION_LIMIT,
      })
      setLogs(res.logs)
      if (!res.win) {
        await withTimeout(supabase.rpc('tower_run_abort'))
        if (res.itemUsed) await consumeItem()
        setRunInfo(null)
        setGain({ win: false, stageLabel: BOSS_RUN_STAGES[stage].label })
        await withTimeout(fetchStatus())
        return
      }
      if (stage >= BOSS_RUN_STAGES.length - 1) {
        // Gold・EXPはサーバーが決める（クライアントからは申告しない）
        const { data, error } = await withTimeout(supabase.rpc('tower_boss_clear', { p_floor: runInfo.floor }))
        if (error || data?.error) { setMsg(data?.error || error?.message || '撃破の反映に失敗しました'); return }
        if (res.itemUsed) await consumeItem()
        setRunInfo(null)
        setGain({ win: true, cleared: true, floor: runInfo.floor, gold: data.gold, exp: data.exp, towerExp: data.tower_exp, firstClear: data.first_clear, monument: data.monument })
        await withTimeout(fetchStatus())
        return
      }
      const { data, error } = await withTimeout(supabase.rpc('tower_run_save', { p_stage: stage + 1, p_hp: res.hp, p_mp: res.mp, p_potion: res.potionUsed }))
      if (error || data?.error) { setMsg(data?.error || error?.message || '進行の保存に失敗しました'); return }
      if (res.itemUsed) await consumeItem()
      setRunInfo({ ...runInfo, stage: stage + 1, hp: res.hp, mp: res.mp, hpMax: res.hpMax, mpMax: res.mpMax, potionUsed: res.potionUsed })
      setGain({ win: true, stageLabel: BOSS_RUN_STAGES[stage].label, hp: res.hp, mp: res.mp, hpMax: res.hpMax, mpMax: res.mpMax })
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '戦闘処理でエラーが発生しました。')
    } finally { busyRef.current = false; setBusy(false) }
  }

  // ── 開発用：相手を選んで1戦だけ試す ──────────────────────
  //   ローカルで戦闘を回すだけ。RPCは呼ばず、報酬・進行・クールダウンに一切触らない。
  const devFight = () => {
    if (busy || busyRef.current) return
    const fd = getFloor(devFloor)
    if (!fd) return
    busyRef.current = true
    setBusy(true); setLogs([]); setMsg(null); setGain(null)
    try {
      let enemies
      const fp = floorPowerOf(devFloor)   // 層ごとの係数。本番と同じ強さでテストする
      if (devTarget === 'boss') enemies = buildStageEnemies(fd, BOSS_RUN_STAGES.length - 1)
      else if (devTarget === 'mid') enemies = [makeEnemy(fd.midBoss, { isBoss: true, floorPower: fp })]
      else if (devTarget === 'mobs3') enemies = buildStageEnemies(fd, 3)
      else enemies = [makeEnemy(fd.enemies[Number(devTarget)] || fd.enemies[0], { floorPower: fp })]
      setBossShot(devTarget === 'boss' ? devFloor : null)
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode, playerItem,
      })
      setLogs(res.logs)
      setGain({ win: res.win, gold: 0, exp: 0, towerExp: 0, dev: true })
      setScene('battle')
    } finally { busyRef.current = false; setBusy(false) }
  }

  // ── 開発用：全上位職を再修練5のスキルセットで回して突破率を出す ──────
  //   ⚠自分（おれおれお）の実効ステータス・装備・紋章・ペット・エンドポイントを
  //     そのまま使う。クラスとスキルの対応は skills テーブルから読む。
  //     模擬プレイヤーで測っても実態と合わないので、ここで実データを使う。
  const runSim = async () => {
    if (simBusy) return
    setSimBusy(true); setSimRows(null); setSimProgress('準備中...')
    try {
      const from = Math.max(1, Math.min(MAX_IMPLEMENTED_FLOOR, simFrom))
      const to = Math.max(from, Math.min(MAX_IMPLEMENTED_FLOOR, simTo))
      const floors = []
      for (let i = from; i <= to; i++) floors.push(i)
      const rows = await simulateAll({
        supabase, eff: buildEff(), equipment, profile,
        tree: treeAlloc, targetMode, playerItem,
        floors, tries: simTries,
        onProgress: (done, total, cls, floor) => setSimProgress(`${done}/${total}  ${cls} / ${floorLabel(floor)}`),
      })
      setSimRows({ rows, floors })
      setSimProgress('')
    } catch (e) {
      setSimProgress('失敗: ' + (e?.message || e))
    } finally { setSimBusy(false) }
  }

  const abortRun = async () => {
    if (!window.confirm('連戦を中断します。HPは回復せず、次はまた1戦目からになります。よろしいですか？')) return
    await supabase.rpc('tower_run_abort')
    setRunInfo(null); setScene('lobby'); setLogs([]); setGain(null); setBossShot(null)
    await fetchStatus()
  }

  const openMonument = async () => {
    setTab('monument')
    if (monument) return
    const { data } = await supabase.rpc('get_tower_monument')
    setMonument(data || [])
  }

  // ── ツリー ─────────────────────────────────────────────────
  const draft = treeDraft || treeAlloc
  const draftSpent = treeSpent(draft)
  const towerLv = status?.tower_lv || 1
  const maxSteps = maxStepsAt(towerLv)
  const remainPt = towerLv - draftSpent

  const bump = (key, d) => {
    const cur = draft[key] || 0
    const next = Math.max(0, Math.min(Math.min(maxSteps, TREE_MAX_STEPS), cur + d))
    if (d > 0 && remainPt <= 0) return
    setTreeDraft({ ...draft, [key]: next })
  }
  const saveTree = async () => {
    const clean = {}
    for (const k of Object.keys(draft)) if (draft[k] > 0) clean[k] = draft[k]
    const { data, error } = await supabase.rpc('tower_tree_set', { p_alloc: clean })
    if (error || data?.error) { setMsg(data?.error || error?.message || '保存に失敗しました'); return }
    setTreeDraft(null); setMsg(null)
    await fetchStatus()
  }
  const resetTree = async () => {
    const cost = treeResetCost(towerLv)
    if (!window.confirm(`${fmt(cost)}G を支払って振り直します。よろしいですか？`)) return
    const { data, error } = await supabase.rpc('tower_tree_reset')
    if (error || data?.error) { setMsg(data?.error || error?.message || '振り直しに失敗しました'); return }
    setTreeDraft(null)
    await fetchStatus()
  }


  // ============================================================
  if (!profile || !status) {
    return <div style={{ color: C.accent, textAlign: 'center', marginTop: '30vh', fontFamily: 'monospace' }}>読み込み中...</div>
  }
  if (status.error) {
    return (
      <Shell nav={nav}>
        <div style={{ padding: '20px', color: C.ng, textAlign: 'center', fontSize: '12px' }}>{status.error}</div>
      </Shell>
    )
  }

  const floors = status.floors || []
  const sel = floors.find(f => f.floor === selFloor)
  const fd = getFloor(selFloor)

  // ── 戦闘画面 ────────────────────────────────────────────────
  if (scene === 'battle') {
    const inRun = !!runInfo
    const stageLabel = inRun ? BOSS_RUN_STAGES[runInfo.stage]?.label : null
    return (
      <Shell nav={nav}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ color: C.accent, fontSize: '13px' }}>
            {floorLabel(inRun ? runInfo.floor : selFloor)}
            {inRun && <span style={{ color: C.gold, marginLeft: '8px' }}>エリアボスへの道 {runInfo.stage}/{BOSS_RUN_STAGES.length} 突破 ─ 次は {stageLabel}</span>}
          </div>
          {!busy && (
            <button onClick={() => { setScene('lobby'); setLogs([]); setGain(null); setBossShot(null) }} style={btn(C.dim)}>← 戻る</button>
          )}
        </div>

        {/* 立ち絵はエリアボスと戦っている間だけ。道中や強敵の結果画面では出さない（画像が無い層も出さない）
            ⚠サイズは「幅を基準・高さは上限」で指定すること。立ち絵は全部縦長（縦横比0.66〜0.93）なので
            maxHeightだけで縛ると高さが先に決まって横幅が25vh前後にしかならず、枠の半分も使えない。
            objectFit:contain なので高さの上限に当たっても歪まない。下のログ枠(34vh)と合わせて86vh。 */}
        {bossShot && !imgFail[bossShot] && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <img
              src={`/tou/${bossShot}sou.png`}
              alt={getFloor(bossShot)?.boss || ''}
              onError={() => setImgFail(s => ({ ...s, [bossShot]: true }))}
              style={{ width: '100%', maxHeight: '52vh', objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(127,212,255,0.25))' }}
            />
            <div style={{ color: C.gold, fontSize: '12px', marginTop: '2px' }}>
              {getFloor(bossShot)?.boss}
            </div>
          </div>
        )}

        {inRun && (
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '8px 10px', marginBottom: '8px', fontSize: '11px', color: C.text }}>
            <StatBar label="HP" cur={runInfo.hp} max={runMax.hp} color="#33dd66" track="#13243a" />
            <StatBar label="MP" cur={runInfo.mp} max={runMax.mp} color="#3a78d8" track="#11203a" />
            <div style={{ color: C.gold, marginTop: '6px' }}>
              🧪 無限ポーション 残り{Math.max(0, RUN_POTION_LIMIT - (runInfo.potionUsed || 0))}/{RUN_POTION_LIMIT}回
            </div>
            <div style={{ color: C.dim, fontSize: '10px', marginTop: '3px' }}>連戦の間、HP・MPは回復しません。中断してもこの状態から再開します。</div>
          </div>
        )}

        <BattleLog logs={logs} busy={busy} endRef={logsEndRef} />

        {msg && <div style={{ color: C.ng, fontSize: '11px', marginTop: '8px' }}>{msg}</div>}
        <ResultBox gain={gain} />

        <div style={{ marginTop: '10px' }}>
          {inRun && (
            <>
              <button onClick={runStage} disabled={busy} style={bigBtn(C.gold, busy)}>
                {busy ? '⏳ 戦闘中...' : `⚔ ${stageLabel} に挑む`}
              </button>
              <button onClick={abortRun} disabled={busy} style={btn(C.ng, busy)}>連戦を中断</button>
            </>
          )}
          {!inRun && (
            <button onClick={() => { setScene('lobby'); setLogs([]); setGain(null); setBossShot(null) }} style={bigBtn(C.accent)}>
              ← 戦闘エリアの選択へ戻る
            </button>
          )}
        </div>
      </Shell>
    )
  }

  // ── ロビー ──────────────────────────────────────────────────
  return (
    <Shell nav={nav}>
      {/* エンドレベル・タブ */}
      <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px 12px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ color: C.dim, fontSize: '11px' }}>進行状況</div>
          <div style={{ color: C.text, fontSize: '11px' }}>
            エンドレベル <span style={{ color: C.gold, fontSize: '14px' }}>{status.tower_lv}</span>
            <span style={{ color: C.dim, marginLeft: '8px' }}>{fmt(status.exp_in_lv)} / {fmt(status.exp_to_next)}</span>
          </div>
        </div>
        <div style={{ height: '4px', background: '#101830', marginTop: '6px' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (status.exp_in_lv / Math.max(1, status.exp_to_next)) * 100)}%`, background: C.accent }} />
        </div>
        <div style={{ color: C.dim, fontSize: '10px', marginTop: '5px' }}>
          到達 {status.max_floor > 0 ? floorLabel(status.max_floor) : '—'} ／ エンドポイント 残り {Math.max(0, status.tower_lv - (status.spent || 0))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('floors')} style={tabBtn(tab === 'floors')}>戦闘エリア</button>
        <button onClick={() => setTab('tree')} style={tabBtn(tab === 'tree')}>エンドポイント</button>
        <button onClick={openMonument} style={tabBtn(tab === 'monument')}>石碑</button>
        <button onClick={() => nav('/ranking')} style={tabBtn(false)}>到達エリア ↗</button>
      </div>

      {msg && <div style={{ color: C.ng, fontSize: '11px', marginBottom: '8px' }}>{msg}</div>}

      {/* ── エリア選択 ── */}
      {tab === 'floors' && (
        <>
          {runInfo && (
            <div style={{ border: `1px solid ${C.gold}`, background: '#181203', padding: '10px', marginBottom: '10px' }}>
              <div style={{ color: C.gold, fontSize: '12px' }}>⚔ {floorLabel(runInfo.floor)} の連戦が進行中（{runInfo.stage}/{BOSS_RUN_STAGES.length} 突破 ─ 次は {BOSS_RUN_STAGES[runInfo.stage]?.label}）</div>
              <div style={{ color: C.dim, fontSize: '10px', margin: '4px 0 8px' }}>HP {fmt(runInfo.hp)} ／ MP {fmt(runInfo.mp)} の状態から再開します。</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setScene('battle')} style={btn(C.gold)}>続きから</button>
                <button onClick={abortRun} style={btn(C.ng)}>中断する</button>
              </div>
            </div>
          )}

          {/* 調整で一時的に閉じている層があることを伝える */}
          {OPEN_MAX_FLOOR < MAX_IMPLEMENTED_FLOOR && (
            <div style={{ border: `1px solid ${C.gold}`, background: '#181203', padding: '10px', marginBottom: '10px', color: C.gold, fontSize: '11px', lineHeight: '1.7' }}>
              🔧 現在 <b>{floorLabel(OPEN_MAX_FLOOR)}まで</b>挑戦できます。<br />
              <span style={{ color: C.text }}>
                {floorLabel(OPEN_MAX_FLOOR + 1)}以降はエリアボスの強さを調整中のため、一時的に閉じています。
                これまでの進行状況はそのまま残ります。
              </span>
            </div>
          )}

          {/* 狙う相手（設定はスキル設定画面の「挑戦」セット側にある） */}
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: C.text, fontSize: '11px' }}>
              🎯 敵が複数のとき狙う相手: <span style={{ color: C.gold }}>{TARGET_MODES.find(m => m.key === targetMode)?.label}</span>
              <span style={{ color: C.dim, marginLeft: '6px' }}>（「🕯 挑戦」セットの設定）</span>
            </span>
            {/* ⚠set=challenge を必ず付ける。付けないとスキル設定は「出撃」セットで開き、
                そちらの狙い方を変えてもタワーには反映されない */}
            <button onClick={() => nav('/skills?set=challenge')} style={btn(C.dim)}>スキル設定で変更 ↗</button>
          </div>

          {/* 出撃パネル（街の出撃と同じ形：タイマー→エリア選択→大きな出撃ボタン） */}
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '12px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
              <span style={{ color: C.dim }}>次の行動まで</span>
              <span style={{ color: canSortie ? C.ok : C.gold }}>{canSortie ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}</span>
            </div>
            <div style={{ background: '#001028', height: '6px', border: '1px solid #002244', marginBottom: '10px' }}>
              <div style={{ height: '100%', width: `${timerPct}%`, background: canSortie ? C.ok : 'linear-gradient(90deg,#003366,#0088ff)', transition: 'width 0.2s' }} />
            </div>

            <select
              value={selFloor}
              onChange={e => setSelFloor(Number(e.target.value))}
              disabled={busy || !!runInfo}
              style={{
                width: '100%', background: '#001028', border: '1px solid #0044aa', color: '#88ccff',
                padding: '8px', fontFamily: 'monospace', fontSize: '12px', marginBottom: '8px',
              }}>
              {/* 挑戦できる戦闘エリアだけ出す。未解放のエリアは存在ごと見せない（エリアボスの名前も伏せる） */}
              {floors.filter(f => f.unlocked).map(f => (
                <option key={f.floor} value={f.floor}>
                  {floorLabel(f.floor)}
                  {f.boss_cleared ? `　${getFloor(f.floor)?.boss || ''}（踏破済）` : ''}
                </option>
              ))}
              {/* 調整で閉じている層があることを一覧の中でも分かるようにする。
                  何層まであるかは伏せたいので「◯層以降」の1行にまとめる */}
              {OPEN_MAX_FLOOR < MAX_IMPLEMENTED_FLOOR && (
                <option value="" disabled>{floorLabel(OPEN_MAX_FLOOR + 1)}以降　🔧 調整中</option>
              )}
            </select>

            {sel?.unlocked && fd && (
              <>
                <div style={{ background: '#001626', border: `1px solid ${C.line}`, padding: '7px 10px', marginBottom: '8px', fontSize: '11px', lineHeight: '1.6', borderRadius: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: C.text }}>
                      {isMonumentFloor(selFloor) && '🗿 '}
                      {/* エリアボスの名前は倒すまで伏せる */}
                      エリアボス「<span style={{ color: C.gold }}>{sel.boss_cleared ? fd.boss : '？？？'}</span>」
                    </span>
                    <span style={{ color: sel.boss_cleared ? C.ok : sel.mid_defeated ? C.gold : C.dim, fontSize: '10px' }}>
                      {sel.boss_cleared ? '✓ 踏破済' : sel.mid_defeated ? 'エリアボスに挑戦可' : '探索中'}
                    </span>
                  </div>
                  {!sel.mid_defeated && sel.sortie_count >= sel.need && (
                    <div style={{ color: C.gold, fontSize: '10px', marginTop: '4px' }}>💡 強敵の気配がする。出撃を続けて遭遇を狙おう。</div>
                  )}
                </div>

                <button onClick={() => doSortie(selFloor)} disabled={!canSortie || busy || !!runInfo}
                  style={bigBtn(C.gold, !canSortie || busy || !!runInfo)}>
                  {runInfo ? '⚔ 連戦中（出撃不可）' : busy ? '⏳ 戦闘中...' : canSortie ? `⚔ ${floorLabel(selFloor)}へ出撃！` : '⏳ 待機中...'}
                </button>

                <button onClick={() => (runInfo ? setScene('battle') : startRun(selFloor))} disabled={busy || !sel.mid_defeated}
                  style={bigBtn(C.accent, busy || !sel.mid_defeated)}>
                  {sel.mid_defeated ? '🗼 エリアボスに挑む' : '🗼 エリアボスに挑む（強敵撃破が必要）'}
                </button>

                {/* 開発用：相手を選んで1戦だけ試す。is_admin のみ。
                    ローカルで戦闘を回すだけで、報酬・進行・クールダウンには一切触らない */}
                {profile?.is_admin && (
                  <div style={{ border: '1px dashed #8a60ff', background: '#0e0820', padding: '10px', margin: '10px 0' }}>
                    <div style={{ color: '#c8a0ff', fontSize: '11px', marginBottom: '6px' }}>
                      🧪 テスト対戦 <span style={{ fontSize: '9px', color: '#8877aa' }}>[開発]</span>
                      <span style={{ color: C.dim, marginLeft: '6px' }}>報酬なし・進行に影響しません</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <select value={devFloor} onChange={e => setDevFloor(Number(e.target.value))}
                        style={{ background: '#001028', border: '1px solid #6a44aa', color: '#c8a0ff', padding: '6px', fontFamily: 'monospace', fontSize: '11px' }}>
                        {Array.from({ length: MAX_IMPLEMENTED_FLOOR }, (_, i) => i + 1).map(n => (
                          <option key={n} value={n}>{floorLabel(n)}</option>
                        ))}
                      </select>
                      <select value={devTarget} onChange={e => setDevTarget(e.target.value)}
                        style={{ background: '#001028', border: '1px solid #6a44aa', color: '#c8a0ff', padding: '6px', fontFamily: 'monospace', fontSize: '11px', flex: 1, minWidth: '160px' }}>
                        <option value="boss">エリアボス（取り巻き込み）</option>
                        <option value="mid">強敵</option>
                        <option value="mobs3">雑魚3体</option>
                        {(getFloor(devFloor)?.enemies || []).map((e, i) => (
                          <option key={i} value={String(i)}>雑魚: {e.name}</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={devFight} disabled={busy}
                      style={{ ...bigBtn('#c8a0ff', busy), marginTop: '8px' }}>
                      {busy ? '⏳ 戦闘中...' : '🧪 この相手と戦う'}
                    </button>

                    {/* 全上位職を再修練5のスキルセットで回して突破率を出す。
                        自分の実効ステータス（装備・紋章・ペット・エンドポイント込み）を使う */}
                    <div style={{ borderTop: '1px solid #33285a', marginTop: '12px', paddingTop: '10px' }}>
                      <div style={{ color: '#c8a0ff', fontSize: '11px', marginBottom: '6px' }}>
                        📊 全上位職シミュレーション
                        <span style={{ color: C.dim, marginLeft: '6px' }}>いまの自分の装備・ステータスで、19職ぶん6連戦を回します</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px', color: C.text }}>
                        <span>層</span>
                        <input type="number" min="1" max={MAX_IMPLEMENTED_FLOOR} value={simFrom}
                          onChange={e => setSimFrom(Number(e.target.value))}
                          style={{ width: '52px', background: '#001028', border: '1px solid #6a44aa', color: '#c8a0ff', padding: '5px', fontFamily: 'monospace' }} />
                        <span>〜</span>
                        <input type="number" min="1" max={MAX_IMPLEMENTED_FLOOR} value={simTo}
                          onChange={e => setSimTo(Number(e.target.value))}
                          style={{ width: '52px', background: '#001028', border: '1px solid #6a44aa', color: '#c8a0ff', padding: '5px', fontFamily: 'monospace' }} />
                        <span style={{ marginLeft: '6px' }}>各</span>
                        <input type="number" min="1" max="50" value={simTries}
                          onChange={e => setSimTries(Number(e.target.value))}
                          style={{ width: '52px', background: '#001028', border: '1px solid #6a44aa', color: '#c8a0ff', padding: '5px', fontFamily: 'monospace' }} />
                        <span>回</span>
                      </div>
                      <button onClick={runSim} disabled={simBusy}
                        style={{ ...bigBtn('#c8a0ff', simBusy), marginTop: '8px' }}>
                        {simBusy ? `⏳ ${simProgress}` : '📊 全上位職で回す'}
                      </button>
                      {!simBusy && simProgress && <div style={{ color: C.ng, fontSize: '10px', marginTop: '4px' }}>{simProgress}</div>}

                      {simRows && (
                        <div style={{ marginTop: '10px', overflowX: 'auto' }}>
                          <table style={{ borderCollapse: 'collapse', fontSize: '10px', width: '100%' }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', color: C.dim, padding: '3px 6px', borderBottom: '1px solid #33285a' }}>クラス</th>
                                {simRows.floors.map(fl => (
                                  <th key={fl} style={{ color: C.dim, padding: '3px 6px', borderBottom: '1px solid #33285a', whiteSpace: 'nowrap' }}>{floorLabel(fl)}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {simRows.rows.map(r => (
                                <tr key={r.cls} title={r.skills.join(' / ')}>
                                  <td style={{ color: C.text, padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.cls}</td>
                                  {simRows.floors.map(fl => {
                                    const v = r.rates[fl] ?? 0
                                    const col = v >= 0.5 ? C.ng : v > 0 ? C.gold : C.ok
                                    return (
                                      <td key={fl} style={{ color: col, padding: '3px 6px', textAlign: 'center', fontWeight: v >= 0.5 ? 'bold' : 'normal' }}>
                                        {Math.round(v * 100)}%
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div style={{ color: C.dim, fontSize: '9px', marginTop: '6px', lineHeight: '1.6' }}>
                            数値は6連戦の突破率。<span style={{ color: C.ng }}>赤=50%以上（抜けられる）</span> ／
                            <span style={{ color: C.gold }}> 黄=たまに抜ける</span> ／
                            <span style={{ color: C.ok }}> 緑=0%（抜けられない）</span><br />
                            クラス名にカーソルを合わせると、使ったスキルの並びが出ます。
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ color: C.dim, fontSize: '10px', lineHeight: '1.7' }}>
                  出撃を重ねると、やがて強敵が現れるようになります。<br />
                  強敵を倒すとエリアボスへ挑戦できます。エリアボスへの道は<span style={{ color: C.gold }}>{BOSS_RUN_STAGES.length}連戦</span>で、その間HP・MPは回復しません。<br />
                  出撃・連戦の開始時はHP・MPが満タンになります（街のHPとは別枠）。
                </div>
              </>
            )}
          </div>

          {/* 出撃の結果とログ。画面は切り替えず、ここに出す（街の出撃と同じ） */}
          {(logs.length > 0 || busy) && (
            <>
              <ResultBox gain={gain} />
              <div style={{ marginTop: '8px' }}>
                <BattleLog logs={logs} busy={busy} endRef={logsEndRef} />
              </div>
            </>
          )}
        </>
      )}

      {/* ── ツリー ── */}
      {tab === 'tree' && (
        <>
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px', marginBottom: '10px', fontSize: '11px', color: C.text }}>
            残りエンドポイント <span style={{ color: remainPt > 0 ? C.gold : C.dim, fontSize: '14px' }}>{Math.max(0, remainPt)}</span>
            <span style={{ color: C.dim, marginLeft: '10px' }}>1ノード {maxSteps}段まで</span>
            <div style={{ color: C.dim, fontSize: '10px', marginTop: '4px', lineHeight: '1.7' }}>
              効果は<span style={{ color: C.accent }}>エンドレスタワーの中だけ</span>で有効です。<br />
              {nextUnlock(towerLv)
                ? <>エンドレベル<span style={{ color: C.gold }}>{nextUnlock(towerLv).lv}</span>で <span style={{ color: C.gold }}>{nextUnlock(towerLv).upTo}段</span>まで解放。</>
                : <span style={{ color: C.ok }}>全段（{TREE_MAX_STEPS}段）解放済み。</span>}
            </div>
          </div>

          {TREE_LINES.map(line => (
            <div key={line.key} style={{ marginBottom: '10px' }}>
              <div style={{ color: C.accent, fontSize: '11px', marginBottom: '4px' }}>― {line.label} ―</div>
              {TREE_NODES.filter(n => n.line === line.key).map(n => {
                const v = draft[n.key] || 0
                return (
                  <div key={n.key} style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '8px 10px', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ color: C.text, fontSize: '11px' }}>{n.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button onClick={() => bump(n.key, -1)} style={stepBtn(v > 0)}>−</button>
                        <span style={{ color: v > 0 ? C.gold : C.dim, fontSize: '11px', minWidth: '64px', textAlign: 'center' }}>
                          {v}/{maxSteps}（{(v * stepPctOf(n.key)).toFixed(1)}%）
                        </span>
                        <button onClick={() => bump(n.key, +1)} style={stepBtn(remainPt > 0 && v < maxSteps)}>＋</button>
                      </div>
                    </div>
                    <NodeDesc text={n.desc} />
                  </div>
                )
              })}
            </div>
          ))}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button onClick={saveTree} disabled={!treeDraft} style={btn(C.ok, !treeDraft)}>保存する</button>
            <button onClick={() => setTreeDraft(null)} disabled={!treeDraft} style={btn(C.dim, !treeDraft)}>取り消し</button>
            <button onClick={resetTree} style={btn(C.ng)}>振り直し（{fmt(treeResetCost(towerLv))}G）</button>
          </div>
        </>
      )}

      {/* ── 石碑 ── */}
      {tab === 'monument' && (
        <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '12px' }}>
          <div style={{ color: C.gold, fontSize: '12px', marginBottom: '4px' }}>🗿 踏破の石碑</div>
          <div style={{ color: C.dim, fontSize: '10px', marginBottom: '10px', lineHeight: '1.7' }}>
            まず<span style={{ color: C.gold }}>10層</span>に最初に到達した者の名が刻まれる。<br />
            そこから先は<span style={{ color: C.gold }}>1層ごと</span>に、その層を最初に踏破した者の名が刻まれる。
          </div>
          {monument === null && <div style={{ color: C.dim, fontSize: '11px' }}>読み込み中...</div>}
          {monument?.map(m => (
            <div key={m.floor} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${C.line}`, padding: '8px 2px', fontSize: '11px' }}>
              <span style={{ color: C.text }}>{floorLabel(m.floor)}</span>
              <span style={{ color: m.username ? C.gold : C.dim }}>{m.username || '― 未踏破 ―'}</span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

const btn = (color, disabled = false) => ({
  background: disabled ? '#0a0d18' : '#0d1424',
  border: `1px solid ${disabled ? '#243050' : color}`,
  color: disabled ? '#3f4a68' : color,
  padding: '7px 14px', cursor: disabled ? 'default' : 'pointer',
  fontFamily: 'monospace', fontSize: '11px',
})
// 出撃・連戦などの主要ボタン。街の出撃ボタンと同じ大きさに揃える
const bigBtn = (color, disabled = false) => ({
  width: '100%', padding: '14px', background: '#001840',
  border: `1px solid ${disabled ? '#003366' : color}`,
  color: disabled ? '#446688' : color,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'monospace', fontSize: '14px', letterSpacing: '2px', marginBottom: '10px',
})
const tabBtn = (on) => ({
  background: on ? '#12203c' : '#0a0d18',
  border: `1px solid ${on ? C.accent : C.line}`,
  color: on ? C.accent : C.dim,
  padding: '5px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px',
})
const stepBtn = (on) => ({
  background: '#0d1424', border: `1px solid ${on ? C.accent : '#243050'}`,
  color: on ? C.accent : '#3f4a68', width: '26px', height: '24px',
  cursor: on ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: '12px',
})
