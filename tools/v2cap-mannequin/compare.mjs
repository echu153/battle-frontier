// 頭身の比べ絵：見本Aの①のコマを、参考の待機の絵と同じ高さに縮めて横に並べる（見やすいよう全体を3倍）。
//   node compare.mjs <待機の絵.png> [技] [向き]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderSheet, writePng, SHEET } from './mannequin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [idlePath, motion = 'slash1h', view = 'A'] = process.argv.slice(2);
const head = readFileSync(idlePath);
const iw = head.readUInt32BE(16), ih = head.readUInt32BE(20);
const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', idlePath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
if (dec.status !== 0) throw new Error(String(dec.stderr));
const idle = dec.stdout;

// 待機の絵の、キャラの上下左右（すみの色＝背景とみなす）
const bg = [idle[0], idle[1], idle[2], idle[3]];
const isBgI = (i) => (bg[3] < 10 ? idle[i + 3] < 10 : Math.abs(idle[i] - bg[0]) + Math.abs(idle[i + 1] - bg[1]) + Math.abs(idle[i + 2] - bg[2]) < 40 || idle[i + 3] < 10);
let top = ih, bot = -1, l = iw, r = -1;
for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) if (!isBgI((y * iw + x) * 4)) { top = Math.min(top, y); bot = Math.max(bot, y); l = Math.min(l, x); r = Math.max(r, x); }
const charH = bot - top + 1;

// マネキンの①のコマの上下左右
const { img } = renderSheet(motion, view);
const isBgM = (i) => img.px[i] < 40 && img.px[i + 1] > 215 && img.px[i + 2] < 40;
let mt = img.h, mb = -1, ml = SHEET.colW, mr = -1;
for (let y = 0; y < img.h; y++) for (let x = 0; x < SHEET.colW; x++) if (!isBgM((y * img.w + x) * 4)) { mt = Math.min(mt, y); mb = Math.max(mb, y); ml = Math.min(ml, x); mr = Math.max(mr, x); }
const scale = charH / (mb - mt + 1), mw = Math.ceil((mr - ml + 1) * scale);

// 並べる（左＝待機の絵そのまま・右＝縮めたマネキン。足もとの高さを合わせる）
const gap = 16, W = iw + gap + mw + gap, H = ih;
const out = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 0; out[i * 4 + 1] = 255; out[i * 4 + 2] = 0; out[i * 4 + 3] = 255; }
for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
  const i = (y * iw + x) * 4, o = (y * W + x) * 4; if (isBgI(i)) continue;
  out[o] = idle[i]; out[o + 1] = idle[i + 1]; out[o + 2] = idle[i + 2];
}
for (let y = 0; y < charH; y++) for (let x = 0; x < mw; x++) {
  // 面積でならして縮める
  const sx0 = ml + x / scale, sx1 = ml + (x + 1) / scale, sy0 = mt + y / scale, sy1 = mt + (y + 1) / scale;
  let rr = 0, gg = 0, bb = 0, n = 0;
  for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
    if (sx >= SHEET.colW || sy >= img.h) continue;
    const i = (sy * img.w + sx) * 4; rr += img.px[i]; gg += img.px[i + 1]; bb += img.px[i + 2]; n++;
  }
  const o = ((top + y) * W + iw + gap + x) * 4; out[o] = rr / n; out[o + 1] = gg / n; out[o + 2] = bb / n;
}
// 3倍（にじませない）
const K = 3, big = { w: W * K, h: H * K, px: new Uint8ClampedArray(W * K * H * K * 4) };
for (let y = 0; y < H * K; y++) for (let x = 0; x < W * K; x++) {
  const s = ((Math.floor(y / K)) * W + Math.floor(x / K)) * 4, d = (y * W * K + x) * 4;
  big.px[d] = out[s]; big.px[d + 1] = out[s + 1]; big.px[d + 2] = out[s + 2]; big.px[d + 3] = 255;
}
const file = path.join(HERE, 'out', `compare-${motion}-${view}.png`);
writePng(big, file);
console.log(file, `待機の絵のキャラの高さ ${charH}px（${iw}x${ih} の中）・マネキンの①は ${mb - mt + 1}px → ${scale.toFixed(3)} 倍`);
