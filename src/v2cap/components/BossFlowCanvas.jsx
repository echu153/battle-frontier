import { useEffect, useRef } from 'react'
import { GRAIN_SIZE, grainOf } from '../lib/bossBg.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ボス戦の背景の溶岩や滝の水を、流れ図（lib/bossBg.js の flow）のとおりに流す（WebGL）
// ------------------------------------------------------------
// 【確定】2026-10-30 ユーザー「黒龍の溶岩ちゃんと動かしてほしい」：絵の上に光の線を足すのではなく、絵の溶岩そのものが流れて見えるようにする。
//   流れ図の1画素＝R・G が流れる向き（0.5 が止まる）・B が動かす強さ。
//   ★絵を大きくずらすと、滝の形が崩れて岩も溶けた（作り直した）。形は元の絵のまま、その上を「熱いムラ」が流れる：
//     ムラ（grainOf）を流れる向きに長くのばして、向きのとおりに走らせる。熱い所は黄色く白っぽく、冷めた所は赤く（G・B を大きく動かす＝暗くしても濁らない）。
//     速さの違うムラを2枚重ねる（1枚だと模様がそのまま滑って見える）。同じムラで絵を少しだけゆらす＝溶けて流れている感じ。
//     2つの時刻を重ねて、ずれが戻る瞬間を隠す（重ねると薄まるぶんは s で戻す）。
//   その画素が暗い（岩）なら何もしない＝岩と滝のかたちはそのまま。ゆらして読んだ先が岩なら元の絵のまま。
//   色の動かし方はボスごと（flow の mask・gain・hot）：溶岩は上のとおり。水（雨摩座）は暗い所が深い青、明るい所が白くなる。
//   動かす所だけ描いて、ほかは透明（下の <img> が見える）＝WebGL が使えないときは止まった絵のまま。
//   描く時刻は親から（tMs・戦闘の画面の時計）＝止めて確かめられる
// ============================================================
const VS = `
attribute vec2 p;
varying vec2 v;
void main() { v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }
`
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D img;
uniform sampler2D flow;
uniform sampler2D grain;
uniform vec2 off;     // 向き1のときの1周の進み（絵の幅と高さの割合）
uniform vec2 wob;     // 絵をゆらす大きさ（絵の幅と高さの割合）
uniform vec2 phase;   // 2つの時刻（0〜1）
uniform vec3 mk;      // 動かす画素を選ぶ色の重み
uniform vec3 gn;      // ムラで色をどれだけ動かすか
uniform vec3 ht;      // いちばん明るい筋に足す色
void main() {
  vec3 fm = texture2D(flow, v).rgb;
  if (fm.b < 0.012) { gl_FragColor = vec4(0.0); return; }
  vec3 base = texture2D(img, v).rgb;
  float a = fm.b * smoothstep(0.42, 0.66, dot(base, mk));
  if (a < 0.01) { gl_FragColor = vec4(0.0); return; }
  vec2 dir = (fm.rg - 0.50196) * 2.0;
  float fall = smoothstep(0.2, 0.5, abs(dir.y));
  float lake = smoothstep(0.1, 0.2, abs(dir.x));
  vec2 sc = mix(mix(vec2(4.0, 6.0), vec2(0.6, 9.0), lake), vec2(3.0, 0.55), fall);
  vec2 sc2 = sc * vec2(1.7, 1.3);
  vec2 o = dir * off;
  float k = abs(phase.x - 0.5) * 2.0;
  float s = 1.0 / sqrt(k * k + (1.0 - k) * (1.0 - k));
  vec2 n1 = mix(texture2D(grain, (v - o * phase.x) * sc).rg, texture2D(grain, (v - o * phase.y) * sc + 0.37).rg, k);
  vec2 n2 = mix(texture2D(grain, (v - o * 1.6 * phase.x) * sc2 + 0.61).rg, texture2D(grain, (v - o * 1.6 * phase.y) * sc2 + 0.13).rg, k);
  vec3 moved = texture2D(img, v + vec2(n1.g - 0.5, n2.g - 0.5) * s * wob).rgb;
  vec3 col = mix(base, moved, smoothstep(0.32, 0.62, dot(moved, mk)));
  float d = clamp(((n1.r - 0.5) + (n2.r - 0.5) * 0.7) * s * 2.6, -1.0, 1.0);
  col *= 1.0 + d * gn;
  col += max(d - 0.35, 0.0) * ht;
  gl_FragColor = vec4(col * a, a);
}
`
const shader = (gl, type, src) => {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
}
// 絵を読みこんだら貼る
const textureOf = (gl, url, unit, done) => {
  const tex = gl.createTexture()
  const im = new Image()
  im.onload = () => {
    if (gl.isContextLost()) return
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)   // 流れ図の数字を変えない
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    done()
  }
  im.src = url
}
// ムラは並べてくり返す
const grainTexture = (gl, unit) => {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRAIN_SIZE, GRAIN_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, grainOf())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
}
// 用意（失敗したら null＝止まった絵のまま）
const setup = (gl, src, flowSrc, onReady) => {
  const vs = shader(gl, gl.VERTEX_SHADER, VS), fs = shader(gl, gl.FRAGMENT_SHADER, FS)
  if (!vs || !fs) return null
  const pr = gl.createProgram()
  gl.attachShader(pr, vs)
  gl.attachShader(pr, fs)
  gl.linkProgram(pr)
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null
  gl.useProgram(pr)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(pr, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  gl.uniform1i(gl.getUniformLocation(pr, 'img'), 0)
  gl.uniform1i(gl.getUniformLocation(pr, 'flow'), 1)
  gl.uniform1i(gl.getUniformLocation(pr, 'grain'), 2)
  gl.clearColor(0, 0, 0, 0)
  grainTexture(gl, 2)
  let left = 2
  const one = () => { left -= 1; if (left === 0) onReady() }
  textureOf(gl, src, 0, one)
  textureOf(gl, flowSrc, 1, one)
  const u = (n) => gl.getUniformLocation(pr, n)
  return { off: u('off'), wob: u('wob'), phase: u('phase'), mk: u('mk'), gn: u('gn'), ht: u('ht') }
}

// rect＝画面の場所（x・y・w・h）・bg＝lib/bossBg.js の bossBgOf の答え（src・flowSrc・flow）
export default function BossFlowCanvas({ bg, rect, tMs }) {
  const ref = useRef(null)
  const st = useRef(null)   // { gl, u, ready }
  const draw = () => {
    const s = st.current
    if (!s?.ready || s.gl.isContextLost()) return
    const { gl, u } = s, f = bg.flow, c = gl.canvas
    gl.viewport(0, 0, c.width, c.height)
    const p0 = (tMs / f.periodMs) % 1
    gl.uniform2f(u.off, (f.dist * bg.h) / bg.w, f.dist)
    gl.uniform2f(u.wob, f.wobble[0] / bg.w, f.wobble[1] / bg.h)
    gl.uniform2f(u.phase, p0, (p0 + 0.5) % 1)
    gl.uniform3fv(u.mk, f.mask)
    gl.uniform3fv(u.gn, f.gain)
    gl.uniform3fv(u.ht, f.hot)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  useEffect(() => {
    const canvas = ref.current
    const start = () => {
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
      if (!gl) return
      const me = { gl, u: null, ready: false }
      me.u = setup(gl, bg.src, bg.flowSrc, () => { me.ready = true })
      st.current = me.u ? me : null
    }
    const lost = (e) => { e.preventDefault(); st.current = null }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', start)
    start()
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', start)
      const gl = st.current?.gl
      st.current = null
      // 画面から消えたら WebGL を返す（開発モードの作り直しでは、同じ canvas を使い続けるので返さない）
      setTimeout(() => { if (gl && !canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext() }, 0)
    }
  }, [bg.src, bg.flowSrc])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(draw)
  // 細かくしすぎない（絵は幅1280・スマホの電池）
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5)
  const pxW = Math.min(1280, Math.round(rect.w * dpr)), pxH = Math.round((pxW * bg.h) / bg.w)
  return <canvas ref={ref} width={pxW} height={pxH} style={{ position:'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
}
