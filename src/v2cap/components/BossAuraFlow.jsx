import { useEffect, useRef, useState } from 'react'
import { GRAIN_SIZE, grainOf } from '../lib/bossBg.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ボスの後ろで燃え続けるオーラ（HPの節目のバフのあと・WebGL）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「びりびりが変すぎる」「もうちょっと体のうちから出るオーラみたいにしてほしい」：
//   描いてもらったオーラの絵（逆鱗_オーラ）を、付いた瞬間だけでなく、付いているあいだずっと竜の後ろで燃やす。
//   絵を動かすのではなく、読む所を流れるムラでずらす（炎が下から上へ立ちのぼる・上ほど大きく揺れてちぎれる・足元の輪はほとんど消えない）。
//   絵の中の稲妻の筋（g が大きい所）は細かく明滅する。WebGL が使えない・絵がまだ貼れていないあいだは <img> のまま。描く時刻は親から（止めて確かめられる）
//   軽い表示（lite）：絵の0.75倍の細かさ・1秒30回
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
uniform sampler2D grain;
uniform float t;      // 秒
uniform float amp;    // 揺らぎの大きさ（絵の割合）
uniform float pad;    // 絵のまわりの余白（canvas の割合）
void main() {
  vec2 p = (v - pad) / (1.0 - 2.0 * pad);
  float up = clamp(1.0 - p.y, 0.0, 1.0);
  float a = texture2D(grain, vec2(p.x * 0.28, p.y * 0.28 + t * 0.13)).r - 0.5;
  float b = texture2D(grain, vec2(p.x * 0.7 + 0.37, p.y * 0.7 + t * 0.31)).g - 0.5;
  float w = amp * (0.35 + 0.65 * up);
  vec4 c = texture2D(img, p + vec2(a + 0.5 * b, b + 0.5 * a) * w * 2.0);
  if (c.a < 0.004) { gl_FragColor = vec4(0.0); return; }
  float m = texture2D(grain, vec2(p.x * 0.45 + 0.11, p.y * 0.45 + t * 0.2)).r;
  float lick = smoothstep(0.18, 0.55, m + 0.45 * (1.0 - up));
  float fr = floor(t * 18.0);
  float sp = texture2D(grain, vec2(p.x * 0.6 + fract(fr * 0.137), p.y * 0.6 + fract(fr * 0.271))).g;
  float vein = smoothstep(0.3, 0.75, c.g) * (smoothstep(0.35, 0.7, sp) * 1.5 - 0.35);
  vec3 col = c.rgb + vec3(1.0, 0.8, 0.7) * vein * 0.7;
  float al = c.a * lick;
  gl_FragColor = vec4(col * al, al);
}
`
const shader = (gl, type, src) => {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
}
// 用意（失敗したら null）
const setup = (gl, im) => {
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
  gl.uniform1i(gl.getUniformLocation(pr, 'grain'), 1)
  gl.clearColor(0, 0, 0, 0)
  const param = (wrap) => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRAIN_SIZE, GRAIN_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, grainOf())
  param(gl.REPEAT)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im)
  param(gl.CLAMP_TO_EDGE)
  const u = (n) => gl.getUniformLocation(pr, n)
  return { t: u('t'), amp: u('amp'), pad: u('pad') }
}

// 炎が絵の外へ少しはみ出してもよいように、canvas は絵より広い（canvas の幅に対する片側の割合）
const PAD = 0.08

// base＝立ち絵の大きさ（p の x・y・w・h の単位）・p＝オーラの絵（src・x・y・w・h）・amp＝揺らぎの大きさ・op＝濃さ・tMs＝時計（ミリ秒）
export default function BossAuraFlow({ base, p, amp, op, tMs, lite = false }) {
  const ref = useRef(null)
  const st = useRef(null)   // { gl, u }
  const [ready, setReady] = useState(false)
  const t = (lite ? Math.floor(tMs / 33) * 33 : tMs) / 1000
  const draw = () => {
    const s = st.current
    if (!s || s.gl.isContextLost()) return
    const { gl, u } = s
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    // 時計が大きくなりすぎると細かさが足りなくなる（ムラの1周は整数の秒ではないので、十分長い周期で丸める）
    gl.uniform1f(u.t, t % 4000)
    gl.uniform1f(u.amp, amp)
    gl.uniform1f(u.pad, PAD)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  useEffect(() => {
    const canvas = ref.current
    let off = false
    const im = new Image()
    const start = () => {
      if (off || !im.naturalWidth) return
      const scale = (lite ? 0.75 : 1) / (1 - 2 * PAD)
      canvas.width = Math.round(im.naturalWidth * scale)
      canvas.height = Math.round(im.naturalHeight * scale)
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
      const u = gl ? setup(gl, im) : null
      st.current = u ? { gl, u } : null
      setReady(!!u)
    }
    const lost = (e) => { e.preventDefault(); st.current = null; setReady(false) }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', start)
    im.onload = start
    im.src = p.src
    return () => {
      off = true
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', start)
      const gl = st.current?.gl
      st.current = null
      // 画面から消えたら WebGL を返す（開発モードの作り直しでは、同じ canvas を使い続けるので返さない）
      setTimeout(() => { if (gl && !canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext() }, 0)
    }
  }, [p.src, lite])
  useEffect(draw)
  const at = (x, y, w, h) => ({ position:'absolute', left:`${(x / base) * 100}%`, top:`${(y / base) * 100}%`, width:`${(w / base) * 100}%`, height:`${(h / base) * 100}%`, maxWidth:'none', pointerEvents:'none' })
  const ex = (PAD / (1 - 2 * PAD)) * p.w, ey = (PAD / (1 - 2 * PAD)) * p.h
  return (
    <>
      {!ready && <img src={p.src} alt="" draggable={false} decoding="sync" style={{ ...at(p.x, p.y, p.w, p.h), userSelect:'none', opacity: op }} />}
      <canvas ref={ref} style={{ ...at(p.x - ex, p.y - ey, p.w + 2 * ex, p.h + 2 * ey), opacity: op < 1 ? op : undefined, visibility: ready ? undefined : 'hidden' }} />
    </>
  )
}
