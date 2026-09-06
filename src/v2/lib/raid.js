// ============================================================
// バトルフロンティアⅡ（リメイク版）— レイドボス
// ------------------------------------------------------------
// 設計は docs/v2-raid-design.md。**ユニークボスとは別コンテンツ**：
//   ・レイド … オート戦闘（runBattle）／救援で最大20人／中盤から遊べる
//   ・ユニーク … ATB専用／ソロ／終盤の到達目標
//
//   出撃で戦闘 →（0.4%）レイドボス出現！ ── ここから1時間 ──
//     出撃と同じ10秒クールタイムで何度でも殴る（HP/MPは毎回全快・ボスのHPは減ったまま）
//     救援信号を出すと、選んだ相手も同じレイドへ入れる（最大20人）
//         ↓
//     討伐 or 時間切れ → 与ダメの割合ぶんの報酬（ルーン素材＋確率で合成素材）
//
// ★5体は無印から来た4体＋炎の枠が空いていたので足した1体。
//   名前・冠名・素材・特殊能力は**この表の1行にまとまっている**（変えるならここだけ）。
// ★特殊能力の中身は enchant.js の FUSIONS（刻印と同じ枠で戦闘に乗るため）。
//   合成素材そのものは fusion.js（ユニークボスぶんも後で同じ表へ足す）。
//
// ⚠数値の正はこのファイル。supabase_v2_raid_20260906.sql に同じ値が入っていて、
//   raid.test.js が両方を突き合わせている（片方だけ直すと落ちる）。
// ============================================================
import { ENEMY_SKILLS, statsOf, toFighter } from './enemies.js'

const S = ENEMY_SKILLS

// ===== 5体 =====
// dist は「戦闘力に対する割合(%)」。合計100。エリアボスと同じくHPとVITへ寄せてある。
// main は「生かすステータス」＝そのボスらしさ（ユニークボスと同じ考え方）。
// img が null のボスは**まだ絵が無い**（名前だけで出す）。
export const RAID_BOSSES = [
  {
    key: 'varuzenoku', name: '黒龍ヴァルゼノク', crown: '黒龍', main: 'str',
    img: '/varuzenoku.png', color: '#ff6666',
    text: '闇をまとった古龍。物理の一撃で押し潰しにくる',
    kind: 'phys', dist: { hp:40, mp:6, str:22, dex:7, agi:6, int_stat:4, vit:12, luk:3 },
    skills: [S.深淵咆哮, S.ちからため, S.じわれ, S.さけび, S.じこさいせい],
  },
  {
    key: 'amaza', name: '雨摩座', crown: '雨摩座', main: 'int_stat',
    img: '/amaza.png', color: '#66bbff',
    text: '水禍を呼ぶ座。動きを奪ってから沈める',
    kind: 'mag', dist: { hp:40, mp:9, str:4, dex:8, agi:8, int_stat:20, vit:8, luk:3 },
    skills: [S.深海波動, S.まりょくため, S.つらら, S.星辰崩落, S.じこさいせい],
  },
  {
    key: 'zerugiasu', name: '雷鋼機神ゼルギアス', crown: '雷鋼', main: 'dex',
    img: '/zerugiasu.png', color: '#ffdd44',
    text: '雷を動力にする機神。狙いが正確で外さない',
    kind: 'phys', dist: { hp:36, mp:7, str:15, dex:20, agi:9, int_stat:5, vit:5, luk:3 },
    skills: [S.天雷万鈞, S.すばやくなる, S.らくらい, S.天穿雷撃, S.じこさいせい],
  },
  {
    key: 'enma', name: '閻魔', crown: '閻魔', main: 'luk',
    img: '/enma.png', color: '#cc66ff',
    text: '冥府の裁定者。呪いを撒きながらこちらの運を削る',
    kind: 'mag', dist: { hp:38, mp:7, str:6, dex:7, agi:7, int_stat:16, vit:9, luk:10 },
    skills: [S.腐蝕溶解, S.さけび, S.しんえんのめ, S.崩落震撼, S.じこさいせい],
  },
  {
    // ★2026-09-06 に足した5体目（無印にいない新顔）。名前は案なので、変えるならこの行だけ
    key: 'guraudiosu', name: '炎獄王グラウディオス', crown: '炎獄', main: 'int_stat',
    img: null, color: '#ff8844',
    text: '炎獄をまとう王。焼き尽くすまで手を止めない',
    kind: 'mag', dist: { hp:38, mp:9, str:6, dex:8, agi:8, int_stat:22, vit:6, luk:3 },
    skills: [S.炎獄の審判, S.まりょくため, S.かえんだん, S.腐蝕溶解, S.じこさいせい],
  },
]
export const RAID_BOSS_BY_KEY = Object.fromEntries(RAID_BOSSES.map(b => [b.key, b]))
export const RAID_BOSS_BY_NAME = Object.fromEntries(RAID_BOSSES.map(b => [b.name, b]))
export const raidBossOf = (key) => RAID_BOSS_BY_KEY[key] || null

// ===== 出現 =====
// ★出撃1戦闘につき 0.4%。ピティ（積み上げ）は無い＝いつでも同じ確率。
//   レアモンスター（0.5%・sortie.js）やエリアボス（ピティ）とは**別の抽選**。
export const RAID_RATE = 0.4
export const rollRaid = (rng = Math.random) => rng() * 100 < RAID_RATE
// 出たあと挑戦できる時間（分）と、終わってから次が出るまでの間隔（時間）
export const RAID_MINUTES = 60
export const RAID_COOLDOWN_HOURS = 3
// 1つのレイドに入れる人数（主催者を含む）
export const RAID_MAX_MEMBERS = 20
// どのボスが出るかは5体から均等
export const pickRaidBoss = (rng = Math.random) => RAID_BOSSES[Math.floor(rng() * RAID_BOSSES.length)]

// ===== 強さ（tools/v2-raid-tune.mjs で測って決めた）=====
// ボスの戦闘力もHPも**主催者の戦闘力 P 基準**。ボスの防御も一緒に伸びるので、
// 与ダメはPに対してほぼ線形になる（ユニークボスの P^1.2 はここでは要らない）。
export const RAID_MIN_POWER = 6000    // 下限。これ未満の人が引いても強さはここで止まる
export const RAID_HP_K = 2000         // HP = K × 戦闘力。攻撃寄りの編成で約320回ぶん＝1時間
export const RAID_TURNS = 10          // 1回の挑戦で回すターン数（通常戦闘は100ターン上限）
export const raidPowerOf = (power) => Math.max(RAID_MIN_POWER, Math.round(power || 0))
export const raidHpOf = (power) => RAID_HP_K * raidPowerOf(power)

// runBattle に渡せる形。uses は1回の挑戦で技を何回使えるか（10ターンなので4回で足りる）
export const bossStatsOf = (boss, power) => ({
  name: boss.name, kind: boss.kind, dist: boss.dist, skills: boss.skills, power: raidPowerOf(power),
})
export const toRaidFighter = (boss, power, hpLeft = null) => {
  const f = toFighter(bossStatsOf(boss, power), 4)
  // ★HPだけレイドのもの（削れた状態）に差し替える。他のステはそのまま
  const max = raidHpOf(power)
  f.stats = { ...f.stats, hp: Math.max(1, hpLeft == null ? max : hpLeft) }
  return f
}
// 表示用（ステータスの中身を見せるとき）
export const bossBaseStats = (boss, power) => statsOf(bossStatsOf(boss, power))

// ===== 報酬 =====
// share ＝ 自分の与ダメ ÷ ボスの最大HP（0〜1）
export const shareOf = (dmg, maxHp) => (maxHp > 0 ? Math.min(1, Math.max(0, (dmg || 0) / maxHp)) : 0)
// ルーン素材は**確定**。個数は share で増える（最大6個）
export const MAT_COUNT_MAX = 6
export const matCountOf = (share) => Math.min(MAT_COUNT_MAX, 1 + Math.floor(shareClamp(share) * 10))
const shareClamp = (s) => Math.min(1, Math.max(0, Number(s) || 0))
// レア度の重み(%)。share が大きいほど良いものが出る（合計100）
export const rarityTableOf = (share) => {
  const s = shareClamp(share)
  return { normal: 70 - 50 * s, rare: 25 + 30 * s, ultra: 5 + 20 * s }
}
export const rollRarity = (share, rng = Math.random) => {
  const t = rarityTableOf(share)
  const r = rng() * 100
  if (r < t.ultra) return 'ultra'
  if (r < t.ultra + t.rare) return 'rare'
  return 'normal'
}
// 合成素材は**討伐できたときだけ**。主催者は+10%
export const FUSION_BASE_PCT = 20
export const FUSION_SHARE_PCT = 60
export const FUSION_HOST_BONUS = 10
export const fusionChanceOf = (share, isHost = false) =>
  Math.min(100, FUSION_BASE_PCT + FUSION_SHARE_PCT * shareClamp(share) + (isHost ? FUSION_HOST_BONUS : 0))

// ===== 救援信号 =====
// 宛先は**種別＋ID**で持つ。国を作ったら 'country' を足すだけで載る
export const CALL_KINDS = ['online', 'friend']
export const CALL_KIND_LABEL = { online: 'オンライン中', friend: 'フレンド', country: '国のメンバー' }
export const ONLINE_MINUTES = 5     // 直近これだけの間に動いていた人を「オンライン中」とする
export const CALL_MAX = 50          // 1回の信号で送れる人数（全選択の暴発よけ）

// ===== 残り時間 =====
export const endsAtOf = (startedAt) => new Date(new Date(startedAt).getTime() + RAID_MINUTES * 60000)
export const secondsLeft = (startedAt, now = Date.now()) =>
  Math.max(0, Math.floor((endsAtOf(startedAt).getTime() - now) / 1000))
export const isOver = (raid, now = Date.now()) =>
  !raid || raid.hp_left <= 0 || secondsLeft(raid.started_at, now) <= 0
export const timeText = (sec) => {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}分${String(s).padStart(2, '0')}秒`
}
