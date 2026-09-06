import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2LogLine from './V2LogLine.jsx'
import { AREAS_SORTED, areaOf, markOf, biasLabelOf, BIAS_MULT, toFighter as enemyFighter } from '../lib/enemies.js'
import {
  pickEncounter, expOf, isAreaUnlocked, nextBossRate, clearedAreasOf, isAreaCleared,
  clearNext, unlockNext, restToOpenNext, LAST_TIER,
  SORTIE_CD, rollHasDrop, rollIsProtect, rollDrop, rollMaterial, rollFusionDrop,
} from '../lib/sortie.js'
import { staminaMax, rollStamina } from '../lib/stamina.js'
import { runBattle } from '../lib/battle.js'
import { buildBattleLog } from '../lib/battleLog.js'
import { toFighter as playerFighter, equippedRunes, runeAbilities } from '../lib/loadout.js'
import { dropRateMultOf } from '../lib/enchant.js'
import { guardDropMultOf, GUARD_DROP_MULT } from '../lib/arena.js'
import { RARITY_COLOR } from '../lib/material.js'
import { rollRaid, raidBossOf } from '../lib/raid.js'
import { fusionOfEnemy } from '../lib/fusion.js'
import { PROTECT_NAME } from '../lib/smith.js'
import { RANK_COLOR, dropLine, LOG_PLAIN } from './v2ui.js'
import V2Evolve from './V2Evolve.jsx'
import { pushWeaponRecord } from './weaponRecord.js'

// ★旧版（無印）の街とまったく同じ作り。
//   街のブロックが**ホームにそのまま載っている**（別画面へ移動しない）。
//   「次の行動まで」バー → エリアのプルダウン（解放済みだけ）→「◯◯へ出撃！」
//   出撃すると戦闘ログの画面に切り替わり、「🏰 街に戻る」で戻る。
//   戦闘ログの表示は旧版の BattleLogLine をそのまま使っている（ArenaPanel などと同じ）。
//
// ★オート出撃（2026-08-22 追加）
//   スタミナが1以上あるあいだは、10秒ごとに勝手に出撃する（1回につき1消費）。
//   切れたら止まり、**これまで通り自分でクリックして出撃**する（手動は消費しない）。
//   ⚠消費と回復の権威はサーバー（v2_sortie_settle / v2_stamina_roll）。ここは表示と読み替え。
export default function V2Sortie({ prof, inventory, runes, fishDex, dex, pet, guard, onProfile, onScene, onRaid }) {
  const [scene, setScene] = useState('town')
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('v2SelectedArea')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  // ★オートは覚えておかない（リロードで勝手に走り出してスタミナを溶かさないように）
  const [auto, setAuto] = useState(false)
  // スタミナ。サーバーが返した「値と数え直した時刻」を持ち、経過ぶんは画面側で足して出す
  const [stam, setStam] = useState(() => ({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }))
  // 武器の進化：節目に達した武器（ポップアップで受け取る）
  const [evolving, setEvolving] = useState(null)
  const lastAt = useRef(0)
  // ★2重発火よけ。オートは100msごとに条件を見るので、setLoading(true) が画面へ反映される前に
  //   もう一度呼ばれる余地がある。ref なら**その場で**閉じられる（stateだと間に合わない）
  const busy = useRef(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  useEffect(() => { onScene?.(scene) }, [scene, onScene])
  // プロフィールを取り直したら、そちらの値へ合わせる
  useEffect(() => { setStam({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }) }, [prof?.stamina, prof?.stamina_at])

  const unlocked = prof?.unlocked_areas || [1]
  // ★解放されていないエリアはプルダウンに出さない（旧版と同じ）
  // ★並べる順は**難易度帯の順**（id は9〜15が後ろに付いているだけで難易度順ではない）
  const availableAreas = AREAS_SORTED.filter(a => isAreaUnlocked(unlocked, a.id))
  const area = availableAreas.find(a => a.id === selectedArea) || availableAreas[0]
  // ★エリアボスを倒したエリアはプルダウンで「踏破済み」と分かるようにする
  const cleared = clearedAreasOf(prof)
  // アリーナで階層守護者でいるあいだのドロップ率ボーナス（arena.js）
  const guardMult = guardDropMultOf(guard)
  const elapsed = (now - lastAt.current) / 1000
  const remaining = Math.max(0, SORTIE_CD - elapsed)
  const canAct = remaining <= 0 && !loading
  const timerPct = Math.min(100, (elapsed / SORTIE_CD) * 100)
  // ★スタミナの残り。**表示（何／何・次まで何分）はステータスの枠が持つ**（V2Status）。
  //   戦闘中は出撃のパネルが隠れてしまうので、常に見えるあちらへ寄せてある。
  //   ここで要るのは「オートを回せるか」の判定と、ボタンに出す残り回数だけ
  const stamMax = staminaMax(prof?.job_changes)
  const stamNow = rollStamina(stam.n, stam.at, stamMax, now).n

  const doBattle = async (isAuto = false) => {
    // ★判定は ref で行う（state の canAct は1フレーム古いことがある）
    if (busy.current || !area) return
    if (Date.now() - lastAt.current < SORTIE_CD * 1000) return
    busy.current = true
    lastAt.current = Date.now()
    setLoading(true); setScene('battle'); setLogs([])
    try {
      const me = playerFighter(prof, inventory, runes, fishDex, dex, pet)
      // 「素材ドロップ率up」の特殊能力ぶん。★重複せず、一番高いものだけが効く
      // ★アリーナで階層守護者でいるあいだは、素材も装備も落ちやすくなる（×1.1・掛け算で乗る）
      const matMult = dropRateMultOf(runeAbilities(equippedRunes(prof, inventory, runes))) * guardMult
      const enc = pickEncounter(area.id, bossRate, new Date())
      // ★ボスかどうかは戦闘（「大敵斬り」）と戦績（ボス討伐数）の両方が見る
      const r = runBattle(me, { ...enemyFighter(enc.enemy, 8), boss: enc.isBoss })
      const win = r.winner === 'a'
      const exp = win ? expOf(enc.isBoss) : 0
      // ★落ちたものが装備か守りの護符か。**同じ抽選から出る**（sortie.js の PROTECT_SHARE）
      const gotDrop = win && rollHasDrop(Math.random, guardMult)
      const gotProtect = gotDrop && rollIsProtect()
      const drop = gotDrop && !gotProtect ? rollDrop(area.id, new Date()) : null
      // ★レアモンスターは素材を**確定で**落とす（内訳は55/35/10・sortie.js）
      const mat = win ? rollMaterial(enc.enemy.name, matMult, Math.random, { sure: !!enc.isRare }) : null
      // ★合成素材（2026-09-06）。倒した敵のぶんが**一律1%**で落ちる。
      //   装備・護符・ルーン素材とは**まったく別の抽選**（重なってもよい）
      const fuse = win && rollFusionDrop() ? fusionOfEnemy(enc.enemy.name) : null
      setBossRate(nextBossRate(bossRate, enc.isBoss))

      // 旧版の文体に合わせる（BattleLogLine が スキル名・ダメージ・回復 を拾って色を付ける）
      const out = []
      out.push(enc.isBoss
        ? { text:`⚠ ボス出現！ ${enc.enemy.name}が現れた！`, color:'#ff4444' }
        : enc.isRare
          ? { text:`✦ レアモンスター出現！ ${enc.enemy.name}が現れた！`, color:'#ffcc44' }
          : { text:`${enc.enemy.name}が現れた！`, color:'#88ccff' })
      const foe = enc.enemy.name
      const you = me.name   // ★ログはプレイヤー名で出す（「あなた」とは書かない）
      // ★文面は battleLog.js が正（出撃とアリーナで同じものを使う）
      out.push(...buildBattleLog(r, you, foe))

      out.push(win
        ? { text:`${foe}を倒した！（${r.turns}ターン）`, color:'#ffcc00' }
        : { text:`敗北…（${r.turns}ターン）`, color:'#ff4444' })
      if (win) {
        // ★敵はGoldを落とさない（docs/v2-gold-design.md）。Goldは素材を売って稼ぐ
        out.push({ text:`EXP +${exp}`, color:'#ffcc00' })
        // ★色を付けるのは**ランクと装備名だけ**。行全体は塗らない（V2LogLine）
        if (drop) out.push(dropLine(drop, RANK_COLOR[drop.rank]))
        if (gotProtect) out.push({ color: LOG_PLAIN, parts:[
          { text:'🛡 ' }, { text: PROTECT_NAME, color:'#88ddaa' }, { text:'を入手！' },
        ] })
        if (mat) out.push({ color: LOG_PLAIN, parts:[
          { text:'⚗ ルーン素材「' },
          { text: mat.name, color: RARITY_COLOR[mat.rarity] },
          { text:'」を入手！' },
        ] })
        if (fuse) out.push({ color: LOG_PLAIN, parts:[
          { text:'✦ 合成素材「' },
          { text: fuse.name, color:'#ff8844' },
          { text:'」を入手！' },
        ] })
        // ★解放は「その帯を全部踏破したか」で決まる（1本道ではない）。
        //   開いたエリアが出たらその名前を、まだなら残りいくつかを出す
        if (enc.isBoss) {
          const nextCleared = clearNext(cleared, area.id, true, true)
          const opened = unlockNext(unlocked, nextCleared).filter(id => !unlocked.includes(id))
          if (opened.length) {
            out.push({ text:`🔓 ${opened.map(id => areaOf(id)?.name).join('・')}が解放された！`, color:'#44ff88' })
          } else {
            const rest = restToOpenNext(nextCleared, area.tier)
            if (rest > 0 && area.tier < LAST_TIER) {
              out.push({ text:`あと${rest}エリア踏破で難易度${markOf(area.tier + 1)}が解放される`, color:'#7fa6d0' })
            }
          }
        }
      }
      setLogs(out)

      // ★1戦ごとにその場で反映する（旧版と同じ。まとめて清算はしない）
      const { data, error } = await supabase.rpc('v2_sortie_settle', {
        p_area: area.id, p_normals: enc.isBoss ? 0 : 1,
        p_boss_wins: enc.isBoss && win ? 1 : 0, p_boss_seen: enc.isBoss ? 1 : 0,
        // p_gold は**サーバー側が無視する**（敵はGoldを落とさない）。引数だけ互換で残している
        p_exp: exp, p_gold: 0, p_drops: drop ? [drop.id] : [],
        p_materials: mat ? [mat.id] : [],
        p_protect: gotProtect ? 1 : 0,
        // ★オートで戦ったときだけスタミナを1使う（手動は消費しない）
        p_auto: !!isAuto,
        // ★モンスター図鑑。勝ったときだけ討伐数が1増える。
        //   名前はサーバーが v2_enemies と突き合わせて弾くので、盛れない
        p_enemy: enc.enemy.name, p_win: win,
      })
      // サーバーが返したスタミナへ合わせる（足りずに弾かれたときも returns に入っている）
      if (data && data.stamina != null) setStam({ n: data.stamina, at: data.stamina_at || new Date().toISOString() })
      if (error || !data?.ok) {
        setAuto(false)   // ★弾かれたまま回し続けない
        setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
        return
      }
      if (data.level?.ups > 0) setLogs(l => [...l, { text:`🆙 レベルアップ！ LV${data.level.lv}`, color:'#44ff88' }])
      // ★合成素材は別のRPCで受け取る（core の v2_sortie_settle を触らずに足すため）。
      //   ⚠**失敗したら黙らない**。ログには「入手！」ともう出しているので、
      //     受け取れていないのに手に入ったように見えるのが一番まずい
      if (fuse) {
        const { data: fd, error: fe } = await supabase.rpc('v2_grant_fusion_drop', { p_fusion_id: fuse.id })
        if (fe || !fd?.ok) {
          setLogs(l => [...l, {
            text: `⚠ 合成素材を受け取れませんでした（${fe?.message || fd?.error}）`, color:'#ff8844',
          }])
        }
      }

      // ★レイドボス（docs/v2-raid-design.md §2）。2026-09-06 ユーザー指示で
      //   **エリアボスを討伐したときだけ**引く（確率20%・1人1日2回まで）。
      //   ⚠**清算が通ったあとに引く**＝弾かれた出撃でレイドが立たないように。
      //   ⚠**どのボスが出るか・今日あと何回出会えるかはサーバーが決める**。
      //     こちらが送るのは「どのエリアで引いたか」だけ。断られたら黙って流す
      //     （1日の上限に当たっただけなので、出撃の邪魔をしない）。
      if (enc.isBoss && win && rollRaid()) {
        const { data: rd } = await supabase.rpc('v2_raid_spawn', { p_area: area.id })
        if (rd?.ok) {
          const rb = raidBossOf(rd.raid?.boss_key)
          setLogs(l => [...l,
            { text:`☠ レイドボス出現！ ${rb?.name || 'レイドボス'}が現れた！`, color: rb?.color || '#ff6644' },
            { text:'「レイド」から挑戦できる（1時間・救援信号を出せる）', color:'#ffcc00' }])
          setAuto(false)   // ★オート出撃は止める（気づかずに時間を溶かさないように）
          onRaid?.()
        }
      }

      // ★武器の進化（戦闘記憶）。装備している武器へ1戦ぶんの戦績を積む
      const ready = await pushWeaponRecord(prof, inventory, r, you, foe, { isBoss: enc.isBoss })
      if (ready.length) setEvolving(ready[0])
      onProfile(null)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  // ★オート出撃。クールタイム（10秒）が明けるたびに、スタミナを1使って勝手に出撃する。
  //   進化のポップアップが出ているあいだは止める（選ばせてから続ける）
  useEffect(() => {
    if (!auto || loading || evolving || !area || remaining > 0) return
    if (stamNow < 1) {
      setAuto(false)
      setLogs(l => [...l, { text:'⚡ スタミナ切れ。ここからは自分で出撃する', color:'#ffcc00' }])
      return
    }
    doBattle(true)
  }, [auto, now, loading, evolving, area, remaining, stamNow])   // eslint-disable-line react-hooks/exhaustive-deps

  // 節目に達した武器のポップアップ（出撃・アリーナで同じものを使う）
  const evolveModal = evolving
    ? <V2Evolve pending={evolving} inventory={inventory} onDone={() => { setEvolving(null); onProfile(null) }} />
    : null

  // 次の行動までのバー（★街と戦闘ログの両方に出す。戦闘ログ側でも待ち時間が分かるように）
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


  if (scene === 'battle') {
    return (
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
        {evolveModal}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'10px' }}>
          <span style={{ color:'#ff6644', fontSize:'13px' }}>⚔ バトル！</span>
          {auto && <span style={{ color:'#44ff88', fontSize:'11px' }}>▶ オート出撃中（⚡{stamNow}）</span>}
        </div>
        {/* ★「戦闘中...」の1行はここに置かない（2026-09-06 ユーザー指示）。
            戦闘そのものは runBattle で一瞬で終わっていて、その表示が出ているのは
            **サーバーへ結果を送っているあいだ**。ログはもう出そろっているので、
            上に1行はさまってログが下へずれ、消えるとまた戻る＝ちらつくだけだった。
            反映に失敗したときはログの最後に⚠が出るので、待っている印は要らない。 */}
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2LogLine key={i} l={l} />)}
        </div>
        {/* ★戦闘ログの画面でも次の行動までが分かるようにする（街と同じバー） */}
        {timerRow}
        {auto && (
          <button onClick={() => setAuto(false)}
            style={{ width:'100%', padding:'10px', background:'#1a0a20', border:'1px solid #ff88cc',
              color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
            ■ オートを止める
          </button>
        )}
        {/* ★街に戻らずに同じエリアへもう一度出撃する。溜まっていなければグレーアウト。
            オート中は出さない（勝手に出撃してくれるので要らない） */}
        {!auto && (
          <button onClick={() => doBattle(false)} disabled={!canAct}
            style={{ width:'100%', padding:'10px', background:'#001840',
              border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
              color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
              fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
            {canAct ? `⚔ ${area?.name}へ再出撃！` : '⏳ 待機中...'}
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

  // ===== 街（ホームにそのまま載る） =====
  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
      {evolveModal}
      {timerRow}
      {/* ★守っているあいだは出撃のドロップ率が上がる（アリーナには挑戦できない代わり） */}
      {guard && (
        <div style={{ border:'1px solid #ff88cc', background:'#1a0a20', padding:'5px 8px',
          marginBottom:'8px', fontSize:'11px', color:'#ff88cc' }}>
          👑 {guard.floor}階の階層守護者
          <span style={{ color:'#44ff88' }}>
            {'　'}ルーン素材と装備のドロップ率 ×{GUARD_DROP_MULT}
          </span>
        </div>
      )}
      <select value={area?.id || 1}
        onChange={e => { const v = Number(e.target.value); setSelectedArea(v); localStorage.setItem('v2SelectedArea', v) }}
        style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
        {/* ★出すのは**エリア名だけ**（難易度の番号は出さない・2026-08-22 ユーザー指示）。
            並びは難易度帯の順。踏破済みの空きはCSSが効かないので全角スペースで作る */}
        {availableAreas.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{isAreaCleared(cleared, a.id) ? '　　　✔踏破済み' : ''}
          </option>
        ))}
      </select>
      {/* ★同じ難易度でも、エリアごとに通りやすい型が違う（enemies.js の bias） */}
      <div style={{ fontSize:'10px', color:'#7fa6d0', marginBottom:'8px', textAlign:'right' }}>
        <span style={{ color: area?.bias ? '#88ccff' : '#7fa6d0' }}>
          {biasLabelOf(area?.bias)}
          {area?.bias ? `（与ダメージ+${Math.round((BIAS_MULT - 1) * 100)}%）` : ''}
        </span>
      </div>
      <button onClick={() => doBattle(false)} disabled={!canAct}
        style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
          color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
        {canAct ? `⚔ ${area?.name}へ出撃！` : '⏳ 待機中...'}
      </button>
      {/* ★オート出撃。スタミナがあるあいだ、10秒ごとに勝手に出撃する（1回につき1消費） */}
      <button onClick={() => setAuto(true)} disabled={stamNow < 1}
        style={{ width:'100%', padding:'8px', background: stamNow > 0 ? '#00281a' : '#000818',
          border:`1px solid ${stamNow > 0 ? '#44ff88' : '#2a4a66'}`, color: stamNow > 0 ? '#44ff88' : '#2a4a66',
          cursor: stamNow > 0 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
        {stamNow > 0 ? `▶ オート出撃（あと${stamNow}回）` : '⚡ スタミナ切れ'}
      </button>
      <div style={{ color:'#4d6f92', fontSize:'10px', marginTop:'5px', textAlign:'center' }}>
        {stamNow > 0
          ? 'スタミナ1につき1回、10秒ごとに自動で出撃します'
          : '自分でクリックする出撃はスタミナを使いません'}
      </div>
    </div>
  )
}
