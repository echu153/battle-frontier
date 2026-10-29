import { useId, useLayoutEffect, useRef, useState } from 'react'
import { TEXT } from './v2ui.js'
import { buffChips, ailChips, stateChips, needNow, CAST_SEC } from '../core/atb.js'
import { STAT_DEFS } from '../core/stats.js'
import { lungeOf, shakeOf, HIT_SEC, POP_SEC, GLOW_SEC } from '../lib/atbFx.js'
import { motionFrameAt, IDLE_SIZE } from '../lib/motionArt.js'
import { illustPoseAt, illustCastPoseAt, illustFreePoseAt, illustTrailsAt, illustPointAt, mouthPointOf, rotPoint, swapOpacityOf, dustEllipsesOf, bendFramesOf } from '../lib/bossIllust.js'
import { FX_HEAD_Y, FX_FEET_Y, FX_TARGET_Y, SCENE_TOP, fallAt, coilAt, pourTimesOf, sceneEndMsOf, stageSceneOf } from '../lib/bossScene.js'

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
//   ・ボスのイラスト版（IllustRig・lib/bossIllust.js・2026-10-28 ユーザー「イラスト版も作ったからドット絵版は別バージョンで作っておいて」）：
//     パーツ（奥の翼・手前の翼・体・頭）を重ね、姿勢（翼・首・全体の角度とずれ・口の火）で動かす。ドット絵版より大きく出す
//     （STAGE_OF.illust＝枠を高く・自分はそのぶん小さく。グラブルのように「どんと大きく」）。エフェクトは1枚の塗りを動きで見せる
//     2026-10-28 ユーザー「もっとひっかく」「口をしっかり開けて吐く」「翼の風をもっと翼から」：前脚（体の子・頭より手前）と
//     下あご（頭の中）も回す・開いた口の中（MouthInside）・爪と翼の残像の筋（RigTrails）・飛ぶ絵は出どころ（shots）ごとに1枚・爪の跡は引いて出す（wipe）
//   ・2026-10-29 雨摩座の技：構え（大技の詠唱）のあいだは構えの姿勢（両手を掲げて震える）・構えのすぐあとの技は構えの姿勢からつなぐ。
//     エフェクトを相手の頭上・足元に出す（on）：氷雨の雨・水天葬の滝は上から下へ降りる（drop）・水縛の帯は外から締まる（bind）・
//     水天葬の渦の雲（ためる）は構えのあいだから相手の頭上に出て、滝が落ちたら薄れる
//   ・2026-10-29 雨摩座の手振り（ユーザー「右手を胸元まで持ってきて手前にさっと（いけー！）」「大技は右手を真上に掲げて相手に向かって放つ」）：
//     右腕は3つの絵（ふだん・胸元・真上）を切り替える（RigPart の濃さ）。払う・振り下ろす手の通り道に水の筋（RigTrails の water）
//     水の帯は体の動きから切り離し、技・構えのあいだも待機のまま漂う（ユーザー「水の帯まで動いてると違和感ある」・IllustRig の freePose）
//   ・2026-10-29 黒龍の描き直し（ユーザー「待機時のモーションは翼を前後に羽ばたかせたりしっぽを時折叩きつける」・選んだ「たまに火の玉が出る感じ」）：
//     ときどき口に火の玉（RigPart の頭の中・pose.orb）・しっぽを叩きつけた砂ぼこり（RigDust・pose.dust）
//   ・2026-10-29 派手な演出（ユーザー「もっとモーションを豪華にしたい、グラブルに近づけたい」「水天葬だったらほんとに滝が叩きつけてるように、派手に」）：
//     技に scene があれば（lib/bossScene.js）、背景を暗く（舞台の内側の影）・光る（Flash）・舞台ごと揺れる・描いた絵の上に動くもの（SceneLayer＝
//     流れ落ちる水の筋・しぶき・波紋・もや・雲の渦の光・掲げた手に集まる光）。滝の絵は叩きつけた所でふくらみ、落ち終わると上から切れる。
//     戦闘の画面は2.5秒より古い印を片付けるので、演出が終わるまでボスの技の印を覚えておく（keptActs）
//   ・2026-10-30 ユーザー「滝流すモーションが止まってるから躍動感がない、しっかり水が流れるようにしてほしい」「水縛りの帯もしょぼい、もっと豪華にして」：
//     滝は水の絵そのものを流す（PourFlow＝流れる水の絵を縦に並べて流す2枚・描いた絵は下の波だけにして、裏返した絵と交互に揺らして泡立たせる）。
//     水縛の帯＝手から波打つ水の綱（SceneLayer の tether・光が綱を伝う）・体に巻きつく3重の水の輪（回りながら締め上げる・奥の半分は暗く）・
//     泡・しぶき・締め上げるたび相手が縮む（Fighter の squeeze）・最後にはじけて解ける
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
// ボスの絵ごとの舞台の大きさ：枠の高さ（両方そろえる＝HPバーが並ぶ）・自分の絵の倍率・ボスの側の幅（flex）
//   イラスト版は枠を 300px まで（自分の絵はドット絵版のときとほぼ同じ大きさ＝0.48倍）
const STAGE_OF = {
  pixel: { artH: ART_H_BIG, player: PLAYER_VS_BOSS, flex: '1.35 1 0' },
  illust: { artH: 'clamp(170px, 46vw, 300px)', player: 0.48, flex: '1.6 1 0' },
}

// 横に並べたコマの1枚から frame のコマだけを見せる（-1 なら隠す）。
//   【確定】2026-10-28 背景の絵（background-image）にして出すたびに置くと、そのたびに絵を読み直して一瞬なにも出ない
//   （竜の技の頭で竜が消えて見えた）＝<img> を隠して置いたままにして、コマだけ切り替える
const FrameStrip = ({ a, frame, style }) => (
  <div style={{ position:'absolute', overflow:'hidden', pointerEvents:'none', visibility: frame >= 0 ? 'visible' : 'hidden', ...style }}>
    <img src={a.src} alt="" draggable={false} decoding="sync"
      style={{ position:'absolute', top:0, left:`${-Math.max(0, frame) * 100}%`, width:`${a.frames * 100}%`, height:'100%', maxWidth:'none', userSelect:'none' }} />
  </div>
)

// イラスト版のボス：枠（正方形）を立ち絵（art.base px）として、パーツを割合で置く。全体→パーツ→子のパーツの順に回す（中心は一覧の px・py）
//   子のパーツ（前脚＝体の子・下あご＝頭の子）は親の中に重ねる＝親といっしょに動く。口の火（glow）と口の中は頭といっしょに動く
//   体の動きから切り離したパーツ（p.free・雨摩座の水の帯）は、いちばん奥に別の枠で、待機の姿勢（freePose）のまま動かす
//   黒龍の待機：しっぽを叩きつけた砂ぼこり（RigDust・いちばん手前）
const rigWrap = (art, pose) => ({ position:'absolute', inset:0, pointerEvents:'none',
  transform:`translate(${(pose.x * 100).toFixed(2)}%, ${(pose.y * 100).toFixed(2)}%) rotate(${pose.r.toFixed(2)}deg)`,
  transformOrigin:`${(art.pivot[0] / art.base) * 100}% ${(art.pivot[1] / art.base) * 100}%` })
const IllustRig = ({ art, pose, freePose }) => {
  const box = { x: 0, y: 0, w: art.base, h: art.base }
  const free = art.parts.filter(p => p.free && !p.nest)
  return (
    <>
      {free.length > 0 && (
        <div style={rigWrap(art, freePose)}>
          {free.map(p => <RigPart key={p.key} art={art} p={p} box={box} pose={freePose} />)}
        </div>
      )}
      <div style={rigWrap(art, pose)}>
        {art.parts.filter(p => !p.nest && !p.free).map(p => <RigPart key={p.key} art={art} p={p} box={box} pose={pose} />)}
        {art.dust && pose.dust > 0 && <RigDust art={art} k={pose.dust} />}
      </div>
    </>
  )
}
// 砂ぼこり（k＝出てからの割合 0〜1）：打った所（しっぽの下のふち）から左右へ広がり、少し上がりながら薄れる。はじめの 12% で濃くなる
//   （小さく出すと粒が並んで見えた・2026-10-29）。色はくすんだ茶色（白いと雲に見えた）。lib の dustEllipsesOf と同じ形
const RigDust = ({ art, k }) => {
  const id = useId()
  return (
    <svg viewBox={`0 0 ${art.base} ${art.base}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible', pointerEvents:'none' }}>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor="#7d6d62" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#5e5048" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#3e3430" stopOpacity="0" />
        </radialGradient>
      </defs>
      {dustEllipsesOf(art.dust, k).map((c, i) => <ellipse key={i} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={`url(#${id})`} opacity={c.op} />)}
    </svg>
  )
}
// パーツ1つぶんの CSS（lib/bossIllust.js の partMove と同じ：長さの向きに縮めてから回す）
const partTransform = (p, pose) => {
  if (p.bend) return undefined   // 曲げるパーツは回さない（角度は曲げた絵の選び方に使う＝BendFrames）
  const deg = pose[p.key], sq = pose[`${p.key}Sq`] || 0
  if (typeof deg !== 'number') return undefined
  return `rotate(${deg.toFixed(2)}deg)${sq ? ` rotate(${p.ax || 0}deg) scaleX(${(1 - sq).toFixed(3)}) rotate(${-(p.ax || 0)}deg)` : ''}`
}
//   腕の構えの絵（p.swap・雨摩座）は切り替える割合で濃さを変え、見えないときは隠す（子のパーツもいっしょ）
const RigPart = ({ art, p, box, pose }) => {
  const S = art.base
  const mouth = art.jaw ? rotPoint(art.jaw.mouth, art.jaw.pivot, (pose.jaw || 0) / 2) : [art.mouth[0] + S * 0.03, art.mouth[1]]
  const op = p.swap ? swapOpacityOf(p.swap, pose) : 1
  return (
    <div style={{ position:'absolute', left:`${((p.x - box.x) / box.w) * 100}%`, top:`${((p.y - box.y) / box.h) * 100}%`,
      width:`${(p.w / box.w) * 100}%`, height:`${(p.h / box.h) * 100}%`,
      opacity: op < 1 ? op : undefined, visibility: op <= 0 ? 'hidden' : undefined,
      transform: partTransform(p, pose),
      transformOrigin:`${((p.px - p.x) / p.w) * 100}% ${((p.py - p.y) / p.h) * 100}%` }}>
      {p.key === 'head' && <MouthInside art={art} p={p} pose={pose} />}
      {p.bend
        ? <BendFrames p={p} deg={pose[p.key] || 0} />
        : <img src={p.src} alt="" draggable={false} decoding="sync" style={{ position:'relative', width:'100%', height:'100%', display:'block', maxWidth:'none', userSelect:'none' }} />}
      {art.parts.filter(c => c.nest && c.parent === p.key).map(c => <RigPart key={c.key} art={art} p={c} box={p} pose={pose} />)}
      {/* 待機のときどき口に出る火の玉（黒龍・pose.orb＝大きさ）：頭といっしょに動く。ゆっくり回ってゆらめく */}
      {p.key === 'head' && art.orb && pose.orb > 0.001 && (
        <img src={art.orb.src} alt="" draggable={false} decoding="sync"
          style={{ position:'absolute', left:`${((art.orb.at[0] - p.x) / p.w) * 100}%`, top:`${((art.orb.at[1] - p.y) / p.h) * 100}%`,
            width:`${(art.orb.size * S / p.w) * 100}%`, maxWidth:'none', pointerEvents:'none', userSelect:'none', opacity: pose.orbOp,
            transform:`translate(-50%, -50%) rotate(${(pose.orbT * 0.12).toFixed(1)}deg) scale(${(pose.orb * (1 + 0.05 * Math.sin(pose.orbT / 45))).toFixed(3)})` }} />
      )}
      {/* 口の外の光：口を大きく開けているあいだは小さく薄く（開いた口の中が見えるように・火は口の中で光る） */}
      {p.key === 'head' && pose.glow > 0.01 && (
        <div style={{ position:'absolute', left:`${((mouth[0] - p.x) / p.w) * 100}%`, top:`${((mouth[1] - p.y) / p.h) * 100}%`,
          width:`${(S * (art.jaw ? 0.12 : 0.16) / p.w) * 100}%`, aspectRatio:'1 / 1', transform:'translate(-50%, -50%)', borderRadius:'50%',
          opacity: pose.glow * (art.jaw ? 1 - 0.75 * Math.min(1, -(pose.jaw || 0) / 24) : 1), mixBlendMode:'screen',
          background:'radial-gradient(circle, rgba(255,245,200,0.95) 0%, rgba(255,150,40,0.75) 30%, rgba(255,60,0,0.25) 55%, rgba(255,40,0,0) 72%)' }} />
      )}
    </div>
  )
}
// 曲げるパーツ（黒龍のしっぽの巻いた先・p.bend）：角度ごとに曲げた絵を横に並べた1枚から、角度に近い2枚を重ねて出す（上の絵の濃さで間をつなぐ＝2°ごとの絵でもなめらか）
//   【確定】2026-10-29 ユーザー「しっぽ動かすの不自然って思わない？」：回すだけだと付け根で折れて見えた
const BendFrames = ({ p, deg }) => {
  const b = p.bend, { i, j, k } = bendFramesOf(b, deg)
  const frame = (n, op, key) => (
    <div key={key} style={{ position:'absolute', left:`${((b.x - p.x) / p.w) * 100}%`, top:`${((b.y - p.y) / p.h) * 100}%`,
      width:`${(b.w / p.w) * 100}%`, height:`${(b.h / p.h) * 100}%`, overflow:'hidden', opacity: op }}>
      <img src={b.src} alt="" draggable={false} decoding="sync"
        style={{ position:'absolute', left:`${-n * 100}%`, top:0, width:`${b.n * 100}%`, height:'100%', maxWidth:'none', userSelect:'none' }} />
    </div>
  )
  return <>{frame(i, 1, 'a')}{k > 0.01 && j !== i && frame(j, k, 'b')}</>
}
// 開いた口の中（頭の後ろに描く＝上あご・下あごの絵がふちを覆う）：口の線と、下あごの角度だけ回した線のあいだ。牙を少し・口の火で明るく
const MouthInside = ({ art, p, pose }) => {
  const id = useId()
  const j = art.jaw
  if (!j || (pose.jaw || 0) > -0.5) return null
  const lower = j.line.map(pt => rotPoint(pt, j.pivot, pose.jaw))
  const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const mouth = rotPoint(j.mouth, j.pivot, pose.jaw / 2)
  // 牙：口の線の点から、向かいの線のほうへ（長さは口のすき間の 35%・7px まで）
  const fang = (a, b, i) => {
    const [ax, ay] = a, dx = b[0] - ax, dy = b[1] - ay, d = Math.hypot(dx, dy) || 1, len = Math.min(7, d * 0.35)
    const ux = -dy / d * 2.2, uy = dx / d * 2.2
    return <polygon key={i} points={pts([[ax - ux, ay - uy], [ax + ux, ay + uy], [ax + dx / d * len, ay + dy / d * len]])} fill="#e6d6bc" />
  }
  return (
    <svg viewBox={`${p.x} ${p.y} ${p.w} ${p.h}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible' }}>
      <defs>
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={mouth[0]} cy={mouth[1]} r="46">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="35%" stopColor="#ff8a1e" />
          <stop offset="100%" stopColor="#5a0800" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polygon points={pts([...j.line, ...lower.slice().reverse()])} fill="#2a0306" />
      {pose.glow > 0.01 && <polygon points={pts([...j.line, ...lower.slice().reverse()])} fill={`url(#${id})`} opacity={pose.glow} />}
      {[1, 2, 3].map(i => fang(j.line[i], lower[i], `u${i}`))}
      {[1, 2].map(i => {
        const m = (a) => [(a[i][0] + a[i + 1][0]) / 2, (a[i][1] + a[i + 1][1]) / 2]
        return fang(m(lower), m(j.line), `l${i}`)
      })}
    </svg>
  )
}
// 残像の筋（爪・風）：立ち絵の px の線を、新しいほど太く濃く。外に広くぼかした色＋細い明るい芯
const TRAIL_STYLE = {
  claw: { glow: '#ff4a14', core: '#fff0c0', gw: 11, cw: 3.2 },
  wind: { glow: 'rgba(255,110,80,0.5)', core: 'rgba(255,238,228,0.9)', gw: 18, cw: 3 },
  // 水（雨摩座の払う手）：白い袖の上を通るので、濃い青で太く
  water: { glow: 'rgba(40,130,255,0.9)', core: 'rgba(225,248,255,1)', gw: 30, cw: 8 },
}
const RigTrails = ({ art, trails }) => (
  <svg viewBox={`0 0 ${art.base} ${art.base}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible', pointerEvents:'none', zIndex: 1 }}>
    {['glow', 'core'].map(layer => (
      <g key={layer} strokeLinecap="round" style={layer === 'glow' ? { filter:'blur(3px)' } : undefined}>
        {trails.flatMap((tr, i) => tr.line.slice(1).map((b, k) => {
          const a = tr.line[k], f = (k + 1) / (tr.line.length - 1), st = TRAIL_STYLE[tr.kind]
          return <line key={`${i}-${k}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={st[layer]}
            strokeWidth={(layer === 'glow' ? st.gw : st.cw) * (0.25 + 0.75 * f)} opacity={tr.alpha * (0.15 + 0.85 * f)} />
        }))}
      </g>
    ))}
  </svg>
)

const POP_COLOR ={ hit: '#ffffff', miss: '#9fb3c8', heal: '#44ff88', tick: '#cc99ff' }
const popText = (f) => (f.kind === 'miss' ? 'MISS' : f.kind === 'heal' ? `+${f.amount.toLocaleString()}` : f.amount.toLocaleString())
// 構えのすぐあとに撃った技か：構えを最後に見た時刻（castEnd）から CAST_GAP_SEC 以内に動いた（構えが終わった刻みで撃つ＝ふつうは 0.03秒ほど）
const CAST_GAP_SEC = 0.5
const afterCast = (t0, castEnd) => t0 - castEnd > -0.05 && t0 - castEnd < CAST_GAP_SEC

// 1人ぶん。right＝右（モンスター）。fx は [{ kind, side, amount, crit, t0 }]・now は fx の t0 と同じ時計（秒）
//   areaRef … 絵の場所（動かない枠）。ボスのエフェクトの位置を測る
//   strips … 置いておく攻撃の絵（自分＝motion・ボス＝技ごとの絵ぜんぶ）／rig … イラスト版のボス（lib/bossIllust.js の bossIllustOf）
//   castEnd … 構えを最後に見た時刻（now と同じ時計）。構えのすぐあとの技は構えの姿勢からつなぐ
//   squeeze … ボスの技で締め上げられて縮む [横, 縦]（水縛の帯・足元を中心に）
function Fighter({ st, side, me, right, src, motion, strips = [], rig = null, fx, now, name, flex = '1 1 0', artH = ART_H, scale = 1, areaRef, castEnd = -1e9, squeeze = null }) {
  const mine = fx.filter(f => f.side === side)
  const lastOf = (kind) => mine.reduce((t, f) => (f.kind === kind && f.t0 <= now && f.t0 > t ? f.t0 : t), -1e9)
  const dir = right ? -1 : 1   // 前＝相手の方
  // 攻撃の絵があれば流す（流しているあいだは踏み込まない）。act に motion が付いていればそちら（ボスの技ごとの絵）
  const lastAct = mine.reduce((p, f) => (f.kind === 'act' && f.t0 <= now && (!p || f.t0 > p.t0) ? f : p), null)
  const mo = lastAct?.motion || motion
  const frame = mo?.ms && lastAct ? motionFrameAt(mo, (now - lastAct.t0) * 1000) : -1
  // イラスト版は姿勢で動かす（技の動きも姿勢の中＝踏み込まない）
  const rigMotion = rig && lastAct?.motion?.keys ? lastAct.motion : null, rigMs = (now - (lastAct?.t0 ?? now)) * 1000
  // 構えのあいだは構えの姿勢（技を流しているあいだは技が先）
  const casting = rig && me.cast && !(rigMotion && rigMs < rigMotion.totalMs)
  const pose = !rig ? null : casting ? illustCastPoseAt(rig.key, (st.t - me.cast.start) * 1000, now * 1000)
    : illustPoseAt(rig.key, rigMotion, rigMs, now * 1000, !!lastAct && afterCast(lastAct.t0, castEnd))
  const trails = rigMotion ? illustTrailsAt(rig.key, rigMotion, rigMs, now * 1000) : []
  const dx = (frame >= 0 || rig ? 0 : lungeOf(now - lastOf('act')) * dir) + shakeOf(now - lastOf('hit'))
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
    <div style={{ flex, minWidth:0, display:'flex', flexDirection:'column', alignItems:'stretch' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', fontSize:'12px', color: right ? '#ff8888' : '#88ccff',
        flexDirection: right ? 'row-reverse' : 'row' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
      </div>
      {/* 絵 */}
      <div ref={areaRef} style={{ position:'relative', height: artH, display:'flex', justifyContent:'center', alignItems:'flex-end', margin:'4px 0' }}>
        <div style={{ height:`${scale * 100}%`, display:'flex', alignItems:'flex-end', transformOrigin:'50% 100%',
          transform:`translateX(${dx.toFixed(1)}px)${squeeze ? ` scale(${squeeze[0].toFixed(3)}, ${squeeze[1].toFixed(3)})` : ''}`,
          opacity: down ? 0.25 : 1, transition:'opacity 0.4s' }}>
          {src || rig ? (
            // 待機の絵の枠（正方形）。攻撃の絵はこの枠に重ねる（ox・oy・w・h は待機の枠（クラスは 224px・ボスは base）を100%として割合で置く）
            <div style={{ position:'relative', height:'100%', aspectRatio:'1 / 1', maxWidth:'100%', filter: filters.join(' ') || 'none' }}>
              {rig && trails.length > 0 && <RigTrails art={rig} trails={trails} />}
              {rig ? <IllustRig art={rig} pose={pose} freePose={illustFreePoseAt(rig.key, now * 1000)} /> : (
                <img src={src} alt="" draggable={false}
                  style={{ width:'100%', height:'100%', objectFit:'contain', userSelect:'none', visibility: frame >= 0 ? 'hidden' : 'visible' }} />
              )}
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

// ボスの技のエフェクトが当たる場所（自分の絵の枠の上からの割合＝体の真ん中あたり）は lib/bossScene.js の FX_TARGET_Y
// 相手の頭上・足元に出すエフェクト（on）の場所（FX_HEAD_Y・FX_FEET_Y）は lib/bossScene.js（演出と同じ場所）
// 飛ぶ絵：出はじめは小さく（FX_GROW_SEC で元の大きさ）・だんだん速く
const FX_GROW_SEC = 0.12
const flyPosOf = (p) => p * (0.7 + 0.3 * p)

// 絵の枠（正方形・下にそろえて横は真ん中・高さは場所の scale 倍）の、舞台の左上からの位置と大きさ
const boxOf = (stage, area, scale) => {
  const h = area.height * scale, w = Math.min(h, area.width)
  return { x: area.left - stage.left + (area.width - w) / 2, y: area.top - stage.top + area.height - h, w, h }
}

// 横に並べたコマの1つを、合わせる点（ax・ay）が (x, y) に来るように置く。s＝絵の1pxが画面の何pxか・rot＝回す角度（ラジアン）・op＝濃さ
//   ay を渡すと縦の合わせる点だけ変える（足元にそろえる絵＝絵の下のはし）・mask＝ぼかした切り抜き（CSS の mask-image）・
//   sx・sy＝横・縦だけ伸ばす（合わせる点は動かない）・filter＝明るさなど・flip＝左右に裏返す（合わせる点で）
const Sprite = ({ a, frame, x = 0, y = 0, s = 1, sx = 1, sy = 1, rot = 0, op = 1, clip, mask, filter, flip = false, ay = a.ay }) => (
  <FrameStrip a={a} frame={frame} style={{ zIndex: 2, left: x - a.ax * s * sx, top: y - ay * s * sy, width: a.w * s * sx, height: a.h * s * sy, opacity: op, clipPath: clip,
    maskImage: mask, WebkitMaskImage: mask, filter,
    transform: rot || flip ? `${rot ? `rotate(${rot}rad)` : ''}${flip ? ' scaleX(-1)' : ''}` : undefined, transformOrigin: `${a.ax * s * sx}px ${ay * s * sy}px` }} />
)
const easeOut = (k) => 1 - (1 - k) * (1 - k)

// ボスの技のエフェクト。geo＝{ p: 自分の絵の枠, b: ボスの絵の枠 }（舞台の左上から）・art＝lib/bossArt.js の bossArtOf か lib/bossIllust.js の bossIllustOf
//   エフェクトの絵は1枚ずつ置いたまま（出ていないときは隠す・FrameStrip）。同じ絵が重なったら新しいほう
//   ドット絵版＝コマを流す（大きさは竜と同じ px）／イラスト版＝1枚の塗りを動きで見せる（大きさは枠の幅 × size）：
//     飛ぶ＝少しゆらぐ・当たる＝durMs のあいだ大きくなりながら消える（spin° 回る）
//   on のあるエフェクト（雨摩座）は相手の頭上・足元に出す（大きさは自分の絵の枠の幅に対して）：
//     drop＝lead のあいだに上から下へ見えてくる（降りきったときがダメージ）／bind＝大きく出て締まる
//   cast＝構えている大技（{ name, ms＝構えはじめてから }）・castEnd＝構えを最後に見た時刻（相手の頭上の雲を構えから技へつなぐ）
//   scene＝派手な演出（lib/bossScene.js の stageSceneOf）：雲の稲光と明るさに使う。滝の絵の動きは fallAt
function BossFx({ fx, now, geo, art, cast = null, castEnd = -1e9, scene = null }) {
  const s = geo ? geo.b.w / art.base : 1
  const extras = []   // 滝の流れる水・泡立つ波（裏返した絵）
  const to = geo && { x: geo.p.x + geo.p.w / 2, y: geo.p.y + geo.p.h * FX_TARGET_Y }
  const acts = geo ? fx.filter(f => f.kind === 'act' && f.side === 'b' && f.motion?.fx) : []
  // 構えている技の絵：名前が同じ技・無ければ最後の技（lib/bossArt.js の bossMotionKeyOf と同じ＝構えた技は最後の技を流す）
  const motions = Object.values(art.motions)
  const castM = cast && geo ? motions.find(m => m.label === cast.name) || motions.at(-1) : null
  return motions.flatMap(m => Object.entries(m.fx || {}).flatMap(([kind, a]) => {
    if (kind === 'flow') return []   // 流れる水の絵は滝の中（PourFlow）
    const sc = a.size ? (a.size * ((a.on ? geo?.p.w : geo?.b.w) || 0)) / a.w : s   // イラスト版は枠の幅に対する大きさ
    const lead = a.lead || 0
    // 飛ぶ絵は出どころ（shots）ごとに1枚（イラスト版の黒翼烈風は両方の翼から）。届く時刻は1つめ＝ダメージの時刻。ためる絵は ChargeOrb だけ
    const shots = kind === 'fly' ? (m.shots || (m.front ? [{ front: m.front, delayMs: 0, size: 1 }] : [])) : kind === 'hit' ? [null] : []
    return shots.map((sh, i) => {
      let on = null
      for (const f of acts) {
        if (f.motion !== m) continue
        const lag = (sh?.delayMs || 0) / 1000
        const tFly = f.t0 + m.hitMs / 1000 + lag, tHit = f.t0 + m.impactMs / 1000 + lag
        if (kind === 'fly' && now >= tFly && now < tHit) {
          const e = now - tFly
          const from = { x: geo.b.x + sh.front[0] * s, y: geo.b.y + sh.front[1] * s }
          const q = flyPosOf(e / (tHit - tFly))
          const grow = Math.min(1, 0.5 + 0.5 * e / FX_GROW_SEC) * (a.frames > 1 ? 1 : 1 + 0.06 * Math.sin(e * 30))
          on = { frame: a.frames > 1 ? Math.floor(e * 1000 / a.ms) % a.frames : 0, x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q,
            s: sc * sh.size * grow, rot: Math.atan2(to.y - from.y, to.x - from.x) - Math.PI }   // 飛ぶ絵は左向き
        }
        if (kind === 'hit' && f.landed !== false && now >= tHit - lead / 1000) {
          const ms = (now - tHit) * 1000 + lead   // 当たる絵が出はじめてから
          const actMs = (now - f.t0) * 1000 - (sh?.delayMs || 0)
          const fall = a.anim === 'drop' ? fallAt(m, actMs) : null
          const coil = a.anim === 'bind' ? coilAt(m, actMs) : null
          if (fall) {
            // 派手な演出のある滝（水天葬）：落ち続けるあいだ出したまま・叩きつけた所で横へふくらむ・光ったときは明るく・
            //   落ち終わると上から切れる（cut）。上から見えてくるのは drop と同じ。
            //   流れる水の絵（m.fx.flow）があれば、描いた絵は下の波だけにして（柱の所は PourFlow が流す）、裏返した絵と交互に揺らして泡立たせる
            const p = (lead ? easeOut(Math.min(1, ms / lead)) : 1) * 112, top = (a.fadeTop || 0) * 100, c = top + (100 - top) * fall.cut
            const flow = m.fx.flow, waveTop = flow ? 40 : 0, waveIn = flow ? 56 : 0
            const mask = `linear-gradient(to bottom, transparent 0%, transparent ${Math.max(c, waveTop).toFixed(1)}%, #000 ${Math.max(top, c + 20, waveIn).toFixed(1)}%, #000 ${Math.max(top, c + 20, waveIn, p - 12).toFixed(1)}%, transparent ${p.toFixed(1)}%)`
            const bob = flow ? Math.sin(actMs / 55) * 0.012 * geo.p.w : 0
            on = { frame: 0, x: to.x, y: geo.p.y + geo.p.h * FX_FEET_Y + bob, ay: a.h, s: sc, sx: fall.sx, sy: fall.sy, op: Math.min(1, ms / 90),
              filter: `brightness(${fall.bright.toFixed(3)})`, mask }
            if (flow) {
              extras.push(<Sprite key={`${a.src}#flip`} a={a} {...on} y={on.y - bob * 2} flip op={on.op * (0.35 + 0.3 * Math.sin(actMs / 75))} />)
              extras.push(<PourFlow key={`${a.src}#flow`} a={a} flow={flow} x={to.x} feet={geo.p.y + geo.p.h * FX_FEET_Y} s={sc} fall={fall}
                ms={actMs - m.hitMs} p={p} c={c} top={top} op={on.op} />)
            }
          } else if (coil) {
            // 水縛の帯（派手な演出）：大きく出て一気に締まり・締め上げるたび縮み・はじけたら広がって消える（lib/bossScene.js の coilAt）
            on = { frame: 0, x: to.x, y: to.y, s: sc * coil.s, rot: coil.rot, op: coil.op, filter: `brightness(${coil.bright.toFixed(3)})` }
          } else if (a.frames > 1) {
            const frame = motionFrameAt(a, ms)
            if (frame >= 0) on = { frame, x: to.x, y: to.y, s: sc }
          } else if (ms < a.durMs) {
            const k = ms / a.durMs, fade = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1
            // 出す場所：足元（絵の下のはしを枠の下へ）・頭上・ほかは体の真ん中
            const sp = a.on === 'feet' ? { x: to.x, y: geo.p.y + geo.p.h * FX_FEET_Y, ay: a.h }
              : a.on === 'head' ? { x: to.x, y: geo.p.y + geo.p.h * FX_HEAD_Y } : to
            if (a.anim === 'drop') {
              // 上から下へ降りる（雨・滝）：lead のあいだに上から見えてくる（降りる先のふちはぼかす）。fadeTop＝絵の上のはしをぼかす割合（滝の上を雲になじませる）
              const p = (lead ? easeOut(Math.min(1, ms / lead)) : 1) * 112, top = (a.fadeTop || 0) * 100
              on = { frame: 0, ...sp, s: sc, op: Math.min(1, ms / 90) * fade,
                mask: `linear-gradient(to bottom, transparent 0%, #000 ${top.toFixed(1)}%, #000 ${Math.max(top, p - 12).toFixed(1)}%, transparent ${p.toFixed(1)}%)` }
            } else if (a.anim === 'bind') {
              // 外から締まる（水の帯）：大きく出て、はじめの30%で元の大きさへ（小さく揺れて止まる）
              const t = Math.min(1, k / 0.3)
              on = { frame: 0, ...sp, s: sc * (1.35 - 0.35 * easeOut(t)), rot: Math.sin(ms / 60) * 0.04 * (1 - t), op: Math.min(1, k / 0.1) * fade }
            } else {
              on = a.wipe
                // 爪の跡：大きくせず、右上から左下へ引いたように出す（はじめの22%で引ききる）
                ? { frame: 0, ...sp, s: sc * (0.96 + 0.08 * easeOut(k)), op: fade, clip: wipeClipOf(Math.min(1, k / 0.22)) }
                : { frame: 0, ...sp, s: sc * (0.55 + 0.6 * easeOut(k)), rot: ((a.spin || 0) * k * Math.PI) / 180, op: Math.min(1, k / 0.08) * fade }
            }
          }
        }
      }
      return <Sprite key={`${a.src}#${i}`} a={a} {...(on || { frame: -1 })} />
    }).concat(m.charge?.kind === kind ? [<ChargeOrb key={`${a.src}#charge`} m={m} a={a} acts={acts} now={now} geo={geo} art={art} s={s}
      cast={castM === m ? cast : null} castEnd={castEnd} sky={scene?.cloud} />] : [])
  })).concat(extras)
}
// 滝の流れる水（水天葬）：上と下がつながる水の絵（flow）を、滝の柱の所（flow.at＝当たる絵の px）に縦に並べて流す。
//   2枚重ね（奥＝柱の幅で速く・手前＝少し広く、もっと速く、明るく重ねる）。外の箱は縦のぼかし（雲になじむ上・滝の先・落ち終わりの切れ目・下の波へ消える）、
//   中の箱は横のぼかし（柱のふち）。ms＝撃ってから・p・c・top＝描いた絵と同じ見えてくる先・切れ目・上のぼかし（当たる絵の %）
const FLOW_PX_PER_SEC = 3.4   // 1秒に柱の高さの何倍落ちるか
const FLOW_WIDE = 1.35        // 柱を描いた所より何倍広く流すか（ふちはぼかす）
function PourFlow({ a, flow, x, feet, s, fall, ms, p, c, top, op }) {
  const [fx0, fy0, fw] = flow.at, fh = a.h * 0.62 - fy0   // 柱は下の波の中ほどまで
  const W0 = fw * s * fall.sx, W = W0 * FLOW_WIDE, H = fh * s * fall.sy
  const left = x - a.ax * s * fall.sx + fx0 * s * fall.sx - (W - W0) / 2, topPx = feet - a.h * s * fall.sy + fy0 * s * fall.sy
  const pct = (v) => Math.max(0, Math.min(100, ((v / 100) * a.h - fy0) / fh * 100))   // 当たる絵の % → 柱の %
  const mask = `linear-gradient(to bottom, transparent 0%, transparent ${pct(c).toFixed(1)}%, #000 ${Math.max(pct(top + 6), pct(c + 20)).toFixed(1)}%, #000 ${Math.min(80, Math.max(pct(top + 6), pct(p - 12))).toFixed(1)}%, transparent ${Math.min(100, pct(p)).toFixed(1)}%)`
  // 流れた量はふくらむ前の大きさで数える（叩きつけてふくらんでも流れが跳ねない）
  const layer = (k, speed, extra) => {
    const w = W * k, tile = w * (flow.h / flow.w), tile0 = fw * s * FLOW_WIDE * k * (flow.h / flow.w)
    const off = (((Math.max(0, ms) / 1000) * FLOW_PX_PER_SEC * fh * s * speed) / tile0 % 1) * tile
    return (
      <div style={{ position:'absolute', left: (W - w) / 2, top: 0, width: w, height: H, backgroundImage:`url(${flow.src})`, backgroundRepeat:'repeat-y',
        backgroundSize:`${w}px ${tile}px`, backgroundPositionY:`${off.toFixed(1)}px`,
        maskImage:'linear-gradient(to right, transparent 0%, #000 16%, #000 84%, transparent 100%)', WebkitMaskImage:'linear-gradient(to right, transparent 0%, #000 16%, #000 84%, transparent 100%)', ...extra }} />
    )
  }
  return (
    <div style={{ position:'absolute', zIndex: 2, left, top: topPx, width: W, height: H, pointerEvents:'none', opacity: op,
      maskImage: mask, WebkitMaskImage: mask, filter:`brightness(${fall.bright.toFixed(3)})` }}>
      {layer(1, 1, {})}
      {layer(1.3, 1.45, { opacity: 0.5, mixBlendMode:'screen', filter:'brightness(1.25)' })}
    </div>
  )
}
// 撃つ前に口でためる火の玉（イラスト版の charge）：口（首と頭の動きについていく）で、小さく出てだんだん大きく・回りながら脈打つ
//   エフェクトに on があれば相手の頭上の雲（雨摩座の水天葬）：構えのあいだに大きくなり、技のあいだは出したまま、
//   toMs（滝が落ちる）のあと holdMs で薄れる。ゆっくり脈打って小さく揺れる（渦は斜めから見た形なので回さない）
//   派手な演出（m.scene）のときは、滝が落ち終わるまで出したまま（そのあと tailMs で薄れる）・ときどき稲光で明るく（sky＝演出の雲）
function ChargeOrb({ m, a, acts, now, geo, art, s, cast, castEnd, sky = null }) {
  const c = m.charge
  let on = null
  if (a.on) {
    if (!geo) return <Sprite a={a} frame={-1} />
    const at = { x: geo.p.x + geo.p.w / 2, y: geo.p.y + geo.p.h * FX_HEAD_Y }
    const P = m.scene ? pourTimesOf(m) : null
    const filter = sky ? `brightness(${(1 + 0.2 * sky.glow + 0.7 * sky.flicker).toFixed(3)})` : undefined
    const cloud = (k, op) => ({ frame: 0, x: at.x, y: at.y, op, rot: Math.sin(now * 2.2) * 0.035, filter,
      s: (a.size * geo.p.w / a.w) * (0.35 + 0.65 * easeOut(k)) * (1 + 0.035 * Math.sin(now * 6)) })
    if (cast) on = cloud(Math.min(1, cast.ms / 1200), Math.min(1, cast.ms / 400))
    for (const f of acts) {
      if (f.motion !== m) continue
      const ms = (now - f.t0) * 1000
      const gone = P ? P.E + P.T + 200 : c.toMs + (c.holdMs || 0)
      if (ms < c.fromMs || ms >= gone) continue
      // 構えのすぐあと＝雲はもう大きい。構えずに流したとき（動きを見る）は toMs までの6割で大きくなる
      const k = afterCast(f.t0, castEnd) ? 1 : Math.min(1, (ms - c.fromMs) / ((c.toMs - c.fromMs) * 0.6))
      const fade = P ? (ms > P.E ? 1 - (ms - P.E) / (P.T + 200) : 1) : ms > c.toMs ? 1 - (ms - c.toMs) / c.holdMs : 1
      on = cloud(k, Math.min(1, k / 0.25) * fade)
    }
    return <Sprite a={a} {...(on || { frame: -1 })} />
  }
  for (const f of acts) {
    if (f.motion !== m) continue
    const ms = (now - f.t0) * 1000
    if (ms < c.fromMs || ms >= c.toMs) continue
    const pose = illustPoseAt(art.key, m, ms, now * 1000)
    const [mx, my] = illustPointAt(art.key, pose, mouthPointOf(art.key, pose), 'head')
    const k = (ms - c.fromMs) / (c.toMs - c.fromMs)
    on = { frame: 0, x: geo.b.x + mx * s, y: geo.b.y + my * s, s: (c.size * geo.b.w / a.w) * (0.15 + 0.85 * easeOut(k)) * (1 + 0.07 * Math.sin(ms / 28)),
      rot: ms * 0.004, op: Math.min(1, k / 0.12) }
  }
  return <Sprite a={a} {...(on || { frame: -1 })} />
}
// 派手な演出の動くもの（lib/bossScene.js の stageSceneOf の items・cloud・hand）を舞台の上に描く。
//   場所は相手の足元の真ん中が原点・相手の絵の枠の幅が1。手に集まる光（space: 'hand'）は掲げた手の指先から（立ち絵の px × s）
//   雲の渦の光＝相手の頭上で、斜めから見た形（縦に縮めた）の渦巻きが回る・まん中が光る
const SPIRAL = Array.from({ length: 25 }, (_, j) => j / 24)
//   水の綱（tether）＝掲げた手（hand）から相手の体の真ん中へ、波打ちながら伸びる（head＝伸びた割合）・綱を伝う光（tglow・u＝綱の上の割合）
//   水の輪（coil）＝体のまわりの楕円。奥の半分（上）は暗く細く、手前の半分（下）は明るく、点線が回る
const tetherPts = (A, Bp, t, U) => {
  const dx = Bp[0] - A[0], dy = Bp[1] - A[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  return Array.from({ length: 29 }, (_, j) => {
    const u = (j / 28) * t.head, env = Math.sin(Math.PI * Math.min(1, u / Math.max(0.001, t.head))), w = Math.sin(u * 2.4 * Math.PI * 2 - t.phase) * t.amp * U * env
    return [A[0] + dx * u + nx * w, A[1] + dy * u + ny * w]
  })
}
function SceneLayer({ geo, sc, hand, s }) {
  const id = useId().replace(/:/g, '')
  const U = geo.p.w, ox = geo.p.x + U / 2, oy = geo.p.y + geo.p.h * FX_FEET_Y
  const X = (x) => ox + x * U, Y = (y) => oy + y * U
  const c = sc.cloud, cy = Y(SCENE_TOP)
  const tp = sc.tether && hand ? tetherPts(hand, [ox, geo.p.y + geo.p.h * FX_TARGET_Y], sc.tether, U) : null
  const tAt = (u) => { if (!tp) return null; const q = Math.min(27.999, u * 28), j = Math.floor(q), k = q - j; return [tp[j][0] + (tp[j + 1][0] - tp[j][0]) * k, tp[j][1] + (tp[j + 1][1] - tp[j][1]) * k] }
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', zIndex: 2, pointerEvents:'none', overflow:'visible' }}>
      <defs>
        <linearGradient id={`${id}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c8ebff" stopOpacity="0" /><stop offset="0.6" stopColor="#d7f0ff" stopOpacity="0.7" /><stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <radialGradient id={`${id}m`}><stop offset="0" stopColor="#dcf0ff" stopOpacity="0.6" /><stop offset="0.45" stopColor="#b4dcfa" stopOpacity="0.28" /><stop offset="0.75" stopColor="#aad7fa" stopOpacity="0.08" /><stop offset="1" stopColor="#aad7fa" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}g`}><stop offset="0" stopColor="#ffffff" /><stop offset="0.35" stopColor="#bee6ff" stopOpacity="0.9" /><stop offset="1" stopColor="#78beff" stopOpacity="0" /></radialGradient>
      </defs>
      {c && c.glow > 0 && (
        <g transform={`translate(${ox.toFixed(1)} ${cy.toFixed(1)}) rotate(6) scale(1 0.42)`} opacity={Math.min(1, c.glow).toFixed(3)}>
          <ellipse rx={U * 0.2} ry={U * 0.2} fill={`url(#${id}g)`} opacity={0.55 + 0.45 * c.flicker} />
          {[0, 1, 2].map(arm => {
            const pts = SPIRAL.map(j => { const t = -(j * 2.4 * Math.PI + (arm * 2 * Math.PI) / 3 + c.spin), r = U * 0.34 * (0.1 + 0.9 * j); return `${(r * Math.cos(t)).toFixed(1)},${(r * Math.sin(t)).toFixed(1)}` }).join(' ')
            return (
              <g key={arm}>
                <polyline points={pts} fill="none" stroke="#9fd4ff" strokeWidth={U * 0.05} strokeLinecap="round" opacity="0.22" />
                <polyline points={pts} fill="none" stroke="#e8f6ff" strokeWidth={U * 0.014} strokeLinecap="round" opacity="0.75" />
              </g>
            )
          })}
        </g>
      )}
      {tp && sc.tether.op > 0 && (
        <g opacity={sc.tether.op.toFixed(3)} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={tp.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')} stroke="#3c8cff" strokeWidth={U * 0.12} opacity="0.3" />
          <polyline points={tp.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')} stroke="#7cc4ff" strokeWidth={U * 0.065} opacity="0.85" />
          <polyline points={tp.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')} stroke="#f2fbff" strokeWidth={U * 0.022} />
        </g>
      )}
      {sc.items.map((it, i) => {
        if (it.t === 'streak' || it.t === 'jet') return <rect key={i} x={X(it.x - it.w / 2)} y={Y(it.y1)} width={it.w * U} height={(it.y2 - it.y1) * U} rx={(it.w * U) / 2} fill={`url(#${id}k)`} opacity={it.op} />
        if (it.t === 'rain') return <line key={i} x1={X(it.x1)} y1={Y(it.y1)} x2={X(it.x2)} y2={Y(it.y2)} stroke="#cfeaff" strokeWidth={Math.max(1, it.w * U)} strokeLinecap="round" opacity={it.op} />
        if (it.t === 'drop') return <ellipse key={i} cx={X(it.x)} cy={Y(it.y)} rx={it.rx * U} ry={it.ry * U} fill="#e6f6ff" opacity={it.op} transform={`rotate(${it.rot.toFixed(1)} ${X(it.x).toFixed(1)} ${Y(it.y).toFixed(1)})`} />
        if (it.t === 'ring') return <ellipse key={i} cx={X(it.x)} cy={Y(it.y)} rx={it.rx * U} ry={it.ry * U} fill="none" stroke="#d4eeff" strokeWidth={it.w * U} opacity={it.op} />
        if (it.t === 'mist') return <ellipse key={i} cx={X(it.x)} cy={Y(it.y)} rx={it.r * U} ry={it.r * U * 0.6} fill={`url(#${id}m)`} opacity={it.op} />
        if (it.t === 'foam') return <ellipse key={i} cx={X(it.x)} cy={Y(it.y)} rx={it.rx * U} ry={it.ry * U} fill={`url(#${id}g)`} opacity={it.op} />
        if (it.t === 'glow') return <circle key={i} cx={X(it.x)} cy={Y(it.y)} r={it.r * U} fill={`url(#${id}g)`} opacity={it.op} />
        if (it.t === 'coil') {
          const cx = X(it.x), cyy = Y(it.y), rx = it.rx * U, ry = it.ry * U, back = `M ${(cx - rx).toFixed(1)} ${cyy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${(cx + rx).toFixed(1)} ${cyy.toFixed(1)}`
          const front = `M ${(cx - rx).toFixed(1)} ${cyy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${(cx + rx).toFixed(1)} ${cyy.toFixed(1)}`
          return (
            <g key={i} fill="none" strokeLinecap="round" opacity={it.op}>
              <path d={back} stroke="#2f6fd6" strokeWidth={it.w * U * 0.7} opacity="0.55" />
              <path d={front} stroke="#4aa0ff" strokeWidth={it.w * U * 1.6} opacity="0.4" />
              <path d={front} stroke="#9fd8ff" strokeWidth={it.w * U} />
              <path d={front} stroke="#ffffff" strokeWidth={it.w * U * 0.35} strokeDasharray={`${(U * 0.09).toFixed(1)} ${(U * 0.06).toFixed(1)}`} strokeDashoffset={(-it.dash * U / 100).toFixed(1)} />
            </g>
          )
        }
        if (it.t === 'bubble') return (
          <g key={i} opacity={it.op}>
            <circle cx={X(it.x)} cy={Y(it.y)} r={it.r * U} fill="rgba(160,215,255,0.18)" stroke="#d8f0ff" strokeWidth={Math.max(0.8, it.r * U * 0.18)} />
            <circle cx={X(it.x) - it.r * U * 0.35} cy={Y(it.y) - it.r * U * 0.35} r={it.r * U * 0.25} fill="#ffffff" />
          </g>
        )
        if (it.t === 'tglow' && tp) { const q = tAt(it.u); return <circle key={i} cx={q[0]} cy={q[1]} r={it.r * U} fill={`url(#${id}g)`} opacity={it.op} /> }
        if (it.t === 'mote' && hand) return <circle key={i} cx={hand[0] + it.x * s} cy={hand[1] + it.y * s} r={it.r * s * 2} fill={`url(#${id}g)`} opacity={it.op} />
        return null
      })}
      {sc.hand && hand && sc.hand.op > 0 && (
        <g opacity={sc.hand.op}>
          <circle cx={hand[0]} cy={hand[1]} r={sc.hand.r * s * 2} fill={`url(#${id}g)`} />
          <circle cx={hand[0]} cy={hand[1]} r={sc.hand.r * s * 0.5} fill="#ffffff" opacity="0.85" />
        </g>
      )}
    </svg>
  )
}
// 画面ぜんたいが光る（叩きつけた所を中心に）
const Flash = ({ geo, op }) => {
  const x = geo.p.x + geo.p.w / 2, y = geo.p.y + geo.p.h * (FX_FEET_Y - 0.4)
  return <div style={{ position:'absolute', inset:0, zIndex: 4, pointerEvents:'none', opacity: op,
    background:`radial-gradient(circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, rgba(240,250,255,0.95) 0%, rgba(160,215,255,0.55) 35%, rgba(90,170,255,0.15) 70%, rgba(90,170,255,0) 100%)` }} />
}

// 右上から左下へ引いて見せる切り抜き（r＝0 何も見えない〜1 全部）：x − y ≥ u の側（絵の枠の %）
const wipeClipOf = (r) => {
  const u = 100 - 200 * r
  return `polygon(${u - 100}% -100%, 400% -100%, 400% 200%, ${u + 200}% 200%)`
}

// 演出（lib/bossScene.js の stageSceneOf）に、いま流れている技と構えを渡す。handAt＝掲げた手の指先（立ち絵の px・手の光を出す所）
//   構えた技＝名前が同じ技・無ければ最後の技（BossFx と同じ）。技を流しているあいだは構えの演出は出さない（技が先＝Fighter と同じ）
const sceneOfStage = (art, acts, now, cast, castEnd) => {
  const motions = Object.values(art.motions)
  const castM = cast ? motions.find(m => m.label === cast.name) || motions.at(-1) : null
  const list = acts.map(f => ({ m: f.motion, ms: (now - f.t0) * 1000, after: afterCast(f.t0, castEnd), landed: f.landed !== false })).filter(a => a.ms >= 0)
  const running = list.filter(a => a.ms < a.m.totalMs).at(-1)
  const sc = stageSceneOf(list, castM?.scene && !running ? { m: castM, ms: cast.ms } : null)
  // 手（scene.hand＝{ pt, part }・立ち絵の px とパーツ）：光と水の綱の出どころ。演出が続いている技（体の動きが終わっても水の綱は手から出たまま）、
  //   構えているあいだ（技を流していない）は構えた技
  const live = list.filter(a => a.ms < sceneEndMsOf(a.m)).at(-1)
  const fromCast = !sc.tether && !running && !!castM?.scene
  const handPt = fromCast ? castM.scene.hand : live ? live.m.scene.hand : null
  if (handPt && (sc.hand || sc.tether || sc.items.some(it => it.space === 'hand'))) {
    const pose = !fromCast ? illustPoseAt(art.key, live.m, live.ms, now * 1000, live.after) : illustCastPoseAt(art.key, cast.ms, now * 1000)
    sc.handAt = illustPointAt(art.key, pose, handPt.pt, handPt.part)
  }
  return sc
}

// foeArt … ダンジョンのボスの絵（lib/bossArt.js の bossArtOf＝ドット絵版／lib/bossIllust.js の bossIllustOf＝イラスト版）。
//   あれば技ごとの絵とエフェクトを流す
export default function V2capAtbStage({ st, fx, now, playerSrc, playerMotion, foeSrc, foeBig = false, foeArt = null }) {
  const size = foeBig ? STAGE_OF[foeArt?.kind === 'illust' ? 'illust' : 'pixel'] : null
  // ボスのエフェクトの位置：絵の場所（動かない枠）を測る。大きさが変わったら測り直す
  const stageRef = useRef(null), pArea = useRef(null), bArea = useRef(null)
  const [geo, setGeo] = useState(null)
  const playerScale = size?.player || 1
  // 構えを最後に見た時刻（構えのすぐあとの技を、構えの姿勢・相手の頭上の雲からつなぐ）
  const castSeen = useRef(-1e9)
  if (st.b.cast) castSeen.current = now
  const cast = st.b.cast ? { name: st.b.cast.name, ms: (st.t - st.b.cast.start) * 1000 } : null
  // 派手な演出のあるボスの技の印は、戦闘の画面が古い印を片付けても演出が終わるまで覚えておく（keptActs）
  const kept = useRef([])
  const sceneActs = foeArt?.kind === 'illust' ? fx.filter(f => f.kind === 'act' && f.side === 'b' && f.motion?.scene) : []
  kept.current = [...kept.current.filter(f => !sceneActs.includes(f) && now - f.t0 < sceneEndMsOf(f.motion) / 1000), ...sceneActs]
  const fxAll = kept.current.some(f => !fx.includes(f)) ? [...fx, ...kept.current.filter(f => !fx.includes(f))] : fx
  const sc = foeArt?.kind === 'illust' ? sceneOfStage(foeArt, kept.current, now, cast, castSeen.current) : null
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || !foeBig) return
    const measure = () => {
      if (!pArea.current || !bArea.current) return
      const r = el.getBoundingClientRect()
      setGeo({ p: boxOf(r, pArea.current.getBoundingClientRect(), playerScale), b: boxOf(r, bArea.current.getBoundingClientRect(), 1) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [foeBig, playerScale])
  return (
    <div ref={stageRef} style={{ position:'relative', overflow:'hidden', display:'flex', gap:'12px', alignItems:'flex-start', padding:'8px',
      background:'linear-gradient(180deg, #000a26 0%, #001338 70%, #00204a 100%)', border:'1px solid #0a2a55',
      // 演出：背景を暗く（内側の影は背景の上・中身の下）・舞台ごと揺れる
      boxShadow: sc?.dim ? `inset 0 0 0 2000px rgba(0,3,14,${sc.dim.toFixed(3)})` : undefined,
      transform: sc && (sc.shake[0] || sc.shake[1]) ? `translate(${sc.shake[0].toFixed(1)}px, ${sc.shake[1].toFixed(1)}px)` : undefined }}>
      <Fighter st={st} side="a" me={st.a} src={playerSrc} motion={playerMotion} strips={playerMotion ? [playerMotion] : []} fx={fx} now={now} name={st.a.name}
        artH={size?.artH || ART_H} scale={playerScale} areaRef={pArea} squeeze={sc?.squeeze} />
      <Fighter st={st} side="b" me={st.b} right src={foeSrc} fx={fx} now={now} name={st.b.name}
        strips={foeArt?.kind === 'pixel' ? Object.values(foeArt.motions) : []} rig={foeArt?.kind === 'illust' ? foeArt : null}
        flex={size?.flex} artH={size?.artH || ART_H} areaRef={bArea} castEnd={castSeen.current} />
      {foeArt && <BossFx fx={fxAll} now={now} geo={geo} art={foeArt} cast={cast} castEnd={castSeen.current} scene={sc} />}
      {sc && geo && <SceneLayer geo={geo} sc={sc} hand={sc.handAt ? [geo.b.x + sc.handAt[0] * (geo.b.w / foeArt.base), geo.b.y + sc.handAt[1] * (geo.b.w / foeArt.base)] : null} s={geo.b.w / foeArt.base} />}
      {sc && geo && sc.flash > 0 && <Flash geo={geo} op={sc.flash} />}
    </div>
  )
}
