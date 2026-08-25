import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import V2LogLine from './V2LogLine.jsx'
import { runBattle } from '../lib/battle.js'
import { buildBattleLog } from '../lib/battleLog.js'
import { toFighter } from '../lib/loadout.js'
import { calcPower } from '../lib/stats.js'
import { SKILL_BY_NAME } from '../lib/skills.js'
import { ITEM_BY_ID } from '../lib/equipment.js'
import { rollDropRank } from '../lib/enemies.js'
import { SORTIE_CD, dropRateOf, rollHasDrop } from '../lib/sortie.js'
import {
  FLOORS, champOf, snapshotOf, streakBonusPct, applyStreakBonus,
  floorAfterLose, expOf, canChallenge, STREAK_PCT, GUARD_DROP_MULT, DROP_RANKS,
} from '../lib/arena.js'
import { box, btn, miniBtn, RANK_COLOR, dropLine } from './v2ui.js'
import V2Evolve from './V2Evolve.jsx'
import { pushWeaponRecord } from './weaponRecord.js'
import V2Help from './V2Help.jsx'

// アリーナ（あるけみすとの天空闘技場と同じ仕組み）。
// ★戦闘はここで回して、結果を v2_arena_fight へ申告する（出撃と同じ形）。
//   仕組みの説明と定数は src/v2/lib/arena.js が正。
//
// 表示は「いまいる階の階層守護者」と「一覧」の2つだけ。挑戦できるのは自分の階の階層守護者。
// embedded … ホームの出撃タブの中に置くとき。自前の「← ホームへ」は出さず、階の一覧は畳んでおく
export default function V2Arena({ prof, inventory, runes, fishDex, dex, onProfile, onBack, embedded = false }) {
  const [rows, setRows] = useState([])       // v2_arena_floors（埋まっている階だけ）
  const [logs, setLogs] = useState([])
  const [scene, setScene] = useState('lobby')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showList, setShowList] = useState(!embedded)   // 階の一覧（ホームでは畳んでおく）
  // 武器の進化：節目に達した武器（ポップアップで受け取る）
  const [evolving, setEvolving] = useState(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t) }, [])

  const load = async () => {
    const { data, error } = await supabase.from('v2_arena_floors').select('*')
    if (error) { setMsg(error.message); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const byFloor = useMemo(() => Object.fromEntries((rows || []).map(r => [r.floor, r])), [rows])
  const floor = Math.min(FLOORS, Math.max(1, prof.arena_floor || 1))
  const defending = (rows || []).find(r => String(r.player_id) === String(prof.id)) || null
  const champ = champOf(floor, byFloor[floor], SKILL_BY_NAME)

  const me = useMemo(() => toFighter(prof, inventory, runes, fishDex, dex), [prof, inventory, runes, fishDex, dex])
  const myPower = calcPower(me.stats)
  const foePower = champ ? calcPower(champ.stats) : 0
  const bonus = champ ? streakBonusPct(champ.streak, floor, myPower, foePower) : 0

  // 出撃とクールタイムを共有する（あるけみすとも「探索」と共有）。★10秒固定
  const cd = SORTIE_CD
  const last = prof.last_sortie_at ? new Date(prof.last_sortie_at).getTime() : 0
  const remain = Math.max(0, cd - (now - last) / 1000)
  // 自分の階を中心に前後3階ずつ。端では寄せる（いつも同じ枚数出す）
  const nearFloors = (() => {
    const span = 7
    const start = Math.max(1, Math.min(FLOORS - span + 1, (defending?.floor || floor) - 3))
    return Array.from({ length: Math.min(span, FLOORS) }, (_, i) => start + i)
  })()
  const blocked = canChallenge({ defending })
  const canAct = !blocked && remain <= 0 && !busy && !!champ

  const fight = async () => {
    if (!canAct) return
    setBusy(true); setMsg(''); setScene('battle'); setLogs([])

    // ★挑戦者は毎回満タン。階層守護者は前の戦いで減ったHP/MPのまま
    const mine = { ...me, stats: applyStreakBonus(me.stats, bonus) }
    // ★階層守護者は前の防衛で減ったHP/MPのまま始まる（挑戦者は満タン）
    const foe = { ...champ, startHp: champ.hp, startMp: champ.mp }
    const r = runBattle(mine, foe)
    const win = r.winner === 'a'
    const exp = expOf()
    // ★装備のドロップ率は出撃とまったく同じ（クールタイムを共有するので揃える）。
    //   アリーナは**勝敗によらず**同じ確率で落ちる（出撃は勝ったときだけ）
    const drop = rollHasDrop()
      ? (() => {
          // ★ランクの表はどの階でも同じ。F〜Sまで出るが高いほど出にくい
          const rank = rollDropRank({ dropRanks: DROP_RANKS })
          const pool = Object.values(ITEM_BY_ID).filter(i => i.rank === rank)
          return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
        })()
      : null

    const out = []
    out.push({ text:`${floor}階の階層守護者 ${champ.name} が立ちはだかる！`, color:'#ff88cc' })
    if (bonus) out.push({ text:`✊ ${champ.streak}連勝中！ あなたのステータスが+${bonus}%（HP/MPを除く）`, color:'#44ff88' })
    out.push(...buildBattleLog(r, mine.name, champ.name))
    out.push(win
      ? { text:`${champ.name}を倒した！ ${floor}階の階層守護者になった`, color:'#ffcc00' }
      : { text:`敗北…（${r.turns}ターン）`, color:'#ff4444' })
    out.push({ text:`EXP +${exp}`, color:'#ffcc00' })
    // ★色を付けるのは**ランクと装備名だけ**。行全体は塗らない（V2LogLine）
    if (drop) out.push(dropLine(drop, RANK_COLOR[drop.rank]))
    if (!win) out.push({ text:`次は${floorAfterLose(floor)}階から`, color:'#7fa6d0' })
    setLogs(out)

    const { data, error } = await supabase.rpc('v2_arena_fight', {
      p_win: win, p_my_hp: Math.max(1, Math.round(r.a.hp)), p_my_mp: Math.max(0, Math.round(r.a.mp)),
      p_foe_hp: Math.max(1, Math.round(r.b.hp)), p_foe_mp: Math.max(0, Math.round(r.b.mp)),
      p_snapshot: snapshotOf(me), p_exp: exp, p_drop: drop?.id || null,
    })
    setBusy(false)
    if (error || !data?.ok) {
      setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
      return
    }
    if (data.level?.ups > 0) setLogs(l => [...l, { text:`🆙 レベルアップ！ LV${data.level.lv}`, color:'#44ff88' }])
    // ★武器の進化（戦闘記憶）。出撃とまったく同じ関数を通す（片方だけ入れ忘れない）
    const ready = await pushWeaponRecord(prof, inventory, r, mine.name, champ.name)
    if (ready.length) setEvolving(ready[0])
    await load()
    onProfile(null)
  }

  const retire = async () => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2_arena_retire')
    setBusy(false)
    if (error || !data?.ok) { setMsg(error?.message || data?.error || '降りられませんでした'); return }
    await load(); onProfile(null)
  }

  // 節目に達した武器のポップアップ（出撃・アリーナで同じものを使う）
  const evolveModal = evolving
    ? <V2Evolve pending={evolving} inventory={inventory} onDone={() => { setEvolving(null); onProfile(null) }} />
    : null

  if (scene === 'battle') {
    return (
      <div style={{ ...box, padding:'12px' }}>
        {evolveModal}
        <div style={{ color:'#ff88cc', fontSize:'13px', marginBottom:'10px' }}>⚔ アリーナ {floor}階</div>
        {busy && <div style={{ color:'#7fa6d0', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
        <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2LogLine key={i} l={l} />)}
        </div>
        <button onClick={() => setScene('lobby')} disabled={busy} style={{ ...btn('#0088ff'), width:'100%', padding:'10px' }}>
          🏛 アリーナに戻る
        </button>
      </div>
    )
  }

  return (
    <div>
      {evolveModal}
      {!embedded && <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>}

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
          <span style={{ color:'#ff88cc', fontSize:'13px' }}>⚔ アリーナ</span>
          <V2Help id="arena" />
        </div>
        <div style={{ color:'#7fa6d0', fontSize:'10px', lineHeight:1.8 }}>
          各階に<b style={{ color:'#ff88cc' }}>階層守護者</b>がいます。勝つとその階の階層守護者になり、
          守っているあいだは挑戦できません。<br />
          自分の階層守護者が破られると<b style={{ color:'#44ff88' }}>1つ上の階</b>へ、
          挑戦して負けると<b style={{ color:'#ff8844' }}>1つ下の階</b>へ（戦闘力に関係なく必ず落ちます）。<br />
          <b style={{ color:'#ffcc00' }}>階層守護者のHP/MPは回復しません</b>。挑戦する側は毎回満タンです。<br />
          連勝中の階層守護者に挑むと、こちらのステータスが連勝数×{STREAK_PCT}%上がります（HP/MPを除く）。<br />
          EXPも装備も<b style={{ color:'#ffcc00' }}>勝敗によらず</b>もらえます（装備は{dropRateOf()}%＝出撃と同じ確率）。落ちるランクはどの階でも同じで、F〜Sまで出ます。出撃とクールタイムを共有します。<br />
          <b style={{ color:'#44ff88' }}>守っているあいだは、出撃のルーン素材と装備のドロップ率が×{GUARD_DROP_MULT}</b>になります。
        </div>
      </div>

      {/* 守っているとき */}
      {defending && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px', borderColor:'#ffcc00' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>
            👑 {defending.floor}階を守っています（{defending.streak}連勝中）
          </div>
          <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'8px', lineHeight:1.8 }}>
            HP {defending.hp} / MP {defending.mp}　※守るたびに減り、回復しません<br />
            破られると1つ上の階へ挑戦できるようになります。<b style={{ color:'#44ff88' }}>自分から降りても1つ上へ進めます</b>。<br />
            <b style={{ color:'#44ff88' }}>出撃のルーン素材と装備のドロップ率が×{GUARD_DROP_MULT}</b>（守っているあいだだけ）
          </div>
          <button onClick={retire} disabled={busy} style={{ ...btn('#ff8888'), width:'100%' }}>席を降りる</button>
        </div>
      )}

      {/* ★自分のいる階を上に出す。あるけみすともホームの一番上に前後の階を横に並べ、
          いまの階だけ枠を変えて分かるようにしている（下まで送らないと分からない、を避ける） */}
      <div style={{ ...box, padding:'10px', marginBottom:'10px' }}>
        <div style={{ display:'flex', gap:'4px', overflowX:'auto', paddingBottom:'2px' }}>
          {nearFloors.map(f => {
            const c = champOf(f, byFloor[f], SKILL_BY_NAME)
            const here = f === floor
            const mine = String(byFloor[f]?.player_id || '') === String(prof.id)
            const pct = c ? Math.max(0, Math.min(100, (c.hp / Math.max(1, c.stats.hp)) * 100)) : 0
            return (
              <div key={f} style={{ flex:'0 0 96px', background: here ? '#001a2e' : '#000818',
                border:`1px solid ${here ? '#00ccff' : mine ? '#ffcc00' : '#002244'}`, padding:'5px 6px' }}>
                <div style={{ color: here ? '#00ccff' : '#62789a', fontSize:'9px', textAlign:'center' }}>
                  {f}階{here ? '（いまここ）' : ''}
                </div>
                <div style={{ color: mine ? '#ffcc00' : c?.npc ? '#7fa6d0' : '#88ccff', fontSize:'10px',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'center' }}>
                  {c ? c.name : '空席'}
                </div>
                {/* 階層守護者は回復しないので、残りHPがいちばん大事な情報 */}
                <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', margin:'2px 0' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background: pct > 50 ? '#44ff88' : pct > 20 ? '#ffcc00' : '#ff4444' }} />
                </div>
                <div style={{ color:'#62789a', fontSize:'9px', textAlign:'center' }}>
                  {c?.streak > 0 ? <span style={{ color:'#ff8844' }}>{c.streak}連勝中</span> : '　'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* いまの挑戦先 */}
      {!defending && champ && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>{floor}階の階層守護者</div>
          <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px', marginBottom:'8px' }}>
            <div style={{ color: champ.npc ? '#7fa6d0' : '#ffcc00', fontSize:'12px' }}>
              {champ.name}
              <span style={{ color:'#62789a', fontSize:'10px' }}>　{champ.cls}{champ.npc ? '（NPC）' : ''}</span>
            </div>
            <div style={{ color:'#93a9be', fontSize:'10px' }}>
              戦闘力 {foePower.toLocaleString()}　HP {champ.hp}／{champ.stats.hp}　MP {champ.mp}
              {champ.streak > 0 && <span style={{ color:'#ff8844' }}>　{champ.streak}連勝中</span>}
            </div>
          </div>
          {bonus > 0 && (
            <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'8px' }}>
              ✊ 連勝補正でこちらのステータスが +{bonus}%（HP/MPを除く）
            </div>
          )}
          <button onClick={fight} disabled={!canAct}
            style={{ width:'100%', padding:'14px', background: canAct ? '#1a0018' : '#000e1a',
              border:`1px solid ${canAct ? '#ff88cc' : '#003366'}`, color: canAct ? '#ff88cc' : '#7fa6d0',
              cursor: canAct ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
            {busy ? '戦闘中...' : remain > 0 ? `⏳ ${remain.toFixed(1)}秒` : `⚔ ${floor}階の階層守護者に挑戦する`}
          </button>
          {blocked && <div style={{ color:'#ff8844', fontSize:'11px', marginTop:'8px' }}>{blocked}</div>}
        </div>
      )}

      {msg && <div style={{ ...box, padding:'12px', marginBottom:'10px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}

      {/* 一覧 */}
      <div style={{ ...box, padding:'12px' }}>
        <button onClick={() => setShowList(v => !v)}
          style={{ ...miniBtn('#7fa6d0'), width:'100%', padding:'4px', marginBottom:'6px' }}>
          {showList ? '▲ 階の様子を閉じる' : `▼ 階の様子を見る（${FLOORS}階まで）`}
        </button>
        {showList && (
        <div style={{ display:'grid', gap:'2px' }}>
          {Array.from({ length: FLOORS }, (_, i) => FLOORS - i).map(f => {
            const c = champOf(f, byFloor[f], SKILL_BY_NAME)
            const mine = String(byFloor[f]?.player_id || '') === String(prof.id)
            const here = f === floor && !defending
            return (
              <div key={f} style={{ background: here ? '#001a2e' : '#000818',
                border:`1px solid ${here ? '#0088ff' : mine ? '#ffcc00' : '#002244'}`,
                padding:'3px 6px', display:'flex', alignItems:'center', gap:'6px', fontSize:'10px' }}>
                <span style={{ color:'#62789a', width:'34px', flexShrink:0 }}>{f}階</span>
                <span style={{ color: c?.npc ? '#7fa6d0' : mine ? '#ffcc00' : '#88ccff', flex:1, minWidth:0,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {c ? c.name : '空席'}{mine ? '（あなた）' : ''}
                </span>
                {c?.streak > 0 && <span style={{ color:'#ff8844', flexShrink:0 }}>{c.streak}連勝</span>}
                {c && <span style={{ color:'#62789a', flexShrink:0 }}>HP {c.hp}／{c.stats.hp}</span>}
              </div>
            )
          })}
        </div>
        )}
      </div>
    </div>
  )
}
