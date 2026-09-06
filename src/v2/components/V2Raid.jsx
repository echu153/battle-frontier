import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2LogLine from './V2LogLine.jsx'
import V2Help from './V2Help.jsx'
import V2Modal from './V2Modal.jsx'
import { box, btn, miniBtn, TEXT, LOG_PLAIN } from './v2ui.js'
import { runBattle } from '../lib/battle.js'
import { buildBattleLog } from '../lib/battleLog.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { RARITY_COLOR } from '../lib/material.js'
import { SORTIE_CD } from '../lib/sortie.js'
import {
  RAID_BOSSES, raidBossOf, RAID_TURNS, RAID_MAX_MEMBERS, CALL_MAX, ONLINE_MINUTES,
  secondsLeft, timeText, shareOf, toRaidFighter, rampText, raidHpOfTier,
  RAID_BOSS_RATE, RAID_DAILY_MAX, ROTATE_HOURS, raidBossAt, nextRotateAt, rotateSchedule,
  rewardTierOf, mvpIdOf, matRangeText, rarityTableOf, fusionChanceOf,
  BOX_LABEL, BOX_COLOR, BOX_MAT_COUNT, BOX_RARITY, BOX_FUSION_PCT,
  TIER_LABEL, TIER_COLOR, tierMark,
} from '../lib/raid.js'
import { fusionOfBoss } from '../lib/fusion.js'
import { tierOf, markOf, areaOf } from '../lib/enemies.js'
import { splitRows } from '../lib/friends.js'
import V2Evolve from './V2Evolve.jsx'
import { pushWeaponRecord } from './weaponRecord.js'

// ============================================================
// レイドボスの画面（docs/v2-raid-design.md）
// ------------------------------------------------------------
//   出撃で 0.4% を引くとレイドが立ち、ここへ来て殴る。
//   ・戦闘は**オート（runBattle）を10ターンで打ち切る**。与ダメだけをサーバーへ申告する
//   ・出撃と同じ10秒クールタイム。**スタミナは減らず、EXPも入らない**
//   ・主催者は救援信号を出せる（オンライン中／フレンド・複数選択）
//   ・終わったら報酬を受け取る（与ダメの割合ぶん）
//
// ★ボスのHPは**サーバーが持っている残りHP**を毎回もらって組み直す。
//   画面側で減らして持ち回すと、他の人の与ダメとズレる。
// ============================================================

const barColor = (pct) => (pct > 50 ? '#44ff88' : pct > 20 ? '#ffcc00' : '#ff4444')
// 日本時間の「M/D H時」。ローテの予定を出すのに使う
const jstText = (d) => {
  const j = new Date(new Date(d).getTime() + 9 * 3600000)
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${j.getUTCHours()}時`
}

// 参加者の1行。★いまの貢献度だと**どのティアの報酬になるか**をその場で出す
//   （主催者とMVPはA確定。他の人は削るほど上がる＝殴る動機が見える）
const MemberRow = ({ m, hpMax, meId, mvpId }) => {
  const share = shareOf(Number(m.damage || 0), hpMax)
  const isMvp = String(m.player_id) === String(mvpId)
  // ★ティアは**貢献度だけ**で決まる。主催・MVPはこれとは別に箱をもらう
  const rt = rewardTierOf(share)
  return (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', padding:'2px 0',
      color: String(m.player_id) === String(meId) ? '#ffcc00' : TEXT.body }}>
      <span>
        {m.is_host ? '👑 ' : ''}{isMvp ? '★ ' : ''}{m.name || '???'}
      </span>
      <span style={{ color: TEXT.label }}>
        {Number(m.damage).toLocaleString()}（{(share * 100).toFixed(1)}%・{m.hits}回）
        <span style={{ color: TIER_COLOR[rt] }}>　{TIER_LABEL[rt]}</span>
      </span>
    </div>
  )
}

export default function V2Raid({ prof, inventory, runes, fishDex, dex, pet, isAdmin, onProfile, onBack }) {
  const [state, setState] = useState(null)     // v2_raid_list の返り
  const [logs, setLogs] = useState([])
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(Date.now())
  const [callOpen, setCallOpen] = useState(false)
  const [online, setOnline] = useState([])
  const [friends, setFriends] = useState([])
  const [picked, setPicked] = useState(() => new Set())
  const [reward, setReward] = useState(null)
  // 武器の進化（戦闘記憶）：節目に達した武器（ポップアップで受け取る）
  const [evolving, setEvolving] = useState(null)
  const lastAt = useRef(0)
  const running = useRef(false)

  const meId = prof?.id
  // 開発用に立てるときのエリア。**帯を選べる**ようにしてある
  //   （帯ごとにHPが桁違いなので、討伐まで確かめたいときは浅い帯で立てる）
  const devAreas = [...(prof?.unlocked_areas || [1])].sort((a, b) => tierOf(a) - tierOf(b) || a - b)
  const [devArea, setDevArea] = useState(null)
  const devPick = devArea ?? devAreas[devAreas.length - 1] ?? 1
  const raid = state?.active || null
  const boss = raid ? raidBossOf(raid.boss_key) : null
  const left = raid ? secondsLeft(raid.started_at, now) : 0
  const hpPct = raid ? (Number(raid.hp_left) / Number(raid.hp_max)) * 100 : 0
  const elapsed = (now - lastAt.current) / 1000
  const cdLeft = Math.max(0, SORTIE_CD - elapsed)
  const canHit = raid && left > 0 && Number(raid.hp_left) > 0 && cdLeft <= 0 && !busy

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t) }, [])

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('v2_raid_list')
    if (error) { setMsg(`⚠ 読み込みに失敗しました（${error.message}）`); return }
    if (!data?.ok) { setMsg(`⚠ ${data?.error || '読み込めませんでした'}`); return }
    setState(data)
  }, [])

  useEffect(() => { refresh() }, [refresh])
  // ★挑戦中は5秒おきに取り直す。**残りHPは他の人も削っている**ので、
  //   自分が殴ったときだけ更新すると「もう倒されている」ことに気づけない
  useEffect(() => {
    if (!raid) return
    const t = setInterval(() => { if (!running.current) refresh() }, 5000)
    return () => clearInterval(t)
  }, [raid, refresh])

  // ===== 殴る =====
  const attack = async () => {
    if (running.current || !raid || !boss) return
    if (Date.now() - lastAt.current < SORTIE_CD * 1000) return
    running.current = true
    lastAt.current = Date.now()
    setBusy(true)
    try {
      const me = playerFighter(prof, inventory, runes, fishDex, dex, pet)
      // ★残りHPはサーバーの値で組む（自分の画面で減らして持ち回さない）
      const foe = toRaidFighter(boss, raid.tier, Number(raid.hp_left))
      const r = runBattle(me, foe, { maxTurns: RAID_TURNS })
      const dealt = Math.max(0, r.b.base.hp - r.b.hp)

      const out = [{ text:`⚔ ${boss.name}に挑んだ！`, color: boss.color }]
      out.push(...buildBattleLog(r, me.name, boss.name))
      setLogs(out)

      const { data, error } = await supabase.rpc('v2_raid_attack', {
        p_raid_id: raid.id, p_damage: dealt,
      })
      if (error || !data?.ok) {
        setAuto(false)
        setLogs(l => [...l, { text:`⚠ 反映に失敗しました（${error?.message || data?.error}）`, color:'#ff8844' }])
        await refresh()
        return
      }
      setLogs(l => [...l,
        { color: LOG_PLAIN, parts:[
          { text:'💥 与えたダメージ ' },
          { text: Number(data.damage).toLocaleString(), color:'#ffcc00' },
        ] },
        // ★EXPはサーバーが抽選して配る。**入っていることが見えないと入っていないのと同じ**なので必ず出す
        ...(data.exp ? [{ text:`EXP +${data.exp}`, color:'#ffcc00' }] : []),
        ...(data.level?.ups > 0 ? [{ text:`🆙 レベルアップ！ LV${data.level.lv}`, color:'#44ff88' }] : []),
        ...(data.killed ? [{ text:`🎉 ${boss.name}を討伐した！`, color:'#44ff88' }] : []),
      ])
      // ★武器の進化（戦闘記憶）。**戦闘のある画面はすべて積む**（出撃・アリーナと同じ）。
      //   ここを抜かすと「レイドで殴っても武器が育たない」ことになる
      const ready = await pushWeaponRecord(prof, inventory, r, me.name, boss.name, { isBoss: true })
      if (ready.length) setEvolving(ready[0])
      await refresh()
      // ★EXPが入るので、プロフィール（LV・ステータス）も取り直す
      onProfile?.(null)
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  // オート挑戦。クールタイムが明けるたびに殴る（スタミナは減らない）
  useEffect(() => {
    if (!auto || busy || evolving || !canHit) return
    attack()
  }, [auto, now, busy, evolving, canHit])   // eslint-disable-line react-hooks/exhaustive-deps
  // 終わったら自動で止める
  useEffect(() => { if (auto && (!raid || left <= 0)) setAuto(false) }, [auto, raid, left])

  // ===== 救援信号 =====
  const openCall = async () => {
    setPicked(new Set())
    setCallOpen(true)
    const [{ data: on }, { data: fr }] = await Promise.all([
      supabase.rpc('v2_raid_online'),
      supabase.from('v2_friends').select('*'),
    ])
    setOnline(on?.ok ? on.list : [])
    const ids = splitRows(fr || [], meId).friend.map(v => String(v.otherId))
    if (ids.length) {
      const { data: profs } = await supabase.from('v2_profiles').select('id,username,lv').in('id', ids)
      setFriends((profs || []).map(p => ({ id: p.id, name: p.username, lv: p.lv })))
    } else setFriends([])
  }
  const toggle = (id) => setPicked(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const pickAll = (list) => setPicked(s => {
    const n = new Set(s)
    const all = list.every(p => n.has(String(p.id)))
    for (const p of list) { if (all) n.delete(String(p.id)); else n.add(String(p.id)) }
    return n
  })
  const sendCall = async () => {
    const targets = [...picked]
    if (!targets.length) { setMsg('⚠ 送る相手を選んでください'); return }
    if (targets.length > CALL_MAX) { setMsg(`⚠ 一度に送れるのは${CALL_MAX}人までです`); return }
    // 種別は「選んだ相手が全員フレンドかどうか」で決める（記録に残すだけの目印）
    const friendIds = new Set(friends.map(f => String(f.id)))
    const kind = targets.every(t => friendIds.has(String(t))) ? 'friend' : 'online'
    setBusy(true)
    const { data, error } = await supabase.rpc('v2_raid_call', {
      p_raid_id: raid.id, p_targets: targets, p_kind: kind,
    })
    setBusy(false)
    if (error || !data?.ok) { setMsg(`⚠ ${error?.message || data?.error}`); return }
    setMsg(`📣 救援信号を${targets.length}人へ送りました`)
    setCallOpen(false)
  }

  // ★開発限定：レイドをその場に呼ぶ（3時間の間隔と参加中のレイドを飛ばす）。
  //   出現率は0.4%なので、これが無いと動作確認のたびに何百回も出撃することになる
  const devSpawn = async (key, area) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('v2_debug_spawn_raid', { p_area: area, p_boss_key: key })
    setBusy(false)
    if (error || !data?.ok) { setMsg(`⚠ ${error?.message || data?.error}`); return }
    setLogs([])
    await refresh()
  }

  // ===== 参加する／報酬を受け取る =====
  const join = async (id) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('v2_raid_join', { p_raid_id: id })
    setBusy(false)
    if (error || !data?.ok) { setMsg(`⚠ ${error?.message || data?.error}`); return }
    setLogs([])
    await refresh()
  }
  const claim = async (id) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('v2_raid_claim', { p_raid_id: id })
    setBusy(false)
    if (error || !data?.ok) { setMsg(`⚠ ${error?.message || data?.error}`); return }
    setReward(data)
    await refresh()
    onProfile?.(null)
  }

  // ===== 画面 =====
  const header = (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
      <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      <V2Help id="raid" />
    </div>
  )

  const bossFace = (b, size = 96) => (b?.img
    ? <img src={b.img} alt={b.name} style={{ width:`${size}px`, height:`${size}px`, objectFit:'contain', imageRendering:'pixelated' }} />
    : <div style={{ width:`${size}px`, height:`${size}px`, display:'flex', alignItems:'center', justifyContent:'center',
        border:`1px solid ${b?.color || '#0044aa'}`, color: b?.color, fontSize:'28px' }}>☠</div>)

  return (
    <div>
      {evolving && (
        <V2Evolve pending={evolving} inventory={inventory}
          onDone={() => { setEvolving(null); onProfile?.(null) }} />
      )}
      {header}
      {msg && <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'8px' }}>{msg}</div>}

      {/* ===== 挑戦中のレイド ===== */}
      {raid && boss && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ display:'flex', gap:'12px', alignItems:'center', marginBottom:'8px' }}>
            {bossFace(boss)}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color: boss.color, fontSize:'14px' }}>{boss.name}</div>
              <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'4px' }}>{boss.text}</div>
              <div style={{ color: TEXT.label, fontSize:'10px' }}>
                主催 {raid.host_name}／難易度{tierMark(raid.tier)} {raid.area_name}／戦闘力 {Number(raid.power).toLocaleString()}
              </div>
              {/* ★奥のエリアで引いたレイドほど強く、そのぶん報酬も豪華になる */}
              <div style={{ color:'#ff8844', fontSize:'10px' }}>
                {RAID_TURNS}ターンで撤退／たかぶり：{rampText()}
              </div>
              <div style={{ color: left > 300 ? TEXT.label : '#ff8844', fontSize:'11px' }}>
                残り {timeText(left)}
              </div>
            </div>
          </div>

          {/* HPバー */}
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
            <span style={{ color: TEXT.label }}>HP</span>
            <span style={{ color: barColor(hpPct) }}>
              {Number(raid.hp_left).toLocaleString()} / {Number(raid.hp_max).toLocaleString()}（{hpPct.toFixed(1)}%）
            </span>
          </div>
          <div style={{ background:'#001028', height:'10px', border:'1px solid #002244', marginBottom:'10px' }}>
            <div style={{ height:'100%', width:`${Math.max(0, hpPct)}%`, background: barColor(hpPct), transition:'width 0.3s' }} />
          </div>

          {/* 次の行動まで */}
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
            <span style={{ color: TEXT.label }}>次の行動まで</span>
            <span style={{ color: cdLeft <= 0 ? '#44ff88' : '#ffcc00' }}>
              {cdLeft <= 0 ? '▶ 挑戦できる！' : `${cdLeft.toFixed(1)}秒`}
            </span>
          </div>
          <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'10px' }}>
            <div style={{ height:'100%', width:`${Math.min(100, (elapsed / SORTIE_CD) * 100)}%`,
              background: cdLeft <= 0 ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
          </div>

          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
            <button onClick={attack} disabled={!canHit}
              style={{ ...btn(canHit ? '#ff6644' : TEXT.empty), flex:1, minWidth:'140px',
                cursor: canHit ? 'pointer' : 'not-allowed' }}>
              ⚔ 挑戦する
            </button>
            <button onClick={() => setAuto(v => !v)}
              style={btn(auto ? '#ff88cc' : '#44ff88')}>
              {auto ? '■ オートを止める' : '▶ オート挑戦'}
            </button>
            {String(raid.host_id) === String(meId) && (
              <button onClick={openCall} style={btn('#ffcc00')}>📣 救援信号</button>
            )}
          </div>
          <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
            挑戦してもスタミナは減りません。EXPは出撃の敵と同じだけ入ります。報酬は終わったあとにまとめて受け取ります。<br />
            1回の挑戦は{RAID_TURNS}ターンまで。ボスはターンが進むほど強くなるので、後半はほとんど通りません。
          </div>

          {/* 参加者 */}
          <div style={{ borderTop:'1px solid #002244', paddingTop:'8px' }}>
            <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'4px' }}>
              参加者 {raid.members?.length || 0}／{RAID_MAX_MEMBERS}人
            </div>
            {(raid.members || []).map(m => (
              <MemberRow key={m.player_id} m={m} hpMax={Number(raid.hp_max)} meId={meId}
                mvpId={mvpIdOf(raid.members)} />
            ))}
            <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'4px', lineHeight:1.7 }}>
              ティアは貢献度で上がります。👑 主催者と ★ MVP（いちばん削った人）は、
              それとは<b style={{ color:'#ffcc00' }}>別に箱</b>をもらえます（両方なら3つとも）。<br />
              報酬は人数で割られません。呼べば呼ぶほど早く倒せて、全員が受け取れます。
            </div>
          </div>
        </div>
      )}

      {/* ===== 戦闘ログ ===== */}
      {logs.length > 0 && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px', maxHeight:'300px', overflowY:'auto' }}>
          {logs.map((l, i) => <V2LogLine key={i} l={l} />)}
        </div>
      )}

      {/* ===== 救援に呼ばれているレイド ===== */}
      {(state?.invites || []).length > 0 && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>📣 救援を求められています</div>
          {state.invites.map(r => {
            const b = raidBossOf(r.boss_key)
            return (
              <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                borderTop:'1px solid #002244', padding:'6px 0', gap:'8px', flexWrap:'wrap' }}>
                <span style={{ color: b?.color, fontSize:'11px' }}>
                  {b?.name || r.boss_key}
                  <span style={{ color: TEXT.label }}>　{r.host_name}／残り {timeText(secondsLeft(r.started_at, now))}</span>
                </span>
                <button onClick={() => join(r.id)} disabled={busy || !!raid} style={miniBtn(raid ? TEXT.empty : '#44ff88')}>
                  {raid ? '別のレイドに参加中' : '駆けつける'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== 未受取の報酬 ===== */}
      {(state?.unclaimed || []).length > 0 && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color:'#44ff88', fontSize:'12px', marginBottom:'6px' }}>🎁 報酬を受け取れます</div>
          {state.unclaimed.map(r => {
            const b = raidBossOf(r.boss_key)
            const mine = (r.members || []).find(m => String(m.player_id) === String(meId))
            const sh = shareOf(Number(mine?.damage || 0), Number(r.hp_max))
            const rt = rewardTierOf(sh)
            const isHost = String(r.host_id) === String(meId)
            const isMvp = String(mvpIdOf(r.members)) === String(meId)
            return (
              <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                borderTop:'1px solid #002244', padding:'6px 0', gap:'8px', flexWrap:'wrap' }}>
                <span style={{ fontSize:'11px', color: TEXT.body }}>
                  <span style={{ color: b?.color }}>{b?.name || r.boss_key}</span>
                  <span style={{ color: TEXT.label }}>
                    　難易度{tierMark(r.tier)}／{r.killed_at ? '討伐' : '時間切れ'}／貢献 {(sh * 100).toFixed(1)}%
                  </span>
                  <span style={{ color: TIER_COLOR[rt] }}>
                    　{TIER_LABEL[rt]}（素材{matRangeText(rt)}・激レア{rarityTableOf(rt, r.tier).ultra}%
                    {r.killed_at ? `・合成素材${fusionChanceOf()}%` : ''}）
                  </span>
                  {isHost && <span style={{ color: BOX_COLOR.host }}>　＋{BOX_LABEL.host}</span>}
                  {isMvp && <span style={{ color: BOX_COLOR.mvp }}>　＋{BOX_LABEL.mvp}</span>}
                </span>
                <button onClick={() => claim(r.id)} disabled={busy} style={miniBtn('#ffcc00')}>受け取る</button>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== 開発限定：レイドをその場に呼ぶ ===== */}
      {/* ★挑戦中でも出す。**進行中のレイドを終わらせてから立て直す**ので、
          これが無いと1時間待たないと次の確認ができない（報酬の受け取りも試せない） */}
      {isAdmin && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color:'#88ddaa', fontSize:'11px', marginBottom:'6px' }}>
            [開発] レイドをその場に呼ぶ
            {raid && <span style={{ color:'#ff8844' }}>　※いまのレイドは時間切れ扱いで終わります（報酬は残ります）</span>}
          </div>
          {/* ★帯ごとにHPが桁違い（①190万 〜 ⑧15億）。討伐まで確かめたいときは浅い帯で立てる */}
          <div style={{ marginBottom:'6px' }}>
            <span style={{ color: TEXT.label, fontSize:'10px' }}>立てるエリア　</span>
            <select value={devPick} onChange={e => setDevArea(Number(e.target.value))}
              style={{ background:'#000818', border:'1px solid #0044aa', color:'#88ccff',
                fontFamily:'monospace', fontSize:'11px', padding:'3px' }}>
              {devAreas.map(id => (
                <option key={id} value={id}>
                  {markOf(tierOf(id))} {areaOf(id)?.name}（HP {raidHpOfTier(tierOf(id)).toLocaleString()}）
                </option>
              ))}
            </select>
          </div>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {RAID_BOSSES.map(b => (
              <button key={b.key} onClick={() => devSpawn(b.key, devPick)} disabled={busy}
                style={miniBtn(b.color)}>{b.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* ===== 何も無いとき ===== */}
      {!raid && !(state?.invites || []).length && !(state?.unclaimed || []).length && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color: TEXT.body, fontSize:'12px', marginBottom:'6px' }}>いまレイドは出ていません</div>
          <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.8 }}>
            <b style={{ color:'#ffcc00' }}>エリアボスを討伐したとき</b>に、{RAID_BOSS_RATE}%でレイドボスが現れます
            （<b>1日{RAID_DAILY_MAX}回</b>まで・日本時間の5時に戻ります）。<br />
            現れたら1時間だけ挑戦でき、救援信号を出して仲間を呼べます。<br />
            主催者といちばん削った人は、貢献度とは別に{BOX_LABEL.host}・{BOX_LABEL.mvp}
            （素材{BOX_MAT_COUNT}個・激レア{BOX_RARITY.ultra}%・合成素材{BOX_FUSION_PCT}%）をもらえます。<br />
            HPは<b style={{ color:'#ff8844' }}>複数人がかりで1時間</b>ぶんあるので、ひとりでは削り切れません。<br />
            <b style={{ color:'#ff8844' }}>奥のエリアで引いたレイドほど強く、報酬も豪華</b>になります。
          </div>

          {/* ★今日の残り回数。数えているのはサーバー（v2_raid_spawn） */}
          {state?.daily_max != null && (
            <div style={{ fontSize:'11px', marginTop:'8px',
              color: (state.used || 0) >= state.daily_max ? '#ff8844' : '#44ff88' }}>
              今日の残り {Math.max(0, state.daily_max - (state.used || 0))} / {state.daily_max} 回
            </div>
          )}

          {/* ★出るボスは時間帯で決まる（2時間ごとのローテ・誰が引いても同じ顔） */}
          <div style={{ borderTop:'1px solid #002244', marginTop:'8px', paddingTop:'8px' }}>
            <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'4px' }}>
              いまの時間帯に出るボス（{ROTATE_HOURS}時間ごとに入れ替わります）
            </div>
            <div style={{ display:'flex', gap:'10px', alignItems:'center', marginBottom:'8px' }}>
              {bossFace(raidBossAt(new Date(now)), 56)}
              <div>
                <div style={{ color: raidBossAt(new Date(now)).color, fontSize:'12px' }}>
                  {raidBossAt(new Date(now)).name}
                </div>
                <div style={{ color: TEXT.label, fontSize:'10px' }}>
                  {fusionOfBoss(raidBossAt(new Date(now)).name)?.name}
                </div>
                <div style={{ color: TEXT.sub, fontSize:'10px' }}>
                  次の入れ替えは {jstText(nextRotateAt(new Date(now)))}
                </div>
              </div>
            </div>
            <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'2px' }}>このあとの順番</div>
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
              {rotateSchedule(new Date(now), 5).slice(1).map(s => (
                <span key={s.at.toISOString()} style={{ fontSize:'10px', color: TEXT.sub }}>
                  {jstText(s.at)} <span style={{ color: s.boss.color }}>{s.boss.name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== 救援信号のポップアップ ===== */}
      {callOpen && (
        <V2Modal title="📣 救援信号" color="#ffcc00" busy={busy}
          confirmLabel={`${picked.size}人へ送る`} cancelLabel="やめる"
          onConfirm={picked.size && picked.size <= CALL_MAX ? sendCall : undefined}
          onClose={() => setCallOpen(false)}>
          <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
            選んだ相手にこのレイドが見えるようになります（1回に{CALL_MAX}人まで）。<br />
            オンライン中＝直近{ONLINE_MINUTES}分のあいだに動いていた人です。
            {/* ★国はv2にまだ無い（docs/v2-raid-design.md §4） */}
          </div>
          {[{ key:'friend', label:'フレンド', list: friends },
            { key:'online', label:'オンライン中', list: online }].map(g => (
            <div key={g.key} style={{ marginBottom:'10px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                <span style={{ color: TEXT.label, fontSize:'11px' }}>{g.label}（{g.list.length}人）</span>
                {g.list.length > 0 && (
                  <button onClick={() => pickAll(g.list)} style={miniBtn('#88ccff')}>すべて選択</button>
                )}
              </div>
              {g.list.length === 0 && <div style={{ color: TEXT.empty, fontSize:'10px' }}>—</div>}
              <div style={{ maxHeight:'140px', overflowY:'auto' }}>
                {g.list.map(p => (
                  <label key={`${g.key}:${p.id}`} style={{ display:'flex', alignItems:'center', gap:'6px',
                    fontSize:'11px', color: TEXT.body, cursor:'pointer', padding:'2px 0' }}>
                    <input type="checkbox" checked={picked.has(String(p.id))} onChange={() => toggle(String(p.id))} />
                    {p.name}<span style={{ color: TEXT.label }}>　LV{p.lv}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {picked.size > CALL_MAX && (
            <div style={{ color:'#ff8844', fontSize:'11px' }}>
              ⚠ {picked.size}人を選んでいます（一度に送れるのは{CALL_MAX}人までです）
            </div>
          )}
        </V2Modal>
      )}

      {/* ===== 受け取った報酬 ===== */}
      {reward && (
        <V2Modal title="🎁 報酬" color="#44ff88" onClose={() => setReward(null)}>
          <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'8px' }}>
            難易度{tierMark(reward.tier)}／{reward.killed ? '討伐' : '時間切れ'}
            ／貢献 {(Number(reward.share) * 100).toFixed(1)}%
          </div>
          {/* ★枠ごとに分けて出す（貢献度／主催の箱／MVPの箱） */}
          {(reward.parts || []).map((part, pi) => (
            <div key={pi} style={{ borderTop: pi ? '1px solid #002244' : 'none', paddingTop: pi ? '8px' : 0, marginTop: pi ? '8px' : 0 }}>
              <div style={{ fontSize:'12px', marginBottom:'4px',
                color: part.kind === 'share' ? TIER_COLOR[part.tier] : BOX_COLOR[part.kind] }}>
                {part.kind === 'share' ? `${TIER_LABEL[part.tier]}（貢献度）` : BOX_LABEL[part.kind]}
              </div>
              {(part.materials || []).map((m, i) => (
                <div key={i} style={{ fontSize:'11px', color: LOG_PLAIN }}>
                  ⚗ ルーン素材「<span style={{ color: RARITY_COLOR[m.rarity] }}>{m.name}</span>」
                </div>
              ))}
              {part.fusion && (
                <div style={{ fontSize:'12px', color:'#ffcc00', marginTop:'4px' }}>
                  ✦ 合成素材「{part.fusion.name}」を入手！
                  <div style={{ color: TEXT.sub, fontSize:'10px' }}>鍛冶屋の「合成」で武器に付けられます</div>
                </div>
              )}
            </div>
          ))}
        </V2Modal>
      )}
    </div>
  )
}

