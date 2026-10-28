import { useLayoutEffect, useRef, useState } from 'react'
import { TEXT } from './v2ui.js'
import { buffChips, ailChips, stateChips, needNow, CAST_SEC } from '../core/atb.js'
import { STAT_DEFS } from '../core/stats.js'
import { lungeOf, shakeOf, HIT_SEC, POP_SEC, GLOW_SEC } from '../lib/atbFx.js'
import { motionFrameAt, IDLE_SIZE } from '../lib/motionArt.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の舞台（自分が左・モンスターが右）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「普通のバトルと同じでプレイヤーが左、モンスターが右に出るようにして、
//   プレイヤー側はクラスのドット絵が出るようにしたい」「モンスター側のドット絵も用意する」
//   自分の絵＝クラスの待機GIF（ホームと同じ）を**そのままの向き**で出す（反転すると逆を向く＝ユーザー「プレイヤー向き逆」で反転をやめた）
//   ・モンスターの絵はドット絵が届くまで、図鑑と同じ絵（enemyArt.js）。無ければ名前の1文字目
//   ・動き（lib/atbFx.js）：殴った側が前へ踏み込む／補助技・回復・防御は光る／受けた側は揺れて赤く光り、数字が浮かぶ
//   ・攻撃の絵（lib/motionArt.js・ユーザーが ChatGPT で作る）があるクラスは、踏み込みの代わりにその絵を1回流す（2026-10-26）。
//     待機GIFと同じ大きさ・足の位置にそろえてあるので、待機の枠（正方形）に重ねて、はみ出すぶん（斬撃）は枠の外へ出す
//   ・ダンジョンのボス（lib/bossArt.js・2026-10-28 黒龍ヴァルゼノク）：待機はずっと羽ばたく動くWebP、技ごとに違う攻撃の絵。
//     どの絵を流すかは act に付けた motion（試し撃ちの画面が決める）。絵が大きいので枠も大きくする（big）
//     【確定】2026-10-28 ユーザー「画像がずれてる、HPバー合わせて」「プレイヤー側の画像はもう少し小さくていい」：
//     ボスのときは両方の絵の枠を同じ高さにして（HPバーが同じ高さに並ぶ）、自分の絵は枠の PLAYER_VS_BOSS 倍に縮めて下にそろえる
//   ・ボスの技のエフェクト（BossFx・2026-10-28 ユーザー「エフェクトは別に作って、しっかり敵（プレイヤー）に当たってるように見せたい」）：
//     飛ぶ絵＝当たるコマで竜のいちばん前から出て、自分の真ん中まで飛ぶ（向きも合わせる）／当たる絵＝届いたとき自分の上で1回。
//     ダメージの数字と揺れは届いたとき（V2capAtb.jsx が impactMs まで遅らせる）。外れたら当たる絵は出さない
// ============================================================

const Bar = ({ pct, color, h = 10 }) => (
  <div style={{ height:`${h}px`, background:'#000818', border:'1px solid #13405f' }}>
    <div style={{ width:`${Math.max(0, Math.min(100, pct))}%`, height:'100%', background: color }} />
  </div>
)
const chip = (color, bg = '#000818') => ({ fontSize:'10px', padding:'1px 5px', border:`1px solid ${color}`, color, background: bg })
const buffText = (table) => Object.entries(table)
  .map(([k, v]) => `${STAT_DEFS[k]?.label || k}${v >= 0 ? '+' : ''}${Math.round(v)}%`).join('・')

// かかっているもの（時間で切れるバフ・デバフ／状態異常／職の状態）
const Chips = ({ st, side, right }) => {
  const buffs = buffChips(side, st.t)
  const ails = ailChips(st, side)
  const states = stateChips(side)
  if (!buffs.length && !ails.length && !states.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'4px', justifyContent: right ? 'flex-end' : 'flex-start' }}>
      {buffs.map((c, i) => (
        <span key={`b${i}`} style={chip(c.debuff ? '#ff88bb' : '#66bbff')}>{buffText(c.table)} {c.sec}秒</span>
      ))}
      {ails.map(c => (
        <span key={c.key} style={chip('#cc99ff')}>{c.label}{c.stacks ? `×${c.stacks}` : ''}{c.sec ? ` ${c.sec}秒` : ''}</span>
      ))}
      {states.map(c => <span key={c.key} style={chip('#ffdd88', '#181000')}>{c.label}</span>)}
    </div>
  )
}

const ART_H = 'clamp(110px, 30vw, 170px)'
const ART_H_BIG = 'clamp(140px, 40vw, 230px)'
export const PLAYER_VS_BOSS = 0.62

// 横に並べたコマの1枚から frame のコマだけを見せる（-1 なら隠す）。
//   【確定】2026-10-28 背景の絵（background-image）にして出すたびに置くと、そのたびに絵を読み直して一瞬なにも出ない
//   （竜の技の頭で竜が消えて見えた）＝<img> を隠して置いたままにして、コマだけ切り替える
const FrameStrip = ({ a, frame, style }) => (
  <div style={{ position:'absolute', overflow:'hidden', pointerEvents:'none', visibility: frame >= 0 ? 'visible' : 'hidden', ...style }}>
    <img src={a.src} alt="" draggable={false} decoding="sync"
      style={{ position:'absolute', top:0, left:`${-Math.max(0, frame) * 100}%`, width:`${a.frames * 100}%`, height:'100%', maxWidth:'none', userSelect:'none' }} />
  </div>
)

const POP_COLOR ={ hit: '#ffffff', miss: '#9fb3c8', heal: '#44ff88', tick: '#cc99ff' }
const popText = (f) => (f.kind === 'miss' ? 'MISS' : f.kind === 'heal' ? `+${f.amount.toLocaleString()}` : f.amount.toLocaleString())

// 1人ぶん。right＝右（モンスター）。fx は [{ kind, side, amount, crit, t0 }]・now は fx の t0 と同じ時計（秒）
//   areaRef … 絵の場所（動かない枠）。ボスのエフェクトの位置を測る
//   strips … 置いておく攻撃の絵（自分＝motion・ボス＝技ごとの絵ぜんぶ）
function Fighter({ st, side, me, right, src, motion, strips = [], fx, now, name, big, artH = ART_H, scale = 1, areaRef }) {
  const mine = fx.filter(f => f.side === side)
  const lastOf = (kind) => mine.reduce((t, f) => (f.kind === kind && f.t0 <= now && f.t0 > t ? f.t0 : t), -1e9)
  const dir = right ? -1 : 1   // 前＝相手の方
  // 攻撃の絵があれば流す（流しているあいだは踏み込まない）。act に motion が付いていればそちら（ボスの技ごとの絵）
  const lastAct = mine.reduce((p, f) => (f.kind === 'act' && f.t0 <= now && (!p || f.t0 > p.t0) ? f : p), null)
  const mo = lastAct?.motion || motion
  const frame = mo && lastAct ? motionFrameAt(mo, (now - lastAct.t0) * 1000) : -1
  const dx = (frame >= 0 ? 0 : lungeOf(now - lastOf('act')) * dir) + shakeOf(now - lastOf('hit'))
  const hitAgo = now - lastOf('hit')
  const glowAgo = now - lastOf('use')
  const filters = []
  if (hitAgo >= 0 && hitAgo < HIT_SEC) filters.push('drop-shadow(0 0 6px #ff3344) brightness(1.25)')
  if (glowAgo >= 0 && glowAgo < GLOW_SEC) filters.push('drop-shadow(0 0 10px #ffee88) brightness(1.3)')
  if (me.ail.paralyze) filters.push('grayscale(0.6)')
  const down = me.hp <= 0
  const pops = mine.filter(f => f.kind !== 'act' && f.kind !== 'use' && now >= f.t0 && now - f.t0 < POP_SEC)
  const need = needNow(me, st.t)
  const align = right ? 'flex-end' : 'flex-start'
  const hpColor = right ? '#cc3344' : '#44cc66'

  return (
    <div style={{ flex: big ? '1.35 1 0' : '1 1 0', minWidth:0, display:'flex', flexDirection:'column', alignItems:'stretch' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', fontSize:'12px', color: right ? '#ff8888' : '#88ccff',
        flexDirection: right ? 'row-reverse' : 'row' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
      </div>
      {/* 絵 */}
      <div ref={areaRef} style={{ position:'relative', height: artH, display:'flex', justifyContent:'center', alignItems:'flex-end', margin:'4px 0' }}>
        <div style={{ height:`${scale * 100}%`, display:'flex', alignItems:'flex-end', transform:`translateX(${dx.toFixed(1)}px)`,
          opacity: down ? 0.25 : 1, transition:'opacity 0.4s' }}>
          {src ? (
            // 待機の絵の枠（正方形）。攻撃の絵はこの枠に重ねる（ox・oy・w・h は待機の枠（クラスは 224px・ボスは base）を100%として割合で置く）
            <div style={{ position:'relative', height:'100%', aspectRatio:'1 / 1', maxWidth:'100%', filter: filters.join(' ') || 'none' }}>
              <img src={src} alt="" draggable={false}
                style={{ width:'100%', height:'100%', objectFit:'contain', userSelect:'none', visibility: frame >= 0 ? 'hidden' : 'visible' }} />
              {/* 攻撃の絵は、流していないときも隠して置いておく（FrameStrip） */}
              {strips.map(m => {
                const b = m.base || IDLE_SIZE
                return (
                  <FrameStrip key={m.src} a={m} frame={m.src === mo?.src ? frame : -1}
                    style={{ left:`${-m.ox / b * 100}%`, top:`${-m.oy / b * 100}%`, width:`${m.w / b * 100}%`, height:`${m.h / b * 100}%` }} />
                )
              })}
            </div>
          ) : (
            <div style={{ width:'clamp(80px, 22vw, 120px)', height:'clamp(80px, 22vw, 120px)', border:`2px solid ${hpColor}`, borderRadius:'8px',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:'40px', color: hpColor, filter: filters.join(' ') || 'none' }}>
              {(name || '？').slice(0, 1)}
            </div>
          )}
        </div>
        {/* 浮かぶ数字 */}
        {pops.map((f, i) => {
          const a = (now - f.t0) / POP_SEC
          return (
            <span key={`${f.t0}-${i}`} style={{ position:'absolute', zIndex: 3, left:'50%', top:`${30 - a * 26 - (i % 3) * 14}%`,
              transform:'translateX(-50%)', pointerEvents:'none', whiteSpace:'nowrap', fontWeight:'bold',
              fontSize: f.crit ? '22px' : '17px', color: f.crit ? '#ffcc00' : POP_COLOR[f.kind], opacity: Math.max(0, 1 - a * a),
              textShadow:'1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>
              {popText(f)}{f.crit ? '!' : ''}
            </span>
          )
        })}
      </div>
      {/* HP・ゲージ */}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color: TEXT.label, gap:'4px', flexWrap:'wrap' }}>
        <span>HP {Math.max(0, me.hp).toLocaleString()} / {me.base.hp.toLocaleString()}</span>
        {!right && <span>MP {Math.max(0, me.mp).toLocaleString()} / {me.base.mp.toLocaleString()}</span>}
      </div>
      <Bar pct={(Math.max(0, me.hp) / me.base.hp) * 100} color={hpColor} h={10} />
      <div style={{ marginTop:'3px' }}>
        {me.cast
          ? <Bar pct={((st.t - me.cast.start) / CAST_SEC) * 100} color="#ff5522" h={8} />
          : <Bar pct={(Math.min(me.gauge, need) / need) * 100} color={me.ail.paralyze ? '#888888' : right ? '#ff9944' : '#44aaff'} h={6} />}
      </div>
      {me.cast && (
        <div style={{ color:'#ff9944', fontSize:'11px', marginTop:'2px', textAlign: right ? 'right' : 'left' }}>
          ⚠ 「{me.cast.name}」の構え　あと{Math.max(0, me.cast.until - st.t).toFixed(1)}秒
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', alignItems: align }}>
        <Chips st={st} side={me} right={right} />
      </div>
    </div>
  )
}

// ボスの技のエフェクトが当たる場所（自分の絵の枠の上からの割合＝体の真ん中あたり）
export const FX_TARGET_Y = 0.58
// 飛ぶ絵：出はじめは小さく（FX_GROW_SEC で元の大きさ）・だんだん速く
const FX_GROW_SEC = 0.12
const flyPosOf = (p) => p * (0.7 + 0.3 * p)

// 絵の枠（正方形・下にそろえて横は真ん中・高さは場所の scale 倍）の、舞台の左上からの位置と大きさ
const boxOf = (stage, area, scale) => {
  const h = area.height * scale, w = Math.min(h, area.width)
  return { x: area.left - stage.left + (area.width - w) / 2, y: area.top - stage.top + area.height - h, w, h }
}

// 横に並べたコマの1つを、合わせる点（ax・ay）が (x, y) に来るように置く。s＝待機の枠の1pxが画面の何pxか・rot＝回す角度（ラジアン）
const Sprite = ({ a, frame, x = 0, y = 0, s = 1, rot = 0 }) => (
  <FrameStrip a={a} frame={frame} style={{ zIndex: 2, left: x - a.ax * s, top: y - a.ay * s, width: a.w * s, height: a.h * s,
    transform: rot ? `rotate(${rot}rad)` : undefined, transformOrigin: `${a.ax * s}px ${a.ay * s}px` }} />
)

// ボスの技のエフェクト。geo＝{ p: 自分の絵の枠, b: ボスの絵の枠 }（舞台の左上から）・art＝lib/bossArt.js の bossArtOf
//   エフェクトの絵は1枚ずつ置いたまま（出ていないときは隠す・FrameStrip）。同じ絵が重なったら新しいほう
function BossFx({ fx, now, geo, art }) {
  const s = geo ? geo.b.w / art.base : 1
  const to = geo && { x: geo.p.x + geo.p.w / 2, y: geo.p.y + geo.p.h * FX_TARGET_Y }
  const acts = geo ? fx.filter(f => f.kind === 'act' && f.side === 'b' && f.motion?.fx) : []
  return Object.values(art.motions).flatMap(m => Object.entries(m.fx || {}).map(([kind, a]) => {
    let on = null
    for (const f of acts) {
      if (f.motion.src !== m.src) continue
      const tFly = f.t0 + m.hitMs / 1000, tHit = f.t0 + m.impactMs / 1000
      if (kind === 'fly' && m.front && now >= tFly && now < tHit) {
        const e = now - tFly
        const from = { x: geo.b.x + m.front[0] * s, y: geo.b.y + m.front[1] * s }
        const q = flyPosOf(e / (tHit - tFly))
        on = { frame: Math.floor(e * 1000 / a.ms) % a.frames, x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q,
          s: s * Math.min(1, 0.5 + 0.5 * e / FX_GROW_SEC), rot: Math.atan2(to.y - from.y, to.x - from.x) - Math.PI }   // 飛ぶ絵は左向き
      }
      if (kind === 'hit' && f.landed !== false && now >= tHit) {
        const frame = motionFrameAt(a, (now - tHit) * 1000)
        if (frame >= 0) on = { frame, x: to.x, y: to.y, s }
      }
    }
    return <Sprite key={a.src} a={a} {...(on || { frame: -1 })} />
  }))
}

// foeArt … ダンジョンのボスの絵（lib/bossArt.js の bossArtOf）。あれば技ごとの絵とエフェクトを流す
export default function V2capAtbStage({ st, fx, now, playerSrc, playerMotion, foeSrc, foeBig = false, foeArt = null }) {
  // ボスのエフェクトの位置：絵の場所（動かない枠）を測る。大きさが変わったら測り直す
  const stageRef = useRef(null), pArea = useRef(null), bArea = useRef(null)
  const [geo, setGeo] = useState(null)
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || !foeBig) return
    const ro = new ResizeObserver(() => {
      if (!pArea.current || !bArea.current) return
      const r = el.getBoundingClientRect()
      setGeo({ p: boxOf(r, pArea.current.getBoundingClientRect(), PLAYER_VS_BOSS), b: boxOf(r, bArea.current.getBoundingClientRect(), 1) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [foeBig])
  return (
    <div ref={stageRef} style={{ position:'relative', overflow:'hidden', display:'flex', gap:'12px', alignItems:'flex-start', padding:'8px',
      background:'linear-gradient(180deg, #000a26 0%, #001338 70%, #00204a 100%)', border:'1px solid #0a2a55' }}>
      <Fighter st={st} side="a" me={st.a} src={playerSrc} motion={playerMotion} strips={playerMotion ? [playerMotion] : []} fx={fx} now={now} name={st.a.name}
        artH={foeBig ? ART_H_BIG : ART_H} scale={foeBig ? PLAYER_VS_BOSS : 1} areaRef={pArea} />
      <Fighter st={st} side="b" me={st.b} right src={foeSrc} strips={foeArt ? Object.values(foeArt.motions) : []} fx={fx} now={now} name={st.b.name} big={foeBig} artH={foeBig ? ART_H_BIG : ART_H}
        areaRef={bArea} />
      {foeArt && <BossFx fx={fx} now={now} geo={geo} art={foeArt} />}
    </div>
  )
}
