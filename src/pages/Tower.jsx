// ============================================================
// 星霜百層塔（せいそうひゃくそうとう）
// ------------------------------------------------------------
// ・現状 is_admin 限定の開発先行（サーバ側 tower_can_enter() が本番の権威）
// ・入口は「⚔ 挑戦」＝ /abyss のタブから切り替える
// ・内部推奨戦闘力は開発上の目安であり、画面には出さない
// ============================================================
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveStats } from '../lib/stats'
import { petPlayerBonus } from '../constants/pets'
import { loadCharmBonus, PET_STAT_SELECT } from '../lib/petBonus'
import { selectBattleSkillSets } from '../lib/loadout'
import { BattleLogLine } from './Game'
import {
  getFloor, MAX_IMPLEMENTED_FLOOR, BOSS_RUN_STAGES,
  TREE_NODES, TREE_LINES, TREE_MAX_STEPS, TREE_STEP_PCT,
  maxStepsAt, nextUnlock, treeSpent, treeResetCost,
  TARGET_MODES, DEFAULT_TARGET_MODE, MID_BOSS_RATE, isMonumentFloor,
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

export default function Tower() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [status, setStatus] = useState(null)
  const [tab, setTab] = useState('floors')       // floors | tree | monument | ranking
  const [scene, setScene] = useState('lobby')    // lobby | battle
  const [selFloor, setSelFloor] = useState(1)
  const [logs, setLogs] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [gain, setGain] = useState(null)
  const [runInfo, setRunInfo] = useState(null)   // { floor, stage, hp, mp, hpMax, mpMax, done }
  const [monument, setMonument] = useState(null)
  const [ranking, setRanking] = useState(null)
  const [treeDraft, setTreeDraft] = useState(null)
  const logsEndRef = useRef(null)

  useEffect(() => { init() }, [])
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const [{ data: prof }, { data: eq }, { data: pr }, { data: ss }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order'),
    ])
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
      // 最前線＝まだ層主を倒していない一番手前の層
      const next = (data.floors || []).find(f => f.unlocked && !f.boss_cleared)
      setSelFloor(next ? next.floor : Math.min(MAX_IMPLEMENTED_FLOOR, (data.max_floor || 0) + 1) || 1)
      if (data.run) {
        setRunInfo({ floor: data.run.floor, stage: data.run.stage, hp: Number(data.run.hp), mp: Number(data.run.mp), resumed: true })
      }
    }
  }

  const buildEff = () => calcEffectiveStats(profile, equipment, proficiency, abilityTitle)

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
  const targetMode = status?.target_mode || DEFAULT_TARGET_MODE
  const tr = towerTreeEffects(treeAlloc)

  // ── 塔出撃（雑魚1体・HP/MP満タン） ──────────────────────────
  const doSortie = async (floor) => {
    if (busy) return
    const fd = getFloor(floor)
    if (!fd) return
    setBusy(true); setScene('battle'); setLogs([]); setMsg(null); setGain(null)
    try {
      if (await idleBlocked()) return
      const fp = (status.floors || []).find(f => f.floor === floor)
      const midOpen = !!fp && !fp.mid_defeated && fp.sortie_count >= fp.need
      const { enemies, isMid } = buildSortieEnemies(fd, midOpen ? MID_BOSS_RATE : 0)
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode,
      })
      setLogs(res.logs)
      const exp = 1 + (Math.random() < tr.expPlus ? 1 : 0)
      const { data, error } = await withTimeout(supabase.rpc('tower_sortie_result', {
        p_floor: floor, p_won: res.win, p_mid_defeat: isMid && res.win,
        p_gold: res.gold, p_exp: res.win ? exp : 0,
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
      setBusy(false)
    }
  }

  // ── 層主連戦：開始 ──────────────────────────────────────────
  const startRun = async (floor) => {
    if (busy) return
    setBusy(true); setMsg(null); setGain(null); setLogs([])
    try {
      if (await idleBlocked()) return
      const eff = buildEff()
      const hpMax = Math.floor(eff.hp_max * tr.hpMult)
      const { data, error } = await withTimeout(supabase.rpc('tower_run_start', { p_floor: floor, p_hp: hpMax, p_mp: eff.mp_max }))
      if (error || data?.error) { setMsg(data?.error || error?.message || '連戦を開始できませんでした'); return }
      setRunInfo({ floor, stage: 0, hp: hpMax, mp: eff.mp_max })
      setScene('battle')
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '開始処理でエラーが発生しました。')
    } finally { setBusy(false) }
  }

  // ── 層主連戦：1戦ぶん進める ─────────────────────────────────
  const runStage = async () => {
    if (busy || !runInfo) return
    const fd = getFloor(runInfo.floor)
    if (!fd) return
    setBusy(true); setLogs([]); setMsg(null); setGain(null)
    try {
      // 連戦の途中でも毎戦チェックする（別端末で釣りを始める等の抜け道を塞ぐ）
      if (await idleBlocked()) return
      const stage = runInfo.stage
      const enemies = buildStageEnemies(fd, stage)
      const res = simulateTowerBattle({
        eff: buildEff(), equipment, skillSets, profile,
        enemies, floorData: fd, tree: treeAlloc, targetMode,
        startHp: runInfo.hp, startMp: runInfo.mp,
      })
      setLogs(res.logs)
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
      const { data, error } = await withTimeout(supabase.rpc('tower_run_save', { p_stage: stage + 1, p_hp: res.hp, p_mp: res.mp }))
      if (error || data?.error) { setMsg(data?.error || error?.message || '進行の保存に失敗しました'); return }
      setRunInfo({ ...runInfo, stage: stage + 1, hp: res.hp, mp: res.mp, hpMax: res.hpMax, mpMax: res.mpMax })
      setGain({ win: true, stageLabel: BOSS_RUN_STAGES[stage].label, hp: res.hp, mp: res.mp, hpMax: res.hpMax, mpMax: res.mpMax })
    } catch (e) {
      setMsg(e?.message === 'timeout' ? '通信がタイムアウトしました。' : '戦闘処理でエラーが発生しました。')
    } finally { setBusy(false) }
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
  const openRanking = async () => {
    setTab('ranking')
    const { data } = await supabase.rpc('get_tower_ranking', { p_limit: 50 })
    setRanking(data || [])
  }

  const saveTargetMode = async (mode) => {
    const { data, error } = await supabase.rpc('tower_set_target_mode', { p_mode: mode })
    if (error || data?.error) { setMsg(data?.error || error?.message || '設定を保存できませんでした'); return }
    setStatus(s => ({ ...s, target_mode: mode }))
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
      <div style={{ padding: '20px', fontFamily: 'monospace', color: C.ng, textAlign: 'center' }}>
        <div style={{ marginBottom: '8px' }}>🗼 星霜百層塔</div>
        <div style={{ fontSize: '12px', color: C.dim }}>{status.error}</div>
      </div>
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
      <div style={{ fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ color: C.accent, fontSize: '13px' }}>
            🗼 {floorLabel(inRun ? runInfo.floor : selFloor)}
            {inRun && <span style={{ color: C.gold, marginLeft: '8px' }}>層主への道 {runInfo.stage + 1}/{BOSS_RUN_STAGES.length}（{stageLabel}）</span>}
          </div>
          {!busy && (
            <button onClick={() => { setScene('lobby'); setLogs([]); setGain(null) }} style={btn(C.dim)}>← 戻る</button>
          )}
        </div>

        {inRun && (
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '8px 10px', marginBottom: '8px', fontSize: '11px', color: C.text }}>
            持ち越し HP <span style={{ color: C.ok }}>{fmt(runInfo.hp)}</span> ／ MP <span style={{ color: C.accent }}>{fmt(runInfo.mp)}</span>
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
                <div style={{ color: C.dim }}>この層の探索 {fmt(gain.count)} / {fmt(gain.need)} 回</div>
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
              {busy ? '戦闘中...' : 'もう一度 探索する'}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── ロビー ──────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'monospace' }}>
      {/* 塔LV・タブ */}
      <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px 12px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ color: C.accent, fontSize: '13px' }}>🗼 星霜百層塔</div>
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
        <button onClick={openRanking} style={tabBtn(tab === 'ranking')}>到達層</button>
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

          {/* 対象設定 */}
          <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '10px', marginBottom: '10px' }}>
            <div style={{ color: C.text, fontSize: '11px', marginBottom: '6px' }}>🎯 敵が複数いるときに狙う相手</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {TARGET_MODES.map(m => (
                <button key={m.key} onClick={() => saveTargetMode(m.key)} style={tabBtn(targetMode === m.key)}>{m.label}</button>
              ))}
            </div>
          </div>

          {floors.map(f => {
            const data = getFloor(f.floor)
            const open = f.unlocked
            const isSel = f.floor === selFloor
            return (
              <div key={f.floor}
                onClick={() => open && setSelFloor(f.floor)}
                style={{
                  border: `1px solid ${isSel ? C.accent : C.line}`, background: open ? (isSel ? '#0d1730' : C.panel) : '#080a12',
                  padding: '10px 12px', marginBottom: '6px', cursor: open ? 'pointer' : 'default', opacity: open ? 1 : 0.45,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ color: f.boss_cleared ? C.dim : C.text, fontSize: '12px' }}>
                    {isMonumentFloor(f.floor) && '🗿 '}{floorLabel(f.floor)}　<span style={{ color: C.dim }}>{data?.boss || '？'}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: f.boss_cleared ? C.ok : open ? C.gold : C.dim }}>
                    {f.boss_cleared ? '✓ 踏破' : open ? (f.mid_defeated ? '層主に挑戦可' : `探索 ${f.sortie_count}/${f.need}`) : '未解放'}
                  </div>
                </div>
                {open && !f.boss_cleared && (
                  <div style={{ height: '3px', background: '#101830', marginTop: '6px' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (f.sortie_count / Math.max(1, f.need)) * 100)}%`, background: f.mid_defeated ? C.gold : C.accent }} />
                  </div>
                )}
              </div>
            )
          })}

          {/* 選択中の層の操作 */}
          {sel?.unlocked && fd && (
            <div style={{ border: `1px solid ${C.accent}`, background: C.panel, padding: '12px', marginTop: '10px' }}>
              <div style={{ color: C.accent, fontSize: '13px', marginBottom: '4px' }}>{floorLabel(selFloor)}　層主「{fd.boss}」</div>
              <div style={{ color: C.dim, fontSize: '10px', lineHeight: '1.8', marginBottom: '10px' }}>
                探索を <span style={{ color: C.text }}>{fmt(sel.need)}</span> 回こなすと中ボスが現れるようになります（1回の探索につき{Math.round(MID_BOSS_RATE * 100)}%）。<br />
                中ボスを倒すと層主へ挑戦できます。層主への道は<span style={{ color: C.gold }}>{BOSS_RUN_STAGES.length}連戦</span>で、その間HP・MPは回復しません。<br />
                探索・連戦の開始時はHP・MPが満タンになります（街のHPとは別枠）。
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => doSortie(selFloor)} disabled={busy || !!runInfo} style={btn(C.accent, busy || !!runInfo)}>🔍 探索する</button>
                <button onClick={() => (runInfo ? setScene('battle') : startRun(selFloor))} disabled={busy || !sel.mid_defeated} style={btn(C.gold, busy || !sel.mid_defeated)}>
                  ⚔ 層主に挑む
                </button>
              </div>
              {!sel.mid_defeated && sel.sortie_count >= sel.need && (
                <div style={{ color: C.gold, fontSize: '10px', marginTop: '8px' }}>中ボスが出現するようになりました。探索を続けて遭遇を狙いましょう。</div>
              )}
            </div>
          )}
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

      {/* ── 到達層ランキング ── */}
      {tab === 'ranking' && (
        <div style={{ border: `1px solid ${C.line}`, background: C.panel, padding: '12px' }}>
          <div style={{ color: C.accent, fontSize: '12px', marginBottom: '4px' }}>🏆 到達層ランキング</div>
          <div style={{ color: C.dim, fontSize: '10px', marginBottom: '10px' }}>同じ層なら、先に到達した者が上位。</div>
          {ranking === null && <div style={{ color: C.dim, fontSize: '11px' }}>読み込み中...</div>}
          {ranking?.length === 0 && <div style={{ color: C.dim, fontSize: '11px' }}>まだ誰も層主を倒していません。</div>}
          {ranking?.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${C.line}`, padding: '7px 2px', fontSize: '11px' }}>
              <span style={{ color: i < 3 ? C.gold : C.text }}>{i + 1}. {r.username}</span>
              <span style={{ color: C.accent }}>{floorLabel(r.max_floor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
