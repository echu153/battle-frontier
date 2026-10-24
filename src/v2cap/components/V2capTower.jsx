import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capLogLine from './V2capLogLine.jsx'
import V2capIcon from './V2capIcon.jsx'
import { runBattle } from '../core/battle.js'
import { loadPref } from '../core/prefs.js'
import { artGenderOf } from '../lib/gender.js'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { calcPower } from '../lib/level.js'
import { ascEffectsOf } from '../lib/ascension.js'
import { sortieClock, sendWithCooldownRetry, newSettleKey, settleKeyArgOf } from '../lib/cooldown.js'
import { attackKindOf } from '../lib/jobs.js'
import { buildCapBattleView } from '../lib/battleView.js'
import { expText, gainedExpOf, levelUpLines, dropLineOf } from '../lib/settleLines.js'
import {
  TOWER_NAME, FLOORS, LOSE_DROP, STREAK_PCT, GUARD_DROP_BONUS,
  floorLabel, clampFloor, floorAfterDefended, canChallenge, champOf, floorInfoOf,
  towerBattleOf, towerIconSrc, iconClassOf, hpPmOf, snapshotOf, rollTowerDrop,
} from '../lib/tower.js'

// ============================================================
// 「レベルキャップあり」版 — 塔（あるけみすと型の対人・2026-10-14）
//   決まりと数は src/v2cap/lib/tower.js が正（1〜100層・負けたら2つ下・守護者は回復しない・空き層はNPC・席を降りられる）。
//   ★戦闘はここで回して、結果を v2cap_tower_fight へ申告する（出撃と同じ形）
//   ・【確定】ユーザー指示「該当者は画像みたいに現在の職業のアイコンが表示されるように」：
//     一覧は 層・職業のアイコン（デフォルメの絵・丸い枠）・LV・名前（ユーザーが見せた画像の形）。自分の行は黄色。
//     枠の色は通常攻撃が物理なら赤・魔法なら青。上位職はデフォルメの絵がまだ無いので系統の初期職の絵（tower.js の iconClassOf）
//   ・戦闘ログは出撃と同じ あるけみすと風（battleView.js・V2capLogLine.jsx）。精算のあとの行も出撃と同じ（settleLines.js）
//   ・待ち時間は出撃と共有（サーバーの last_sortie_at から10秒）。画面では出撃と1つの時計（lib/cooldown.js の sortieClock）で数え、
//     サーバーに早すぎると言われたら残りを待って送り直す・挑戦ごとの印を付ける（2026-10-23・出撃と同じ）
// ============================================================
const KIND_RING = { phys: '#ff6655', mag: '#55aaff' }
const ringOf = (cls) => KIND_RING[attackKindOf(cls)] || '#7fa6d0'
const npcTag = (
  <span style={{ color:'#5d7fa8', border:'1px solid #24405e', padding:'0 3px', fontSize:'9px', lineHeight:'13px', display:'inline-block',
    alignSelf:'center', marginLeft:'4px', flexShrink:0 }}>NPC</span>
)
// 残りHPのバー（千分率）
const HpBar = ({ pm, height = 4 }) => {
  const pct = Math.max(0, Math.min(100, pm / 10))
  return (
    <div style={{ background:'#001028', height:`${height}px`, border:'1px solid #002244' }}>
      <div style={{ height:'100%', width:`${pct}%`, background: pct > 50 ? '#44ff88' : pct > 20 ? '#ffcc00' : '#ff4444' }} />
    </div>
  )
}

export default function V2capTower({ prof, inventory, onProfile }) {
  const [rows, setRows] = useState([])        // v2cap_tower_floors（埋まっている層だけ）
  const [loadErr, setLoadErr] = useState('')
  const [scene, setScene] = useState('lobby')
  const [logs, setLogs] = useState([])
  const [art, setArt] = useState(null)        // 戦闘ログのアイコン（{ me:{ src, name }, foe:{ src, name } }）
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showRules, setShowRules] = useState(false)
  const listBox = useRef(null)
  const scrolled = useRef(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t) }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('v2cap_tower_floors').select('floor, player_id, snapshot, hp_pm, mp, streak, since')
    if (error) { setLoadErr(error.message); return }
    setLoadErr('')
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const byFloor = useMemo(() => Object.fromEntries((rows || []).map(r => [r.floor, r])), [rows])
  const guardRow = (rows || []).find(r => String(r.player_id) === String(prof?.id)) || null
  const guarding = !!guardRow || !!prof?.tower_guard
  const guardFloor = guardRow?.floor || prof?.tower_guard || null
  const floor = clampFloor(prof?.tower_floor || 1)
  // 自分の戦闘力を先に出す（空いている層のNPCはこれに合わせて底上げされる＝tower.js の npcPowerFor）
  // ★ニャーガーキングの食事（2026-10-25）は戦うときだけ足す。NPCの底上げ・連勝補正の比べ合い・守護者として残す姿は
  //   食事なし（meal:null）＝食べたぶんが相手の底上げで打ち消されない・食事が切れたあとも守護者に残らない
  const me = useMemo(() => playerFighter(prof, inventory, { meal: null }), [prof, inventory])
  const myPower = calcPower(me.stats)
  const champ = useMemo(() => champOf(floor, byFloor[floor], myPower), [floor, byFloor, myPower])
  const preview = useMemo(() => towerBattleOf({ me, myLv: prof?.lv, champ, floor }), [me, prof?.lv, champ, floor])
  const foePower = calcPower(champ.stats)

  // 待ち時間は出撃と共有（出撃と1つの時計。サーバーの last_sortie_at はページを開いて最初の1回だけ読む＝lib/cooldown.js）
  useEffect(() => { sortieClock.fromServer(prof?.last_sortie_at) }, [prof?.last_sortie_at])
  const remain = sortieClock.leftMs(now) / 1000
  const blocked = canChallenge({ guarding })
  const canAct = !blocked && remain <= 0 && !busy && !loadErr

  // 一覧を開いたら、自分の層（守っていればその層）が見えるところまで送る（1回だけ）
  useEffect(() => {
    const el = listBox.current
    if (!el || scrolled.current || scene !== 'lobby') return
    const target = el.querySelector(`[data-floor="${guardFloor || floor}"]`)
    if (target) {
      el.scrollTop = Math.max(0, target.offsetTop - el.clientHeight / 2)
      scrolled.current = true
    }
  }, [rows, floor, guardFloor, scene])

  const fight = async () => {
    // 時計はいまの値でも見る（2回続けて押されたとき、2回目は1回目の start で止まる）
    if (!canAct || sortieClock.leftMs() > 0) return
    setBusy(true); setMsg(''); setScene('battle'); setLogs([])
    sortieClock.start()
    let freeCd = false   // 守護者が入れ替わっていた（待ち時間を使っていない）
    try {
      // 自分のアイコンの男女はキャラの性別（2026-10-21・gender.js。まだ決めていないキャラだけ神殿の切り替え）。守護者になったときの姿にも入れる
      const gender = artGenderOf(prof, loadPref('capArtGender', 'm'))
      // 戦うのは、いま効いている食事を足した姿（押した時点で数える）。連勝補正は食事なしの戦闘力で比べる
      const fed = playerFighter(prof, inventory)
      const { a, b, bonus } = towerBattleOf({ me: fed, myLv: prof.lv, champ, floor, myPower })
      const r = runBattle(a, b)
      const win = r.winner === 'a'
      // 装備は出撃のふつうの敵と同じ（開いている一番先の場所・勝ち負けによらず）
      const drop = rollTowerDrop(prof.cleared_spots, prof.class, new Date(), Math.random, me.setFx?.rareDropMult || 1)
      // 自分のアイコンも一覧と同じ（上位職は系統の初期職のデフォルメの絵）
      setArt({ me: { src: towerIconSrc({ cls: iconClassOf(prof.class), g: gender }), name: me.name }, foe: { src: towerIconSrc(champ.icon), name: champ.name } })
      const out = []
      out.push({ kind:'act', who:'foe', appear: true, lines: [
        { text:`${floorLabel(floor)}の階層守護者 ${champ.name}（LV${champ.lv}）が立ちはだかる！`, color:'#ff88cc' },
      ] })
      if (bonus) out.push({ text:`✊ ${champ.streak}連勝中の守護者！ あなたのステータスが+${bonus}%（HP/MPを除く）`, color:'#44ff88' })
      // ★守護者は減ったHPから始まる（1ターン目の表もその値）
      out.push(...buildCapBattleView(r, me.name, champ.name, { b: b.startHp }))
      out.push(win
        ? { text:`${champ.name}を倒した！`, color:'#ffcc00', big: true }
        : { text:'敗北…', color:'#ff4444', big: true })
      setLogs(out)

      // 早すぎると言われたら残りを待って送り直す・挑戦ごとの印を付ける（出撃と同じ＝lib/cooldown.js）
      const args = {
        p_floor: floor, p_foe: champ.playerId || null, p_win: win,
        p_my_hp_pm: hpPmOf(r.a), p_my_mp: Math.max(0, Math.round(r.a.mp)),
        p_foe_hp_pm: hpPmOf(r.b), p_foe_mp: Math.max(0, Math.round(r.b.mp)),
        p_snapshot: snapshotOf(me, { lv: prof.lv, gender, ups: ascEffectsOf(prof).ups }), p_drop: drop ? drop.item.id : null,
        ...settleKeyArgOf(prof, newSettleKey()),
      }
      const { data, error } = await sendWithCooldownRetry(() => supabase.rpc('v2cap_tower_fight', args),
        { onWait: (ms) => sortieClock.wait(ms) })
      if (error || !data?.ok) {
        setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
        // 守護者が入れ替わっていた（画面が古かった）ときは、待ち時間を使っていないので読み直してすぐ挑戦できる
        if (data?.changed) { freeCd = true; await load(); onProfile(null) }
        return
      }
      const after = []
      after.push(win
        ? { text:`👑 ${floorLabel(floor)}の階層守護者になった！`, color:'#ffcc00' }
        : { text:`次は${floorLabel(data.next_floor)}から挑戦（負けると${LOSE_DROP}つ下）`, color:'#7fa6d0' })
      after.push({ text:`${expText(gainedExpOf(data), prof.lv)}　Gold +${data.gold}`, color:'#ffcc00' })
      after.push(...levelUpLines(prof.class, data.level))
      if (data.drop && drop) after.push(dropLineOf(drop.item))
      setLogs(l => [...l, ...after])
      await load()
      onProfile(null)
    } finally {
      if (freeCd) sortieClock.clear()
      else sortieClock.start()
      setBusy(false)
    }
  }

  const retire = async () => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2cap_tower_retire')
    setBusy(false)
    if (error || !data?.ok) { setMsg(error?.message || data?.error || '席を降りられませんでした'); return }
    setMsg(`${floorLabel(data.floor)}の席を降りました。次は${floorLabel(data.next_floor)}に挑戦できます`)
    await load()
    onProfile(null)
  }

  if (scene === 'battle') {
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#ff88cc', fontSize:'13px', marginBottom:'10px' }}>🗼 {TOWER_NAME} {floorLabel(floor)}</div>
        <div style={{ marginBottom:'12px', maxHeight:'420px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2capLogLine key={i} l={l} art={art} />)}
        </div>
        <button onClick={() => { setScene('lobby'); scrolled.current = false }} disabled={busy}
          style={{ ...btn('#0088ff'), width:'100%', padding:'10px' }}>
          🗼 塔に戻る
        </button>
      </div>
    )
  }

  const record = `${prof?.tower_wins || 0}勝${prof?.tower_losses || 0}敗`
  return (
    <div>
      {/* 見出しと決まり（決まりは畳んでおく） */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <span style={{ color:'#ff88cc', fontSize:'14px', letterSpacing:'2px' }}>🗼 {TOWER_NAME}</span>
          <span style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ color: TEXT.sub, fontSize:'10px' }}>戦績 {record}</span>
            <button onClick={() => setShowRules(v => !v)} style={miniBtn('#7fa6d0')}>{showRules ? '決まりを閉じる' : '決まり'}</button>
          </span>
        </div>
        {showRules && (
          <div style={{ color:'#93a9be', fontSize:'10px', lineHeight:1.8, marginTop:'8px' }}>
            1〜{FLOORS}層。自分のいる層の<b style={{ color:'#ff88cc' }}>階層守護者</b>に挑みます。<br />
            勝つとその層の守護者になり、守っているあいだは挑戦できません。破られるか、自分から席を降りると<b style={{ color:'#44ff88' }}>1つ上の層</b>へ。<br />
            挑戦して負けると<b style={{ color:'#ff8844' }}>{LOSE_DROP}つ下の層</b>へ。<br />
            <b style={{ color:'#ffcc00' }}>守護者のHP/MPは回復しません</b>。挑戦する側は毎回満タンです。<br />
            連勝中の守護者に挑むと、こちらのステータスが連勝数×{STREAK_PCT}%上がります（HP/MPを除く）。<br />
            勝ち負けによらず、出撃と同じEXP・Gold・装備（開いている一番先の場所のふつうの敵1体ぶん）。待ち時間は出撃と共有です。<br />
            <b style={{ color:'#44ff88' }}>守護者でいるあいだ、出撃の装備のドロップ率+{GUARD_DROP_BONUS}%</b>。<br />
            <span style={{ color:'#5d7fa8' }}>NPC</span>の印は、空いている層の番人です。
          </div>
        )}
      </div>

      {loadErr && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px', fontSize:'11px', color:'#ff8844' }}>
          ⚠ 塔を読み込めませんでした（{loadErr}）
        </div>
      )}

      {/* 守っているとき */}
      {guarding && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px', borderColor:'#ffcc00' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>
            👑 {floorLabel(guardFloor)}を守っています{guardRow?.streak ? `（${guardRow.streak}連勝中）` : ''}
          </div>
          {guardRow && (
            <div style={{ marginBottom:'6px' }}>
              <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'2px' }}>
                残りHP {Math.round(guardRow.hp_pm / 10)}%・MP {guardRow.mp}（守るたびに減り、回復しません）
              </div>
              <HpBar pm={guardRow.hp_pm} height={6} />
            </div>
          )}
          <div style={{ color:'#44ff88', fontSize:'10px', marginBottom:'8px' }}>出撃の装備のドロップ率+{GUARD_DROP_BONUS}%（守っているあいだだけ）</div>
          <button onClick={retire} disabled={busy} style={{ ...btn('#ff8888'), width:'100%' }}>
            席を降りる（次は{floorLabel(floorAfterDefended(guardFloor))}へ挑戦）
          </button>
        </div>
      )}

      {/* いまの挑戦先 */}
      {!guarding && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>{floorLabel(floor)}の階層守護者</div>
          <div style={{ display:'flex', gap:'10px', alignItems:'center', background:'#000818', border:'1px solid #002244', padding:'8px', marginBottom:'8px' }}>
            <V2capIcon key={towerIconSrc(champ.icon) || 'none'} src={towerIconSrc(champ.icon)} name={champ.name} ring={ringOf(champ.cls)} size={52} round />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', minWidth:0 }}>
                <span style={{ color:'#93a9be', fontSize:'11px', flexShrink:0 }}>LV{champ.lv}</span>
                <span style={{ color: champ.npc ? '#a9c4e0' : '#ffffff', fontSize:'13px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{champ.name}</span>
                {champ.npc && npcTag}
              </div>
              <div style={{ color:'#93a9be', fontSize:'10px', margin:'2px 0 4px' }}>
                {champ.cls}　戦闘力 {foePower.toLocaleString()}
                {champ.streak > 0 && <span style={{ color:'#ff8844' }}>　{champ.streak}連勝中</span>}
              </div>
              <HpBar pm={champ.hpPm} />
            </div>
          </div>
          {preview.bonus > 0 && (
            <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'8px' }}>✊ 連勝補正でこちらのステータスが +{preview.bonus}%（HP/MPを除く）</div>
          )}
          <button onClick={fight} disabled={!canAct}
            style={{ width:'100%', padding:'14px', background: canAct ? '#1a0018' : '#000e1a',
              border:`1px solid ${canAct ? '#ff88cc' : '#003366'}`, color: canAct ? '#ff88cc' : '#7fa6d0',
              cursor: canAct ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
            {busy ? '⏳ 待機中...' : remain > 0 ? `⏳ ${remain.toFixed(1)}秒` : `⚔ ${floorLabel(floor)}の階層守護者に挑戦する`}
          </button>
        </div>
      )}

      {msg && <div style={{ ...box, padding:'10px 12px', marginBottom:'10px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}

      {/* 一覧（ユーザーが見せた画像の形：職業のアイコン・LV・名前。上の層から） */}
      <div style={{ ...box, padding:'10px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>階層守護者</div>
        <div ref={listBox} style={{ maxHeight:'440px', overflowY:'auto', position:'relative', border:'1px solid #002244' }}>
          {Array.from({ length: FLOORS }, (_, i) => FLOORS - i).map(f => {
            const info = floorInfoOf(f, byFloor[f])
            const mine = !info.npc && String(info.playerId) === String(prof?.id)
            const here = f === floor && !guarding
            const src = towerIconSrc(info.icon)
            return (
              <div key={f} data-floor={f}
                style={{ display:'flex', alignItems:'center', gap:'8px', padding:'4px 8px', minHeight:'40px',
                  background: here ? '#001a2e' : f % 2 ? '#0a1424' : '#0d182a',
                  borderBottom:'1px solid #14243a', boxShadow: here ? 'inset 0 0 0 1px #0088ff' : mine ? 'inset 0 0 0 1px #ffcc0088' : undefined }}>
                <span style={{ color: here ? '#00ccff' : '#62789a', fontSize:'10px', width:'38px', flexShrink:0, textAlign:'right' }}>{floorLabel(f)}</span>
                <V2capIcon key={src || 'none'} src={src} name={info.name} ring={ringOf(info.cls)} size={30} round />
                <span style={{ color: mine ? '#ffcc00' : '#93a9be', fontSize:'11px', width:'44px', flexShrink:0 }}>LV{info.lv}</span>
                <span style={{ color: mine ? '#ffcc00' : info.npc ? '#a9c4e0' : '#ffffff', fontSize:'12px', flex:1, minWidth:0,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {info.name}{mine ? '（あなた）' : ''}
                </span>
                {info.npc && npcTag}
                {info.streak > 0 && <span style={{ color:'#ff8844', fontSize:'10px', flexShrink:0 }}>{info.streak}連勝</span>}
                {!info.npc && <span style={{ width:'40px', flexShrink:0 }}><HpBar pm={info.hpPm} /></span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
