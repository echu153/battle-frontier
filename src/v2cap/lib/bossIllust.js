// ============================================================
// 「レベルキャップあり」版（v2cap）— ダンジョンのボスのイラスト版（大きなイラスト＋パーツを画面で動かす・グラブル型）
// ------------------------------------------------------------
// 【確定】2026-10-28 ユーザー「ATBの敵はグラブルの戦闘みたいにどんと大きく、かつこんな感じのイラストで」→「イラスト＋パーツで行きたい」
//   →「今のドット絵VERも試したいから、それぞれ分けて作れるようにして」→「イラスト版も作ったからドット絵版は別バージョンで作っておいて」
//   ＝試し撃ちで「イラスト版／ドット絵版」を選べる（はじめはイラスト版）。ドット絵版は lib/bossArt.js のまま
//   元の絵（ユーザーが ChatGPT で作って置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/イラスト版/
//     立ち絵.png … 戦闘用の全身（パーツを重ねる目安。画面には出さない）
//     体.png・頭.png・翼_手前.png（・翼_奥.png）… パーツ。ChatGPT は立ち絵と同じ大きさ・場所には描かない
//       ＝道具（tools/v2cap-boss-illust.mjs）が形と溶岩の筋の明るさで、倍率・角度・位置を探して立ち絵に重ねる
//       翼_奥.png が無ければ、立ち絵からほかのパーツを除いた残り（左上の翼）を切り出す。頭の後ろに隠れていた穴はまわりの色で埋める
//     <技の名前>_飛ぶ.png・<技の名前>_当たる.png … 塗りのエフェクト（1つにつき1枚・動きは画面で付ける）
//   画面で使う版：public/v2cap-art/boss/<key>-il-<パーツ>.webp・<key>-il-fx-<技>-<fly|hit>.webp、一覧は bossIllustList.js（道具が書く）
// 動かし方（このファイルの illustPoseAt・純関数）：
//   待機＝翼を付け根から回して羽ばたく（振り下ろしは速く）・体が上下に浮き沈み・首が少し揺れる
//   技＝決まった姿勢（キーフレーム）のあいだをなめらかにつなぐ。当たる時刻（hitMs）に飛ぶエフェクトが口から出る
//     黒爪＝身を引いてから前へ踏み込む／焦熱の吐息＝首を引いて口に火をため、突き出して吐く／
//     黒翼烈風＝翼を高く上げて叩きつける／終焉の黒焔＝のけぞって大きくため、突き出して撃つ
//   【確定】2026-10-28 ユーザー「爪攻撃のときもっとひっかくモーションが欲しい」「ブレス吐くときは口をしっかり開けて吐くモーションが欲しい」
//     「翼の風ももっと翼から出すように見せたい」：
//     ・前脚（arm）と下あご（jaw）を体・頭から切り分けて別に回す（cuts＝道具が 640px の立ち絵の上の多角形で切る）
//       黒爪＝前脚を振り上げて振り下ろす（爪の先に残像の筋）・当たる絵は右上から左下へ引いて出す（wipe）
//       焦熱の吐息・終焉の黒焔＝下あごを大きく開けて吐く（開いた口の中は画面で描く・火は口の中から出る）
//     ・黒翼烈風＝両方の翼のふちに風の筋（残像）・飛ぶ絵は口でなく翼から（shots＝相手に近い奥の翼の先とふちから2つ）
// ============================================================
import { BOSS_ILLUST } from './bossIllustList.js'
import { BOSS_DEFS, BOSS_ART_DIR, bossFileOf, bossArtOf } from './bossArt.js'

export const BOSS_ILLUST_SRC = 'イラスト版'   // 元の絵のフォルダの中
export const BOSS_ILLUST_SIZE = 640          // 立ち絵の大きさ（画面で使う版・正方形のpx）。パーツの位置はこの大きさで持つ
// 奥から手前へ重ねる順。arm（前脚）・jaw（下あご）は体・頭から切り分けたパーツ（元の絵は無い）。
//   下あごは頭の中に重ねる（頭といっしょに回る）。前脚は頭より手前（振り上げた爪が頭に隠れない・頭に覆われていた付け根は道具が除く＝over）
export const ILLUST_PARTS = ['wingF', 'wingN', 'body', 'head', 'arm', 'jaw']
export const ILLUST_PART_FILES = { wingF: '翼_奥', wingN: '翼_手前', body: '体', head: '頭' }

export const illustKindOf = (part) => `il-${part}`
export const illustFxKindOf = (motion, kind) => `il-fx-${motion}-${kind}`
const srcOf = (key, kind) => {
  const v = BOSS_ILLUST[key]?.v?.[kind]
  return `${BOSS_ART_DIR}/${bossFileOf(key, kind)}${v ? `?v=${v}` : ''}`
}

// 姿勢：x・y＝全体のずれ（枠の大きさに対する割合）／r＝全体の角度（°・時計回り）／head＝首の角度／wingN・wingF＝翼の角度／
//   arm＝前脚の角度（＋で爪が上がる）／jaw＝下あごの角度（−で開く）／glow＝口の火（0〜1）
const ZERO = { x: 0, y: 0, r: 0, head: 0, wingN: 0, wingF: 0, arm: 0, jaw: 0, glow: 0 }
// 技ごとの動き：keys＝[時刻ミリ秒, 姿勢（待機に足す）]・hitMs＝当たる（撃ち出す）時刻
//   trails＝残像の筋（part のパーツの点 pts を、lagMs 前からいまの時刻までたどる。fromMs〜toMs のあいだだけ・kind＝claw 爪／wind 風）
//   shots＝飛ぶ絵の出どころ（無ければ口から1つ）。{ part, pt（パーツの点）, delayMs（hitMs からの遅れ）, size（飛ぶ絵の大きさの倍率） }
export const BOSS_ILLUST_DEFS = {
  varuzenoku: {
    // 待機：1回の羽ばたき（ミリ秒）・翼の振れ幅（°・上げきり→下ろしきり）・体の浮き沈み（枠の割合）
    idle: { periodMs: 1200, wingUp: -12, wingDown: 14, bob: 0.012, headSway: 1.5, armSway: 2 },
    // 切り分け（立ち絵 640px の上の点）：take＝切り出す所・drop＝親から消す所（無ければ take と同じ）・pivot＝回す中心（付け根）
    //   前脚：take を drop より付け根の側へ広く取る＝付け根は親にも残り、前脚を回してもすき間が見えない
    //   over＝そのパーツより手前に出す（そのパーツに覆われていた所は切り出さない＝止まっているときは立ち絵と同じ）
//   下あご：line＝口の線（先から付け根へ）。開くと line と回した line のあいだに口の中を描く・mouth＝火が出る所（line の上の点）
    cuts: {
      arm: { from: 'body', over: 'head', pivot: [182, 343],
        take: [[44, 304], [150, 300], [172, 300], [186, 312], [194, 340], [198, 372], [196, 396], [44, 402]],
        drop: [[44, 304], [158, 300], [166, 318], [171, 345], [176, 372], [182, 396], [44, 402]] },
      jaw: { from: 'head', pivot: [114, 272],
        line: [[40, 291], [52, 286], [70, 280], [90, 274], [114, 270]],
        take: [[40, 291], [52, 286], [70, 280], [90, 274], [114, 270], [124, 282], [124, 302], [100, 307], [62, 314], [40, 314]],
        mouth: [50, 290] },
    },
    motions: {
      claw: { totalMs: 900, hitMs: 400, keys: [
        [0, {}],
        [260, { x: 0.035, y: -0.01, r: 5, head: 10, arm: 48, wingN: -12, wingF: 10, jaw: -6 }],
        [330, { x: 0.03, y: -0.01, r: 4, head: 9, arm: 54, wingN: -10, wingF: 8, jaw: -8 }],
        [400, { x: -0.11, y: 0.025, r: -8, head: -6, arm: -36, wingN: 10, wingF: -8, jaw: -16 }],
        [540, { x: -0.1, y: 0.025, r: -7, head: -5, arm: -30, wingN: 8, wingF: -6, jaw: -12 }],
        [900, {}],
      ], trails: [
        { kind: 'claw', part: 'arm', pts: [[58, 336], [55, 369], [96, 392]], fromMs: 330, toMs: 400, lagMs: 70, fadeMs: 140 },
      ] },
      breath: { totalMs: 1200, hitMs: 600, keys: [
        [0, {}],
        [440, { x: 0.025, r: 3, head: 16, glow: 0.8, jaw: -10, arm: -8 }],
        [520, { x: 0.025, r: 3, head: 17, glow: 0.9, jaw: -12, arm: -10 }],
        [600, { x: -0.045, r: -3, head: -10, glow: 1, jaw: -36, arm: -26 }],
        [900, { x: -0.04, r: -2, head: -8, glow: 0.5, jaw: -32, arm: -22 }],
        [1200, {}],
      ] },
      gale: { totalMs: 1150, hitMs: 560, keys: [
        [0, {}],
        [400, { y: -0.045, head: 5, wingN: -34, wingF: 30, arm: 8, jaw: -6 }],
        [560, { y: 0.025, head: -4, wingN: 30, wingF: -26, arm: -6, jaw: -10 }],
        [800, { y: 0.012, wingN: 20, wingF: -18 }],
        [1150, {}],
      ], trails: [
        { kind: 'wind', part: 'wingF', pts: [[18, 192], [62, 118], [130, 62], [200, 40], [268, 30]], fromMs: 420, toMs: 560, lagMs: 90, fadeMs: 180 },
        { kind: 'wind', part: 'wingN', pts: [[530, 8], [600, 92], [630, 230], [616, 330], [597, 428]], fromMs: 420, toMs: 560, lagMs: 90, fadeMs: 180 },
      ], shots: [
        { part: 'wingF', pt: [18, 192], delayMs: 0, size: 1 },
        { part: 'wingF', pt: [150, 58], delayMs: 70, size: 0.85 },
      ] },
      doom: { totalMs: 1600, hitMs: 900, keys: [
        [0, {}],
        [600, { x: 0.03, y: -0.05, r: 8, head: 18, wingN: -20, wingF: 16, glow: 1, jaw: -14, arm: 14 }],
        [760, { x: 0.035, y: -0.05, r: 8, head: 17, wingN: -22, wingF: 18, glow: 1, jaw: -16, arm: 16 }],
        [900, { x: -0.08, y: 0.02, r: -7, head: -12, wingN: 16, wingF: -12, glow: 1, jaw: -40, arm: -26 }],
        [1200, { x: -0.07, y: 0.02, r: -6, head: -10, glow: 0.4, jaw: -34, arm: -22 }],
        [1600, {}],
      ] },
    },
    // 塗りのエフェクト（元の絵の名前はドット絵版と同じ・フォルダが違う）。size＝枠の幅に対する横幅
    //   飛ぶ＝flyMs で口（か shots）から自分の体の真ん中へ／当たる＝durMs のあいだ大きくなりながら消える（spin＝回る角度°）
    //   wipe＝大きくせず、右上から左下へ引いたように出す（爪の跡）
    effects: [
      { file: '黒爪_当たる', motion: 'claw', kind: 'hit', size: 0.5, durMs: 520, spin: 0, wipe: true },
      { file: '焦熱の吐息_飛ぶ', motion: 'breath', kind: 'fly', size: 0.36, flyMs: 300 },
      { file: '焦熱の吐息_当たる', motion: 'breath', kind: 'hit', size: 0.5, durMs: 620, spin: 0 },
      { file: '黒翼烈風_飛ぶ', motion: 'gale', kind: 'fly', size: 0.42, flyMs: 360 },
      { file: '黒翼烈風_当たる', motion: 'gale', kind: 'hit', size: 0.56, durMs: 620, spin: 70 },
      { file: '終焉の黒焔_飛ぶ', motion: 'doom', kind: 'fly', size: 0.48, flyMs: 420 },
      { file: '終焉の黒焔_当たる', motion: 'doom', kind: 'hit', size: 0.72, durMs: 760, spin: 0 },
    ],
  },
}

const smooth = (k) => k * k * (3 - 2 * k)
const lerpPose = (a, b, k) => Object.fromEntries(Object.keys(ZERO).map(f => [f, (a[f] ?? 0) + ((b[f] ?? 0) - (a[f] ?? 0)) * k]))
// 技の姿勢（待機に足すぶん）。流し終わったら null
export const motionPoseAt = (keys, ms) => {
  if (ms < 0 || ms >= keys.at(-1)[0]) return null
  let i = 0
  while (i < keys.length - 2 && ms >= keys[i + 1][0]) i++
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]
  return lerpPose(p0, p1, smooth((ms - t0) / (t1 - t0)))
}
// 待機の姿勢（時刻 tMs）。振り下ろし（はじめの35%）は速く、振り上げはゆっくり
export const idlePoseAt = (idle, tMs) => {
  const ph = ((tMs % idle.periodMs) + idle.periodMs) % idle.periodMs / idle.periodMs
  const down = ph < 0.35 ? smooth(ph / 0.35) : 1 - smooth((ph - 0.35) / 0.65)
  const w = idle.wingUp + (idle.wingDown - idle.wingUp) * down
  return { ...ZERO, y: -idle.bob * down, head: idle.headSway * Math.sin(2 * Math.PI * (ph - 0.15)), wingN: w, wingF: -w * 0.8,
    arm: (idle.armSway || 0) * Math.sin(2 * Math.PI * (ph - 0.3)) }
}
// いまの姿勢：motion（bossIllustOf の motions の1つ）を流しはじめて ms たったとき。技のあいだは羽ばたきを弱める
export const illustPoseAt = (key, motion, ms, tMs) => {
  const def = BOSS_ILLUST_DEFS[key]
  const idle = idlePoseAt(def.idle, tMs)
  const add = motion ? motionPoseAt(motion.keys, ms) : null
  if (!add) return idle
  return Object.fromEntries(Object.keys(ZERO).map(f => [f, (f === 'wingN' || f === 'wingF' ? idle[f] * 0.35 : f === 'y' ? idle[f] * 0.5 : 0) + add[f]]))
}

// 点（立ち絵の px）を姿勢で動かした先（同じ px）。パーツ→親のパーツ→全体の順に回す（画面の rotate と同じ時計回り）
export const rotPoint = ([x, y], [cx, cy], deg) => {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t)
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]
}
export const illustPointAt = (key, pose, pt, part = 'head') => {
  const a = BOSS_ILLUST[key]
  let p = pt
  for (let q = part, pp = a.parts[q]; pp; q = pp.parent, pp = a.parts[q]) p = rotPoint(p, [pp.px, pp.py], pose[q] || 0)
  p = rotPoint(p, a.pivot, pose.r)
  return [p[0] + pose.x * BOSS_ILLUST_SIZE, p[1] + pose.y * BOSS_ILLUST_SIZE]
}
// 開いた口の火が出る所（頭の上の点）：口の線の上の mouth を、下あごの半分の角度だけ回す（上あごと下あごの真ん中）
export const mouthPointOf = (key, pose) => {
  const j = BOSS_ILLUST_DEFS[key]?.cuts?.jaw
  return j ? rotPoint(j.mouth, j.pivot, (pose.jaw || 0) / 2) : BOSS_ILLUST[key].mouth
}

// 残像の筋（引っかく爪・翼の風）：motion.trails の点を、少し前からいまの時刻までたどった線（立ち絵の px）
//   → [{ kind, line: [[x, y], …（古い→新しい）], alpha }]。toMs を過ぎたら fadeMs で薄れながら縮む
export const illustTrailsAt = (key, motion, ms, tMs) => {
  const out = []
  for (const tr of motion?.trails || []) {
    if (ms < tr.fromMs || ms >= tr.toMs + tr.fadeMs) continue
    const t1 = Math.min(ms, tr.toMs), t0 = Math.max(tr.fromMs, ms - tr.lagMs)
    if (t1 - t0 < 1) continue
    const n = Math.max(2, Math.ceil((t1 - t0) / 10))
    const alpha = ms <= tr.toMs ? 1 : 1 - (ms - tr.toMs) / tr.fadeMs
    const poses = Array.from({ length: n + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / n; return illustPoseAt(key, motion, t, tMs - (ms - t)) })
    for (const pt of tr.pts) out.push({ kind: tr.kind, alpha, line: poses.map(p => illustPointAt(key, p, pt, tr.part)) })
  }
  return out
}

// 画面で使う形（無ければ null）。lib/bossArt.js の bossArtOf と同じ並び（kind で見分ける）
//   { kind:'illust', key, name, base（＝640）, illust（遭遇のイラスト）, parts:[{ key, src, x, y, w, h, px, py, parent? }], pivot, mouth,
//     jaw:{ line, pivot, mouth }（口の中を描く）,
//     motions:{ <key>: { label, keys, trails, totalMs, hitMs, flyMs, impactMs, front（当たる時刻の口・px）,
//       shots:[{ front, delayMs, size }]（飛ぶ絵の出どころ・1つめが front）, fx:{ fly?, hit? } } }, srcs }
export const bossIllustOf = (key) => {
  const def = BOSS_ILLUST_DEFS[key], art = BOSS_ILLUST[key], base = BOSS_DEFS[key]
  if (!def || !art?.parts || !base) return null
  // nest＝親の中に重ねる（親が回るパーツのとき＝下あご）。前脚の親（体）は回らないので、ほかのパーツと同じ並びで重ねる
  const parts = ILLUST_PARTS.filter(p => art.parts[p]).map(p => ({ key: p, src: srcOf(key, illustKindOf(p)), ...art.parts[p],
    nest: !!art.parts[p].parent && art.parts[p].parent in ZERO }))
  const motions = {}
  for (const m of base.motions) {
    const md = def.motions[m.key]
    if (!md) continue
    const fx = {}
    let flyMs = 0
    for (const d of def.effects.filter(d => d.motion === m.key)) {
      const a = art.fx?.[m.key]?.[d.kind]
      if (!a) continue
      fx[d.kind] = { ...a, frames: 1, src: srcOf(key, illustFxKindOf(m.key, d.kind)), size: d.size, durMs: d.durMs, spin: d.spin || 0, wipe: !!d.wipe }
      if (d.kind === 'fly') flyMs = d.flyMs
    }
    const poseAt = (ms) => ({ ...ZERO, ...motionPoseAt(md.keys, ms) })
    const shots = (md.shots || [{ delayMs: 0, size: 1 }]).map(sh => {
      const p = poseAt(md.hitMs + sh.delayMs)
      const front = sh.part ? illustPointAt(key, p, sh.pt, sh.part) : illustPointAt(key, p, mouthPointOf(key, p), 'head')
      return { front: front.map(Math.round), delayMs: sh.delayMs, size: sh.size ?? 1 }
    })
    motions[m.key] = { label: m.file, keys: md.keys, trails: md.trails || [], totalMs: md.totalMs, hitMs: md.hitMs, flyMs, impactMs: md.hitMs + flyMs,
      front: shots[0].front, shots, fx: fx.fly || fx.hit ? fx : null }
  }
  const jaw = def.cuts?.jaw && art.parts.jaw ? { line: def.cuts.jaw.line, pivot: def.cuts.jaw.pivot, mouth: def.cuts.jaw.mouth } : null
  // 遭遇のイラストはドット絵版と同じ
  const illust = bossArtOf(key)?.illust || null
  return {
    kind: 'illust', key, name: base.name, base: BOSS_ILLUST_SIZE, illust, parts, pivot: art.pivot, mouth: art.mouth, jaw, motions,
    srcs: [...parts.map(p => p.src), ...Object.values(motions).flatMap(m => Object.values(m.fx || {}).map(f => f.src))],
  }
}
