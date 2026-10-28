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
// ============================================================
import { BOSS_ILLUST } from './bossIllustList.js'
import { BOSS_DEFS, BOSS_ART_DIR, bossFileOf, bossArtOf } from './bossArt.js'

export const BOSS_ILLUST_SRC = 'イラスト版'   // 元の絵のフォルダの中
export const BOSS_ILLUST_SIZE = 640          // 立ち絵の大きさ（画面で使う版・正方形のpx）。パーツの位置はこの大きさで持つ
export const ILLUST_PARTS = ['wingF', 'wingN', 'body', 'head']   // 奥から手前へ重ねる順
export const ILLUST_PART_FILES = { wingF: '翼_奥', wingN: '翼_手前', body: '体', head: '頭' }

export const illustKindOf = (part) => `il-${part}`
export const illustFxKindOf = (motion, kind) => `il-fx-${motion}-${kind}`
const srcOf = (key, kind) => {
  const v = BOSS_ILLUST[key]?.v?.[kind]
  return `${BOSS_ART_DIR}/${bossFileOf(key, kind)}${v ? `?v=${v}` : ''}`
}

// 姿勢：x・y＝全体のずれ（枠の大きさに対する割合）／r＝全体の角度（°・時計回り）／head＝首の角度／wingN・wingF＝翼の角度／glow＝口の火（0〜1）
const ZERO = { x: 0, y: 0, r: 0, head: 0, wingN: 0, wingF: 0, glow: 0 }
// 技ごとの動き：keys＝[時刻ミリ秒, 姿勢（待機に足す）]・hitMs＝当たる（撃ち出す）時刻
export const BOSS_ILLUST_DEFS = {
  varuzenoku: {
    // 待機：1回の羽ばたき（ミリ秒）・翼の振れ幅（°・上げきり→下ろしきり）・体の浮き沈み（枠の割合）
    idle: { periodMs: 1200, wingUp: -12, wingDown: 14, bob: 0.012, headSway: 1.5 },
    motions: {
      claw: { totalMs: 760, hitMs: 340, keys: [
        [0, {}],
        [220, { x: 0.03, r: 4, head: 6, wingN: -10, wingF: 8 }],
        [340, { x: -0.12, y: 0.02, r: -7, head: -6, wingN: 8, wingF: -6 }],
        [480, { x: -0.11, y: 0.02, r: -6, head: -5, wingN: 6, wingF: -4 }],
        [760, {}],
      ] },
      breath: { totalMs: 1100, hitMs: 560, keys: [
        [0, {}],
        [420, { x: 0.02, r: 3, head: 14, glow: 0.7 }],
        [560, { x: -0.04, r: -3, head: -10, glow: 1 }],
        [820, { x: -0.035, r: -2, head: -8, glow: 0.3 }],
        [1100, {}],
      ] },
      gale: { totalMs: 1100, hitMs: 540, keys: [
        [0, {}],
        [380, { y: -0.04, head: 4, wingN: -30, wingF: 26 }],
        [540, { y: 0.02, head: -4, wingN: 26, wingF: -22 }],
        [760, { y: 0.01, wingN: 18, wingF: -16 }],
        [1100, {}],
      ] },
      doom: { totalMs: 1500, hitMs: 860, keys: [
        [0, {}],
        [600, { x: 0.03, y: -0.05, r: 8, head: 18, wingN: -20, wingF: 16, glow: 1 }],
        [740, { x: 0.035, y: -0.05, r: 8, head: 17, wingN: -22, wingF: 18, glow: 1 }],
        [860, { x: -0.08, y: 0.02, r: -7, head: -12, wingN: 16, wingF: -12, glow: 1 }],
        [1150, { x: -0.07, y: 0.02, r: -6, head: -10, glow: 0.3 }],
        [1500, {}],
      ] },
    },
    // 塗りのエフェクト（元の絵の名前はドット絵版と同じ・フォルダが違う）。size＝枠の幅に対する横幅
    //   飛ぶ＝flyMs で口から自分の体の真ん中へ／当たる＝durMs のあいだ大きくなりながら消える（spin＝回る角度°）
    effects: [
      { file: '黒爪_当たる', motion: 'claw', kind: 'hit', size: 0.5, durMs: 480, spin: 0 },
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
  return { ...ZERO, y: -idle.bob * down, head: idle.headSway * Math.sin(2 * Math.PI * (ph - 0.15)), wingN: w, wingF: -w * 0.8 }
}
// いまの姿勢：motion（bossIllustOf の motions の1つ）を流しはじめて ms たったとき。技のあいだは羽ばたきを弱める
export const illustPoseAt = (key, motion, ms, tMs) => {
  const def = BOSS_ILLUST_DEFS[key]
  const idle = idlePoseAt(def.idle, tMs)
  const add = motion ? motionPoseAt(motion.keys, ms) : null
  if (!add) return idle
  return Object.fromEntries(Object.keys(ZERO).map(f => [f, (f === 'wingN' || f === 'wingF' ? idle[f] * 0.35 : f === 'y' ? idle[f] * 0.5 : 0) + add[f]]))
}

// 点（立ち絵の px）を姿勢で動かした先（同じ px）。首→全体の順に回す（画面の rotate と同じ時計回り）
const rot = ([x, y], [cx, cy], deg) => {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t)
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]
}
export const illustPointAt = (key, pose, pt, part = 'head') => {
  const a = BOSS_ILLUST[key]
  let p = pt
  const pp = a.parts[part]
  if (pp) p = rot(p, [pp.px, pp.py], pose[part === 'head' ? 'head' : part] || 0)
  p = rot(p, a.pivot, pose.r)
  return [p[0] + pose.x * BOSS_ILLUST_SIZE, p[1] + pose.y * BOSS_ILLUST_SIZE]
}

// 画面で使う形（無ければ null）。lib/bossArt.js の bossArtOf と同じ並び（kind で見分ける）
//   { kind:'illust', key, name, base（＝640）, illust（遭遇のイラスト）, parts:[{ key, src, x, y, w, h, px, py }], pivot, mouth,
//     motions:{ <key>: { label, keys, totalMs, hitMs, flyMs, impactMs, front（当たる時刻の口・px）, fx:{ fly?, hit? } } }, srcs }
export const bossIllustOf = (key) => {
  const def = BOSS_ILLUST_DEFS[key], art = BOSS_ILLUST[key], base = BOSS_DEFS[key]
  if (!def || !art?.parts || !base) return null
  const parts = ILLUST_PARTS.filter(p => art.parts[p]).map(p => ({ key: p, src: srcOf(key, illustKindOf(p)), ...art.parts[p] }))
  const motions = {}
  for (const m of base.motions) {
    const md = def.motions[m.key]
    if (!md) continue
    const fx = {}
    let flyMs = 0
    for (const d of def.effects.filter(d => d.motion === m.key)) {
      const a = art.fx?.[m.key]?.[d.kind]
      if (!a) continue
      fx[d.kind] = { ...a, frames: 1, src: srcOf(key, illustFxKindOf(m.key, d.kind)), size: d.size, durMs: d.durMs, spin: d.spin || 0 }
      if (d.kind === 'fly') flyMs = d.flyMs
    }
    const hitPose = { ...ZERO, ...motionPoseAt(md.keys, md.hitMs) }
    motions[m.key] = { label: m.file, keys: md.keys, totalMs: md.totalMs, hitMs: md.hitMs, flyMs, impactMs: md.hitMs + flyMs,
      front: illustPointAt(key, hitPose, art.mouth).map(Math.round), fx: fx.fly || fx.hit ? fx : null }
  }
  // 遭遇のイラストはドット絵版と同じ
  const illust = bossArtOf(key)?.illust || null
  return {
    kind: 'illust', key, name: base.name, base: BOSS_ILLUST_SIZE, illust, parts, pivot: art.pivot, mouth: art.mouth, motions,
    srcs: [...parts.map(p => p.src), ...Object.values(motions).flatMap(m => Object.values(m.fx || {}).map(f => f.src))],
  }
}
