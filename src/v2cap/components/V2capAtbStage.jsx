import { useId, useLayoutEffect, useRef, useState } from 'react'
import { TEXT } from './v2ui.js'
import { buffChips, hpBuffChips, ailChips, stateChips, needNow, CAST_SEC, BUFF_GAUGE_SEC } from '../core/atb.js'
import { STAT_DEFS } from '../core/stats.js'
import { lungeOf, shakeOf, HIT_SEC, POP_SEC, GLOW_SEC, RAGE_SEC, skillBannerAt } from '../lib/atbFx.js'
import { JP_BOLD } from './casinoStyle.js'
import { rubySegmentsOf } from '../lib/skillRuby.js'
import { motionFrameAt, IDLE_SIZE } from '../lib/motionArt.js'
import { illustPoseAt, illustCastPoseAt, illustFreePoseAt, illustTrailsAt, illustPointAt, mouthPointOf, rotPoint, swapOpacityOf, dustEllipsesOf, bendFramesOf, illustShowAt, illustGhostsAt, flutterBandsAt, rigLayersOf, artAnchorAt, illustCastShowAt, illustBuffShowAt, buffSceneAt, buffAfterAt, buffRainAt } from '../lib/bossIllust.js'
import { FX_HEAD_Y, FX_FEET_Y, FX_SKY_Y, FX_TARGET_Y, SCENE_TOP, fallAt, coilAt, pourTimesOf, sceneEndMsOf, stageSceneOf, flyPosOf } from '../lib/bossScene.js'

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
//     水縛の帯＝（手から波打つ水の綱は同じ日にやめた＝ユーザー「紐いらない」）体に巻きつく3重の水の輪（回りながら締め上げる・奥の半分は暗く）・
//     泡・しぶき・締め上げるたび相手が縮む（Fighter の squeeze）・最後にはじけて解ける
//   ・2026-10-30 ユーザー「氷雨、水天葬、これもっと上から降らせて」「水縛の帯 紐いらない」：水天葬の雲は空の上のほう（FX_SKY_Y）・
//     滝は雲から足元まで流れる柱（PourFlow は雲から下の波まで・描いた絵は下の波だけ）・氷雨の絵は大きく縦にも伸ばす（sy）・水の綱はやめた
//   ・2026-10-30 ユーザー「氷雨も絵1枚になってる、もっと雨が降ってる感じにして」：氷雨も雲の下の雨の所を流れる雨の絵で流す（FlowColumn）。
//     描いた絵は雲だけを見せる（alphaMask・足元の動かないしぶきはユーザー「いらないかも」でやめ、雨を足元まで伸ばした）
//   ・2026-10-30 ユーザー「待機モーションで軽く着物ひらひらしててほしい」：雨摩座の帯から下を横の帯に分けて、上から下へ伝わる波で左右にずらす
//     （IllustRig が体の動きの箱の中で帯ごとに同じパーツを切り抜いて描く・lib/bossIllust.js の flutterBandsAt）
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

// HPの節目で付いた固有のバフ（2026-10-30 ユーザー「固有のバフは敵の右側の方にバフボタンを作って何が付与されてるのかタップして確認できるようにして」）：
//   絵の右上に「🔥バフ×数」のボタン（HP の下の札からは抜いた）。押すと、付いているバフの名前（読み）と「効き目（消去不可）」を下に出す
//   （同じ日にユーザー「（）内の文言いらない 代わりに（消去不可）にして、下の戦いの終わりまで～は消して」）。
//   もう一度ボタンを押すか、出した所を押すと閉じる。見るだけ（戦闘は止めない）。付いた瞬間はボタンが光ってふくらむ（ago＝付いてからの秒）
const UNIQUE_GLOW_SEC = 1.2
const UniqueBuffs = ({ side, right, ago }) => {
  const [open, setOpen] = useState(false)
  const list = hpBuffChips(side)
  if (!list.length) return null
  const g = ago >= 0 && ago < UNIQUE_GLOW_SEC ? 1 - ago / UNIQUE_GLOW_SEC : 0
  const gold = 'rgba(255,190,90,0.85)', red = 'linear-gradient(180deg, rgba(70,10,4,0.94) 0%, rgba(28,2,0,0.94) 100%)'
  return (
    <div style={{ position:'absolute', top:'2px', [right ? 'right' : 'left']: '2px', zIndex: 6, display:'flex', flexDirection:'column', alignItems: right ? 'flex-end' : 'flex-start' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ padding:'3px 8px', fontSize:'11px', fontFamily: JP_BOLD, fontWeight: 700, color:'#ffe2a0', letterSpacing:'0.04em', cursor:'pointer',
          border:`1px solid ${gold}`, borderRadius:'3px', background: red, lineHeight: 1.3, whiteSpace:'nowrap',
          boxShadow:`0 2px 8px rgba(0,0,0,0.5), 0 0 ${(4 + 12 * g).toFixed(1)}px rgba(255,90,30,${(0.45 + 0.5 * g).toFixed(2)})`,
          transform: g > 0 ? `scale(${(1 + 0.18 * g).toFixed(3)})` : undefined, transformOrigin: right ? '100% 0' : '0 0',
          textShadow:'0 1px 2px #000' }}>
        🔥 バフ×{list.length}
      </button>
      {open && (
        <div onClick={() => setOpen(false)}
          style={{ marginTop:'4px', width:'min(210px, 62vw)', padding:'6px 8px', border:`1px solid ${gold}`, borderRadius:'3px', background: red,
            boxShadow:'0 4px 14px rgba(0,0,0,0.6)', color:'#ffe9c4', fontSize:'11px', lineHeight: 1.45, textAlign:'left', cursor:'pointer' }}>
          {list.map((c, n) => (
            <div key={c.name} style={{ marginBottom: n < list.length - 1 ? '5px' : 0 }}>
              <div style={{ fontFamily: JP_BOLD, fontWeight: 700, color:'#ffd27a', lineHeight: 1.6 }}>
                🔥 {rubySegmentsOf(c.name).map((sg, i) => (sg.ruby
                  ? <ruby key={i}>{sg.text}<rt style={{ fontSize:'7px', color:'#ffd2a0' }}>{sg.ruby}</rt></ruby>
                  : <span key={i}>{sg.text}</span>))}
              </div>
              <div>{buffText(c.table)}（消去不可）</div>
            </div>
          ))}
        </div>
      )}
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
//   lean＝地面（art.ground）を支点に前へ傾ける（skewX・2026-10-30 黒龍の技でしっぽが地面に残る）。lib の leanPoint と同じ
const rigWrap = (art, pose) => {
  const lean = pose.lean && art.ground != null
    ? (() => { const d = ((art.ground - art.pivot[1]) / art.base * 100).toFixed(2); return ` translate(0, ${d}%) skewX(${Math.atan(pose.lean).toFixed(4)}rad) translate(0, ${-d}%)` })() : ''
  return { position:'absolute', inset:0, pointerEvents:'none',
    transform:`translate(${(pose.x * 100).toFixed(2)}%, ${(pose.y * 100).toFixed(2)}%) rotate(${pose.r.toFixed(2)}deg)${lean}`,
    transformOrigin:`${(art.pivot[0] / art.base) * 100}% ${(art.pivot[1] / art.base) * 100}%` }
}
//   技のポーズの絵（2026-10-30・ユーザー「グラブルのベルゼバブぐらいしっかりと攻撃モーション動いてほしい」）：show（illustShowAt）のとおりに
//   部品の立ち絵とポーズの絵を切り替える（ポーズの絵も全体の姿勢 x・y・r で動く）。ghosts＝飛び込む勢いの残像（前の姿勢でポーズの絵を薄く）
//   着物のひらひら（art.flutter）：体の動きの箱の中で、横の帯ごとに同じ部品の立ち絵を切り抜いて描き、帯ごとに左右へずらして傾ける。
//   足（still）・ポーズの絵・砂ぼこりは帯に入れず上に重ねる（2026-10-30 足までゆらゆらしていた）
//   （帯の上の境目で dx・下へ行くほど tan ずつずれる＝隣の帯と境目でつながる）。帯は少し重ねて切る（境目に細いすき間が出ない）
//   HPの節目のバフのオーラ（aura＝{ p, op, scale, front, glow }・2026-10-30）：front は竜の手前（鎧の殻）・glow は光として手前に明るく重ねる（雨摩座の篠突く雨）・
//   どちらも無ければいちばん奥（逆鱗の闘気）。体の動きでは動かさない
const IllustRig = ({ art, pose, freePose, motion = null, show = null, ghosts = [], tMs = 0, aura = null }) => {
  const box = { x: 0, y: 0, w: art.base, h: art.base }
  const free = art.parts.filter(p => p.free && !p.nest)
  const rigOp = show ? show.rig : 1
  const { moving, still } = rigLayersOf(art)
  const rigStyle = { position:'absolute', inset:0, opacity: rigOp < 1 ? rigOp : undefined, visibility: rigOp <= 0.001 ? 'hidden' : undefined }
  const rig = <div style={rigStyle}>{moving.map(p => <RigPart key={p.key} art={art} p={p} box={box} pose={pose} />)}</div>
  const bands = art.flutter ? flutterBandsAt(art.key, tMs) : []
  const pct = (y) => (y / art.base) * 100
  const auraEl = aura && aura.op > 0.001 ? <AuraArt art={art} a={aura} /> : null
  return (
    <>
      {auraEl && !aura.front && !aura.glow && auraEl}
      {free.length > 0 && (
        <div style={rigWrap(art, freePose)}>
          {free.map(p => <RigPart key={p.key} art={art} p={p} box={box} pose={freePose} />)}
        </div>
      )}
      {ghosts.map((g, i) => (
        <div key={`g${i}`} style={{ ...rigWrap(art, g.pose), opacity: g.op }}><PoseArt art={art} p={motion.poses[g.name]} /></div>
      ))}
      <div style={rigWrap(art, pose)}>
        {bands.length === 0 ? rig : bands.map((b, i) => (
          <div key={i} style={{ position:'absolute', inset:0,
            clipPath:`inset(${i === 0 ? '-40%' : `${(pct(b.y0) - 0.15).toFixed(2)}%`} -40% ${i === bands.length - 1 ? '-40%' : `${(100 - pct(b.y1) - 0.15).toFixed(2)}%`} -40%)`,
            transform: b.dx || b.tan ? `translateX(${pct(b.dx).toFixed(3)}%) skewX(${(Math.atan(b.tan) * 180 / Math.PI).toFixed(3)}deg)` : undefined,
            transformOrigin: `0 ${pct(Number.isFinite(b.y0) ? b.y0 : 0).toFixed(2)}%` }}>
            {rig}
          </div>
        ))}
        {still.length > 0 && <div style={rigStyle}>{still.map(p => <RigPart key={p.key} art={art} p={p} box={box} pose={pose} />)}</div>}
        {show?.poses.map(sp => <PoseArt key={sp.name} art={art} p={motion.poses[sp.name]} op={sp.op} />)}
        {art.dust && pose.dust > 0 && <RigDust art={art} k={pose.dust} />}
      </div>
      {auraEl && (aura.front || aura.glow) && auraEl}
    </>
  )
}
// 技のポーズの絵1枚（立ち絵の px で置く）
const PoseArt = ({ art, p, op = 1 }) => (
  <img src={p.src} alt="" draggable={false} decoding="sync"
    style={{ position:'absolute', left:`${(p.x / art.base) * 100}%`, top:`${(p.y / art.base) * 100}%`, width:`${(p.w / art.base) * 100}%`, height:`${(p.h / art.base) * 100}%`,
      maxWidth:'none', userSelect:'none', pointerEvents:'none', opacity: op < 1 ? op : undefined }} />
)
// HPの節目のバフの衝撃の輪と火の粉と稲妻（lib/bossIllust.js の buffSceneAt・buffAfterAt・立ち絵の px）。明るく重ねる（screen）。
//   輪＝ぼかした太い色の輪＋細い明るい芯・火の粉＝ぼかした光の玉＋明るい芯（芯の色は決まりに書いてあれば＝雨摩座は水の色）・稲妻＝ぼかした太い線＋細い白い線
const BuffSparks = ({ art, sc, after }) => {
  const id = useId()
  const dots = (list, color, pre, core) => list.map((p, i) => (
    <g key={`${pre}${i}`} opacity={p.op.toFixed(3)}>
      <circle cx={p.x} cy={p.y} r={p.r * 2.2} fill={`rgb(${color})`} filter={`url(#${id})`} />
      <circle cx={p.x} cy={p.y} r={p.r * 0.7} fill={`rgb(${core || '255,236,190'})`} />
    </g>
  ))
  return (
    <svg viewBox={`0 0 ${art.base} ${art.base}`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible', pointerEvents:'none', mixBlendMode:'screen' }}>
      <defs><filter id={id} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" /></filter></defs>
      {sc?.rings.map((r, i) => (
        <g key={`r${i}`} opacity={r.op.toFixed(3)}>
          <circle cx={r.x} cy={r.y} r={r.r} fill="none" stroke={`rgb(${sc.ringColor})`} strokeWidth={r.w * 1.8} filter={`url(#${id})`} />
          <circle cx={r.x} cy={r.y} r={r.r} fill="none" stroke={`rgb(${sc.ringCore || '255,226,170'})`} strokeWidth={Math.max(1, r.w * 0.35)} />
        </g>
      ))}
      {after && dots(after.sparks, after.sparkColor, 'a', after.sparkCore)}
      {sc && dots(sc.sparks, sc.sparkColor, 's', sc.sparkCore)}
      {sc?.bolts.map((b, i) => {
        const pts = b.pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
        return (
          <g key={`b${i}`} opacity={b.op.toFixed(3)} fill="none" strokeLinejoin="round">
            <polyline points={pts} stroke={`rgb(${sc.boltColor})`} strokeWidth={11} filter={`url(#${id})`} />
            <polyline points={pts} stroke="rgb(240,250,255)" strokeWidth={3} />
          </g>
        )
      })}
    </svg>
  )
}
// 舞台に降る雨（篠突く雨・lib/bossIllust.js の buffRainAt）：舞台の上から足元まで（下の HP の表にはかからない）。手前の筋は太く・奥の筋は細く薄い。足元に水の輪が広がる。
//   rains＝濃さ（k）と時計（t）のついた決まり（付いた瞬間の土砂降りと、そのあと降り続ける雨）・op＝全体の濃さ（ボスが倒れると止む）。px は舞台の大きさ（geo）から。
//   線の太さは変わらないので、狭い舞台では本数を減らす（スマホの幅で雨が濃すぎて雨摩座が見えにくかった）
const BuffRain = ({ geo, rains, op = 1 }) => {
  const W = geo.W, H = geo.b.y + geo.b.h
  const pathOf = (list, slant) => list.map(([x, y, len]) => {
    const x1 = x * W + slant * y * H, y1 = y * H
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${(x1 + slant * len * H).toFixed(1)} ${(y1 + len * H).toFixed(1)}`
  }).join('')
  return (
    <svg width={W} height={H} style={{ position:'absolute', left: 0, top: 0, zIndex: 3, pointerEvents:'none', opacity: op < 1 ? op : undefined }}>
      {rains.map((r, i) => {
        const fit = Math.min(1, W / 600)
        const { far, near, splashes } = buffRainAt({ ...r, n: Math.ceil(r.n * fit), splash: Math.ceil((r.splash || 0) * fit) }, r.t)
        return (
          <g key={i} opacity={r.k.toFixed(3)} fill="none" stroke={`rgb(${r.color})`} strokeLinecap="round">
            <path d={pathOf(far, r.slant)} strokeWidth={r.w * 0.6} opacity={(r.op * 0.55).toFixed(3)} />
            <path d={pathOf(near, r.slant)} strokeWidth={r.w} opacity={r.op.toFixed(3)} />
            {splashes.map((p, j) => <ellipse key={j} cx={(p.x * W).toFixed(1)} cy={(p.y * H).toFixed(1)} rx={(2 + 13 * p.t).toFixed(1)} ry={(0.8 + 3.2 * p.t).toFixed(1)}
              strokeWidth={r.w * 0.7} opacity={((1 - p.t) * r.op).toFixed(3)} />)}
          </g>
        )
      })}
    </svg>
  )
}
// HPの節目のバフのオーラ1枚（立ち絵の px で置く）：広げる中心は、手前の殻＝絵の真ん中・後ろの闘気と光の闘気＝足元（下のまん中）。光（glow）は下の絵を明るくする重ね方（screen）
const AuraArt = ({ art, a }) => (
  <img src={a.p.src} alt="" draggable={false} decoding="sync"
    style={{ position:'absolute', left:`${(a.p.x / art.base) * 100}%`, top:`${(a.p.y / art.base) * 100}%`, width:`${(a.p.w / art.base) * 100}%`, height:`${(a.p.h / art.base) * 100}%`,
      maxWidth:'none', userSelect:'none', pointerEvents:'none', opacity: a.op < 1 ? a.op : undefined, mixBlendMode: a.glow ? 'screen' : undefined,
      transform:`scale(${a.scale.toFixed(3)})`, transformOrigin: a.front ? '50% 50%' : '50% 100%' }} />
)
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
// 付いているあいだの見た目（lib/bossIllust.js の buffAfterAt）：marks＝その側の印（rage の印から付いてからの時間を出す）
const buffAfterOf = (art, me, marks, now) => {
  const sinceOf = (nm) => { const f = marks.reduce((p, f) => (f.kind === 'rage' && f.skill === nm && f.t0 <= now && (!p || f.t0 >= p.t0) ? f : p), null); return f ? (now - f.t0) * 1000 : Infinity }
  return buffAfterAt(hpBuffChips(me).map(c => ({ b: art.buffs[c.name], since: sinceOf(c.name) })), now * 1000)
}
function Fighter({ st, side, me, right, src, motion, strips = [], rig = null, fx, now, name, flex = '1 1 0', artH = ART_H, scale = 1, areaRef, castEnd = -1e9, squeeze = null, bossGlow = 0 }) {
  const mine = fx.filter(f => f.side === side)
  const lastOf = (kind) => mine.reduce((t, f) => (f.kind === kind && f.t0 <= now && f.t0 > t ? f.t0 : t), -1e9)
  const dir = right ? -1 : 1   // 前＝相手の方
  // 攻撃の絵があれば流す（流しているあいだは踏み込まない）。act に motion が付いていればそちら（ボスの技ごとの絵）
  const lastAct = mine.reduce((p, f) => (f.kind === 'act' && f.t0 <= now && (!p || f.t0 > p.t0) ? f : p), null)
  const mo = lastAct?.motion || motion
  const frame = mo?.ms && lastAct ? motionFrameAt(mo, (now - lastAct.t0) * 1000) : -1
  // イラスト版は姿勢で動かす（技の動きも姿勢の中＝踏み込まない）
  const rigMotion = rig && lastAct?.motion?.keys ? lastAct.motion : null, rigMs = (now - (lastAct?.t0 ?? now)) * 1000
  // HPの節目のバフが付いているあいだの見た目（逆鱗のあと・lib/bossIllust.js の buffAfterAt）：待機の速さ・体の脈・立ちのぼる火の粉。
  //   tMs＝部品の待機の時計（速さを掛けた時刻）。付いてからの時間は rage の印から（印が片付いたあとは十分たった）
  const after = rig?.buffs ? buffAfterOf(rig, me, mine, now) : null
  const tMs = now * 1000 * (after?.tempo || 1)
  // 構えのあいだは構えの姿勢（技を流しているあいだは技が先）
  const casting = rig && me.cast && !(rigMotion && rigMs < rigMotion.totalMs)
  const pose = !rig ? null : casting ? illustCastPoseAt(rig.key, (st.t - me.cast.start) * 1000, tMs)
    : illustPoseAt(rig.key, rigMotion, rigMs, tMs, !!lastAct && afterCast(lastAct.t0, castEnd))
  const trails = rigMotion ? illustTrailsAt(rig.key, rigMotion, rigMs, tMs) : []
  // 技のポーズの絵と残像（構えのあいだは部品の立ち絵）
  // 構えのあいだのポーズの絵（雨摩座＝構えた技の構えの絵・lib/bossIllust.js の illustCastShowAt・黒龍は無し）
  const cs = casting ? illustCastShowAt(rig, me.cast.name, (st.t - me.cast.start) * 1000) : null
  // HPの節目のバフの絵（黒龍・雨摩座・lib/bossIllust.js の illustBuffShowAt）：付いた瞬間にバフのポーズの絵とオーラ。技を流しているあいだ・構えのあいだは技が先（オーラは出す）
  const lastRage = mine.reduce((p, f) => (f.kind === 'rage' && f.t0 <= now && (!p || f.t0 >= p.t0) ? f : p), null)
  const buff = rig && lastRage ? illustBuffShowAt(rig, lastRage.skill, (now - lastRage.t0) * 1000) : null
  const buffArt = buff ? rig.buffs[lastRage.skill] : null
  // 付いた瞬間の強い見せ方（逆鱗・buffSceneAt）：ポーズの絵のふくらみ・衝撃の輪・噴き上がる火の粉（舞台の暗さと揺れは V2capAtbStage）
  const bsc = rig && lastRage ? buffSceneAt(rig.buffs?.[lastRage.skill], (now - lastRage.t0) * 1000) : null
  const moving = !!rigMotion && rigMs < rigMotion.totalMs
  const buffPose = buff && buffArt.pose && !moving && !casting
  const show = buffPose ? { rig: buff.rig, poses: buff.pose > 0.001 ? [{ name: lastRage.skill, op: buff.pose }] : [] }
    : rigMotion && !casting ? illustShowAt(rigMotion, rigMs) : cs?.show || null
  const showMotion = buffPose ? { poses: { [lastRage.skill]: buffArt.pose } } : cs ? cs.motion : rigMotion
  const aura = buff?.aura && buffArt.aura ? { p: buffArt.aura, op: buff.aura.op * buffArt.auraOp, scale: buff.aura.scale, front: buffArt.front, glow: buffArt.glow } : null
  const ghosts = rigMotion && !casting && !buffPose ? illustGhostsAt(rigMotion, rigMs).map(g => ({ ...g, pose: illustPoseAt(rig.key, rigMotion, g.ms, tMs - (rigMs - g.ms)) })) : []
  const dx = (frame >= 0 || rig ? 0 : lungeOf(now - lastOf('act')) * dir) + shakeOf(now - lastOf('hit'))
  const hitAgo = now - lastOf('hit')
  const glowAgo = now - lastOf('use')
  const rageAgo = now - lastOf('rage')
  const filters = []
  if (hitAgo >= 0 && hitAgo < HIT_SEC) filters.push('drop-shadow(0 0 6px #ff3344) brightness(1.25)')
  if (glowAgo >= 0 && glowAgo < GLOW_SEC) filters.push('drop-shadow(0 0 10px #ffee88) brightness(1.3)')
  if (buff) {
    // バフの絵があるボス：付いた瞬間にぱっと明るく光り、赤い光が見せているあいだ残る
    const k = Math.max(0, 1 - (now - lastRage.t0) / (RAGE_SEC * 1.2))
    filters.push(`brightness(${(1 + 0.9 * buff.flash).toFixed(2)}) drop-shadow(0 0 ${(4 + 12 * k).toFixed(1)}px rgba(${buffArt.tint || '255,70,30'},${(0.25 + 0.55 * k).toFixed(2)}))`)
  } else if (rageAgo >= 0 && rageAgo < RAGE_SEC) {
    // 2回脈打って消える赤い光（節目のバフ・バフの絵が無いボス）
    const k = Math.sin(Math.PI * 2 * rageAgo / RAGE_SEC * 1.0) ** 2 * (1 - rageAgo / RAGE_SEC)
    filters.push(`drop-shadow(0 0 ${(6 + 14 * k).toFixed(1)}px rgba(255,70,30,${(0.35 + 0.6 * k).toFixed(2)})) brightness(${(1 + 0.35 * k).toFixed(2)})`)
  }
  // 大技をためるあいだ：竜の体が赤く光を増す（終焉の黒焔・lib/bossScene.js の bossGlow）
  if (bossGlow > 0.01) filters.push(`drop-shadow(0 0 ${(4 + 14 * bossGlow).toFixed(1)}px rgba(255,60,16,${(0.25 + 0.6 * bossGlow).toFixed(2)})) brightness(${(1 + 0.22 * bossGlow).toFixed(3)})`)
  // 逆鱗のあと：体が赤く脈打つ（心臓のように2回ずつ）
  if (after?.glow > 0.01) filters.push(`drop-shadow(0 0 ${(3 + 9 * after.glow).toFixed(1)}px rgba(${after.glowColor},${(0.2 + 0.55 * after.glow).toFixed(2)}))`)
  if (me.ail.paralyze) filters.push('grayscale(0.6)')
  const down = me.hp <= 0
  const pops = mine.filter(f => f.kind !== 'act' && f.kind !== 'use' && f.kind !== 'rage' && now >= f.t0 && now - f.t0 < POP_SEC)
  const need = needNow(me, st.t)
  const align = right ? 'flex-end' : 'flex-start'
  const hpColor = right ? '#cc3344' : '#44cc66'

  return (
    <div style={{ flex, minWidth:0, display:'flex', flexDirection:'column', alignItems:'stretch' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'6px', fontSize:'12px', color: right ? '#ff8888' : '#88ccff',
        flexDirection: right ? 'row-reverse' : 'row', minHeight:'18px' }}>
        <span style={{ flex:'0 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
        {/* 敵の技の名前：名前と同じ行の、名前の横の空いた所のまん中（絵に重ならない・名前とも重ならない） */}
        {side === 'b' && (
          <div style={{ flex:'1 1 0', minWidth:0, position:'relative', alignSelf:'stretch' }}>
            {/* 構えのあいだは構えた技の名前を赤と金で出したまま（2026-10-30 ユーザー「大技っぽく」） */}
            <SkillBanner b={skillBannerAt(fx, now, 'b') || (me.cast ? { name: me.cast.name, op: 1, k: 1, rage: true } : null)} />
          </div>
        )}
      </div>
      {/* 絵 */}
      <div ref={areaRef} style={{ position:'relative', height: artH, display:'flex', justifyContent:'center', alignItems:'flex-end', margin:'4px 0' }}>
        <div style={{ height:`${scale * 100}%`, display:'flex', alignItems:'flex-end', transformOrigin:'50% 100%',
          transform:`translateX(${dx.toFixed(1)}px)${squeeze ? ` scale(${squeeze[0].toFixed(3)}, ${squeeze[1].toFixed(3)})` : ''}`,
          opacity: down ? 0.25 : 1, transition:'opacity 0.4s' }}>
          {src || rig ? (
            // 待機の絵の枠（正方形）。攻撃の絵はこの枠に重ねる（ox・oy・w・h は待機の枠（クラスは 224px・ボスは base）を100%として割合で置く）
            <div style={{ position:'relative', height:'100%', aspectRatio:'1 / 1', maxWidth:'100%', filter: filters.join(' ') || 'none',
              transform: bsc && bsc.punch !== 1 ? `scale(${bsc.punch.toFixed(4)})` : undefined, transformOrigin:'50% 92%' }}>
              {rig && trails.length > 0 && <RigTrails art={rig} trails={trails} />}
              {rig ? <IllustRig art={rig} pose={pose} freePose={illustFreePoseAt(rig.key, tMs)} motion={showMotion} show={show} ghosts={ghosts} tMs={tMs} aura={aura} /> : (
                <img src={src} alt="" draggable={false}
                  style={{ width:'100%', height:'100%', objectFit:'contain', userSelect:'none', visibility: frame >= 0 ? 'hidden' : 'visible' }} />
              )}
              {/* HPの節目のバフの衝撃の輪と火の粉（逆鱗） */}
              {rig && (bsc || after?.sparks.length > 0) && <BuffSparks art={rig} sc={bsc} after={after} />}
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
        {/* 固有のバフのボタン（絵の右上） */}
        <UniqueBuffs side={me} right={right} ago={rageAgo} />
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
        {/* 大技の構えのゲージ（赤・2026-10-30 ユーザー「○○の構えとか表示させなくていい」で下の文字はやめた）・バフの行動のゲージ（金・0.5秒で貯まる）・ふだんのゲージ */}
        {me.cast
          ? <Bar pct={((st.t - me.cast.start) / (me.cast.until - me.cast.start)) * 100} color="#ff5522" h={8} />
          : me.buffAct
            ? <Bar pct={((st.t - me.buffAct.start) / BUFF_GAUGE_SEC) * 100} color="#ffd24a" h={6} />
            : <Bar pct={(Math.min(me.gauge, need) / need) * 100} color={me.ail.paralyze ? '#888888' : right ? '#ff9944' : '#44aaff'} h={6} />}
      </div>
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
  const extras = []   // 滝の流れる水・泡立つ波（裏返した絵）・氷雨の流れる雨
  // ★同じ技が続けて出て絵が重なったら新しいほうに置き換える（足すと同じ key が2つになる・2026-10-30 雨摩座の氷雨が続いたとき）
  const putExtra = (el) => { const i = extras.findIndex(e => e.key === el.key); if (i >= 0) extras.splice(i, 1); extras.push(el) }
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
          // 口から伸びて出てくる（a.emerge・終焉の黒焔）：絵は先（ax）が前で、うしろへ伸びる＝飛んだ距離より後ろ（口より竜の側）は見せない。絵といっしょに回る切り抜き
          if (a.emerge) {
            const lx = ((a.ax + (Math.hypot(on.x - from.x, on.y - from.y) + 0.03 * geo.b.w) / on.s) / a.w) * 100
            if (lx < 100) on.mask = `linear-gradient(to right, #000 ${Math.max(0, lx - 10).toFixed(1)}%, transparent ${lx.toFixed(1)}%)`
          }
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
            const flow = m.fx.flow
            if (flow) {
              // 流れる水の絵があるとき：滝は雲（空の上のほう）から足元まで。先（front）と落ち終わりの切れ目（cut）は画面の px で、柱と下の波で同じ所
              const feet = geo.p.y + geo.p.h * FX_FEET_Y, sky = geo.p.y + geo.p.h * FX_SKY_Y
              const front = sky + (feet - sky) * (lead ? easeOut(Math.min(1, ms / lead)) : 1) + 0.06 * (feet - sky), cut = sky + (feet - sky) * fall.cut
              const bob = Math.sin(actMs / 55) * 0.012 * geo.p.w
              const sTop = feet - a.h * sc * fall.sy, sH = a.h * sc * fall.sy, pc = (y) => ((y - sTop) / sH) * 100
              const mask = `linear-gradient(to bottom, transparent 0%, transparent ${Math.max(40, pc(cut)).toFixed(1)}%, #000 ${Math.max(56, pc(cut) + 12).toFixed(1)}%, #000 ${Math.max(56, pc(cut) + 12, pc(front) - 8).toFixed(1)}%, transparent ${pc(front).toFixed(1)}%)`
              on = { frame: 0, x: to.x, y: feet + bob, ay: a.h, s: sc, sx: fall.sx, sy: fall.sy, op: Math.min(1, ms / 90), filter: `brightness(${fall.bright.toFixed(3)})`, mask }
              putExtra(<Sprite key={`${a.src}#flip`} a={a} {...on} y={on.y - bob * 2} flip op={on.op * (0.35 + 0.3 * Math.sin(actMs / 75))} />)
              putExtra(<PourFlow key={`${a.src}#flow`} a={a} flow={flow} x={to.x} sky={sky} bottom={sTop + sH * 0.62} s={sc} fall={fall}
                ms={actMs - m.hitMs} front={front} cut={cut} op={on.op} />)
            } else {
              const p = (lead ? easeOut(Math.min(1, ms / lead)) : 1) * 112, top = (a.fadeTop || 0) * 100, c = top + (100 - top) * fall.cut
              on = { frame: 0, x: to.x, y: geo.p.y + geo.p.h * FX_FEET_Y, ay: a.h, s: sc, sx: fall.sx, sy: fall.sy, op: Math.min(1, ms / 90),
                filter: `brightness(${fall.bright.toFixed(3)})`,
                mask: `linear-gradient(to bottom, transparent 0%, transparent ${c.toFixed(1)}%, #000 ${Math.max(top, c + 20).toFixed(1)}%, #000 ${Math.max(top, c + 20, p - 12).toFixed(1)}%, transparent ${p.toFixed(1)}%)` }
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
              : a.on === 'head' || a.on === 'sky' ? { x: to.x, y: geo.p.y + geo.p.h * (a.on === 'sky' ? FX_SKY_Y : FX_HEAD_Y) } : to
            if (a.anim === 'drop' && m.fx.flow) {
              // 流れる雨の絵があるとき（氷雨）：描いた絵は雲だけ（雨の所から下は抜く）・雨は雲の下から足元まで流れる雨の絵を流す。
              //   【確定】2026-10-30 ユーザー「氷雨の最後の動いていない下部分のイラストいらないかも」：足元の動かないしぶき（描いた絵のいちばん下）はやめ、雨を足元まで伸ばした。
              //   どちらも lead のあいだに上から見えてくる（降りる先のふちはぼかす）
              const p = (lead ? easeOut(Math.min(1, ms / lead)) : 1) * 112, fl = m.fx.flow, sy = a.sy || 1
              const cTop = (fl.at[1] / a.h) * 100
              const reveal = (y) => Math.min(1, Math.max(0, (p - y) / 12))
              const op = Math.min(1, ms / 90) * fade
              on = { frame: 0, ...sp, s: sc, sy, op,
                mask: alphaMask([0, cTop + 3, cTop + 12, 100, p - 12, p], (y) => (y <= cTop + 3 ? 1 : y >= cTop + 12 ? 0 : (cTop + 12 - y) / 9) * reveal(y)) }
              const sTop = sp.y - a.h * sc * sy, sLeft = sp.x - a.ax * sc, colH = a.h - fl.at[1]   // 雨は雲の下から足元（絵のいちばん下）まで
              const top = sTop + fl.at[1] * sc * sy, H = colH * sc * sy, colPct = (y) => ((y / 100) * a.h - fl.at[1]) / colH * 100
              const f = colPct(p)
              // 流れる速さは前と同じ（雨の所＝flow.at の高さで数える）
              putExtra(<FlowColumn key={`${a.src}#rain`} flow={fl} left={sLeft + fl.at[0] * sc} top={top} W={fl.at[2] * sc} H={H} ms={ms} speed={RAIN_PX_PER_SEC} unit={fl.at[3] * sc * sy} op={op}
                mask={alphaMask([0, 10, 90, 100, f - 10, f], (y) => Math.min(1, y / 10, (100 - y) / 10) * Math.min(1, Math.max(0, (f - y) / 10)))} />)
            } else if (a.anim === 'drop') {
              // 上から下へ降りる（雨・滝）：lead のあいだに上から見えてくる（降りる先のふちはぼかす）。fadeTop＝絵の上のはしをぼかす割合（滝の上を雲になじませる）
              const p = (lead ? easeOut(Math.min(1, ms / lead)) : 1) * 112, top = (a.fadeTop || 0) * 100
              on = { frame: 0, ...sp, s: sc, sy: a.sy || 1, op: Math.min(1, ms / 90) * fade,
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
// 滝の流れる水（水天葬）：上と下がつながる水の絵（flow）を、雲（sky）から下の波の中ほど（bottom）まで、縦に並べて流す（幅は滝の柱の所＝flow.at）。
//   2枚重ね（奥＝柱の幅で速く・手前＝少し広く、もっと速く、明るく重ねる）。外の箱は縦のぼかし（雲になじむ上・滝の先・落ち終わりの切れ目・下の波へ消える）、
//   中の箱は横のぼかし（柱のふち）。ms＝撃ってから・front・cut＝滝の先と落ち終わりの切れ目（画面の px）
const FLOW_PX_PER_SEC = 3.4   // 滝：1秒に「当たる絵の柱の高さ」の何倍落ちるか
const RAIN_PX_PER_SEC = 4.2   // 氷雨：1秒に雨の所の高さの何倍落ちるか
const FLOW_WIDE = 1.35        // 柱を描いた所より何倍広く流すか（ふちはぼかす）
function PourFlow({ a, flow, x, sky, bottom, s, fall, ms, front, cut, op }) {
  const fw = flow.at[2], W = fw * s * fall.sx * FLOW_WIDE, top = sky - 0.04 * (bottom - sky), H = bottom - top
  const pc = (y) => ((y - top) / H) * 100   // 画面の px → 柱の %
  const c = Math.max(0, pc(cut)), f = pc(front)
  const mask = `linear-gradient(to bottom, transparent 0%, transparent ${c.toFixed(1)}%, #000 ${Math.max(10, c + 10).toFixed(1)}%, #000 ${Math.min(84, Math.max(10, c + 10, f - 6)).toFixed(1)}%, transparent ${Math.min(100, Math.max(f, Math.max(10, c + 10) + 0.1)).toFixed(1)}%)`
  // 流れた量はふくらむ前の幅で数える（叩きつけてふくらんでも流れが跳ねない）・流れる速さは当たる絵の柱の高さで決める
  return <FlowColumn flow={flow} left={x - W / 2} top={top} W={W} W0={fw * s * FLOW_WIDE} H={H} ms={ms} speed={FLOW_PX_PER_SEC} unit={0.62 * a.h * s}
    op={op} mask={mask} filter={`brightness(${fall.bright.toFixed(3)})`} />
}
// 流れる水の絵（flow）を縦に並べて流す箱（滝の柱・氷雨の雨）。2枚重ね（奥＝箱の幅・手前＝1.3倍広く1.45倍速く明るく重ねる）。
//   外の箱は縦の切り抜き（mask）、中の箱は横のぼかし（ふち）。ms＝流しはじめてから・speed＝1秒に unit（無ければ箱の高さ）の何倍落ちるか・
//   W0＝流れた量を数える幅（ふくらんでも流れが跳ねない）
function FlowColumn({ flow, left, top, W, W0 = W, H, ms, speed, unit = H, op, mask, filter }) {
  const layer = (k, sp, extra) => {
    const w = W * k, tile = w * (flow.h / flow.w), tile0 = W0 * k * (flow.h / flow.w)
    const off = (((Math.max(0, ms) / 1000) * speed * unit * sp) / tile0 % 1) * tile
    return (
      <div style={{ position:'absolute', left: (W - w) / 2, top: 0, width: w, height: H, backgroundImage:`url(${flow.src})`, backgroundRepeat:'repeat-y',
        backgroundSize:`${w}px ${tile}px`, backgroundPositionY:`${off.toFixed(1)}px`,
        maskImage:'linear-gradient(to right, transparent 0%, #000 16%, #000 84%, transparent 100%)', WebkitMaskImage:'linear-gradient(to right, transparent 0%, #000 16%, #000 84%, transparent 100%)', ...extra }} />
    )
  }
  return (
    <div style={{ position:'absolute', zIndex: 2, left, top, width: W, height: H, pointerEvents:'none', opacity: op, maskImage: mask, WebkitMaskImage: mask, filter }}>
      {layer(1, 1, {})}
      {layer(1.3, 1.45, { opacity: 0.5, mixBlendMode:'screen', filter:'brightness(1.25)' })}
    </div>
  )
}
// 縦の切り抜き（mask-image）：at の % ごとに alpha(y)（0〜1）を並べる（0〜100 の外は捨てる・並べ替える）
const alphaMask = (at, alpha) => `linear-gradient(to bottom, ${[...new Set(at.filter(y => y >= 0 && y <= 100).map(y => +y.toFixed(2)))].sort((p, q) => p - q)
  .map(y => `rgba(0,0,0,${Math.min(1, Math.max(0, alpha(y))).toFixed(3)}) ${y}%`).join(', ')})`
// 撃つ前に口でためる火の玉（イラスト版の charge）：口（首と頭の動きについていく）で、小さく出てだんだん大きく・回りながら脈打つ
//   エフェクトに on があれば相手の頭上の雲（雨摩座の水天葬）：構えのあいだに大きくなり、技のあいだは出したまま、
//   toMs（滝が落ちる）のあと holdMs で薄れる。ゆっくり脈打って小さく揺れる（渦は斜めから見た形なので回さない）
//   派手な演出（m.scene）のときは、滝が落ち終わるまで出したまま（そのあと tailMs で薄れる）・ときどき稲光で明るく（sky＝演出の雲）
function ChargeOrb({ m, a, acts, now, geo, art, s, cast, castEnd, sky = null }) {
  const c = m.charge
  let on = null
  if (a.on) {
    if (!geo) return <Sprite a={a} frame={-1} />
    const at = { x: geo.p.x + geo.p.w / 2, y: geo.p.y + geo.p.h * (a.on === 'sky' ? FX_SKY_Y : FX_HEAD_Y) }
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
  // 構えの5秒（終焉の黒焔）：ため の絵の口で、構えのあいだに育つ
  const castPt = cast && m.anchors?.[art.castArt]?.mouth
  if (castPt) {
    const [mx, my] = illustPointAt(art.key, illustCastPoseAt(art.key, cast.ms, now * 1000), castPt, 'body')
    const k = Math.min(1, cast.ms / (m.castSkipMs || CAST_SEC * 1000))
    on = { frame: 0, x: geo.b.x + mx * s, y: geo.b.y + my * s, s: (c.size * geo.b.w / a.w) * (0.15 + 0.85 * easeOut(k)) * (1 + 0.07 * Math.sin(cast.ms / 28)),
      rot: cast.ms * 0.004, op: Math.min(1, cast.ms / 400) }
  }
  for (const f of acts) {
    if (f.motion !== m) continue
    const ms = (now - f.t0) * 1000
    if (ms < c.fromMs || ms >= c.toMs) continue
    const pose = illustPoseAt(art.key, m, ms, now * 1000)
    // ポーズの絵が出ていれば、その絵の口（ため の絵は上を向いた口）に置く
    const [mx, my] = artAnchorAt(art.key, m, ms, pose, 'mouth') || illustPointAt(art.key, pose, mouthPointOf(art.key, pose), 'head')
    const k = (ms - c.fromMs) / (c.toMs - c.fromMs)
    on = { frame: 0, x: geo.b.x + mx * s, y: geo.b.y + my * s, s: (c.size * geo.b.w / a.w) * (0.15 + 0.85 * easeOut(k)) * (1 + 0.07 * Math.sin(ms / 28)),
      rot: ms * 0.004, op: Math.min(1, k / 0.12) }
  }
  return <Sprite a={a} {...(on || { frame: -1 })} />
}
// 派手な演出の動くもの（lib/bossScene.js の stageSceneOf の items・cloud・hand）を舞台の上に描く。
//   場所は相手の足元の真ん中が原点・相手の絵の枠の幅が1。手に集まる光・手からのしぶき（space: 'hand'）は手（hands[hi]）から（立ち絵の px × s）
//   雲の渦の光＝相手の頭上で、斜めから見た形（縦に縮めた）の渦巻きが回る・まん中が光る
const SPIRAL = Array.from({ length: 25 }, (_, j) => j / 24)
//   水の輪（coil）＝体のまわりの楕円。奥の半分（上）は暗く細く、手前の半分（下）は明るく、点線が回る
function SceneLayer({ geo, sc, hands, s }) {
  const id = useId().replace(/:/g, '')
  const U = geo.p.w, ox = geo.p.x + U / 2, oy = geo.p.y + geo.p.h * FX_FEET_Y
  const X = (x) => ox + x * U, Y = (y) => oy + y * U
  const c = sc.cloud, cy = Y(SCENE_TOP)
  // 色：ふつうは水・tone 'fire' は炎（終焉の黒焔・煙は黒）
  const fire = sc.tone === 'fire'
  const K = fire ? ['#ff4a12', '#ffa030', '#fff0c0'] : ['#c8ebff', '#d7f0ff', '#ffffff']
  const M = fire ? ['#3a1410', '#22100c', '#140806'] : ['#dcf0ff', '#b4dcfa', '#aad7fa']
  const Gl = fire ? ['#fff4d0', '#ffb040', '#ff3a10'] : ['#ffffff', '#bee6ff', '#78beff']
  const dropC = fire ? '#ffb060' : '#e6f6ff', ringC = fire ? '#ff8a3c' : '#d4eeff'
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', zIndex: 2, pointerEvents:'none', overflow:'visible' }}>
      <defs>
        <linearGradient id={`${id}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={K[0]} stopOpacity="0" /><stop offset="0.6" stopColor={K[1]} stopOpacity="0.7" /><stop offset="1" stopColor={K[2]} />
        </linearGradient>
        <radialGradient id={`${id}m`}><stop offset="0" stopColor={M[0]} stopOpacity={fire ? 0.9 : 0.6} /><stop offset="0.45" stopColor={M[1]} stopOpacity={fire ? 0.55 : 0.28} /><stop offset="0.75" stopColor={M[2]} stopOpacity={fire ? 0.2 : 0.08} /><stop offset="1" stopColor={M[2]} stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}g`}><stop offset="0" stopColor={Gl[0]} /><stop offset="0.35" stopColor={Gl[1]} stopOpacity="0.9" /><stop offset="1" stopColor={Gl[2]} stopOpacity="0" /></radialGradient>
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
      {sc.items.map((it, i) => {
        if (it.t === 'streak' || it.t === 'jet') return <rect key={i} x={X(it.x - it.w / 2)} y={Y(it.y1)} width={it.w * U} height={(it.y2 - it.y1) * U} rx={(it.w * U) / 2} fill={`url(#${id}k)`} opacity={it.op} />
        if (it.t === 'rain') return <line key={i} x1={X(it.x1)} y1={Y(it.y1)} x2={X(it.x2)} y2={Y(it.y2)} stroke="#cfeaff" strokeWidth={Math.max(1, it.w * U)} strokeLinecap="round" opacity={it.op} />
        if (it.t === 'drop') return <ellipse key={i} cx={X(it.x)} cy={Y(it.y)} rx={it.rx * U} ry={it.ry * U} fill={dropC} opacity={it.op} transform={`rotate(${it.rot.toFixed(1)} ${X(it.x).toFixed(1)} ${Y(it.y).toFixed(1)})`} />
        if (it.t === 'ring') return <ellipse key={i} cx={X(it.x)} cy={Y(it.y)} rx={it.rx * U} ry={it.ry * U} fill="none" stroke={ringC} strokeWidth={it.w * U} opacity={it.op} />
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
        if (it.space === 'hand' && hands) {
          const h = hands[it.hi || 0] || hands[0], x = h[0] + it.x * s, y = h[1] + it.y * s
          if (it.t === 'mote') return <circle key={i} cx={x} cy={y} r={it.r * s * 2} fill={`url(#${id}g)`} opacity={it.op} />
          if (it.t === 'hdrop') return <ellipse key={i} cx={x} cy={y} rx={it.rx * s} ry={it.ry * s} fill="#e6f6ff" opacity={it.op} transform={`rotate(${it.rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`} />
        }
        return null
      })}
      {sc.hand && hands && sc.hand.op > 0 && hands.map((h, i) => (
        <g key={`h${i}`} opacity={sc.hand.op}>
          <circle cx={h[0]} cy={h[1]} r={sc.hand.r * s * 2} fill={`url(#${id}g)`} />
          <circle cx={h[0]} cy={h[1]} r={sc.hand.r * s * (fire ? 0.3 : 0.5)} fill={Gl[0]} opacity={fire ? 0.7 : 0.85} />
        </g>
      ))}
    </svg>
  )
}
// 黒焔の奔流（sc.beam・終焉の黒焔）：口（hand）から相手の体の真ん中へ流れる炎のかたまり（棒に見えないように・下に暗い赤のぼかしを敷く）。
//   飛ぶ絵の後ろに描く（前に描くと、塗りの絵の上に濁って重なった）。hand＝口（舞台の px）
function DoomBeam({ geo, beam, hand }) {
  const id = useId().replace(/:/g, '')
  const U = geo.p.w, [hx, hy] = hand, dx = geo.p.x + U / 2 - hx, dy = geo.p.y + geo.p.h * FX_TARGET_Y - hy, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', zIndex: 2, pointerEvents:'none', overflow:'visible' }}>
      <defs>
        <radialGradient id={`${id}m`}><stop offset="0" stopColor="#3a1410" stopOpacity="0.9" /><stop offset="0.45" stopColor="#22100c" stopOpacity="0.55" /><stop offset="1" stopColor="#140806" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}g`}><stop offset="0" stopColor="#fff4d0" /><stop offset="0.35" stopColor="#ffb040" stopOpacity="0.9" /><stop offset="1" stopColor="#ff3a10" stopOpacity="0" /></radialGradient>
        <filter id={`${id}b`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={(U * 0.012).toFixed(2)} /></filter>
      </defs>
      <g opacity={beam.op.toFixed(3)}>
        <line x1={hx} y1={hy} x2={hx + dx * beam.head} y2={hy + dy * beam.head} stroke="#7a1200" strokeWidth={U * 0.2 * beam.w} strokeLinecap="round" opacity="0.6" filter={`url(#${id}b)`} />
        {beam.blobs.map((q, i) => (
          <circle key={i} cx={hx + dx * q.p + nx * q.off * U} cy={hy + dy * q.p + ny * q.off * U} r={q.r * U * (0.5 + 0.5 * beam.w) * (q.dark ? 1.25 : 1)}
            fill={`url(#${id}${q.dark ? 'm' : 'g'})`} opacity={q.op.toFixed(3)} />
        ))}
      </g>
    </svg>
  )
}
// 画面ぜんたいが光る（叩きつけた所を中心に）
const Flash = ({ geo, op, fire = false }) => {
  const x = geo.p.x + geo.p.w / 2, y = geo.p.y + geo.p.h * (FX_FEET_Y - 0.4)
  const stops = fire ? 'rgba(255,246,214,0.97) 0%, rgba(255,150,50,0.6) 35%, rgba(255,60,16,0.18) 70%, rgba(255,60,16,0) 100%'
    : 'rgba(240,250,255,0.95) 0%, rgba(160,215,255,0.55) 35%, rgba(90,170,255,0.15) 70%, rgba(90,170,255,0) 100%'
  return <div style={{ position:'absolute', inset:0, zIndex: 4, pointerEvents:'none', opacity: op,
    background:`radial-gradient(circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, ${stops})` }} />
}

// 右上から左下へ引いて見せる切り抜き（r＝0 何も見えない〜1 全部）：x − y ≥ u の側（絵の枠の %）
const wipeClipOf = (r) => {
  const u = 100 - 200 * r
  return `polygon(${u - 100}% -100%, 400% -100%, 400% 200%, ${u + 200}% 200%)`
}

// 演出（lib/bossScene.js の stageSceneOf）に、いま流れている技と構えを渡す。handsAt＝手（立ち絵の px・手の光と粒としぶきを出す所・ポーズの絵の両手）
//   構えた技＝名前が同じ技・無ければ最後の技（BossFx と同じ）。技を流しているあいだは構えの演出は出さない（技が先＝Fighter と同じ）
const sceneOfStage = (art, acts, now, cast, castEnd) => {
  const motions = Object.values(art.motions)
  const castM = cast ? motions.find(m => m.label === cast.name) || motions.at(-1) : null
  // after＝構えのすぐあとの技か（技の途中から流す技は t0 が前にずれているので、動いた時刻で見る）
  const list = acts.map(f => ({ m: f.motion, ms: (now - f.t0) * 1000, after: afterCast(f.t0 + (f.castSkip || 0) / 1000, castEnd), landed: f.landed !== false })).filter(a => a.ms >= 0)
  const running = list.filter(a => a.ms < a.m.totalMs).at(-1)
  const sc = stageSceneOf(list, castM?.scene && !running ? { m: castM, ms: cast.ms } : null)
  // 手（scene.hand＝{ pt, part }・立ち絵の px とパーツ）：光の出どころ。構えているあいだ（技を流していない）は構えた技、ほかは演出が続いている技
  const live = list.filter(a => a.ms < sceneEndMsOf(a.m)).at(-1)
  const fromCast = !running && !!castM?.scene
  const handPt = fromCast ? castM.scene.hand : live ? live.m.scene.hand : null
  if (handPt && (sc.hand || sc.beam || sc.items.some(it => it.space === 'hand'))) {
    const pose = !fromCast ? illustPoseAt(art.key, live.m, live.ms, now * 1000, live.after) : illustCastPoseAt(art.key, cast.ms, now * 1000)
    // ポーズの絵が出ていれば、その絵の上の手（anchors の hand・hand2＝両手）から。無ければ決まりの手（scene.hand）
    const castAn = fromCast && art.castArt ? castM.anchors?.[art.castArt] : null
    const pts = ['hand', 'hand2'].map(n => (!fromCast ? artAnchorAt(art.key, live.m, live.ms, pose, n) : castAn?.[n] ? illustPointAt(art.key, pose, castAn[n], 'body') : null)).filter(Boolean)
    sc.handsAt = pts.length ? pts : [illustPointAt(art.key, pose, handPt.pt, handPt.part)]
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
  // HPの節目のバフの強い見せ方（逆鱗・lib/bossIllust.js の buffSceneAt）：舞台を赤黒く暗く・吠える揺れ（技の演出と重ねる）
  const rageB = foeArt?.kind === 'illust' ? fx.reduce((p, f) => (f.kind === 'rage' && f.side === 'b' && f.t0 <= now && (!p || f.t0 >= p.t0) ? f : p), null) : null
  const bsc = rageB ? buffSceneAt(foeArt.buffs?.[rageB.skill], (now - rageB.t0) * 1000) : null
  // 付いているあいだの空の暗さと雨（篠突く雨）。ボスが倒れると雨は 0.8秒で止む
  const after = foeArt?.kind === 'illust' && foeArt.buffs ? buffAfterOf(foeArt, st.b, fx.filter(f => f.side === 'b'), now) : null
  const deadAt = useRef(null)
  if (st.b.hp > 0) deadAt.current = null
  else if (deadAt.current == null) deadAt.current = now
  const rainOp = deadAt.current == null ? 1 : Math.max(0, 1 - (now - deadAt.current) / 0.8)
  const rains = [bsc?.rain, rainOp > 0 ? after?.rain : null].filter(Boolean)
  const dimOf = [bsc?.dim ? { k: bsc.dim, c: bsc.dimColor } : null, after?.dim ? { k: after.dim * rainOp, c: after.dimColor } : null, sc?.dim ? { k: sc.dim, c: sc.dimColor } : null]
    .reduce((p, d) => (d && d.k > (p?.k || 0) ? { k: d.k, c: d.c || '0,3,14' } : p), null)
  const shake = [(sc?.shake[0] || 0) + (bsc?.shake[0] || 0), (sc?.shake[1] || 0) + (bsc?.shake[1] || 0)]
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el || !foeBig) return
    const measure = () => {
      if (!pArea.current || !bArea.current) return
      const r = el.getBoundingClientRect()
      setGeo({ W: r.width, p: boxOf(r, pArea.current.getBoundingClientRect(), playerScale), b: boxOf(r, bArea.current.getBoundingClientRect(), 1) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [foeBig, playerScale])
  return (
    <div ref={stageRef} style={{ position:'relative', overflow:'hidden', display:'flex', gap:'12px', alignItems:'flex-start', padding:'8px',
      background:'linear-gradient(180deg, #000a26 0%, #001338 70%, #00204a 100%)', border:'1px solid #0a2a55',
      // 演出：背景を暗く（内側の影は背景の上・中身の下）・舞台ごと揺れる
      boxShadow: dimOf ? `inset 0 0 0 2000px rgba(${dimOf.c},${dimOf.k.toFixed(3)})` : undefined,
      transform: shake[0] || shake[1] ? `translate(${shake[0].toFixed(1)}px, ${shake[1].toFixed(1)}px)` : undefined }}>
      <Fighter st={st} side="a" me={st.a} src={playerSrc} motion={playerMotion} strips={playerMotion ? [playerMotion] : []} fx={fx} now={now} name={st.a.name}
        artH={size?.artH || ART_H} scale={playerScale} areaRef={pArea} squeeze={sc?.squeeze} />
      <Fighter st={st} side="b" me={st.b} right src={foeSrc} fx={fx} now={now} name={st.b.name}
        strips={foeArt?.kind === 'pixel' ? Object.values(foeArt.motions) : []} rig={foeArt?.kind === 'illust' ? foeArt : null}
        flex={size?.flex} artH={size?.artH || ART_H} areaRef={bArea} castEnd={castSeen.current} bossGlow={sc?.bossGlow || 0} />
      {sc?.beam && geo && sc.handsAt && <DoomBeam geo={geo} beam={sc.beam} hand={[geo.b.x + sc.handsAt[0][0] * (geo.b.w / foeArt.base), geo.b.y + sc.handsAt[0][1] * (geo.b.w / foeArt.base)]} />}
      {foeArt && <BossFx fx={fxAll} now={now} geo={geo} art={foeArt} cast={cast} castEnd={castSeen.current} scene={sc} />}
      {sc && geo && <SceneLayer geo={geo} sc={sc} hands={sc.handsAt ? sc.handsAt.map(p => [geo.b.x + p[0] * (geo.b.w / foeArt.base), geo.b.y + p[1] * (geo.b.w / foeArt.base)]) : null} s={geo.b.w / foeArt.base} />}
      {sc && geo && sc.flash > 0 && <Flash geo={geo} op={sc.flash} fire={sc.tone === 'fire'} />}
      {geo && rains.length > 0 && <BuffRain geo={geo} rains={rains} op={rainOp} />}
      {/* 稲妻が落ちた瞬間に舞台ぜんぶが光る（篠突く雨） */}
      {bsc?.flash > 0.01 && <div style={{ position:'absolute', inset:0, zIndex: 4, pointerEvents:'none', background:'rgb(205,230,255)', opacity: bsc.flash.toFixed(3) }} />}
    </div>
  )
}

// 敵の技の名前の帯（FF のように・lib/atbFx.js の skillBannerAt）：黒い半透明の帯に白い字。上から少しすべり込む
//   【確定】2026-10-30 ユーザー「敵のスキル発動時はスキル名を上に表示させてほしい、FFみたいに」
//   【確定】2026-10-30 ユーザー「スキルはモンスターの真ん中上部にして、文字ちょっと大きいから調整して」：舞台のまん中→モンスターの絵の枠の上のまん中・字は15px→12px
//   【確定】2026-10-30 ユーザー「文字こんな感じで被ってるから調整してほしい名前と同じ行でもいいと思う、文字ももう少し小さめで」（雨摩座の顔に重なった）：
//     名前の行の、名前の横の空いた所のまん中に置く（絵の枠の外＝重ならない）・字は12px→11px・帯の高さを名前の行に収める
//   【確定】2026-10-30 ユーザー「これIDダンジョンは全部これね、スキルの感じルぴ振れる？」：漢字にルビ（lib/skillRuby.js）。
//     ルビのぶん帯が高くなるので、名前の行の下にそろえて上へはみ出させる（名前の行の高さは変えない＝帯が出ても下の絵がずれない）
//   【確定】2026-10-30 ユーザー「バフは６０％と３０％以下のタイミングで自動発動してほしい、名前も固有」：HPの節目のバフの名前も同じ帯に出す
//     （b.rage＝赤と金の帯・技より長く）。付いた瞬間は体が赤く2回脈打つ（RAGE_SEC・絵のエフェクトが届くまでの仮）。付いているバフは絵の右上の「🔥バフ×数」のボタン（UniqueBuffs）で見る
const SkillBanner = ({ b }) => {
  if (!b) return null
  return (
    <div style={{ position:'absolute', bottom:0, left:'50%', zIndex: 5, pointerEvents:'none', opacity: b.op,
      transform:`translate(-50%, ${((1 - b.k) * 3).toFixed(1)}px)`, maxWidth:'100%', lineHeight: 1.25,
      padding:'1px 10px', borderRadius:'3px', border: b.rage ? '1px solid rgba(255,190,90,0.85)' : '1px solid rgba(220,232,255,0.55)',
      background: b.rage ? 'linear-gradient(180deg, rgba(70,10,4,0.92) 0%, rgba(28,2,0,0.92) 100%)' : 'linear-gradient(180deg, rgba(10,18,44,0.88) 0%, rgba(2,6,20,0.88) 100%)',
      boxShadow: b.rage ? '0 2px 10px rgba(0,0,0,0.55), 0 0 10px rgba(255,90,30,0.55), inset 0 0 0 1px rgba(0,0,0,0.6)' : '0 2px 10px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.6)',
      color: b.rage ? '#ffe2a0' : '#ffffff', fontFamily: JP_BOLD, fontWeight: 700, fontSize:'11px', letterSpacing:'0.08em', whiteSpace:'nowrap',
      overflow:'hidden', textOverflow:'ellipsis', textShadow: b.rage ? '0 1px 2px #000, 0 0 6px rgba(255,120,40,0.6)' : '0 1px 2px #000, 0 0 6px rgba(120,160,255,0.45)' }}>
      {rubySegmentsOf(b.name).map((sg, i) => (sg.ruby
        ? <ruby key={i}>{sg.text}<rt style={{ fontSize:'7px', letterSpacing:0, color: b.rage ? '#ffd2a0' : '#cfe0ff', fontWeight: 700 }}>{sg.ruby}</rt></ruby>
        : <span key={i}>{sg.text}</span>))}
    </div>
  )
}
