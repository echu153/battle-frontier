// ============================================================
// v2cap ATB の「技の種類ごとのモーション」の手本＝マネキン（木のデッサン人形）のスプライトシートを描く
// ------------------------------------------------------------
// 【確定】2026-11-11 ユーザー「Fable5.2にマネキンの…スプライトシートを作ってもらい、GPTimage2.6にキャラクターと一緒に渡して…」
//   ＝この道具は Fable 5.2 が書いた（ポーズの表 motions.mjs も）。ユーザーは見本の A（斜め前・待機GIFと同じ向き）を選んだ。
//   2172×724・真緑・横一列に6コマ（ChatGPT の攻撃モーションの1枚と同じ形）。どの技に使うかは plan.mjs、頼む文はプロンプト帳
//   （node tools/v2cap-skill-motion-book.mjs）。出力 out/ は git に入れない（いつでも作り直せる）
// ============================================================
// マネキン（体の動きの手本）のスプライトシートを描いて PNG にする道具。
//   node mannequin.mjs                 … 全部の技を A（斜め前）の向きで out/ に書く
//   node mannequin.mjs slash1h A       … 技と向きを選ぶ（A=斜め前 / B=真横）
// ポーズと武器の形は motions.mjs（データの表）。ここは「骨組みを解く」「描く」だけ。
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MOTIONS, WEAPONS } from './motions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── シートの決まり ─────────────────────────────────────
export const SHEET = { w: 2172, h: 724, cols: 6, colW: 362, baseY: 527, bg: [0, 255, 0] };

// ── 向き ───────────────────────────────────────────────
export const VIEWS = {
  A: { label: '斜め前', yaw: 35 },
  B: { label: '真横', yaw: 0 },
};

// ── 人形の寸法（px・立ったときの背が約330）────────────────────
const B = {
  ankleH: 12, shin: 42, thigh: 46,         // 足首の高さ・すね・もも
  torso: 86,                               // 股関節 → 肩の線
  neckToHead: 78, headR: 66,               // 肩の線 → 頭のまん中・頭の半径
  hipW: 18, shW: 31,                       // 股関節・肩の、まん中からの横の離れ
  uArm: 48, fArm: 46, handR: 10.5,
  rThigh: [15.5, 13], rShin: [12.5, 10], rUArm: [11.5, 10], rFArm: [9.5, 8],
  rShoulder: 12.5, rElbow: 9, rHip: 14, rKnee: 11.5, rAnkle: 8.5,
  footBack: 7, footFront: 25, rFoot: [9, 7.5],
  rChest: 23, rPelvis: 21, rWaist: 15, rNeck: 9,
  noseR: 8.5,
};

// ── 色 ─────────────────────────────────────────────────
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const COL = {
  line: hex('#4a3220'),
  N: { fill: hex('#f6e3bd'), joint: hex('#e2bf86') },   // 手前＝明るい
  M: { fill: hex('#ddbd8a'), joint: hex('#c39a62') },   // 胴と頭
  F: { fill: hex('#a67f52'), joint: hex('#86633c') },   // 奥＝一段濃い
  nose: hex('#c98a4e'),
};
const OUTLINE = 2.6;

// ── 計算の小道具 ───────────────────────────────────────
const D = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// 横から見た面の角度 a（0=下・90=前・180=上）と、外への開き s から向きを作る
const dir = (a, s, side) => [Math.sin(a * D) * Math.cos(s * D), -Math.cos(a * D) * Math.cos(s * D), side * Math.sin(s * D)];
// たての軸まわりに回す（＋でこちら＝見る人のほうへ向く）
const rotY = (v, t) => { const c = Math.cos(t * D), s = Math.sin(t * D); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; };
// 前へ倒す（＋で前かがみ）
const pitch = (v, t) => { const c = Math.cos(t * D), s = Math.sin(t * D); return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]; };

// 2本の骨（腕・脚）を、付け根 S と先の行き先 T から解く。まん中の関節は pole の向きへ出る
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len3 = (a) => Math.hypot(a[0], a[1], a[2]);
function ik2(S, T, l1, l2, pole) {
  let v = sub3(T, S), d = len3(v), short = 0; const max = l1 + l2 - 0.5, min = Math.abs(l1 - l2) + 2;
  if (d > max) { short = d - max; v = mul(v, max / d); d = max; }
  if (d < min) { v = mul(d < 1e-6 ? [1, 0, 0] : v, min / Math.max(d, 1e-6)); d = min; }
  const u = mul(v, 1 / d), a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub3(pole, mul(u, pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2])); p = len3(p) < 1e-6 ? [0, -1, 0] : mul(p, 1 / len3(p));
  return { mid: add(S, add(mul(u, a), mul(p, h))), end: add(S, v), short };
}

// ── 骨組みを解く：ポーズ → 描く部品の並び（体の座標・股関節のまん中が原点）────
function solve(pose, motion) {
  const parts = [];
  const lean = pose.lean || 0, twist = pose.twist || 0, hipTw = pose.hipTwist || 0;
  const root = [0, 0, 0];
  const spine = [Math.sin(lean * D), Math.cos(lean * D), 0];
  const cap = (a, b, ra, rb, tone, kind = 'fill', bias = 0) => parts.push({ t: 'cap', a, b, ra, rb, col: COL[tone][kind], bias });
  const ball = (c, r, tone, kind = 'joint', bias = 2) => parts.push({ t: 'ball', c, r, col: COL[tone][kind], bias });

  // 脚（角度で形を決めたあと、浮いたほうの足は足首をまっすぐ下ろして地面に付ける。leg に air:1 と書けば浮かせたまま）
  const ankles = {}, lows = []; let lowest = Infinity;
  const legs = [['N', 1, pose.legN], ['F', -1, pose.legF]].map(([key, side, L]) => {
    const out = L.out || 0, knee = Math.max(0, L.knee || 0);
    const hip = rotY([0, 0, side * B.hipW], hipTw);
    const kn = add(hip, mul(rotY(dir(L.hip, out, side), hipTw), B.thigh));
    const an = add(kn, mul(rotY(dir(L.hip - knee, out, side), hipTw), B.shin));
    const fp = L.foot || 0;
    const fwd = rotY([Math.cos(fp * D), -Math.sin(fp * D), 0], hipTw), dn = rotY([-Math.sin(fp * D), -Math.cos(fp * D), 0], hipTw);
    const ho = add(mul(fwd, -B.footBack), mul(dn, B.ankleH - B.rFoot[0])), to = add(mul(fwd, B.footFront), mul(dn, B.ankleH - B.rFoot[1]));
    const low = Math.min(an[1] + ho[1] - B.rFoot[0], an[1] + to[1] - B.rFoot[1]);
    return { key, side, L, hip, kn, an, ho, to, low };
  });
  lowest = Math.min(legs[0].low, legs[1].low);
  for (const g of legs) {
    const up = g.low - lowest;
    if (up > 0.5 && !g.L.air) {
      const r = ik2(g.hip, add(g.an, [0, -up, 0]), B.thigh, B.shin, rotY([1, 0.15, g.side * 0.15], hipTw));
      g.kn = r.mid; g.an = r.end; g.low = Math.min(g.an[1] + g.ho[1] - B.rFoot[0], g.an[1] + g.to[1] - B.rFoot[1]);
    }
    lows.push(g.low); ankles[g.key] = g.an;
    cap(g.hip, g.kn, B.rThigh[0], B.rThigh[1], g.key);
    cap(g.kn, g.an, B.rShin[0], B.rShin[1], g.key);
    cap(add(g.an, g.ho), add(g.an, g.to), B.rFoot[0], B.rFoot[1], g.key, 'fill', -1);
    ball(g.hip, B.rHip, g.key); ball(g.kn, B.rKnee, g.key); ball(g.an, B.rAnkle, g.key);
  }

  // 胴
  const off = (z, k = 1) => pitch(rotY([0, 0, z * k], twist), lean);
  const chestC = add(root, mul(spine, B.torso));
  const chestTop = add(root, mul(spine, B.torso - 6)), chestLow = add(root, mul(spine, 44));
  const hipN = rotY([0, 0, B.hipW], hipTw), hipF = rotY([0, 0, -B.hipW], hipTw);
  parts.push({ t: 'poly', pts: [hipN, hipF, add(root, mul(spine, 12))], r: B.rPelvis, col: COL.M.fill, bias: -8 });
  ball(add(root, mul(spine, 30)), B.rWaist, 'M', 'joint', -7);
  parts.push({
    t: 'poly', r: B.rChest, col: COL.M.fill, bias: -6,
    pts: [add(chestTop, off(B.shW - 8)), add(chestTop, off(-(B.shW - 8))), add(chestLow, off(-(B.shW - 14))), add(chestLow, off(B.shW - 14))],
  });
  cap(add(chestC, mul(spine, 2)), add(chestC, mul(spine, 16)), B.rNeck, B.rNeck, 'M', 'joint', -5);

  // 頭（顔の向きの線と鼻先）
  const hl = lean * 0.45 + (pose.headLean || 0);
  const headC = add(chestC, mul([Math.sin(hl * D), Math.cos(hl * D), 0], B.neckToHead));
  const nod = pose.headNod ?? lean * 0.3, hyaw = twist * 0.3 + (pose.headTurn || 0);
  const onHead = (az, el, r = B.headR) => {
    const p = [Math.cos(el * D) * Math.cos(az * D) * r, Math.sin(el * D) * r, Math.cos(el * D) * Math.sin(az * D) * r];
    return add(headC, rotY(pitch(p, nod), hyaw));
  };
  const lines = [];
  { const l = []; for (let az = -80; az <= 80; az += 8) l.push(onHead(az, -6)); lines.push(l); }   // 目の高さの横線
  { const l = []; for (let el = -62; el <= 78; el += 7) l.push(onHead(0, el)); lines.push(l); }    // 顔のまん中のたて線
  parts.push({ t: 'head', c: headC, r: B.headR, col: COL.M.fill, bias: -4, lines, nose: onHead(0, -14, B.headR + 3) });

  // 腕と武器
  const SIDE = { N: 1, F: -1 }, KEYS = ['N', 'F'];
  const shoulder = { N: add(chestC, off(B.shW)), F: add(chestC, off(-B.shW)) };
  const arms = {}, warn = [];
  // 角度で決まる腕
  const fk = (key) => {
    const A = pose['arm' + key], side = SIDE[key], tw = A.w ? 0 : twist;
    const out = A.out || 0, fout = A.fout ?? out, el = Math.max(0, A.el || 0), fa = A.sh + el;
    const eb = add(shoulder[key], mul(rotY(dir(A.sh, out, side), tw), B.uArm));
    return { eb, hd: add(eb, mul(rotY(dir(fa, fout, side), tw), B.fArm)), fa, fout, tw };
  };
  // 手の行き先から腕を決める（ひじは pole の向きへ出る。届かないときは伸ばしきった所まで）
  const ik = (key, T, pole) => {
    const r = ik2(shoulder[key], T, B.uArm, B.fArm, pole || [-0.35, -1, SIDE[key] * 0.6]);
    if (r.short > 1) warn.push(`${key}の手が ${Math.round(r.short)}px 届かない`);
    return { eb: r.mid, hd: r.end, fa: Math.atan2(r.end[0] - r.mid[0], -(r.end[1] - r.mid[1])) / D, fout: 0, tw: 0 };
  };
  const isHold = (A) => A.hold != null;
  for (const key of KEYS) { const A = pose['arm' + key]; if (A.to) arms[key] = ik(key, add(chestC, A.to), A.pole); else if (!isHold(A)) arms[key] = fk(key); }

  // 持ち物の置き場所（o=原点・d=武器の向き・n=それに直角）
  const frames = {}, w = pose.weapon || {};
  if (motion.sheath) {
    const sp = { abs: -58, ...(motion.sheathAt || {}), ...(pose.sheath || {}) };
    frames.sheath = { o: rotY([sp.x ?? 22, sp.y ?? 14, -(B.hipW + 12)], hipTw), d: rotY(dir(sp.abs, 0, -1), hipTw), n: rotY(dir(sp.abs + 90, 0, -1), hipTw) };
  }
  const hasWeapon = motion.weapon && !w.hide, wdef = WEAPONS[motion.weapon];
  if (hasWeapon) {
    if (w.at === 'sheath') {
      const s = frames.sheath; frames.weapon = { o: add(s.o, mul(s.d, -(wdef.guardU || 0))), d: s.d, n: s.n };
    } else {
      const k = motion.hand, a = arms[k], side = SIDE[k];
      if (!a) throw new Error('武器を持つ手は hold にできない（at:"sheath" のとき以外）');
      let d, n;
      if (w.abs != null) { d = dir(w.abs, w.out || 0, side); n = dir(w.abs + 90, 0, side); }
      else { const ang = a.fa + (w.ang || 0); d = rotY(dir(ang, w.out ?? a.fout, side), a.tw); n = rotY(dir(ang + 90, 0, side), a.tw); }
      let o = add(a.hd, mul(d, -(w.grip || 0))); if (w.fly) o = add(o, [w.fly[0], w.fly[1], 0]);
      frames.weapon = { o, d, n };
    }
  }
  // 持ち物をつかむ腕
  for (const key of KEYS) {
    const A = pose['arm' + key]; if (!isHold(A)) continue;
    const f = frames[A.on || 'weapon']; if (!f) throw new Error(`arm${key}.hold の相手（${A.on || 'weapon'}）がこのコマに無い`);
    const [u, v] = Array.isArray(A.hold) ? A.hold : [A.hold, 0];
    arms[key] = ik(key, add(f.o, add(mul(f.d, u), mul(f.n, v))), A.pole); arms[key].onWeapon = (A.on || 'weapon') === 'weapon';
  }
  // 手前に描くか：技の front（省くと「手前の手で持つ武器」は手前）。コマの weapon.back で体の後ろへ
  const frontOn = motion.front ?? motion.hand === 'N';
  const wBias = w.back ? -40 : frontOn ? 25 : 0;
  for (const key of KEYS) {
    const a = arms[key], sh = shoulder[key];
    cap(sh, a.eb, B.rUArm[0], B.rUArm[1], key);
    cap(a.eb, a.hd, B.rFArm[0], B.rFArm[1], key);
    ball(sh, B.rShoulder, key); ball(a.eb, B.rElbow, key);
    const touching = hasWeapon && !w.fly && (a.onWeapon || (motion.hand === key && w.at !== 'sheath'));
    ball(a.hd, B.handR, key, 'fill', 3 + (touching ? wBias : 0));
  }
  if (frames.sheath) parts.push({ t: 'weapon', ...frames.sheath, def: WEAPONS[motion.sheath], w: {}, bias: 0.5 });
  if (hasWeapon) parts.push({ t: 'weapon', ...frames.weapon, def: wdef, w, hiltOnly: w.at === 'sheath', bias: w.at === 'sheath' ? 22 : 1 + wBias });
  return { parts, lowest, plant: ankles[motion.plant || 'F'], headTop: headC[1] + B.headR, warn, lift: Math.abs(lows[0] - lows[1]) };
}

// ── 画素に描く（距離から「覆う割合」を出して縁をなめらかに）────────────
function makeImage(w, h, bg) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  return { w, h, px };
}
function paint(img, sdf, box, col, alpha = 1) {
  const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(img.w - 1, Math.ceil(box[2])), y1 = Math.min(img.h - 1, Math.ceil(box[3]));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = sdf(x + 0.5, y + 0.5);
    if (d >= 0.5) continue;
    const a = Math.min(1, 0.5 - d) * alpha, i = (y * img.w + x) * 4;
    img.px[i] += (col[0] - img.px[i]) * a; img.px[i + 1] += (col[1] - img.px[i + 1]) * a; img.px[i + 2] += (col[2] - img.px[i + 2]) * a;
  }
}
// 両はしの太さが違うカプセル
function sdCapsule(px, py, a, b, ra, rb) {
  const bx = b[0] - a[0], by = b[1] - a[1], h = Math.hypot(bx, by);
  const ax = px - a[0], ay = py - a[1];
  if (h < 1e-6 || h <= Math.abs(ra - rb)) return ra >= rb ? Math.hypot(ax, ay) - ra : Math.hypot(px - b[0], py - b[1]) - rb;
  const y = (ax * bx + ay * by) / h, x = Math.abs(ax * by - ay * bx) / h;
  const sb = (ra - rb) / h, sa = Math.sqrt(1 - sb * sb), k = -sb * x + sa * y;
  if (k < 0) return Math.hypot(x, y) - ra;
  if (k > sa * h) return Math.hypot(x, y - h) - rb;
  return x * sa + y * sb - ra;
}
function sdPoly(px, py, P) {
  let d = Infinity, s = 1;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1], wx = px - P[i][0], wy = py - P[i][1];
    const ee = ex * ex + ey * ey, t = ee > 1e-9 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / ee)) : 0;
    const qx = wx - ex * t, qy = wy - ey * t; d = Math.min(d, qx * qx + qy * qy);
    const c1 = py >= P[i][1], c2 = py < P[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
const boxOf = (pts, pad) => [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad, Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad];
let BOUNDS = null;
function solid(img, sdf, box, col, ow = OUTLINE) {
  if (BOUNDS) { const p = 4 - ow; BOUNDS[0] = Math.min(BOUNDS[0], box[0] + p); BOUNDS[1] = Math.min(BOUNDS[1], box[1] + p); BOUNDS[2] = Math.max(BOUNDS[2], box[2] - p); BOUNDS[3] = Math.max(BOUNDS[3], box[3] - p); }
  paint(img, (x, y) => sdf(x, y) - ow, box, COL.line);
  paint(img, sdf, box, col);
}

// ── 1コマを描く ───────────────────────────────────────
function drawFrame(img, pose, motion, view, cx, plantX) {
  const s = solve(pose, motion);
  BOUNDS = [Infinity, Infinity, -Infinity, -Infinity];
  const yaw = view.yaw;
  const plantScreenX = rotY(s.plant, yaw)[0];
  const ox = cx + plantX - plantScreenX, oy = SHEET.baseY + s.lowest;
  const P = (p) => { const q = rotY(p, yaw); return [ox + q[0], oy - q[1], q[2]]; };   // [画面x, 画面y, 奥行き（＋が手前）]
  const items = s.parts.map((p) => {
    let depth;
    if (p.t === 'cap') { p.A = P(p.a); p.B = P(p.b); depth = (p.A[2] + p.B[2]) / 2; }
    else if (p.t === 'ball' || p.t === 'head') { p.C = P(p.c); depth = p.C[2]; }
    else if (p.t === 'poly') { p.S = p.pts.map(P); depth = p.S.reduce((a, q) => a + q[2], 0) / p.S.length; }
    else if (p.t === 'weapon') { p.O = P(p.o); depth = p.O[2]; }
    return { p, depth: depth + (p.bias || 0) };
  }).sort((a, b) => a.depth - b.depth);

  for (const { p } of items) {
    if (p.t === 'cap') {
      solid(img, (x, y) => sdCapsule(x, y, p.A, p.B, p.ra, p.rb), boxOf([p.A, p.B], Math.max(p.ra, p.rb) + 4), p.col);
    } else if (p.t === 'ball') {
      solid(img, (x, y) => Math.hypot(x - p.C[0], y - p.C[1]) - p.r, boxOf([p.C], p.r + 4), p.col, 2);
    } else if (p.t === 'poly') {
      solid(img, (x, y) => sdPoly(x, y, p.S) - p.r, boxOf(p.S, p.r + 4), p.col);
    } else if (p.t === 'head') {
      solid(img, (x, y) => Math.hypot(x - p.C[0], y - p.C[1]) - p.r, boxOf([p.C], p.r + 4), p.col);
      for (const l of p.lines) {
        const q = l.map(P);
        for (let i = 0; i + 1 < q.length; i++) {
          if (q[i][2] - p.C[2] < 3 || q[i + 1][2] - p.C[2] < 3) continue;   // 裏がわの線は描かない
          paint(img, (x, y) => sdCapsule(x, y, q[i], q[i + 1], 1.3, 1.3), boxOf([q[i], q[i + 1]], 3), COL.line, 0.6);
        }
      }
      const n = P(p.nose);
      if (n[2] - p.C[2] > -B.noseR) solid(img, (x, y) => Math.hypot(x - n[0], y - n[1]) - B.noseR, boxOf([n], B.noseR + 4), COL.nose, 2);
    } else if (p.t === 'weapon') {
      const O = p.O, t = P(add(p.o, p.d)), nn = P(add(p.o, p.n));
      const dx = t[0] - O[0], dy = t[1] - O[1], nx = nn[0] - O[0], ny = nn[1] - O[1];
      const f = Math.hypot(dx, dy) || 1e-6, ax = dx / f, ay = dy / f;
      const sg = (-ay * nx + ax * ny) < 0 ? -1 : 1;   // ＋v が n のがわに来るように
      // ふつうは板をこちらへ向けて描く（幅がつぶれない）。flat3d の武器（弓）は向きどおりに描く
      const map = p.def.flat3d ? (u, v) => [O[0] + dx * u + nx * v, O[1] + dy * u + ny * v]
        : (u, v) => [O[0] + ax * u * f - ay * v * sg, O[1] + ay * u * f + ax * v * sg];
      for (const part of p.def.parts) {
        if (p.hiltOnly && !part.hilt) continue;   // 鞘におさめた刀は柄とつばだけ描く
        if (part.poly) { const S = part.poly.map(([u, v]) => map(u, v)); solid(img, (x, y) => sdPoly(x, y, S), boxOf(S, 4), hex(part.color), 2.2); }
        else if (part.circle) { const c = map(part.circle[0], part.circle[1]), r = part.circle[2]; solid(img, (x, y) => Math.hypot(x - c[0], y - c[1]) - r, boxOf([c], r + 4), hex(part.color), 2.2); }
      }
      if (p.def.string) {   // 弓のつると矢
        const pull = p.w.pull ?? p.def.string.rest, [a, b] = p.def.string.tips.map(([u, v]) => map(u, v)), m = map(0, pull);
        for (const [q, r] of [[a, m], [m, b]]) paint(img, (x, y) => sdCapsule(x, y, q, r, 1.3, 1.3), boxOf([q, r], 3), COL.line);
        if (p.w.arrow) {
          const L = p.def.string.arrow, tip = map(0, pull - L), neck = map(0, pull - L + 14);
          solid(img, (x, y) => sdCapsule(x, y, m, tip, 2, 2), boxOf([m, tip], 6), hex('#9a9a9a'), 1.8);
          solid(img, (x, y) => sdCapsule(x, y, neck, tip, 5.5, 1), boxOf([neck, tip], 10), hex('#c4c4c4'), 1.8);
        }
      }
    }
  }
  const b = BOUNDS; BOUNDS = null;
  return { headTop: s.headTop - s.lowest, box: b, cx, warn: s.warn, lift: s.lift };
}

// ── シート1枚 ─────────────────────────────────────────
export function renderSheet(motionKey, viewKey) {
  const motion = MOTIONS[motionKey], view = VIEWS[viewKey];
  if (!motion || !view) throw new Error(`知らない技か向き: ${motionKey} ${viewKey}`);
  const poses = Array.from({ length: SHEET.cols }, (_, i) => { const p = motion.frames[i]; return typeof p === 'number' ? motion.frames[p] : p; });
  const cxOf = (i) => SHEET.colW * i + SHEET.colW / 2;
  // 軸足の横の位置：技に plantX があればそれ。なければ、6コマぜんぶの形がいちばん列のまん中に収まる所を自動で決める
  let plantX = motion.plantX;
  if (plantX == null) {
    const tmp = makeImage(SHEET.w, SHEET.h, SHEET.bg);
    let lo = Infinity, hi = -Infinity;
    poses.forEach((p, i) => { const f = drawFrame(tmp, p, motion, view, cxOf(i), 0); lo = Math.min(lo, f.box[0] - f.cx); hi = Math.max(hi, f.box[2] - f.cx); });
    plantX = Math.round(-(lo + hi) / 2);
  }
  const img = makeImage(SHEET.w, SHEET.h, SHEET.bg);
  const heights = poses.map((p, i) => drawFrame(img, p, motion, view, cxOf(i), plantX));
  return { img, heights, plantX };
}

// コマごとの「列のはしまでの余白・足もと・背の高さ」を出す（形の枠から。となりの列のはみ出しに惑わされない）
export function report(img, frames) {
  return frames.map((f, c) => {
    const L = f.box[0] - c * SHEET.colW, R = (c + 1) * SHEET.colW - f.box[2];
    const notes = [...f.warn];
    if (L < 0 || R < 0) notes.push('★となりの列にかかる'); else if (L < 14 || R < 14) notes.push('列のはしに近い');
    if (f.box[3] > SHEET.baseY + 6) notes.push(`基準線より ${Math.round(f.box[3] - SHEET.baseY)}px 下に出る`);
    if (f.lift > 6) notes.push(`浮いた足 ${Math.round(f.lift)}px`);
    return { コマ: c + 1, 左: Math.round(f.box[0] - f.cx), 右: Math.round(f.box[2] - f.cx), 左の余白: Math.round(L), 右の余白: Math.round(R), 上: Math.round(f.box[1]), 下: Math.round(f.box[3]), 背: Math.round(f.headTop), 注意: notes.join('／') };
  });
}

export function writePng(img, file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.w}x${img.h}`, '-i', '-', '-frames:v', '1', file], { input: Buffer.from(img.px.buffer), maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('ffmpeg: ' + String(r.stderr));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mArg, vArg] = process.argv.slice(2);
  const outDir = path.join(HERE, 'out'); mkdirSync(outDir, { recursive: true });
  for (const m of mArg ? [mArg] : Object.keys(MOTIONS)) for (const v of vArg ? [vArg] : ['A']) {
    const { img, heights, plantX } = renderSheet(m, v);
    const file = path.join(outDir, `mannequin-${m}-${v}.png`);
    writePng(img, file);
    console.log(`${file}  （${MOTIONS[m].label}・${VIEWS[v].label}・軸足は列のまん中から ${plantX}）`);
    for (const r of report(img, heights)) console.log('  ' + Object.entries(r).map(([k, x]) => `${k} ${x}`).join('  '));
  }
}
