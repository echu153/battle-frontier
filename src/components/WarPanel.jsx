// 🏳 戦争パネル — 専用ページ(/war)の本体UI。
// 建国者(元帥)が宣戦布告→開戦→敵コアを攻撃→勝利/領地総取り を行う。
// ※ページ枠(ヘッダー/戻る)は War.jsx が用意し、ここは中身だけをインライン描画する。
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { loadLoadout } from '../lib/pvpLoadout'
import { simulateCoreAttack, simulateWarBattle, dummyCombatInput, WAR_CORE_HP } from '../lib/war'

const ATTACK_CD_MS = 20000  // 疑似CD（サーバーCDはM2）
const REGEN_SECONDS = 60    // 自然回復間隔（Game.jsx と一致）。60秒ごとに最大HP/MPの+20%。

const box = { background:'#140802', border:'1px solid #e05a62', padding:'16px', fontFamily:'monospace' }
const fmt = (ms) => { const s=Math.floor(ms/1000); const m=Math.floor(s/60); return m>0?`${m}分${s%60}秒`:`${s}秒` }

function CoreBar({ label, hp, color }) {
  const pct = Math.max(0, Math.min(100, (hp ?? 0) / WAR_CORE_HP * 100))
  return (
    <div style={{ marginBottom:'8px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#ddbbaa', marginBottom:'2px' }}>
        <span>{label}</span><span>{Math.max(0, hp ?? 0).toLocaleString()} / {WAR_CORE_HP.toLocaleString()}</span>
      </div>
      <div style={{ height:'12px', background:'#2a1408', border:'1px solid #5a2a1a' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color }} />
      </div>
    </div>
  )
}

// 参加者の細いHP/MPバー（cur/max）。
function StatBar({ cur, max, color, h = 8 }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0
  return (
    <div style={{ height:`${h}px`, background:'#2a1408', border:'1px solid #4a2418', flex:1 }}>
      <div style={{ height:'100%', width:`${pct}%`, background:color }} />
    </div>
  )
}

export default function WarPanel({ me, myCountry, countries }) {
  const [loadout, setLoadout] = useState(null)
  const [war, setWar] = useState(null)
  const [target, setTarget] = useState('')
  const [testMode, setTestMode] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [cdUntil, setCdUntil] = useState(0)
  const [, setTick] = useState(0)
  const [lastInfo, setLastInfo] = useState(null)      // { atk, matk, power, raw, applied } 直近の数値
  const [participants, setParticipants] = useState([])  // 進行中戦争の war_participants
  const [battleResult, setBattleResult] = useState(null)  // 直近の相互戦闘の結果
  const [self, setSelf] = useState(null)   // 自分の現在HP/MP（profiles.hp_current/mp_current＝街と共有）
  const [enemyHpMap, setEnemyHpMap] = useState({})  // 敵実プレイヤーの現在HP/MP（player_id -> {hp,mp}）

  const nameOf = (cid) => (countries || []).find(c => c.id === cid)?.name || '???'

  const refreshWar = async () => {
    if (!myCountry) { setWar(null); return }
    try { await supabase.rpc('war_tick') } catch { /* 戦争SQL未適用なら無視 */ }
    const { data } = await supabase.from('wars')
      .select('*')
      .or(`attacker_country_id.eq.${myCountry.id},defender_country_id.eq.${myCountry.id}`)
      .order('created_at', { ascending: false })
      .limit(1)
    const w = (data || [])[0] || null
    setWar(w)
    let ps = []
    if (w) {
      const r = await supabase.from('war_participants').select('*').eq('war_id', w.id)
      ps = r.data || []
    }
    setParticipants(ps)
    // 自分の現在HP/MP（街と共有の profiles.hp_current/mp_current）を取得
    if (me?.id) {
      const { data: sp } = await supabase.from('profiles')
        .select('hp_current, mp_current, is_dying').eq('id', me.id).single()
      if (sp) setSelf(sp)
    }
    // 敵の実プレイヤー参加者の現在HP/MPをまとめて取得（ダミーは war_participants.hp を使う）
    const enemyCidLocal = w && myCountry ? (w.attacker_country_id === myCountry.id ? w.defender_country_id : w.attacker_country_id) : null
    const realEnemyIds = ps.filter(p => p.country_id === enemyCidLocal && !p.is_dummy).map(p => p.player_id)
    if (realEnemyIds.length) {
      const { data: eps } = await supabase.from('profiles').select('id, hp_current, mp_current').in('id', realEnemyIds)
      const map = {}
      for (const e of (eps || [])) map[e.id] = { hp: e.hp_current, mp: e.mp_current }
      setEnemyHpMap(map)
    } else setEnemyHpMap({})
  }

  // 自然回復（街と同じ：60秒ごとに最大HP/MPの+20%）。戦争ページ滞在中も効かせる。
  const doSelfRegen = async () => {
    if (!me?.id || !loadout?.eff) return
    const { data: sp } = await supabase.from('profiles')
      .select('hp_current, mp_current, is_dying, last_regen_at').eq('id', me.id).single()
    if (!sp) return
    const elapsed = (Date.now() - new Date(sp.last_regen_at).getTime()) / 1000
    if (elapsed < REGEN_SECONDS) return
    const hpMax = loadout.eff.hp_max, mpMax = loadout.eff.mp_max
    const newHp = Math.min(hpMax, Math.floor((sp.hp_current ?? hpMax) + hpMax * 0.2))
    const newMp = Math.min(mpMax, Math.floor((sp.mp_current ?? mpMax) + mpMax * 0.2))
    const newIsDying = newHp >= hpMax ? false : sp.is_dying
    await supabase.from('profiles').update({
      hp_current: newHp, mp_current: newMp, is_dying: newIsDying, last_regen_at: new Date().toISOString(),
    }).eq('id', me.id)
  }

  useEffect(() => {
    (async () => {
      if (me?.id) { try { setLoadout(await loadLoadout(me.id, true)) } catch (e) { setErr('自分のデータ読込に失敗: ' + e.message) } }
      await refreshWar()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 残時間・CD表示のための1秒更新
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id) }, [])

  // 自然回復ループ（15秒ごとに判定→回復したら表示更新）
  useEffect(() => {
    const id = setInterval(async () => { await doSelfRegen(); await refreshWar() }, 15000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadout])

  const declare = async () => {
    if (!target || busy) return
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('declare_war', { p_target_country: target, p_test: testMode })
    if (error) setErr(error.message); else { setMsg(`${nameOf(target)} に宣戦布告！`); await refreshWar() }
    setBusy(false)
  }

  const attack = async () => {
    if (!war || !loadout || busy || Date.now() < cdUntil) return
    setBusy(true); setErr('')
    const { raw, atk, matk, power } = simulateCoreAttack(loadout)
    const { data, error } = await supabase.rpc('war_attack_core', { p_war_id: war.id, p_raw_damage: raw })
    if (error) { setErr(error.message) }
    else {
      setCdUntil(Date.now() + ATTACK_CD_MS)
      setLastInfo({ atk, matk, power, raw, applied: data?.damage ?? null })
      await refreshWar()
    }
    setBusy(false)
  }

  // 相互戦闘（M2-2）: 敵参加者を殴る。HP/MPは街と共有(profiles)。両者の現在値を開始値に20ターン戦う。
  const attackPlayer = async (tgt) => {
    if (!war || !loadout || busy || Date.now() < cdUntil) return
    const myRow = participants.find(p => p.player_id === me?.id)
    if (!myRow) { setErr('あなたは参加者として登録されていません（開戦時seed要）'); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      // 自分の開始HP/MP＝街と共有の現在値（self）。最大は実効値。
      const atkHpMax = loadout.eff?.hp_max || 0
      const atkMpMax = loadout.eff?.mp_max || 0
      const atkStartHp = Math.min(atkHpMax, self?.hp_current ?? atkHpMax)
      const atkStartMp = Math.min(atkMpMax, self?.mp_current ?? atkMpMax)

      // 対象の戦闘入力と開始HP/MP・最大値
      let tgtInput, tgtStartHp, tgtStartMp, tgtHpMax, tgtMpMax
      if (tgt.is_dummy) {
        tgtInput = dummyCombatInput(tgt)
        tgtStartHp = tgt.hp; tgtStartMp = tgt.mp; tgtHpMax = tgt.hp_max; tgtMpMax = tgt.mp_max
      } else {
        tgtInput = await loadLoadout(tgt.player_id, false)
        tgtHpMax = tgtInput.eff?.hp_max || 0; tgtMpMax = tgtInput.eff?.mp_max || 0
        const cur = enemyHpMap[tgt.player_id]
        tgtStartHp = Math.min(tgtHpMax, cur?.hp ?? tgtHpMax)
        tgtStartMp = Math.min(tgtMpMax, cur?.mp ?? tgtMpMax)
      }

      const res = simulateWarBattle(loadout, tgtInput, { atkHp: atkStartHp, atkMp: atkStartMp, tgtHp: tgtStartHp, tgtMp: tgtStartMp })
      const { data, error } = await supabase.rpc('war_attack', {
        p_war_id: war.id, p_target: tgt.player_id,
        p_atk_end_hp: res.atkEndHp, p_atk_end_mp: res.atkEndMp,
        p_tgt_end_hp: res.tgtEndHp, p_tgt_end_mp: res.tgtEndMp,
        p_atk_hp_max: atkHpMax, p_atk_mp_max: atkMpMax,
        p_tgt_hp_max: tgtHpMax, p_tgt_mp_max: tgtMpMax,
      })
      if (error) setErr(error.message)
      else {
        setCdUntil(Date.now() + ATTACK_CD_MS)
        setBattleResult({
          name: tgt.is_dummy ? 'ダミー兵' : tgt.player_id.slice(0, 6),
          tgtBefore: tgtStartHp, tgtAfter: data?.tgt_hp ?? res.tgtEndHp, tgtDying: data?.tgt_dying,
          atkBefore: atkStartHp, atkAfter: data?.atk_hp ?? res.atkEndHp, atkDying: data?.atk_dying,
        })
        await refreshWar()
      }
    } catch (e) { setErr('交戦に失敗: ' + e.message) }
    setBusy(false)
  }

  const forceEnd = async () => {
    if (!war || busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('war_admin_end', { p_war_id: war.id })
    if (error) setErr(error.message); else await refreshWar()
    setBusy(false)
  }

  // 管理者テスト補助: NPC国側にダミー参加者を seed（dying=true で瀕死状態）
  const seedNpc = async (dying) => {
    if (!war || busy) return
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('war_admin_seed_npc', { p_war_id: war.id, p_count: 3, p_hp: 50000, p_dying: dying })
    if (error) setErr(error.message); else { setMsg(dying ? 'NPCダミー3体を瀕死で投入' : 'NPCダミー3体を投入'); await refreshWar() }
    setBusy(false)
  }
  const clearParticipants = async () => {
    if (!war || busy) return
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('war_admin_clear_participants', { p_war_id: war.id })
    if (error) setErr(error.message); else { setMsg('参加者をクリア'); await refreshWar() }
    setBusy(false)
  }

  const isAttacker = war && myCountry && war.attacker_country_id === myCountry.id
  const enemyCid   = war ? (isAttacker ? war.defender_country_id : war.attacker_country_id) : null
  const myCoreHp   = war ? (isAttacker ? war.attacker_core_hp : war.defender_core_hp) : null
  const enemyCoreHp= war ? (isAttacker ? war.defender_core_hp : war.attacker_core_hp) : null
  const ongoing    = war && ['declared','active','resolving'].includes(war.status)
  const remainMs   = war?.ends_at ? Math.max(0, new Date(war.ends_at).getTime() - Date.now()) : 0
  const startInMs  = war?.starts_at ? Math.max(0, new Date(war.starts_at).getTime() - Date.now()) : 0
  const cdRemain   = Math.max(0, cdUntil - Date.now())
  const targetOptions = (countries || []).filter(c => c.id !== myCountry?.id && !c.is_unaffiliated)
  const enemyIsNpc = (countries || []).find(c => c.id === enemyCid)?.is_npc

  // 敵参加者の集計（非瀕死=「dyingでない」or「dying_untilが既に過ぎた」）。非瀕死が0でコア解禁。
  const nowMs = Date.now()
  const isDyingNow = (p) => p.status === 'dying' && p.dying_until && new Date(p.dying_until).getTime() > nowMs
  const enemyParts = participants.filter(p => p.country_id === enemyCid)
  const enemyActive = enemyParts.filter(p => !isDyingNow(p)).length
  const enemyDying  = enemyParts.length - enemyActive
  const coreUnlocked = enemyParts.length > 0 ? enemyActive === 0 : true  // 参加者0(NPC core-only)は従来どおり解禁
  const myRow = participants.find(p => p.player_id === me?.id) || null
  const iAmDying = myRow ? isDyingNow(myRow) : false

  const resultText = war?.status === 'done'
    ? (war.result === 'draw' ? '🤝 引き分け（領地移動なし）'
      : (war.winner_country_id === myCountry?.id ? `🏆 ${myCountry?.name} の勝利！ ${nameOf(enemyCid)} を併合`
        : `💀 ${nameOf(war.winner_country_id)} の勝利…`))
    : null

  return (
    <div style={box}>
        {!myCountry && <div style={{ color:'#ddaa88', fontSize:'12px' }}>国に所属していません。領地画面で建国または加入してください。</div>}

        {myCountry && (
          <div style={{ color:'#bb9977', fontSize:'11px', marginBottom:'10px' }}>
            自国: <b style={{ color:'#ffcc88' }}>{myCountry.name}</b>（あなた: {me?.country_rank || '—'}）
          </div>
        )}

        {/* 結果バナー（直近の戦争が done のとき） */}
        {resultText && (
          <div style={{ textAlign:'center', color: war.result === 'draw' ? '#aaaaaa' : '#ffcc44', fontSize:'14px', border:'1px solid #5a2a1a', background:'#1a0c04', padding:'10px', marginBottom:'10px' }}>{resultText}</div>
        )}

        {/* 進行中の戦争 */}
        {ongoing && war.status === 'declared' && (
          <div style={{ border:'1px solid #5a2a1a', background:'#1a0c04', padding:'10px', marginBottom:'10px' }}>
            <div style={{ color:'#ffcc88', fontSize:'13px', marginBottom:'4px' }}>⏳ 開戦待ち：vs {nameOf(enemyCid)}</div>
            <div style={{ color:'#bb9977', fontSize:'11px' }}>開戦まで {startInMs > 0 ? fmt(startInMs) : 'まもなく'}。下のボタンで反映。</div>
            <button onClick={refreshWar} disabled={busy} style={{ marginTop:'8px', background:'#2a1008', border:'1px solid #e05a62', color:'#ff8a6a', padding:'6px 14px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🔄 状態を更新（war_tick）</button>
          </div>
        )}

        {ongoing && war.status === 'active' && (
          <div style={{ border:'1px solid #5a2a1a', background:'#1a0c04', padding:'10px', marginBottom:'10px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'8px' }}>
              <div style={{ color:'#ff8a6a', fontSize:'13px' }}>⚔ 交戦中：vs {nameOf(enemyCid)}{enemyIsNpc ? '（NPC）' : ''}</div>
              <div style={{ color:'#ddbb88', fontSize:'11px' }}>残り {fmt(remainMs)}</div>
            </div>
            <CoreBar label={`敵コア（${nameOf(enemyCid)}）`} hp={enemyCoreHp} color="#ff5544" />
            <CoreBar label={`自国コア（${myCountry?.name}）`} hp={myCoreHp} color="#44aaff" />

            {/* 自分の現在HP/MP（街と共有・自然回復で回復） */}
            {myRow && (() => {
              const hpMax = loadout?.eff?.hp_max || 0
              const mpMax = loadout?.eff?.mp_max || 0
              const hpCur = Math.min(hpMax, self?.hp_current ?? hpMax)
              const mpCur = Math.min(mpMax, self?.mp_current ?? mpMax)
              return (
                <div style={{ border:'1px solid #2a4a2a', background:'#0a1206', padding:'8px', margin:'8px 0' }}>
                  <div style={{ color: iAmDying ? '#ff7766' : '#88cc88', fontSize:'11px', marginBottom:'4px' }}>
                    あなた（{me?.username || '自分'}）{iAmDying ? ' — 瀕死中（攻撃不可）' : ''}
                    <span style={{ color:'#557755', fontSize:'9px' }}> ※街と共有・60秒ごと自然回復</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' }}>
                    <span style={{ color:'#88cc88', fontSize:'10px', width:'24px' }}>HP</span>
                    <StatBar cur={hpCur} max={hpMax} color="#44cc66" />
                    <span style={{ color:'#aaccaa', fontSize:'10px', minWidth:'90px', textAlign:'right' }}>{hpCur.toLocaleString()} / {hpMax.toLocaleString()}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    <span style={{ color:'#6699cc', fontSize:'10px', width:'24px' }}>MP</span>
                    <StatBar cur={mpCur} max={mpMax} color="#4488dd" />
                    <span style={{ color:'#aaccdd', fontSize:'10px', minWidth:'90px', textAlign:'right' }}>{mpCur.toLocaleString()} / {mpMax.toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}

            {/* 敵参加者の状況＝コア解禁条件 */}
            <div style={{ color: coreUnlocked ? '#88cc66' : '#ddaa66', fontSize:'11px', margin:'6px 0' }}>
              敵防衛: 戦闘可能 <b>{enemyActive}</b> ／ 瀕死 <b>{enemyDying}</b>
              {enemyParts.length === 0
                ? '（参加者なし＝コア直接攻撃可）'
                : (coreUnlocked ? ' → 全員瀕死！コア解禁🔓' : ' → 全員瀕死にするまでコアは攻撃不可🔒')}
            </div>

            {/* 敵参加者リスト（殴って瀕死にする） */}
            {enemyParts.length > 0 && (
              <div style={{ border:'1px solid #4a2a1a', background:'#160a04', padding:'8px', marginBottom:'8px' }}>
                <div style={{ color:'#ddaa77', fontSize:'10px', marginBottom:'6px' }}>敵参加者（殴って瀕死にするとコアが解禁）</div>
                {enemyParts.map((p, i) => {
                  const dying = isDyingNow(p)
                  const canAttack = !dying && !iAmDying && cdRemain === 0 && !busy
                  // 実プレイヤーは profiles の現在HP（街と共有）、ダミーは war_participants.hp
                  const curHp = p.is_dummy ? p.hp : (enemyHpMap[p.player_id]?.hp ?? p.hp)
                  return (
                    <div key={p.player_id} style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'5px', opacity: dying ? 0.5 : 1 }}>
                      <span style={{ color:'#ccb088', fontSize:'10px', width:'72px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {p.is_dummy ? `ダミー${i + 1}` : p.player_id.slice(0, 6)}
                      </span>
                      <StatBar cur={curHp} max={p.hp_max} color={dying ? '#885544' : '#dd5544'} h={10} />
                      <span style={{ color:'#bba088', fontSize:'10px', minWidth:'74px', textAlign:'right' }}>{Math.max(0, curHp).toLocaleString()}/{p.hp_max.toLocaleString()}</span>
                      <button onClick={() => attackPlayer(p)} disabled={!canAttack}
                        style={{ background: canAttack ? '#3a1208' : '#1a0c06', border:`1px solid ${canAttack ? '#ff6644' : '#5a3a2a'}`, color: canAttack ? '#ff9977' : '#7a5a4a', padding:'3px 8px', cursor: canAttack ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px', whiteSpace:'nowrap' }}>
                        {dying ? '瀕死' : (cdRemain > 0 ? `${Math.ceil(cdRemain/1000)}s` : '🗡交戦')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 直近の交戦結果 */}
            {battleResult && (
              <div style={{ border:'1px solid #4a2a1a', background:'#0c0604', padding:'8px', marginBottom:'8px', fontSize:'10px', color:'#ccb088', lineHeight:'1.6' }}>
                ⚔ {battleResult.name} と交戦：
                相手HP {battleResult.tgtBefore.toLocaleString()}→<b style={{ color:'#ff8866' }}>{battleResult.tgtAfter.toLocaleString()}</b>{battleResult.tgtDying ? ' 💀瀕死！' : ''}
                ／ 自分HP {battleResult.atkBefore.toLocaleString()}→<b style={{ color:'#88cc66' }}>{battleResult.atkAfter.toLocaleString()}</b>{battleResult.atkDying ? ' 💀瀕死！' : ''}
              </div>
            )}

            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
              <button onClick={attack} disabled={busy || cdRemain > 0 || !coreUnlocked}
                style={{ flex:1, minWidth:'160px', background: (cdRemain>0||!coreUnlocked)?'#1a0c06':'#3a1208', border:`1px solid ${(cdRemain>0||!coreUnlocked)?'#5a3a2a':'#ff6644'}`, color: (cdRemain>0||!coreUnlocked)?'#7a5a4a':'#ff9977', padding:'10px', cursor: (cdRemain>0||!coreUnlocked)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'1px' }}>
                {cdRemain > 0 ? `⏱ ${Math.ceil(cdRemain/1000)}秒` : (coreUnlocked ? '🗡 敵コアを攻撃' : '🔒 コアは攻撃不可')}
              </button>
              <button onClick={forceEnd} disabled={busy}
                style={{ background:'#1a0c06', border:'1px solid #886644', color:'#bb9966', padding:'10px 12px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>⏹ 即決着（テスト）</button>
            </div>

            {/* 管理者テスト補助（M2-1：瀕死ゲート検証用） */}
            {me?.is_admin && (
              <div style={{ marginTop:'8px', borderTop:'1px dashed #4a2a1a', paddingTop:'8px', display:'flex', gap:'6px', flexWrap:'wrap' }}>
                <span style={{ color:'#886644', fontSize:'10px', width:'100%' }}>🛠 検証ツール（NPCダミー参加者）</span>
                <button onClick={() => seedNpc(false)} disabled={busy} style={{ background:'#0c1206', border:'1px solid #559944', color:'#99cc77', padding:'5px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>＋ダミー3体(戦闘可)</button>
                <button onClick={() => seedNpc(true)} disabled={busy} style={{ background:'#120c06', border:'1px solid #996644', color:'#ccaa77', padding:'5px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>＋ダミー3体(瀕死)</button>
                <button onClick={clearParticipants} disabled={busy} style={{ background:'#120606', border:'1px solid #884444', color:'#cc7777', padding:'5px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>参加者クリア</button>
              </div>
            )}
          </div>
        )}

        {/* 宣戦布告（進行中の戦争が無いとき） */}
        {myCountry && !ongoing && (
          <div style={{ border:'1px solid #5a2a1a', background:'#160a04', padding:'10px', marginBottom:'10px' }}>
            <div style={{ color:'#ffcc88', fontSize:'12px', marginBottom:'8px' }}>宣戦布告（元帥のみ）</div>
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
              <select value={target} onChange={e => setTarget(e.target.value)}
                style={{ flex:1, minWidth:'180px', background:'#120a04', border:'1px solid #5a2a1a', color:'#e0c0a0', padding:'8px', fontFamily:'monospace', fontSize:'12px' }}>
                <option value="">対象の国を選択…</option>
                {targetOptions.map(c => <option key={c.id} value={c.id}>{c.emblem || ''} {c.name}{c.is_npc ? '（NPC）' : ''}</option>)}
              </select>
              <button onClick={declare} disabled={busy || !target}
                style={{ background:'#3a1208', border:'1px solid #ff6644', color:'#ff9977', padding:'8px 16px', cursor:(busy||!target)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px' }}>宣戦布告</button>
            </div>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', color:'#bb9977', fontSize:'11px', marginTop:'8px', cursor:'pointer' }}>
              <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} />
              テスト即時開戦（管理者・3日待たずに開戦）
            </label>
          </div>
        )}

        {msg && <div style={{ color:'#ffcc66', fontSize:'11px', marginBottom:'6px' }}>{msg}</div>}
        {err && <div style={{ color:'#ff8899', fontSize:'11px', marginBottom:'6px' }}>{err}</div>}

        {/* 直近のコア攻撃の数値 */}
        {lastInfo && (
          <div style={{ border:'1px solid #4a2a1a', background:'#0c0604', padding:'10px', marginTop:'4px' }}>
            <div style={{ color:'#ddbb88', fontSize:'11px', lineHeight:'1.7' }}>
              前回の攻撃: 攻撃力 <b style={{ color:'#ffcc66' }}>{lastInfo.atk.toLocaleString()}</b>
              ＋特攻 <b style={{ color:'#ffcc66' }}>{lastInfo.matk.toLocaleString()}</b>
              ＝ 合計 <b style={{ color:'#ffdd88' }}>{lastInfo.power.toLocaleString()}</b>
              <br />
              <span style={{ color:'#88775a' }}>送信 {lastInfo.raw.toLocaleString()} → </span>
              コア実ダメ <b style={{ color:'#ff8866' }}>{(lastInfo.applied ?? 0).toLocaleString()}</b>
              <span style={{ color:'#88775a' }}>（90%軽減後）</span>
            </div>
          </div>
        )}
    </div>
  )
}
