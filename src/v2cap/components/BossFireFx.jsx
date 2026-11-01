import { useEffect, useRef, useState } from 'react'
import { GRAIN_SIZE, grainOf } from '../lib/bossBg.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 噴き上がる炎（閻魔の業火断罪・無間地獄・WebGL）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「断罪はもっと炎っぽく、無間地獄も炎をしっかりモーションして」：
//   描いてもらった炎の絵（1枚）を、絵のまま燃やす。絵を動かすのではなく読む所をずらす（components/BossAuraFlow.jsx と同じ考え）：
//   ・中身を上へ流す（2枚を半周期ずらして混ぜる＝つなぎ目が見えない・足元は動かさない）・流れるムラで揺らす（上ほど大きく）・上ほど舌のようにちぎれる
//   ・reveal＝下から噴き上がる先（0〜1・ふちはムラで揺れる）／burn＝終わりに上から燃え尽きる（0〜1）／hot＝噴き上がった瞬間の明るさ（0〜1）
//   WebGL が使えない・絵がまだ貼れていないあいだは <img> のまま（下からの切り抜き＝ mask）。描く時刻は親から（止めて確かめられる）
//   挑戦の前に作っておくので、出ていないあいだは隠して描かない（当たった瞬間に作ると一瞬止まる）。軽い表示（lite）：絵の0.75倍の細かさ・1秒30回
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
uniform float t;       // 秒
uniform float amp;     // 揺らぎの大きさ（絵の割合）
uniform float pad;     // 絵のまわりの余白（canvas の割合）
uniform float reveal;  // 下から噴き上がる先（0〜1）
uniform float burn;    // 上から燃え尽きる（0〜1）
uniform float hot;     // 明るさ（0〜1）
void main() {
  vec2 p = (v - pad) / (1.0 - 2.0 * pad);
  float up = clamp(1.0 - p.y, 0.0, 1.0);
  float a = texture2D(grain, vec2(p.x * 0.32, p.y * 0.32 + t * 0.42)).r - 0.5;
  float b = texture2D(grain, vec2(p.x * 0.85 + 0.37, p.y * 0.85 + t * 0.95)).g - 0.5;
  float w = amp * (0.2 + 0.8 * up);
  vec2 q = p + vec2(a + 0.6 * b, 0.5 * b) * w * 2.0;
  float f1 = fract(t * 1.1);
  float f2 = fract(t * 1.1 + 0.5);
  float L = 0.24 * smoothstep(0.0, 0.3, up);
  vec4 c = mix(texture2D(img, q + vec2(0.0, f1 * L)), texture2D(img, q + vec2(0.0, f2 * L)), abs(2.0 * f1 - 1.0));
  if (c.a < 0.004) { gl_FragColor = vec4(0.0); return; }
  float n = texture2D(grain, vec2(p.x * 0.55 + 0.11, p.y * 0.45 + t * 0.7)).r;
  float vis = smoothstep(0.0, 0.14, reveal * 1.3 - up - (n - 0.5) * 0.35);
  float lick = smoothstep(0.1 + burn * 1.05, 0.46 + burn * 1.05, n + 0.55 * (1.0 - up));
  float fr = floor(t * 16.0);
  float sp = texture2D(grain, vec2(p.x * 0.6 + fract(fr * 0.137), p.y * 0.6 + fract(fr * 0.271))).g;
  vec3 col = c.rgb * (1.0 + hot * 0.55 + (sp - 0.5) * 0.22);
  float al = c.a * vis * lick;
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
  return { t: u('t'), amp: u('amp'), pad: u('pad'), reveal: u('reveal'), burn: u('burn'), hot: u('hot') }
}

// 炎が絵の外へ少しはみ出してもよいように、canvas は絵より広い（canvas の幅に対する片側の割合）
const PAD = 0.06

// src＝炎の絵・left・top・w・h＝絵を置く所（親の px）・on＝出している・reveal・burn・hot（上の説明）・op＝濃さ・amp＝揺らぎの大きさ・tMs＝時計（ミリ秒）
export default function BossFireFx({ src, left, top, w, h, on, reveal = 1, burn = 0, hot = 0, op = 1, amp = 0.05, tMs = 0, lite = false }) {
  const ref = useRef(null)
  const st = useRef(null)   // { gl, u }
  const [ready, setReady] = useState(false)
  const t = (lite ? Math.floor(tMs / 33) * 33 : tMs) / 1000
  const draw = () => {
    const s = st.current
    if (!on || !s || s.gl.isContextLost()) return
    const { gl, u } = s
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.uniform1f(u.t, t % 4000)
    gl.uniform1f(u.amp, amp)
    gl.uniform1f(u.pad, PAD)
    gl.uniform1f(u.reveal, reveal)
    gl.uniform1f(u.burn, burn)
    gl.uniform1f(u.hot, hot)
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
    im.src = src
    return () => {
      off = true
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', start)
      const gl = st.current?.gl
      st.current = null
      // 画面から消えたら WebGL を返す（開発モードの作り直しでは、同じ canvas を使い続けるので返さない）
      setTimeout(() => { if (gl && !canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext() }, 0)
    }
  }, [src, lite])
  useEffect(draw)
  const ex = (PAD / (1 - 2 * PAD)) * w, ey = (PAD / (1 - 2 * PAD)) * h
  const p = Math.min(112, reveal * 112)
  return (
    <>
      {on && !ready && <img src={src} alt="" draggable={false} decoding="sync" style={{ position:'absolute', left, top, width: w, height: h, maxWidth:'none', userSelect:'none', pointerEvents:'none', opacity: op * (1 - burn),
        maskImage:`linear-gradient(to top, #000 ${Math.max(0, p - 12).toFixed(1)}%, transparent ${p.toFixed(1)}%)`, WebkitMaskImage:`linear-gradient(to top, #000 ${Math.max(0, p - 12).toFixed(1)}%, transparent ${p.toFixed(1)}%)` }} />}
      <canvas ref={ref} style={{ position:'absolute', left: left - ex, top: top - ey, width: w + 2 * ex, height: h + 2 * ey, maxWidth:'none', pointerEvents:'none', opacity: op < 1 ? op : undefined, visibility: on && ready ? undefined : 'hidden' }} />
    </>
  )
}
