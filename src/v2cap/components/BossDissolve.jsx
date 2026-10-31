import { useEffect, useRef, useState } from 'react'
import { GRAIN_SIZE, grainOf } from '../lib/bossBg.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 倒れたボスの絵が消えていく（lib/bossDeath.js の burn・WebGL）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザーが選んだ「ボスの倒れる動き」：倒れた絵（ポーズの絵1枚）の光が消えて（ash）、ムラのとおりに少しずつ消える（k）。
//   消える境目のふちが光る（黒龍＝燃えて灰になる・雨摩座＝水になって崩れる）。消える順はボスごと（d.burn の weights＝ムラ・外から・下から〔−で上から〕）。
//   WebGL が使えない・絵がまだ貼れていないあいだは <img> を薄くするだけ。描く時刻は親から（止めて確かめられる）
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
uniform float k;      // 消えた割合
uniform float ash;    // 光が消えた割合
uniform vec3 wg;      // 消える順の重み（ムラ・外から・下から）
uniform vec2 ctr;     // いちばんあとまで残る所（絵の割合）
uniform vec3 ashC;    // 光が消えた色（明るさに掛ける）
uniform vec3 e0;      // ふちの色
uniform vec3 e1;      // ふちの芯の色
void main() {
  vec4 c = texture2D(img, v);
  if (c.a < 0.004) { gl_FragColor = vec4(0.0); return; }
  float n = texture2D(grain, v * 0.55).r * 0.6 + texture2D(grain, v * 1.6 + 0.37).g * 0.4;
  n = clamp((n - 0.5) * 2.0 + 0.5, 0.0, 1.0);
  float r = clamp(length(v - ctr) / 0.7, 0.0, 1.0);
  float hy = wg.z >= 0.0 ? wg.z * v.y : -wg.z * (1.0 - v.y);
  float h = wg.x * n + wg.y * (1.0 - r) + hy;
  float d = h - (k * 1.16 - 0.08);
  float a = k <= 0.0 ? 1.0 : smoothstep(0.0, 0.014, d);
  if (a <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float e = k <= 0.0 ? 0.0 : 1.0 - smoothstep(0.0, 0.09, d);
  float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  vec3 col = mix(c.rgb, lum * ashC, ash);
  col = mix(col, e0, smoothstep(0.15, 0.75, e));
  col = mix(col, e1, smoothstep(0.7, 1.0, e));
  float al = c.a * a;
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
  return { k: u('k'), ash: u('ash'), wg: u('wg'), ctr: u('ctr'), ashC: u('ashC'), e0: u('e0'), e1: u('e1') }
}

// base＝立ち絵の大きさ（p の x・y・w・h の単位）・p＝絵（src・x・y・w・h）・b＝def.death.burn（色と消える順）・op・k・ash＝lib/bossDeath.js の burn
export default function BossDissolve({ base, p, b, op, k, ash, lite = false }) {
  const ref = useRef(null)
  const st = useRef(null)   // { gl, u }
  const [ready, setReady] = useState(false)
  const draw = () => {
    const s = st.current
    if (!s || s.gl.isContextLost()) return
    const { gl, u } = s
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.uniform1f(u.k, k)
    gl.uniform1f(u.ash, ash)
    gl.uniform3fv(u.wg, b.weights)
    gl.uniform2fv(u.ctr, b.ctr)
    gl.uniform3fv(u.ashC, b.ashColor)
    gl.uniform3fv(u.e0, b.edge)
    gl.uniform3fv(u.e1, b.core)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  useEffect(() => {
    const canvas = ref.current
    let off = false
    const im = new Image()
    const start = () => {
      if (off || !im.naturalWidth) return
      // 絵の1倍まで（軽い表示は0.75倍）
      const scale = lite ? 0.75 : 1
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
  const at = { position:'absolute', left:`${(p.x / base) * 100}%`, top:`${(p.y / base) * 100}%`, width:`${(p.w / base) * 100}%`, height:`${(p.h / base) * 100}%`, maxWidth:'none', pointerEvents:'none' }
  return (
    <>
      {!ready && <img src={p.src} alt="" draggable={false} decoding="sync" style={{ ...at, userSelect:'none', opacity: op * (1 - k), visibility: op <= 0.001 ? 'hidden' : undefined }} />}
      <canvas ref={ref} style={{ ...at, opacity: op < 1 ? op : undefined, visibility: ready && op > 0.001 ? undefined : 'hidden' }} />
    </>
  )
}
