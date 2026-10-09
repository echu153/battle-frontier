import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capLogLine from './V2capLogLine.jsx'
import { runBattle } from '../../v2/lib/battle.js'
import { buildBattleLog } from '../../v2/lib/battleLog.js'
import { LOG_PLAIN } from '../../v2/components/v2ui.js'
import { SPOTS, spotOf, spotLabel, spotLvText, ROLE_TENTHS, toFighter as enemyFighter } from '../lib/areas.js'
import {
  pickEncounter, rollEquipDrop, nextBossRate, isSpotUnlocked, isSpotCleared, openUntilOf, rewardRangeOf, SORTIE_CD,
} from '../lib/sortie.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { staminaMaxOf, MAX_LV, rollStamina } from '../lib/level.js'
import { jobOf, jobMaxOf } from '../lib/jobs.js'
import { effectPct } from '../lib/gear.js'
import { RARITY_COLOR, RARITIES, rarityLabel, reqLvOf } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版 — 出撃（ホームの右）
//   作りは今のⅡの出撃（V2Sortie.jsx）と同じ：10秒に1回・オートはスタミナ1／回・手動は無消費。
//   違うのは（2026-10-09 エリアの作り替え）：
//   ・場所（15エリア×①②③）を1本道で進む。**その場所のボスを倒すと次の場所が開く**
//   ・敵が**LV**を持つ（場所のLV帯の中で、敵ごとに決まっている）
//   ・**EXPとGoldはサーバーが場所の表から決める**（朝昼晩1.5倍・レア3倍・ボス5倍）＝ログは精算の返事を出す
//   ・ClassLVアップ／スキル習得もサーバーの返事から出す
//   ・落ちる装備は**そのエリアの装備**で、レア度はノーマル・レア・エピック・レジェンダリー
//     （エピックはレアとボスから・レジェンダリーはボスからだけ）。武器はいまの職業が装備できる種類（3〜4種）から（sortie.js）
//   ・落ちた装備の**アイテムLV**＝その装備の必要LV（エリア×レア度・ユーザーの表）
// ============================================================
const ROLE_LINE = {
  boss:  (foe, lv) => ({ text:`⚠ ボス出現！ ${foe}（LV${lv}）が現れた！`, color:'#ff4444' }),
  rare:  (foe, lv) => ({ text:`✨ レアモンスター！ ${foe}（LV${lv}）が現れた！`, color:'#ffcc00' }),
  timed: (foe, lv, band) => ({ text:`${foe}（LV${lv}・${band}だけ）が現れた！`, color:'#aaddff' }),
  normal: (foe, lv) => ({ text:`${foe}（LV${lv}）が現れた！`, color:'#88ccff' }),
}
const mult = (role) => `${ROLE_TENTHS[role] / 10}倍`

export default function V2capSortie({ prof, inventory, onProfile, onScene }) {
  const [scene, setScene] = useState('town')
  const [selectedSpot, setSelectedSpot] = useState(() => Number(localStorage.getItem('v2capSelectedSpot')) || 1)
  const [logs, setLogs] = useState([])
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(false)   // ★覚えておかない（リロードで勝手に走らないように）
  const [stam, setStam] = useState(() => ({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }))
  const lastAt = useRef(0)
  const busy = useRef(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  useEffect(() => { onScene?.(scene) }, [scene, onScene])
  useEffect(() => { setStam({ n: prof?.stamina ?? 0, at: prof?.stamina_at || null }) }, [prof?.stamina, prof?.stamina_at])
  useEffect(() => { setBossRate(prof?.boss_rate || 0) }, [prof?.boss_rate])

  const cleared = prof?.cleared_spots || []
  const availableSpots = SPOTS.filter(s => isSpotUnlocked(cleared, s.id))
  // 選んでいた場所がまだ開いていなければ、開いている一番先の場所
  const spot = availableSpots.find(s => s.id === selectedSpot) || spotOf(openUntilOf(cleared))
  const elapsed = (now - lastAt.current) / 1000
  const remaining = Math.max(0, SORTIE_CD - elapsed)
  const canAct = remaining <= 0 && !loading
  const timerPct = Math.min(100, (elapsed / SORTIE_CD) * 100)
  const stamMax = staminaMaxOf(prof?.lv)
  const stamNow = rollStamina(stam.n, stam.at, stamMax, now).n

  const doBattle = async (isAuto = false) => {
    if (busy.current || !spot) return
    if (Date.now() - lastAt.current < SORTIE_CD * 1000) return
    busy.current = true
    lastAt.current = Date.now()
    setLoading(true); setScene('battle'); setLogs([])
    try {
      const me = playerFighter(prof, inventory)
      const enc = pickEncounter(spot.id, bossRate, new Date())
      const r = runBattle(me, { ...enemyFighter(enc.enemy, 8), boss: enc.isBoss })
      const win = r.winner === 'a'
      const drop = win ? rollEquipDrop(enc, prof.class, new Date()) : null
      setBossRate(nextBossRate(bossRate, enc.isBoss))

      const foe = enc.enemy.name
      const you = me.name
      const out = []
      out.push(ROLE_LINE[enc.role](foe, enc.lv, enc.band))
      out.push(...buildBattleLog(r, you, foe))
      out.push(win
        ? { text:`${foe}を倒した！（${r.turns}ターン）`, color:'#ffcc00' }
        : { text:`敗北…（${r.turns}ターン）`, color:'#ff4444' })
      setLogs(out)

      // ★1戦ごとにその場で反映する。EXP・Gold・アイテムLVはサーバーが場所の表から決める
      const { data, error } = await supabase.rpc('v2cap_sortie_settle', {
        p_spot: spot.id, p_enemy: foe, p_win: win, p_drop: drop ? drop.item.id : null, p_auto: !!isAuto,
      })
      if (data && data.stamina != null) setStam({ n: data.stamina, at: data.stamina_at || new Date().toISOString() })
      if (error || !data?.ok) {
        setAuto(false)
        setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
        return
      }
      const lv = data.level || {}
      const after = []
      // ★LV100・ClassLVの上限（初期職30・一次職50）のぶんは入らないので、そう出す
      const lvMax = prof.lv >= MAX_LV
      const jobMax = jobOf(prof.jobs, prof.class).lv >= jobMaxOf(prof.class)
      const expText = `EXP +${data.exp}${lvMax ? '（LV上限のため入らない）' : ''}${jobMax ? '' : `（ClassEXP +${data.exp}）`}`
      if (win) {
        const bonus = enc.role === 'normal' ? '' : `（${enc.role === 'boss' ? 'ボス' : enc.role === 'rare' ? 'レア' : '時間帯限定'}で${mult(enc.role)}）`
        after.push({ text:`${expText}　Gold +${data.gold}${bonus}`, color:'#ffcc00' })
      } else if (data.exp > 0) {
        // 【確定】負けても経験値はその場所の最低値が入る（倍率なし・Goldは入らない・2026-10-09 ユーザー指示）。
        //   文言は「EXP +2（ClassEXP +2）」だけ（「負けても最低値は入る」の添え書きはユーザー指示で外した）
        after.push({ text: expText, color:'#c8a050' })
      }
      // 負けたときの経験値でもLVは上がりうる
      // LVアップではステは上がらず、ステータスポイントが入る（ステータス欄の「振る」から振る）。
      // サーバーが前の版（points を返さない）のあいだは数を出さない
      if (lv.level_ups > 0) {
        const pts = typeof lv.points === 'number' ? `（ステータスポイント+${lv.points}）` : ''
        after.push({ text:`🆙 レベルアップ！ LV${lv.lv}${pts}`, color:'#44ff88' })
      }
      if (lv.job_ups > 0) after.push({ text:`⭐ ClassLVアップ！ ${prof.class} ClassLV${lv.jlv}`, color:'#ffcc00' })
      for (const name of lv.learned || []) after.push({ text:`📖 スキル「${name}」を覚えた！（スキルセットで編成できる）`, color:'#44ddff' })
      if (win) {
        if (data.drop && drop) {
          const ilv = data.drop.ilv
          const pct = effectPct(ilv, lv.lv || prof.lv)
          // ★色を付けるのはレア度と装備名だけ（今のⅡと同じ形）
          const color = RARITY_COLOR[drop.item.rarity]
          const line = { color: LOG_PLAIN, parts: [
            { text:'🎁 ' }, { text:`【${rarityLabel(drop.item.rarity)}】`, color }, { text:'「' }, { text: drop.item.name, color },
            { text:`」を入手！（LV${ilv}）` },
          ] }
          if (pct < 100) line.parts.push({ text:` 必要LVに足りない＝効果${pct}%`, color:'#ff8844' })
          after.push(line)
        }
        // ボスを倒すと次の場所が開く（1本道）。開いたかどうかはサーバーの返事で見る
        if (enc.isBoss && Number(data.open_until) > openUntilOf(cleared)) {
          after.push({ text:`🔓 ${spotLabel(data.open_until)}が解放された！`, color:'#44ff88' })
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
  useEffect(() => {
    if (!auto || loading || !spot || remaining > 0) return
    if (stamNow < 1) {
      setAuto(false)
      setLogs(l => [...l, { text:'⚡ スタミナ切れ。ここからは自分で出撃する', color:'#ffcc00' }])
      return
    }
    doBattle(true)
  }, [auto, now, loading, spot, remaining, stamNow])   // eslint-disable-line react-hooks/exhaustive-deps

  const normalRange = spot ? rewardRangeOf(spot, 'normal') : null

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
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'10px' }}>
          <span style={{ color:'#ff6644', fontSize:'13px' }}>⚔ バトル！</span>
          {auto && <span style={{ color:'#44ff88', fontSize:'11px' }}>▶ オート出撃中（⚡{stamNow}）</span>}
        </div>
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2capLogLine key={i} l={l} />)}
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
            {canAct ? `⚔ ${spot?.name}へ再出撃！` : '⏳ 待機中...'}
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
      {timerRow}
      <select value={spot?.id || 1}
        onChange={e => { const v = Number(e.target.value); setSelectedSpot(v); localStorage.setItem('v2capSelectedSpot', v) }}
        style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
        {/* ★開いている場所だけ（1本道）。場所の敵のLV帯も出す */}
        {availableSpots.map(s => (
          <option key={s.id} value={s.id}>
            {spotLabel(s)}　{spotLvText(s.id)}{isSpotCleared(cleared, s.id) ? '　✔' : ''}
          </option>
        ))}
      </select>
      {spot && (
        <div style={{ fontSize:'10px', color:'#7fa6d0', marginBottom:'8px', lineHeight:1.7 }}>
          <div>敵は{spotLvText(spot.id)}（ボスは上限のLV）</div>
          <div>
            装備の必要LV：{RARITIES.map((r, i) => (
              <span key={r}>{i ? '・' : ''}<span style={{ color: r === 'N' ? '#cfe2ff' : RARITY_COLOR[r] }}>{rarityLabel(r)}</span>{reqLvOf(spot.area, r)}</span>
            ))}
          </div>
          <div>
            装備：<span style={{ color: RARITY_COLOR.E }}>エピック</span>はレアとボス・
            <span style={{ color: RARITY_COLOR.L }}>レジェンダリー</span>はボスだけが落とす
          </div>
          <div>
            1体あたり EXP <span style={{ color:'#ffcc00' }}>{normalRange.exp.join('〜')}</span>・
            Gold <span style={{ color:'#ffcc00' }}>{normalRange.gold.join('〜')}</span>
            （朝昼晩の敵{mult('timed')}・レア{mult('rare')}・ボス{mult('boss')}）
          </div>
          {!isSpotCleared(cleared, spot.id) && <div style={{ color:'#ff8844' }}>ボスを倒すと次の場所が開く</div>}
        </div>
      )}
      <button onClick={() => doBattle(false)} disabled={!canAct}
        style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct ? '#ffcc00' : '#003366'}`,
          color: canAct ? '#ffcc00' : '#7fa6d0', cursor: canAct ? 'pointer' : 'not-allowed',
          fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
        {canAct ? `⚔ ${spot?.name}へ出撃！` : '⏳ 待機中...'}
      </button>
      <button onClick={() => setAuto(true)} disabled={stamNow < 1}
        style={{ width:'100%', padding:'8px', background: stamNow > 0 ? '#00281a' : '#000818',
          border:`1px solid ${stamNow > 0 ? '#44ff88' : '#2a4a66'}`, color: stamNow > 0 ? '#44ff88' : '#2a4a66',
          cursor: stamNow > 0 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px' }}>
        {stamNow > 0 ? `▶ オート出撃（あと${stamNow}回）` : '⚡ スタミナ切れ'}
      </button>
      <div style={{ color:'#4d6f92', fontSize:'10px', marginTop:'5px', textAlign:'center' }}>
        {stamNow > 0 ? 'スタミナ1につき1回、10秒ごとに自動で出撃します' : '自分でクリックする出撃はスタミナを使いません'}
      </div>
    </div>
  )
}
