// v2cap：モンスターのカードの試作（開発用の枠から開く・2026-11-23）
// 【ユーザー指示】2026-11-23「バトルフロンティアの敵キャラをカード化して収集コンテンツにすることできそう？」
//   →「GIFはあくまで参考ね、クリックとかタップでカードをGIFの視点みたいに見まわせるようにしてほしい　試しにフェアリーで作ってみて」
//   ・GIF は使わない。図鑑の大きい絵（public/enemy-art-big）1枚に、傾き・厚み・虹色の光・流れるハイライト・星・粒を画面で重ねる
//     ＝敵が何体いても増えるファイルは無い
//   ・押したまま動かすと、押した所が奥へ沈むように傾く。離すと、ゆっくり回る元の動きへ戻る
//   ・色は絵から拾う（絵のあざやかな所の色あい）。拾えないときは種族の色
//   ・枠と文字の置きかたは独自のもの（参考のGIFは光の質感だけを借りた）
//   ★まだ試作：手に入れかた・報酬・サーバーの保存は無い。見た目が決まってから決める
import { useEffect, useMemo, useRef, useState } from 'react'
import { box, miniBtn, TEXT } from './v2ui.js'
import { JP_BOLD } from './casinoStyle.js'
import { enemyArtBigSrc, ENEMY_NAMES_BY_AREA } from '../lib/enemyArt.js'
import { raceDefOf } from '../lib/monsterRace.js'
import { AREA_LIST } from '../lib/areas.js'

// ===== 動きのつまみ =====
const IDLE_X = 10.5      // 何もしていないときの傾き（度）：上下
const IDLE_Y = 17.5      //                              ：左右
const ORBIT_SEC = 5.2    // ひと回りの秒数
const BOB_SEC = 3.4      // 浮き沈みの秒数
const BOB_PX = 5
const DRAG_X = 26        // 押して動かしたときの傾きの上限（度）：上下
const DRAG_Y = 34        //                                    ：左右
const THICK = 8          // 厚みの板の枚数（1枚1px）

// 星のきらめきの場所（カードの左上から%）。流れるハイライトが通るときに光る
const STARS = [[17, 13, 1], [85, 21, 0.8], [69, 45, 1.2], [23, 57, 0.7], [88, 69, 0.9], [13, 85, 0.8], [53, 29, 0.6]]
const STAR_PATH = 'M12 0C12.6 8 16 11.4 24 12C16 12.6 12.6 16 12 24C11.4 16 8 12.6 0 12C8 11.4 11.4 8 12 0Z'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const isReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

// 色あい（0〜360）：#rrggbb から
const hueOfHex = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''))
  return m ? hueOfRgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : 210
}
function hueOfRgb(r, g, b) {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
// 絵のあざやかな所の色あいを拾う（小さく縮めて平均する）。拾えるまでは fallback
function useArtHue(src, fallback) {
  const [picked, setPicked] = useState(null)   // { src, hue }
  useEffect(() => {
    if (!src) return undefined
    let alive = true
    const img = new Image()
    img.onload = () => {
      try {
        const n = 24
        const c = document.createElement('canvas'); c.width = n; c.height = n
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(img, 0, 0, n, n)
        const d = g.getImageData(0, 0, n, n).data
        let x = 0, y = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue
          const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255
          const sat = Math.max(r, gg, b) - Math.min(r, gg, b)
          if (sat < 0.12) continue
          const h = hueOfRgb(r, gg, b) * Math.PI / 180
          x += Math.cos(h) * sat; y += Math.sin(h) * sat
        }
        if (alive && (x || y)) setPicked({ src, hue: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360 })
      } catch { /* 読めない絵は種族の色のまま */ }
    }
    img.src = src
    return () => { alive = false }
  }, [src])
  return picked && picked.src === src ? picked.hue : fallback
}

// 決まった並びの乱数（粒の場所を毎回同じにする）
const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) }
const makeMotes = (n, seed) => { const r = seeded(seed); return Array.from({ length: n }, () => ({ x: r() * 100, y: 12 + r() * 84, size: 1.5 + r() * 2.5, dur: 4 + r() * 5, delay: -r() * 9, drift: (r() - 0.5) * 40 })) }

const CSS = `
@keyframes v2card-mote { 0% { transform: translate(0, 0); opacity: 0 } 18% { opacity: .85 } 100% { transform: translate(var(--drift), -110px); opacity: 0 } }
@keyframes v2card-breath { 0%, 100% { opacity: .55; transform: translate(-50%, -50%) scale(1) } 50% { opacity: .9; transform: translate(-50%, -50%) scale(1.08) } }
.v2card-mote { position: absolute; border-radius: 50%; animation: v2card-mote linear infinite; pointer-events: none }
@media (prefers-reduced-motion: reduce) { .v2card-mote, .v2card-breath { animation: none !important } }
`

function Motes({ list, hue, front }) {
  return list.map((m, i) => (
    <span key={i} className="v2card-mote" style={{
      left: `${m.x}%`, top: `${m.y}%`, width: m.size, height: m.size, '--drift': `${m.drift}px`,
      background: `hsl(${(hue + (i % 3) * 25) % 360} 90% ${front ? 85 : 72}%)`,
      boxShadow: `0 0 ${m.size * 3}px hsl(${hue} 90% 70%)`, filter: front ? 'blur(.3px)' : 'blur(1px)',
      animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s`,
    }} />
  ))
}

// 虹色の帯：大きい板（カードの2.4倍）にくり返しで描き、板ごと動かす。★背景の位置で動かさない（斜めの帯は継ぎ目が見える）
const RAINBOW_HUES = [[0, 62], [45, 60], [95, 58], [170, 58], [215, 64], [275, 66], [330, 64], [360, 62]]
const rainbowOf = (deg, period) => `repeating-linear-gradient(${deg}deg, ${RAINBOW_HUES.map(([h, l], i) => `hsl(${h} 92% ${l}%) ${(i / (RAINBOW_HUES.length - 1) * period).toFixed(1)}%`).join(', ')})`
const sheet = (dir) => ({ position: 'absolute', inset: '-70%', transform: `translate(calc(var(--ryn) * ${0.7 * dir}%), calc(var(--rxn) * ${0.7 * dir}%))`, willChange: 'transform' })
const fill = { position: 'absolute', inset: 0 }

// カード1枚。name＝モンスターの名前
export function V2capMonsterCard({ name }) {
  const src = enemyArtBigSrc(name)
  const race = raceDefOf(name)
  const areaNo = ENEMY_NAMES_BY_AREA.findIndex(a => a.includes(name))
  const areaName = areaNo >= 0 ? AREA_LIST[areaNo]?.name : null
  const hue = useArtHue(src, hueOfHex(race?.color))

  const stageRef = useRef(null)
  const cardRef = useRef(null)
  const starRefs = useRef([])
  const pose = useRef({ rx: 0, ry: 0, tx: 0, ty: 0, drag: false })
  const backMotes = useMemo(() => makeMotes(16, 11), [])
  const frontMotes = useMemo(() => makeMotes(8, 29), [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const still = isReduced()
    const s = pose.current
    const t0 = performance.now()
    let raf = 0
    let last = t0
    const tick = (now) => {
      const t = (now - t0) / 1000
      const dt = Math.min(0.1, (now - last) / 1000)   // コマ数が少ない端末でも同じ速さで追いつく
      last = now
      if (!s.drag) {
        const a = t * Math.PI * 2 / ORBIT_SEC
        s.tx = still ? -4 : IDLE_X * Math.sin(a)
        s.ty = still ? 9 : IDLE_Y * Math.cos(a)
      }
      const k = 1 - Math.exp(-dt * (s.drag ? 16 : 3.6))
      s.rx += (s.tx - s.rx) * k
      s.ry += (s.ty - s.ry) * k
      const bob = still ? 0 : Math.sin(t * Math.PI * 2 / BOB_SEC) * BOB_PX
      const band = 50 + s.ry * 2.5 + s.rx * 0.9    // 流れるハイライトの場所（%）
      const st = stage.style
      st.setProperty('--rxn', s.rx.toFixed(2))
      st.setProperty('--ryn', s.ry.toFixed(2))
      st.setProperty('--bob', `${bob.toFixed(2)}px`)
      st.setProperty('--band', band.toFixed(2))
      st.setProperty('--gx', `${(50 + s.ry * 1.5).toFixed(1)}%`)
      st.setProperty('--gy', `${(50 - s.rx * 1.6).toFixed(1)}%`)
      STARS.forEach(([x, y, size], i) => {
        const el = starRefs.current[i]
        if (!el) return
        const d = (x - (band + (50 - y) * 0.375)) / 9      // ハイライトの帯は斜め（上ほど右）
        const o = Math.exp(-d * d)
        el.style.opacity = o.toFixed(3)
        el.style.transform = `translate(-50%, -50%) scale(${(size * (0.35 + o * 0.9)).toFixed(3)}) rotate(${(o * 30).toFixed(1)}deg)`
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 押した所が奥へ沈むように傾ける
  const aim = (e) => {
    const stage = stageRef.current, card = cardRef.current
    if (!stage || !card) return
    const r = stage.getBoundingClientRect()
    const nx = clamp((e.clientX - (r.left + r.width / 2)) / (card.offsetWidth / 2), -1.2, 1.2)
    const ny = clamp((e.clientY - (r.top + r.height / 2)) / (card.offsetHeight / 2), -1.2, 1.2)
    pose.current.ty = nx * DRAG_Y
    pose.current.tx = -ny * DRAG_X
  }
  const onDown = (e) => { pose.current.drag = true; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* つかめない端末 */ } aim(e) }
  const onMove = (e) => { if (pose.current.drag) aim(e) }
  const onUp = () => { pose.current.drag = false }

  const gold = 'linear-gradient(calc(120deg + var(--ryn) * 3deg), #5e430e, #f7e19a 20%, #b8892b 38%, #fff6cf 54%, #a87a22 70%, #f1d581 86%, #5e430e)'
  const rays = 'repeating-conic-gradient(from 0deg at 50% 43%, #000 0 2deg, transparent 2deg 9deg)'

  return (
    <div
      ref={stageRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{
        position: 'relative', width: '100%', maxWidth: 460, margin: '0 auto', padding: '46px 0 62px', overflow: 'hidden',
        perspective: '900px', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: 'grab',
        background: `radial-gradient(ellipse at 50% 44%, hsl(${hue} 45% 17%) 0%, hsl(${hue} 50% 7%) 55%, #020308 100%)`,
        '--rxn': 0, '--ryn': 0, '--bob': '0px', '--band': 50, '--gx': '50%', '--gy': '50%',
      }}
    >
      <style>{CSS}</style>
      {/* カードのうしろの明かり（息をするように明るさが変わる） */}
      <div className="v2card-breath" style={{ position: 'absolute', left: '50%', top: '48%', width: '92%', aspectRatio: '1', borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, hsl(${hue} 85% 58% / .42), hsl(${(hue + 40) % 360} 80% 50% / .14) 45%, transparent 68%)`, animation: `v2card-breath ${BOB_SEC * 1.5}s ease-in-out infinite` }} />
      <Motes list={backMotes} hue={hue} />
      {/* 床に落ちる影（傾きと逆へずれる・浮くと薄くなる） */}
      <div style={{ position: 'absolute', left: '50%', bottom: 22, width: 'min(230px, 58vw)', height: 26, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(ellipse, rgba(0,0,0,.75), transparent 70%)', filter: 'blur(7px)',
        transform: 'translateX(calc(-50% - var(--ryn) * 1.3px)) scaleX(calc(1 - var(--ryn) * var(--ryn) * .0002))' }} />

      <div ref={cardRef} style={{
        position: 'relative', width: 'min(300px, 76vw)', aspectRatio: '5 / 7', margin: '0 auto', transformStyle: 'preserve-3d',
        transform: 'translateY(var(--bob)) rotateX(calc(var(--rxn) * 1deg)) rotateY(calc(var(--ryn) * 1deg))', willChange: 'transform',
      }}>
        {/* 厚み：うしろへ1pxずつ重ねた金属の板 */}
        {Array.from({ length: THICK }, (_, i) => (
          <div key={i} style={{ ...fill, borderRadius: '4.6% / 3.3%', transform: `translateZ(${-(i + 1)}px)`,
            background: i === THICK - 1 ? '#2a1f08' : 'repeating-linear-gradient(90deg, #6b5524 0 1px, #d8c27a 1px 2px, #8d7532 2px 3px)' }} />
        ))}

        {/* 表の面（金の縁） */}
        <div style={{ ...fill, borderRadius: '4.6% / 3.3%', overflow: 'hidden', containerType: 'inline-size', background: gold,
          boxShadow: '0 0 0 1px rgba(255,240,190,.35) inset, 0 12px 30px rgba(0,0,0,.55)' }}>
          {/* 中の面 */}
          <div style={{ position: 'absolute', inset: '2.6cqw', borderRadius: '3.2cqw', overflow: 'hidden',
            background: `linear-gradient(160deg, hsl(${hue} 46% 15%), hsl(${(hue + 40) % 360} 52% 7%) 58%, hsl(${(hue + 330) % 360} 46% 11%))` }}>
            {/* 放射の模様：すじの上だけに虹色（傾きと逆へ流れる） */}
            <div style={{ ...fill, WebkitMaskImage: rays, maskImage: rays, opacity: 0.26, mixBlendMode: 'screen' }}>
              <div style={{ ...sheet(-1), backgroundImage: rainbowOf(115, 34) }} />
            </div>
            {/* 全体の虹色（傾きにつれて流れる） */}
            <div style={{ ...fill, opacity: 0.26, mixBlendMode: 'color-dodge' }}>
              <div style={{ ...sheet(1), backgroundImage: rainbowOf(115, 46) }} />
            </div>
            {/* 細かい斜めの刻み */}
            <div style={{ ...fill, backgroundImage: 'repeating-linear-gradient(58deg, rgba(255,255,255,.075) 0 1px, transparent 1px 4px)', mixBlendMode: 'overlay' }} />
            {/* 絵のうしろの明かり */}
            <div style={{ position: 'absolute', left: '50%', top: '43%', width: '88%', aspectRatio: '1', transform: 'translate(-50%, -50%)', borderRadius: '50%',
              background: `radial-gradient(circle, hsl(${hue} 90% 72% / .34), transparent 62%)` }} />

            {/* 絵（傾きと逆へ少しずれて、手前に浮いて見える） */}
            <div style={{ position: 'absolute', left: '4%', right: '4%', top: '9.5%', aspectRatio: '1',
              transform: 'translate(calc(var(--ryn) * -.28px), calc(var(--rxn) * .28px))' }}>
              {src && <img src={src} alt={name} draggable={false} style={{ ...fill, width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'auto',
                filter: 'drop-shadow(0 1.6cqw 2.4cqw rgba(0,0,0,.55))' }} />}
              {/* 絵の上だけの光（絵の形で切り抜く） */}
              {src && <div style={{ ...fill, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, WebkitMaskSize: 'contain', maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center',
                opacity: 0.22, mixBlendMode: 'color-dodge' }}>
                <div style={{ ...sheet(1), backgroundImage: rainbowOf(115, 40) }} />
                <div style={{ ...fill, background: 'radial-gradient(circle at var(--gx) var(--gy), rgba(255,255,255,.6), transparent 42%)' }} />
              </div>}
            </div>

            {/* 上の行：種族とエリア */}
            <div style={{ position: 'absolute', left: '4.5cqw', right: '4.5cqw', top: '3.6cqw', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontFamily: JP_BOLD, fontWeight: 700, fontSize: '3.7cqw', lineHeight: 1 }}>
              {race && <span style={{ color: race.color, border: `1px solid ${race.color}`, background: 'rgba(2,6,16,.6)', padding: '1.1cqw 2.2cqw', borderRadius: '1cqw' }}>{race.label}</span>}
              {areaName && <span style={{ color: '#f3e3b0', textShadow: '0 1px 2px #000' }}>{areaName}</span>}
            </div>

            {/* 名前の札 */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '6.5cqw', padding: '3cqw 2cqw', textAlign: 'center',
              background: 'linear-gradient(90deg, transparent, rgba(3,6,18,.78) 18%, rgba(3,6,18,.78) 82%, transparent)',
              borderTop: '1px solid rgba(247,225,154,.6)', borderBottom: '1px solid rgba(247,225,154,.6)' }}>
              <span style={{ fontFamily: JP_BOLD, fontWeight: 700, fontSize: '7.4cqw', letterSpacing: '.08em', lineHeight: 1.1,
                backgroundImage: gold, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.8))' }}>{name}</span>
            </div>

            {/* 内側の細い金の線 */}
            <div style={{ position: 'absolute', inset: '1.6cqw', borderRadius: '2.2cqw', border: '1px solid rgba(247,225,154,.5)', pointerEvents: 'none' }} />
          </div>

          {/* 流れるハイライト（斜めの帯） */}
          <div style={{ position: 'absolute', top: '-10%', bottom: '-10%', width: '26%', left: 'calc(var(--band) * 1% - 13%)', transform: 'skewX(-15deg)', pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.3) 45%, rgba(255,255,255,.42) 50%, rgba(255,255,255,.3) 55%, transparent)', mixBlendMode: 'screen' }} />
          {/* 当たる光（押した所へ寄る） */}
          <div style={{ ...fill, pointerEvents: 'none', mixBlendMode: 'soft-light',
            background: 'radial-gradient(circle at var(--gx) var(--gy), rgba(255,255,255,.75), rgba(255,255,255,.12) 38%, rgba(0,0,0,.28) 85%)' }} />
          {/* 星のきらめき */}
          {STARS.map(([x, y], i) => (
            <svg key={i} ref={el => { starRefs.current[i] = el }} viewBox="0 0 24 24" style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: '9cqw', height: '9cqw', opacity: 0,
              pointerEvents: 'none', filter: `drop-shadow(0 0 1.2cqw hsl(${hue} 100% 80%))` }}>
              <path d={STAR_PATH} fill="#fff" />
            </svg>
          ))}
        </div>
      </div>
      <Motes list={frontMotes} hue={hue} front />
    </div>
  )
}

// 試作で見られるモンスター
const LAB_NAMES = ['ツユフェアリー', 'オーロラフェアリー', 'ハピネスフェアリー']

export default function V2capCardLab() {
  const [name, setName] = useState(LAB_NAMES[0])
  return (
    <div>
      <div style={{ ...box, padding: '8px 10px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px' }}>
          <span style={{ color: TEXT.label }}>モンスター</span>
          {LAB_NAMES.map(n => (
            <button key={n} onClick={() => setName(n)} style={{ ...miniBtn(n === name ? '#ffdd88' : '#88aaff'), background: n === name ? '#2a2206' : '#000818' }}>{n}</button>
          ))}
        </div>
        <div style={{ color: TEXT.sub, fontSize: '10px', marginTop: '6px', lineHeight: 1.6 }}>
          カードを押したまま動かすと、傾けて見まわせます。離すと、ゆっくり回る動きへ戻ります
        </div>
      </div>
      <V2capMonsterCard key={name} name={name} />
    </div>
  )
}
