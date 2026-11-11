// 全部の技のシートを半分に縮めて縦に並べた一覧（out/contact-A.png・幅1086）を作る。
//   node contact.mjs [向き]     先に node mannequin.mjs でシートを書いておく
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MOTIONS } from './motions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const view = process.argv[2] || 'A';
const ids = Object.keys(MOTIONS);
const args = ['-v', 'error', '-y'];
for (const id of ids) args.push('-i', path.join(HERE, 'out', `mannequin-${id}-${view}.png`));
const chain = ids.map((_, i) => `[${i}:v]scale=1086:362:flags=area[s${i}]`).join(';') + ';' + ids.map((_, i) => `[s${i}]`).join('') + `vstack=inputs=${ids.length}`;
const out = path.join(HERE, 'out', `contact-${view}.png`);
const r = spawnSync('ffmpeg', [...args, '-filter_complex', chain, '-frames:v', '1', out]);
if (r.status !== 0) throw new Error(String(r.stderr));
console.log(out + '\n上から: ' + ids.map((id) => `${id}（${MOTIONS[id].label}）`).join(' / '));
