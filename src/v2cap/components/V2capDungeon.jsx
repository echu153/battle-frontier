import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capAtbFight from './V2capAtbFight.jsx'
import { preloadArt } from '../lib/artPreload.js'
import { box, miniBtn, TEXT } from './v2ui.js'
import { createAtb } from '../core/atb.js'
import { calcPower } from '../core/stats.js'
import { loadPref } from '../core/prefs.js'
import { macrosOf } from '../lib/atbMacro.js'
import { atbPlayerOf } from '../lib/atbPlayer.js'
import { totalStats } from '../lib/loadout.js'
import { openAreaOf } from '../lib/sortie.js'
import { staminaMaxOfProfile } from '../lib/level.js'
import { motionOf } from '../lib/motionArt.js'
import { homeIconOf } from '../lib/classArt.js'
import { artGenderOf } from '../lib/gender.js'
import { CLASS_BY_ID } from '../lib/jobs.js'
import { bossArtOf, bossThumbOf } from '../lib/bossArt.js'
import { bossIllustOf } from '../lib/bossIllust.js'
import {
  CHALLENGE_CATS, DUNGEON_BOSSES, DIFF_KEYS, DUNGEON_MIN, DUNGEON_TRY_SEC, HELPERS_MAX, STAMINA_HELPER, STAMINA_OWNER, STAMINA_OWNER_FIRST,
  diffOf, isDiffReady, isDiffUnlocked, tryStaminaOf, dungeonFighter, msLeftOf,
} from '../lib/dungeon.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦（ボスを呼び、HPを持ち越して倒す・ATB戦闘）
// ------------------------------------------------------------
// 【確定】2026-10-29 ユーザー選択（決まりの正は lib/dungeon.js・サーバーは SQL §23）：
//   ・入口で難易度を選んで**自分で呼ぶ**（全部の難易度を合わせて1日1回・朝5時に戻る）。呼んだときから90分
//   ・**HPは持ち越し**：負けても残ったHPから挑み直せる。挑戦1回は180秒の ATB 戦闘（画面は V2capAtbFight.jsx・試し撃ちと同じ）
//   ・スタミナ：呼んだ人は最初の1回0・そのあと3／救援で入った人は毎回5
//   ・**救援信号**を出すと、入口の「救援の一覧」に出て、だれでも先着5人まで入れる（それぞれ自分の画面で同じボスを殴る）
//   ・難易度はそのエリアに着いたら呼べる（②ノーマル・⑤ハード）。エキスパート・マスターは準備中
//   ・報酬は黒龍の専用の装備（あとで）。いまは無し＝削った量を数えるだけ
// 【確定】2026-10-31 ユーザー「これは『挑戦』にして」「ここに『強敵』ってカテゴリを作って、ここにヴァルゼノクとあまざ入れて」＋選択「ボスごとに1日1回」：
//   メニューの名前は「挑戦」。入口はカテゴリごと（lib/dungeon.js の CHALLENGE_CATS）にボスを並べ、押すと難易度が開く。呼べるのはボスごとに1日1回・同時に1体
// ★戦闘は画面で回し、終わったら削った量をサーバーへ送る（v2cap_dungeon_try_end）。挑戦の途中で画面を離れたら、そこまでの量を送る
// ============================================================

const POLL_MS = 15000
const DIFF_COLOR = { normal:'#66dd88', hard:'#ffaa44', expert:'#ff5566', master:'#cc77ff' }
const NO_SQL = 'サーバーにまだ挑戦の仕組みがありません（SQL §23 を流すと使えます）'
const errText = (error, data) => (/could not find the function/i.test(error?.message || '') ? NO_SQL : (error?.message || data?.error || 'うまくいきませんでした'))
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const Bar = ({ pct, color, h = 10 }) => (
  <div style={{ height:`${h}px`, background:'#000818', border:'1px solid #13405f' }}>
    <div style={{ width:`${Math.max(0, Math.min(100, pct))}%`, height:'100%', background: color }} />
  </div>
)
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮']
// ボスの絵：イラスト版（無ければドット絵版）。試し撃ちで選んだ版を使う
const artMemo = new Map()
const artOfBoss = (key) => {
  const ver = loadPref('capBossArtVer', 'illust'), id = `${ver}:${key}`
  if (!artMemo.has(id)) artMemo.set(id, (ver === 'illust' && bossIllustOf(key)) || bossArtOf(key) || bossIllustOf(key) || null)
  return artMemo.get(id)
}

export default function V2capDungeon({ prof, inventory, onProfile }) {
  const [state, setState] = useState(null)        // v2cap_dungeon_state の返事
  const [msg, setMsg] = useState(null)            // { ok, text }
  const [busy, setBusy] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())
  const [fight, setFight] = useState(null)        // { run, st, runKey, result, sent }
  const [openBoss, setOpenBoss] = useState(null)  // 難易度を開いているボス
  const pending = useRef(null)                    // 送っていない挑戦（画面を離れたら送る）

  const myPower = useMemo(() => calcPower(totalStats(prof, inventory)), [prof, inventory])
  const reached = openAreaOf(prof?.cleared_spots)
  const macros = useMemo(() => macrosOf(prof), [prof])
  const myGender = artGenderOf(prof, loadPref('capArtGender', 'm'))
  const baseCls = CLASS_BY_ID[prof?.class]?.req?.cls
  const playerSrc = homeIconOf(prof?.class, myGender, baseCls)
  const playerMotion = useMemo(() => motionOf(prof?.class, myGender, 'attack', baseCls), [prof?.class, myGender, baseCls])
  // 開いたボスと入っているボスの絵を先に読む（押してから待たない）
  const runBosses = (state?.runs || []).map(r => r.boss).join(',')
  useEffect(() => {
    for (const key of new Set([openBoss, ...runBosses.split(',')])) {
      const art = key && artOfBoss(key)
      if (art) preloadArt(art.srcs)
    }
  }, [openBoss, runBosses])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('v2cap_dungeon_state')
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return }
    setState(data)
  }, [])
  useEffect(() => { load() }, [load])
  // 入口にいるあいだは、ほかの人の削り・救援の一覧を取り直す（戦っているあいだは取らない）
  useEffect(() => {
    if (fight) return
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [fight, load])
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id) }, [])

  const call = async (fn, args, after) => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error || !data?.ok) { setMsg({ ok: false, text: errText(error, data) }); return null }
    if (after) after(data)
    return data
  }
  const summon = (bossKey, diff) => call('v2cap_dungeon_summon', { p_boss: bossKey, p_diff: diff }, () => {
    setMsg({ ok: true, text: `${DUNGEON_BOSSES[bossKey].name}（${diffOf(bossKey, diff).label}）を呼んだ！ ${DUNGEON_MIN}分のうちに倒そう` })
    setOpenBoss(null)
    load()
  })
  const rescue = (run) => call('v2cap_dungeon_rescue', { p_run: run.id }, () => { setMsg({ ok: true, text: '救援信号を出しました（入口の「救援の一覧」に出ます）' }); load() })
  const join = (run) => call('v2cap_dungeon_join', { p_run: run.id }, () => { setMsg({ ok: true, text: `${run.owner}さんの救援に入りました` }); load() })

  // ===== 挑む =====
  const start = async (run) => {
    const data = await call('v2cap_dungeon_try_start', { p_run: run.id })
    if (!data) return
    const foe = dungeonFighter(data.boss, data.diff, data.hp)
    if (!foe) { setMsg({ ok: false, text: 'このボスはまだ戦えません' }); return }
    const st = createAtb(atbPlayerOf(prof, inventory), foe, { maxSec: DUNGEON_TRY_SEC })
    pending.current = { runId: run.id, st }
    setFight(f => ({ run, st, runKey: (f?.runKey || 0) + 1, result: null }))
    onProfile?.()   // スタミナが減った
  }
  // 削った量を送る（1回だけ）。決着・あきらめる・画面を離れる、のどれか
  const report = useCallback(async () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    const damage = Math.max(0, (p.st.b.startHp ?? 0) - Math.max(0, p.st.b.hp))
    const { data, error } = await supabase.rpc('v2cap_dungeon_try_end', { p_run: p.runId, p_damage: Math.floor(damage) })
    if (error || !data?.ok) return { ok: false, text: errText(error, data) }
    return { ok: true, damage: data.damage, run: data.run }
  }, [])
  const onOver = async () => {
    const r = await report()
    if (r) setFight(f => (f ? { ...f, result: r } : f))
  }
  const giveUp = async () => {
    const r = await report()
    setFight(null)
    if (r) setMsg(r.ok ? { ok: true, text: `挑戦をやめました（${r.damage.toLocaleString()}ダメージを入れた）` } : { ok: false, text: r.text })
    load()
  }
  // 戦っている途中で画面を離れたら、そこまでの量を送る
  useEffect(() => () => { report() }, [report])

  // ===== 戦闘 =====
  if (fight) {
    const r = fight.result
    const boss = DUNGEON_BOSSES[fight.run.boss]
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#ff8866', fontSize:'12px', marginBottom:'6px' }}>
          {boss.name}（{diffOf(fight.run.boss, fight.run.diff)?.label}）・残りHP {Math.max(0, fight.st.b.hp).toLocaleString()} / {fight.st.b.base.hp.toLocaleString()}
        </div>
        <V2capAtbFight st={fight.st} runKey={fight.runKey} macros={macros} playerSrc={playerSrc} playerMotion={playerMotion}
          bossArt={artOfBoss(fight.run.boss)} onOver={onOver}
          footer={fight.st.over
            ? <button onClick={() => { setFight(null); load() }} disabled={!r} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>← 入口へ戻る</button>
            : <button onClick={giveUp} style={{ ...miniBtn('#ff8888'), flex:1, padding:'8px' }}>挑戦をやめる（ここまでの削りを入れる）</button>} />
        {r && (
          <div style={{ marginTop:'8px', fontSize:'12px', color: r.ok ? '#ffdd66' : '#ff6666' }}>
            {!r.ok ? r.text
              : r.run.cleared ? `⚔ ${boss.name}を倒した！（この挑戦で${r.damage.toLocaleString()}ダメージ）`
              : `${r.damage.toLocaleString()}ダメージを入れた（残りHP ${r.run.hp.toLocaleString()} / ${r.run.hp_max.toLocaleString()}）`}
          </div>
        )}
        {!r && fight.st.over && <div style={{ marginTop:'8px', fontSize:'11px', color: TEXT.label }}>削った量を送っています…</div>}
      </div>
    )
  }

  // ===== 入口 =====
  const stamMax = staminaMaxOfProfile(prof)
  const stam = state?.stamina ?? prof?.stamina ?? 0
  const runs = state?.runs || []
  const active = runs.filter(r => !r.cleared && msLeftOf(r.ends_at, nowMs) > 0)
  const ownActive = active.some(r => r.mine)
  // きょうこのボスを呼んだか（SQL をまだ流していないサーバーは全部まとめて1回）
  const summonedOf = (key) => (state?.summoned_bosses ? state.summoned_bosses.includes(key) : !!state?.summoned_today)
  const canSummon = (key) => !!state && !summonedOf(key) && !ownActive

  return (
    <div>
      {msg && <div style={{ fontSize:'11px', marginBottom:'8px', color: msg.ok ? '#88ffaa' : '#ff8888' }}>{msg.text}</div>}
      {!state && !msg && <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'8px' }}>読み込み中...</div>}

      {/* 入っているボス（呼んだ・救援） */}
      {runs.map(run => {
        const left = msLeftOf(run.ends_at, nowMs)
        const over = run.cleared || left <= 0
        const d = diffOf(run.boss, run.diff)
        const cost = tryStaminaOf(run.mine, run.my_tries)
        return (
          <div key={run.id} style={{ ...box, padding:'10px', marginBottom:'10px', borderColor: run.mine ? '#aa4433' : '#336699' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', flexWrap:'wrap', fontSize:'12px' }}>
              <span>
                <b style={{ color: DIFF_COLOR[run.diff] }}>［{d?.label}］</b> <span style={{ color:'#ff8866' }}>{DUNGEON_BOSSES[run.boss]?.name}</span>
                <span style={{ color: TEXT.label, fontSize:'10px' }}>　{run.mine ? 'あなたが呼んだ' : `${run.owner}さんの救援`}</span>
              </span>
              <span style={{ color: over ? TEXT.label : left < 10 * 60000 ? '#ff8866' : TEXT.body }}>
                {run.cleared ? '討伐済み' : left <= 0 ? '時間切れ' : `残り ${mmss(left)}`}
              </span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color: TEXT.label, margin:'4px 0 2px' }}>
              <span>HP {run.hp.toLocaleString()} / {run.hp_max.toLocaleString()}</span>
              <span>{((run.hp / run.hp_max) * 100).toFixed(1)}%</span>
            </div>
            <Bar pct={(run.hp / run.hp_max) * 100} color="#cc3344" />
            <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px', fontSize:'10px', color: TEXT.sub, margin:'6px 0' }}>
              {run.members.map(m => (
                <span key={m.name} style={{ color: m.me ? '#88ccff' : TEXT.sub }}>
                  {m.owner ? '👑' : '🤝'}{m.name}：{Number(m.damage).toLocaleString()}（{m.tries}回）
                </span>
              ))}
            </div>
            {!over && (
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                <button onClick={() => start(run)} disabled={busy || stam < cost} style={{ ...miniBtn('#ff8866'), flex:1, padding:'8px' }}>
                  ⚔ 挑む（スタミナ{cost}）
                </button>
                {run.mine && !run.rescue_open && (
                  <button onClick={() => rescue(run)} disabled={busy} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>📣 救援信号を出す</button>
                )}
                {run.mine && run.rescue_open && <span style={{ color:'#44ddff', fontSize:'10px', alignSelf:'center' }}>📣 救援信号を出しています（{run.members.length - 1}/{HELPERS_MAX}人）</span>}
              </div>
            )}
            {!over && stam < cost && <div style={{ color:'#ff8888', fontSize:'10px', marginTop:'4px' }}>スタミナが足りません</div>}
          </div>
        )
      })}

      {/* カテゴリごとのボス（押すと難易度が開く） */}
      {CHALLENGE_CATS.map(cat => (
        <div key={cat.key} style={{ ...box, padding:'10px', marginBottom:'10px' }}>
          <div style={{ color:'#ff8866', fontSize:'13px', fontWeight:'bold', marginBottom:'4px' }}>{cat.label}</div>
          <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginBottom:'6px' }}>
            呼んでから{DUNGEON_MIN}分のうちに倒します。負けても<b style={{ color: TEXT.bright }}>残ったHPから</b>挑み直せます（1回の挑戦は{DUNGEON_TRY_SEC}秒）。呼べるのはボスごとに1日1回（朝5時に戻る）・同時に1体。救援信号を出すと、ほかの人が{HELPERS_MAX}人まで一緒に戦えます。<br />
            スタミナ：呼んだ人は最初の1回{STAMINA_OWNER_FIRST}・そのあと{STAMINA_OWNER}／救援で入った人は毎回{STAMINA_HELPER}
            <span style={{ color: TEXT.label }}>（いま {stam} / {stamMax}）</span>
            <span style={{ color: TEXT.label }}>・あなたの戦闘力 {myPower.toLocaleString()}</span>
          </div>
          {cat.bosses.map(key => {
            const boss = DUNGEON_BOSSES[key], thumb = bossThumbOf(key), open = openBoss === key
            return (
              <div key={key} style={{ borderTop:'1px solid #001428' }}>
                <button onClick={() => setOpenBoss(open ? null : key)} aria-expanded={open}
                  style={{ display:'flex', alignItems:'center', gap:'10px', width:'100%', padding:'6px 2px', background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
                  {thumb && <img src={thumb} alt="" draggable={false} style={{ width:'64px', height:'64px', objectFit:'contain', flexShrink:0 }} />}
                  <span style={{ flex:1, minWidth:0 }}>
                    <b style={{ color:'#ff8866', fontSize:'13px' }}>{boss.name}</b><br />
                    <span style={{ color: TEXT.label, fontSize:'10px' }}>{summonedOf(key) ? 'きょうはもう呼びました' : '呼べます'}</span>
                  </span>
                  <span style={{ color: TEXT.label, fontSize:'12px', flexShrink:0 }}>{open ? '▲' : '▼'}</span>
                </button>
                {open && DIFF_KEYS.map(k => {
                  const d = diffOf(key, k)
                  const ready = isDiffReady(key, k)
                  const unlocked = isDiffUnlocked(key, k, reached)
                  const enough = ready && myPower >= d.recPower
                  return (
                    <div key={k} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 0', borderTop:'1px solid #001428', opacity: unlocked ? 1 : 0.55 }}>
                      <b style={{ color: DIFF_COLOR[k], width:'72px', flexShrink:0, fontSize:'12px', whiteSpace:'nowrap' }}>{d.label}</b>
                      <span style={{ fontSize:'10px', color: TEXT.sub, flex:1, minWidth:0 }}>
                        推奨LV{d.recLv}
                        {ready && <>・推奨戦闘力 <span style={{ color: enough ? '#88ffaa' : '#ff8888' }}>{d.recPower.toLocaleString()}</span></>}
                        {!ready ? '・準備中' : !unlocked ? `・エリア${CIRCLED[d.area - 1]}に着くと呼べます` : ''}
                      </span>
                      {/* 呼べないとき（呼んだ日・呼んでいるボスがいる・まだのエリア）はボタンを暗くする（押せないのが分かるように） */}
                      <button onClick={() => summon(key, k)} disabled={busy || !unlocked || !canSummon(key)}
                        style={{ ...miniBtn(DIFF_COLOR[k]), padding:'6px 12px', opacity: unlocked && canSummon(key) ? 1 : 0.35 }}>呼ぶ</button>
                    </div>
                  )
                })}
              </div>
            )
          })}
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
              <span style={{ color:'#ff8866' }}>{DUNGEON_BOSSES[run.boss]?.name}</span>・{run.owner}さん・HP {((run.hp / run.hp_max) * 100).toFixed(0)}%・残り {mmss(msLeftOf(run.ends_at, nowMs))}・{run.members.length}/{HELPERS_MAX + 1}人
            </span>
            <button onClick={() => join(run)} disabled={busy} style={{ ...miniBtn('#44ddff'), padding:'6px 10px' }}>救援に入る</button>
          </div>
        ))}
      </div>
    </div>
  )
}
