// ============================================================
// 星霜百層塔（せいそうひゃくそうとう）
// ------------------------------------------------------------
// ・現状 is_admin 限定の開発先行（サーバ側 tower_can_enter() が本番の権威）
// ・入口は街メニューの「⚔ 挑戦」→「🗼 星霜百層塔」（/tower の独立ページ）
// ・内部推奨戦闘力は開発上の目安であり、画面には出さない
// ============================================================
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveStats } from '../lib/stats'
import { petPlayerBonus } from '../constants/pets'
import { loadCharmBonus, PET_STAT_SELECT } from '../lib/petBonus'
import { selectBattleSkillSets, pickTargetMode, TARGET_MODES } from '../lib/loadout'
import { BattleLogLine } from './Game'
import {
  getFloor, MAX_IMPLEMENTED_FLOOR, BOSS_RUN_STAGES,
  TREE_NODES, TREE_LINES, TREE_MAX_STEPS, TREE_STEP_PCT,
  maxStepsAt, nextUnlock, treeSpent, treeResetCost,
  MID_BOSS_RATE, isMonumentFloor, towerSortieGold, RUN_POTION_LIMIT,
} from '../lib/tower'
import { simulateTowerBattle, buildStageEnemies, buildSortieEnemies, towerTreeEffects } from '../lib/towerBattle'

const fmt = (n) => Number(n || 0).toLocaleString()
const floorLabel = (n) => `${n}層`

// 通信がハングしても「戦闘中...」で固まらないようにする
const withTimeout = (promise, ms = 15000) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const C = {
  bg: '#050810', panel: '#0b1020', line: '#26355c', text: '#9fb6e0',
  dim: '#5f7099', accent: '#7fd4ff', gold: '#ffcc66', ok: '#66dd99', ng: '#ff6688',
}

// ページのガワ（ヘッダ＋街に戻る）。
// ⚠コンポーネントの中で定義すると、状態が変わるたびに型が変わって
//   中身が丸ごと作り直され、入力欄のフォーカスやスクロール位置が飛ぶ。必ず外に置く。
function Shell({ nav, children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '12px', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.line}`, paddingBottom: '8px', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 30, paddingTop: '8px', background: C.bg }}>
          <div style={{ color: C.accent, fontSize: '16px', letterSpacing: '3px' }}>🗼 星霜百層塔</div>
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
  const [tab, setTab] = useState('floors')       // floors | tree | monument（到達層ランキングは /ranking のタブへ）
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
  const [targetOptions, setTargetOptions] = useState([])   // 狙う相手（スキル設定画面で決める）
  const [playerItem, setPlayerItem] = useState(null)       // 装備中のアイテム（塔でも街と同じく使える）
  const logsEndRef = useRef(null)
  const floorPickedRef = useRef(false)   // 最前線への自動合わせは初回だけ
  const busyRef = useRef(false)          // 連打で二重に戦闘が走るのを防ぐ（stateは反映が1テンポ遅れる）

  useEffect(() => { init() }, [])
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

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
      // 選んでいる層は保つ。初回だけ最前線（まだ層主を倒していない一番手前の層）に合わせる。
      // 毎回上書きすると、踏破済みの層を周回しているときに勝手に飛ばされる。
      if (!floorPickedRef.current) {
        floorPickedRef.current = true
        const next = (data.floors || []).find(f => f.unlocked && !f.boss_cleared)
        setSelFloor(next ? next.floor : Math.min(MAX_IMPLEMENTED_FLOOR, (data.max_floor || 0) + 1) || 1)
      }
      if (data.run) {
        setRunInfo({ floor: data.run.floor, stage: data.run.stage, hp: Number(data.run.hp), mp: Number(data.run.mp), potionUsed: Number(data.run.potion || 0), resumed: true })
      }
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
  // 狙う相手はスキル設定画面の「挑戦」セットの設定に従う（塔は挑戦セットを使うため）
  const targetMode = pickTargetMode(targetOptions, 'challenge')
  const tr = towerTreeEffects(treeAlloc)

  // ── 塔出撃（雑魚1体・HP/MP満タン） ──────────────────────────
  const doSortie = async (floor) => {
    if (busy || busyRef.current) return
    const fd = getFloor(floor)
    if (!fd) return
    busyRef.current = true
    setBusy(true); setScene('battle'); setLogs([]); setMsg(null); setGain(null)
    try {
      if (await idleBlocked()) return
      const fp = (status.floors || []).find(f => f.floor === floor)
      const midOpen = !!fp && !fp.mid_defeated && fp.sortie_count >= fp.need
      const { enemies, isMid } = buildSortieEnemies(fd, midOpen ? MID_BOSS_RATE : 0)
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode, playerItem,
      })
      setLogs(res.logs)
      if (res.itemUsed) await consumeItem()
      const exp = 1 + (Math.random() < tr.expPlus ? 1 : 0)
      const { data, error } = await withTimeout(supabase.rpc('tower_sortie_result', {
        p_floor: floor, p_won: res.win, p_mid_defeat: isMid && res.win,
        p_gold: res.win ? towerSortieGold(floor) : 0, p_exp: res.win ? exp : 0,
      }))
      if (error || data?.error) {
        setMsg(data?.error || error?.message || '結果の反映に失敗しました')
      } else {
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

  // ── 層主連戦：開始 ──────────────────────────────────────────
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
      setRunInfo({ floor, stage: 0, hp: hpMax, mp: eff.mp_max, potionUsed: 0 })
      setScene('battle')
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '開始処理でエラーが発生しました。')
    } finally { busyRef.current = false; setBusy(false) }
  }

  // ── 層主連戦：1戦ぶん進める ─────────────────────────────────
  const runStage = async () => {
    if (busy || busyRef.current || !runInfo) return
    const fd = getFloor(runInfo.floor)
    if (!fd) return
    busyRef.current = true
    setBusy(true); setLogs([]); setMsg(null); setGain(null)
    try {
      // 連戦の途中でも毎戦チェックする（別端末で釣りを始める等の抜け道を塞ぐ）
      if (await idleBlocked()) return
      const stage = runInfo.stage
      const enemies = buildStageEnemies(fd, stage)
      // アイテムは街の出撃と同じく「1戦闘に1個」。連戦の各戦で使える（使うたび在庫は減る）
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode,
        startHp: runInfo.hp, startMp: runInfo.mp, playerItem,
        potionUsed: runInfo.potionUsed || 0, potionLimit: RUN_POTION_LIMIT,
      })
      setLogs(res.logs)
      if (res.itemUsed) await consumeItem()
      if (!res.win) {
        await withTimeout(supabase.rpc('tower_run_abort'))
        setRunInfo(null)
        setGain({ win: false, stageLabel: BOSS_RUN_STAGES[stage].label })
        await withTimeout(fetchStatus())
        return
      }
      if (stage >= BOSS_RUN_STAGES.length - 1) {
        const exp = 1 + (Math.random() < tr.expPlus ? 1 : 0)
        const { data, error } = await withTimeout(supabase.rpc('tower_boss_clear', { p_floor: runInfo.floor, p_gold: res.gold, p_exp: exp }))
        if (error || data?.error) { setMsg(data?.error || error?.message || '撃破の反映に失敗しました'); return }
        setRunInfo(null)
        setGain({ win: true, cleared: true, floor: runInfo.floor, gold: data.gold, exp: data.exp, firstClear: data.first_clear, monument: data.monument })
        await withTimeout(fetchStatus())
        return
      }
      const { data, error } = await withTimeout(supabase.rpc('tower_run_save', { p_stage: stage + 1, p_hp: res.hp, p_mp: res.mp, p_potion: res.potionUsed }))
      if (error || data?.error) { setMsg(data?.error || error?.message || '進行の保存に失敗しました'); return }
      setRunInfo({ ...runInfo, stage: stage + 1, hp: res.hp, mp: res.mp, hpMax: res.hpMax, mpMax: res.mpMax, potionUsed: res.potionUsed })
      setGain({ win: true, stageLabel: BOSS_RUN_STAGES[stage].label, hp: res.hp, mp: res.mp, hpMax: res.hpMax, mpMax: res.mpMax })
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '戦闘処理でエラーが発生しました。')
    } finally { busyRef.current = false; setBusy(false) }
  }

  const abortRun = async () => {
    if (!window.confirm('連戦を中断します。HPは回復せず、次はまた1戦目からになります。よろしいですか？')) return
    await supabase.rpc('tower_run_abort')
    setRunInfo(null); setScene('lobby'); setLogs([]); setGain(null)
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
            {inRun && <span style={{ color: C.gold, marginLeft: '8px' }}>層主への道 {runInfo.stage + 1}/{BOSS_RUN_STAGES.length}（{stageLabel}）</span>}
          </div>
          {!busy && (
            <button onClick={() => { setScene('lobby'); setLogs([]); setGain(null) }} style={btn(C.dim)}>← 戻る</button>
          )}
        </div>

        {/* 層主・中ボスの立ち絵（中ボスは層主の画像を流用。画像が無い層は出さない） */}
        {inRun && ['mid', 'boss'].includes(BOSS_RUN_STAGES[runInfo.stage]?.kind) && !imgFail[runInfo.floor] && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <img
              src={`/tou/${runInfo.floor}sou.png`}
              alt={getFloor(runInfo.floor)?.boss || ''}
              onError={() => setImgFail(s => ({ ...s, [runInfo.floor]: true }))}
              style={{ maxWidth: '100%', maxHeight: '34vh', objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(127,212,255,0.25))' }}
            />
            <div style={{ color: C.gold, fontSize: '12px', marginTop: '2px' }}>
              {BOSS_RUN_STAGES[runInfo.stage]?.kind === 'boss'
                ? getFloor(runInfo.floor)?.boss
                : getFloor(runInfo.floor)?.midBoss?.name}
            </div>
          </div>
        )}

        {inRun && (
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '8px 10px', marginBottom: '8px', fontSize: '11px', color: C.text }}>
            持ち越し HP <span style={{ color: C.ok }}>{fmt(runInfo.hp)}</span> ／ MP <span style={{ color: C.accent }}>{fmt(runInfo.mp)}</span>
            <span style={{ color: C.gold, marginLeft: '10px' }}>
              🧪 無限ポーション 残り{Math.max(0, RUN_POTION_LIMIT - (runInfo.potionUsed || 0))}/{RUN_POTION_LIMIT}回
            </span>
            <div style={{ color: C.dim, fontSize: '10px', marginTop: '3px' }}>連戦の間、HP・MPは回復しません。中断してもこの状態から再開します。</div>
          </div>
        )}

        <div style={{ border: `1px solid ${C.line}`, background: '#05070f', padding: '10px', maxHeight: '52vh', overflowY: 'auto', fontSize: '11px', lineHeight: '1.8' }}>
          {logs.length === 0 && !busy && <div style={{ color: C.dim }}>まだ戦っていません。</div>}
          {logs.map((l, i) => <BattleLogLine key={i} l={l} />)}
          <div ref={logsEndRef} />
        </div>

        {msg && <div style={{ color: C.ng, fontSize: '11px', marginTop: '8px' }}>{msg}</div>}

        {gain && (
          <div style={{ border: `1px solid ${gain.win ? C.ok : C.ng}`, background: C.panel, padding: '10px', marginTop: '8px', fontSize: '11px', color: C.text, lineHeight: '1.9' }}>
            {gain.cleared ? (
              <>
                <div style={{ color: C.gold, fontSize: '13px' }}>👑 {floorLabel(gain.floor)}の層主を撃破！</div>
                {gain.firstClear && <div style={{ color: C.ok }}>この層を初めて踏破した！ 次の層が解放された。</div>}
                {gain.monument && <div style={{ color: C.gold }}>🗿 石碑に名前が刻まれた！（サーバー最初の踏破者）</div>}
                <div>Gold +{fmt(gain.gold)} ／ EXP +{fmt(gain.exp)}</div>
              </>
            ) : gain.win === false ? (
              <div style={{ color: C.ng }}>敗北…{gain.stageLabel ? `（${gain.stageLabel}）` : ''} 連戦は最初からやり直しになります。</div>
            ) : gain.stageLabel ? (
              <>
                <div style={{ color: C.ok }}>{gain.stageLabel} を突破！</div>
                <div>残り HP {fmt(gain.hp)} ／ MP {fmt(gain.mp)}</div>
              </>
            ) : (
              <>
                <div style={{ color: C.ok }}>勝利！ Gold +{fmt(gain.gold)} ／ EXP +{fmt(gain.exp)} ／ 塔EXP +{fmt(gain.towerExp)}</div>
                {gain.midCleared && <div style={{ color: C.gold }}>⚔ 中ボスを撃破！ 層主に挑めるようになった。</div>}
                {gain.mid && !gain.midCleared && <div style={{ color: C.ng }}>中ボスが現れたが、退けられた…</div>}
                <div style={{ color: C.dim }}>この層の出撃 {fmt(gain.count)} / {fmt(gain.need)} 回</div>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
          {inRun && (
            <>
              <button onClick={runStage} disabled={busy} style={btn(C.gold, busy)}>
                {busy ? '戦闘中...' : `${stageLabel} に挑む`}
              </button>
              <button onClick={abortRun} disabled={busy} style={btn(C.ng, busy)}>連戦を中断</button>
            </>
          )}
          {!inRun && !gain?.cleared && (
            <button onClick={() => doSortie(selFloor)} disabled={busy} style={btn(C.accent, busy)}>
              {busy ? '戦闘中...' : 'もう一度 出撃する'}
            </button>
          )}
        </div>
      </Shell>
    )
  }

  // ── ロビー ──────────────────────────────────────────────────
  return (
    <Shell nav={nav}>
      {/* 塔LV・タブ */}
      <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px 12px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ color: C.dim, fontSize: '11px' }}>階層</div>
          <div style={{ color: C.text, fontSize: '11px' }}>
            塔LV <span style={{ color: C.gold, fontSize: '14px' }}>{status.tower_lv}</span>
            <span style={{ color: C.dim, marginLeft: '8px' }}>{fmt(status.exp_in_lv)} / {fmt(status.exp_to_next)}</span>
          </div>
        </div>
        <div style={{ height: '4px', background: '#101830', marginTop: '6px' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (status.exp_in_lv / Math.max(1, status.exp_to_next)) * 100)}%`, background: C.accent }} />
        </div>
        <div style={{ color: C.dim, fontSize: '10px', marginTop: '5px' }}>
          到達 {status.max_floor > 0 ? floorLabel(status.max_floor) : '—'} ／ 塔スキルポイント 残り {Math.max(0, status.tower_lv - (status.spent || 0))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('floors')} style={tabBtn(tab === 'floors')}>層</button>
        <button onClick={() => setTab('tree')} style={tabBtn(tab === 'tree')}>塔スキル</button>
        <button onClick={openMonument} style={tabBtn(tab === 'monument')}>石碑</button>
        <button onClick={() => nav('/ranking')} style={tabBtn(false)}>到達層 ↗</button>
      </div>

      {msg && <div style={{ color: C.ng, fontSize: '11px', marginBottom: '8px' }}>{msg}</div>}

      {/* ── 層選択 ── */}
      {tab === 'floors' && (
        <>
          {runInfo && (
            <div style={{ border: `1px solid ${C.gold}`, background: '#181203', padding: '10px', marginBottom: '10px' }}>
              <div style={{ color: C.gold, fontSize: '12px' }}>⚔ {floorLabel(runInfo.floor)} の連戦が進行中（{BOSS_RUN_STAGES[runInfo.stage]?.label}）</div>
              <div style={{ color: C.dim, fontSize: '10px', margin: '4px 0 8px' }}>HP {fmt(runInfo.hp)} ／ MP {fmt(runInfo.mp)} の状態から再開します。</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setScene('battle')} style={btn(C.gold)}>続きから</button>
                <button onClick={abortRun} style={btn(C.ng)}>中断する</button>
              </div>
            </div>
          )}

          {/* 狙う相手（設定はスキル設定画面の「挑戦」セット側にある） */}
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ color: C.text, fontSize: '11px' }}>
              🎯 敵が複数のとき狙う相手: <span style={{ color: C.gold }}>{TARGET_MODES.find(m => m.key === targetMode)?.label}</span>
            </span>
            <button onClick={() => nav('/skills')} style={btn(C.dim)}>スキル設定で変更 ↗</button>
          </div>

          {/* 層の選択（街の出撃のエリア選択と同じプルダウン形式） */}
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '12px', marginBottom: '10px' }}>
            <div style={{ color: C.text, fontSize: '11px', marginBottom: '6px' }}>挑む層</div>
            <select
              value={selFloor}
              onChange={e => setSelFloor(Number(e.target.value))}
              disabled={busy || !!runInfo}
              style={{
                width: '100%', background: '#001028', border: `1px solid ${C.accent}`, color: C.accent,
                fontFamily: 'monospace', fontSize: '13px', padding: '8px',
              }}>
              {floors.map(f => (
                <option key={f.floor} value={f.floor} disabled={!f.unlocked}>
                  {floorLabel(f.floor)}　{getFloor(f.floor)?.boss || '？'}
                  {f.boss_cleared ? '（踏破済）' : f.unlocked ? '' : '（未解放）'}
                </option>
              ))}
            </select>

            {sel?.unlocked && fd && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', fontSize: '11px' }}>
                  <span style={{ color: C.text }}>
                    {isMonumentFloor(selFloor) && '🗿 '}層主「<span style={{ color: C.gold }}>{fd.boss}</span>」
                  </span>
                  <span style={{ color: sel.boss_cleared ? C.ok : sel.mid_defeated ? C.gold : C.dim, fontSize: '10px' }}>
                    {sel.boss_cleared ? '✓ 踏破済' : sel.mid_defeated ? '層主に挑戦可' : `出撃 ${sel.sortie_count}/${sel.need}`}
                  </span>
                </div>
                {!sel.boss_cleared && (
                  <div style={{ height: '3px', background: '#101830', marginTop: '6px' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (sel.sortie_count / Math.max(1, sel.need)) * 100)}%`, background: sel.mid_defeated ? C.gold : C.accent }} />
                  </div>
                )}
                <div style={{ color: C.dim, fontSize: '10px', lineHeight: '1.8', margin: '10px 0' }}>
                  出撃を <span style={{ color: C.text }}>{fmt(sel.need)}</span> 回こなすと中ボスが現れるようになります（1回の出撃につき{Math.round(MID_BOSS_RATE * 100)}%）。<br />
                  中ボスを倒すと層主へ挑戦できます。層主への道は<span style={{ color: C.gold }}>{BOSS_RUN_STAGES.length}連戦</span>で、その間HP・MPは回復しません。<br />
                  出撃・連戦の開始時はHP・MPが満タンになります（街のHPとは別枠）。
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => doSortie(selFloor)} disabled={busy || !!runInfo} style={btn(C.accent, busy || !!runInfo)}>⚔ 出撃する</button>
                  <button onClick={() => (runInfo ? setScene('battle') : startRun(selFloor))} disabled={busy || !sel.mid_defeated} style={btn(C.gold, busy || !sel.mid_defeated)}>
                    🗼 層主に挑む
                  </button>
                </div>
                {!sel.mid_defeated && sel.sortie_count >= sel.need && (
                  <div style={{ color: C.gold, fontSize: '10px', marginTop: '8px' }}>中ボスが出現するようになりました。出撃を続けて遭遇を狙いましょう。</div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── ツリー ── */}
      {tab === 'tree' && (
        <>
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px', marginBottom: '10px', fontSize: '11px', color: C.text }}>
            残りポイント <span style={{ color: remainPt > 0 ? C.gold : C.dim, fontSize: '14px' }}>{Math.max(0, remainPt)}</span>
            <span style={{ color: C.dim, marginLeft: '10px' }}>1ノード {maxSteps}段まで（1段 {TREE_STEP_PCT}%）</span>
            <div style={{ color: C.dim, fontSize: '10px', marginTop: '4px' }}>
              効果は<span style={{ color: C.text }}>塔の中だけ</span>で有効です。
              {nextUnlock(towerLv)
                ? `塔LV${nextUnlock(towerLv).lv}で ${nextUnlock(towerLv).upTo}段まで解放。`
                : `全段（${TREE_MAX_STEPS}段）解放済み。`}
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
                          {v}/{maxSteps}（{(v * TREE_STEP_PCT).toFixed(1)}%）
                        </span>
                        <button onClick={() => bump(n.key, +1)} style={stepBtn(remainPt > 0 && v < maxSteps)}>＋</button>
                      </div>
                    </div>
                    <div style={{ color: C.dim, fontSize: '10px', marginTop: '3px' }}>{n.desc}</div>
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
          <div style={{ color: C.dim, fontSize: '10px', marginBottom: '10px' }}>10層ごとの節目を、サーバーで最初に踏破した者の名が刻まれる。</div>
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
