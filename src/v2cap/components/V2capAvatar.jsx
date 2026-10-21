import { useState } from 'react'
import { avatarFitOf, lookOfFrames, visibleBoxOf } from '../lib/avatar.js'

// ============================================================
// 「レベルキャップあり」版 — 自分のアイコン（ホームのステータス・プロフィールで同じものを使う）
//   【確定】2026-10-21 ユーザー指示「暗殺者女みたいに全身反映されるようにしたい」：
//   ・画像を読んで見える部分（透明でないところ）を調べ、そこが枠いっぱいに入るように置く（決まりは lib/avatar.js の avatarFitOf）
//   ・動く画像（GIF など）は全部のコマを見る。大きさは「ふだんの姿」で決め（＝ユーザー指示「女暗殺者と同じ大きさにしたい」）、
//     そこからはみ出す動きは枠を縦に maxHeight まで伸ばして入れる（＝「全身・全部のモーションはいるようにしてほしい」）
//     （戦士男の待機は51コマ中6コマで斧を頭の上まで振り上げる。ホームは横の文字の列が高いので、伸ばしても並びは変わらない）
//     全部のコマを見られないブラウザ（ImageDecoder が無い）は、表示中の1コマをふだんの姿にし、GIF・WebP なら画像全体を動きの範囲にする
//   ・調べた結果は画像ごとに覚えておく（ページを開いているあいだ1回だけ）
//   ・画像は <img> のまま出すので GIF は動く。調べる前は画像全体を入れておく
//   ・読めない画像は何も出さない（onError があればそれも呼ぶ）
// ============================================================
const SCAN_MAX = 256    // 調べるときは長い辺をこの大きさまで縮める（速さのため）
const FRAME_MAX = 120   // 調べるコマの数の上限

const looked = new Map()   // 画像のURL → { w, h, box, main, opaque }（lib/avatar.js の lookOfFrames）
const looking = new Map()  // 画像のURL → 調べている途中（Promise）

// 1コマを縮めて描き、見える部分を元の大きさに戻して返す
const scanFrame = (ctx, source, w, h) => {
  const k = Math.min(1, SCAN_MAX / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k))
  ctx.canvas.width = cw
  ctx.canvas.height = ch
  ctx.clearRect(0, 0, cw, ch)
  ctx.drawImage(source, 0, 0, cw, ch)
  const { box, opaque } = visibleBoxOf(ctx.getImageData(0, 0, cw, ch).data, cw, ch)
  return { w, h, opaque, box: box && { x: box.x / k, y: box.y / k, w: box.w / k, h: box.h / k } }
}
const newCtx = () => document.createElement('canvas').getContext('2d', { willReadFrequently: true })

// 全部のコマを見る（ImageDecoder があるブラウザ）。見られないときは null（表示中の1コマを見る）
//   ・全部のコマを見られないブラウザで動くかもしれない画像は 'whole'（表示中の1コマをふだんの姿・画像全体を動きの範囲にする＝どのコマも切れない）
const MAYBE_MOVING = ['image/gif', 'image/webp', 'image/apng']
const lookFrames = async (src) => {
  const res = await fetch(src)
  if (!res.ok) return null
  const type = (res.headers.get('content-type') || '').split(';')[0].trim()
  if (typeof ImageDecoder === 'undefined' || !type || !(await ImageDecoder.isTypeSupported(type))) {
    return MAYBE_MOVING.includes(type) ? 'whole' : null
  }
  const dec = new ImageDecoder({ data: await res.arrayBuffer(), type })
  try {
    // tracks.ready の前は selectedTrack が null（コマの数が分からず1コマ目しか見ない＝振り上げた斧が枠の外に出た）
    await dec.tracks.ready
    await dec.completed
    const n = Math.min(dec.tracks.selectedTrack?.frameCount || 1, FRAME_MAX)
    const ctx = newCtx()
    const frames = []
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i })
      try { frames.push(scanFrame(ctx, image, image.displayWidth, image.displayHeight)) } finally { image.close() }
    }
    return lookOfFrames(frames)
  } finally { dec.close() }
}

const lookOf = (src, img) => {
  if (!looking.has(src)) {
    const w = img.naturalWidth, h = img.naturalHeight
    looking.set(src, lookFrames(src)
      .catch(() => null)
      .then(r => {
        if (r && r !== 'whole') return r
        let one
        try { one = lookOfFrames([scanFrame(newCtx(), img, w, h)]) } catch { return { w, h, box: null, main: null, opaque: false } }  // 読めない（よその画像）＝全体を入れる
        return r === 'whole' && one.box ? { ...one, box: { x: 0, y: 0, w, h } } : one
      })
      .then(r => { looked.set(src, r); return r }))
  }
  return looking.get(src)
}

// maxHeight … 動きのぶん縦に伸ばせる高さ（無ければ正方形のまま＝はみ出す動きは切れる）
export default function V2capAvatar({ src, size, maxHeight = size, onClick, title, onError, style }) {
  const [state, setState] = useState({})  // { src, look, broken }（src が変わったら前の結果は使わない）
  const mine = state.src === src ? state : {}
  const look = mine.look || looked.get(src)
  if (!src || mine.broken) return null
  const fit = look && look.w && look.h ? avatarFitOf(look, size, maxHeight) : null
  return (
    <div onClick={onClick} title={title}
      style={{ width: size, height: fit ? fit.boxH : size, flexShrink: 0, position: 'relative', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default', ...style }}>
      <img src={src} alt="" crossOrigin="anonymous" draggable={false}
        onLoad={e => { if (!look) lookOf(src, e.currentTarget).then(r => setState({ src, look: r })) }}
        onError={e => { setState({ src, broken: true }); onError?.(e) }}
        style={fit
          ? { position: 'absolute', left: fit.left, top: fit.top, width: fit.width, height: fit.height, maxWidth: 'none', display: 'block', imageRendering: fit.pixel ? 'pixelated' : 'auto' }
          : { width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
    </div>
  )
}
