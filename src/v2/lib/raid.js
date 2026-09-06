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
//     討伐 or 時間切れ → 貢献度のティアぶんの報酬（ルーン素材＋討伐なら合成素材）
//
// ★強さは**出撃していたエリアの難易度帯で決まる**（2026-09-06 ユーザー指示）。
//   奥のエリアで引くほど強く、そのぶん報酬も豪華になる。挑む人の戦闘力では変わらない。
// ★1回の挑戦は**30ターン**。ボスは**ターンが進むほど火力と耐久が上がる**（たかぶり）ので、
//   後半のターンはほとんど通らない＝短期決戦を組めた人ほど削れる。
//
// ★5体は無印から来た4体＋炎の枠が空いていたので足した1体。
//   名前・冠名・素材・特殊能力は**この表の1行にまとまっている**（変えるならここだけ）。
// ★特殊能力の中身は enchant.js の FUSION_ABILITIES（刻印と同じ枠で戦闘に乗せるため）。
//   合成素材そのものは fusion.js（ユニークボスぶんも後で同じ表へ足す）。
//
// ⚠数値の正はこのファイル。supabase_v2_raid_20260906.sql に同じ値が入っていて、
//   raid.test.js が両方を突き合わせている（片方だけ直すと落ちる）。
// ============================================================
import { ENEMY_SKILLS, statsOf, toFighter, areasOfTier, tierOf, TIER_MAX, markOf } from './enemies.js'

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

// ===== 出現（2026-09-06 ユーザー指示で決め直した）=====
// ★**そのエリアのボスを討伐ずみ（＝踏破済み）のエリア**でだけ出る。
//   条件はエリアにかかっていて、**戦った相手がボスかどうかは関係ない**＝
//   踏破したエリアを周回していれば、どの戦闘からでも 3% で出会う。
//   ＝レイドは「そのエリアを踏破できた人」への追加コンテンツという位置づけになる。
// ★**1人1日2回まで**（日本時間の5時で切り替わる。宝樹・デイリーと同じ区切り）。
//   ⚠回数を数えるのも、踏破しているかを見るのも**サーバー**（v2_raid_spawn）。
//     画面の表示と抽選は読み替えでしかない。
export const RAID_RATE = 3
export const rollRaid = (rng = Math.random) => rng() * 100 < RAID_RATE
export const RAID_DAILY_MAX = 2
// 出たあと挑戦できる時間（分）
export const RAID_MINUTES = 60
// 1つのレイドに入れる人数（主催者を含む）
export const RAID_MAX_MEMBERS = 20

// ===== どのボスが出るか（2時間ごとのローテ）=====
// ★**時間帯で決まる**（2026-09-06 ユーザー指示）。抽選ではないので、
//   同じ時間なら**世界中の誰が引いても同じボス**が出る。
//   5体を2時間ずつ回すので、ひと回りに10時間かかる（毎日同じ時刻に同じ顔にならない）。
// ⚠**選ぶのはサーバー**（v2_raid_spawn が now() から決める）。
//   ここは画面に「いま出るボス」を出すためのもので、送っても採用されない。
export const ROTATE_HOURS = 2
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
// 1970年からのJSTでの通算「2時間」数。出撃の部位ローテ（sortie.js）と同じ作り
export const raidSlotAt = (at = new Date()) =>
  Math.floor((new Date(at).getTime() + JST_OFFSET_MS) / (ROTATE_HOURS * 3600000))
export const raidBossAt = (at = new Date()) =>
  RAID_BOSSES[((raidSlotAt(at) % RAID_BOSSES.length) + RAID_BOSSES.length) % RAID_BOSSES.length]
// 次に入れ替わる時刻
export const nextRotateAt = (at = new Date()) =>
  new Date((raidSlotAt(at) + 1) * ROTATE_HOURS * 3600000 - JST_OFFSET_MS)
// これから n 回ぶんの予定（画面に出す）
export const rotateSchedule = (at = new Date(), n = 5) =>
  Array.from({ length: n }, (_, i) => {
    const t = new Date(new Date(at).getTime() + i * ROTATE_HOURS * 3600000)
    return { at: new Date(raidSlotAt(t) * ROTATE_HOURS * 3600000 - JST_OFFSET_MS), boss: raidBossAt(t) }
  })

// ===== 強さ（エリアの難易度帯で決まる・2026-09-06 ユーザー指示）=====
// ★**そのエリアのボスの戦闘力 × 2**。エリアボスの数字は tools/v2-boss-tune.mjs が
//   「1日1時間で目標どおりに進む」ところへ置いたものなので、それに乗せておけば
//   帯を進めるたびにレイドも同じ歩幅で重くなる（レイド用に別の目標を置かない）。
// ⚠**挑む人の戦闘力では変わらない**。強い人が浅いエリアのレイドを手伝うと楽に倒せるが、
//   報酬はその帯ぶんしか出ないので旨みは無い（自然に釣り合う）。
// ★**守りと攻めを別の戦闘力で作る**（2026-09-06）。
//   ・守り（HP以外のステ全部）… エリアボスの **2倍**。硬くて素早い
//   ・攻め（STR / INT）      … エリアボスの **6%**。素の攻撃力はとても低い
//   ⚠攻めを守りと同じ戦闘力で作ると、**5ターンでこちらが力尽きて30ターンに届かない**
//     （実測。tools/v2-raid-tune.mjs）。レイドボスは「倒しに来る敵」ではなく
//     **削り切るまでの時間を測る壁**なので、素の攻撃力は低くしてある。
//     そのかわり下の「たかぶり」でターンごとに攻撃力が伸び、最後には必ず倒される。
export const RAID_POWER_MULT = 2
export const RAID_ATK_MULT = 0.06
export const bossPowerOfTier = (tier) => areasOfTier(tier)[0]?.boss?.power || 0
export const raidPowerOfTier = (tier) => Math.round(bossPowerOfTier(tier) * RAID_POWER_MULT)
export const raidAtkPowerOfTier = (tier) => Math.max(1, Math.round(bossPowerOfTier(tier) * RAID_ATK_MULT))
export const raidPowerOfArea = (areaId) => raidPowerOfTier(tierOf(areaId))

// ===== 想定人数（2026-09-06 ユーザー指示「複数人で戦闘することも考慮」）=====
// ★HPは**この人数で1時間ちょうど**になるように置いてある。
//   ソロだと1時間かけても 1/RAID_PARTY しか削れない＝**救援を出す前提**のコンテンツ。
//   ただし**自分の帯より下のレイド**なら上振れぶんそのまま速く、少人数でも討伐できる。
export const RAID_PARTY = 5

// HPは**帯ごとの表**。「その帯の作り込んだ編成が RAID_PARTY 人で1時間フル
// （360回×人数）殴ってちょうど削り切れる」量を tools/v2-raid-tune.mjs で測って焼いてある。
// ★戦闘力に出てこない伸び（ルーンの刻印・釣り図鑑・モンスター図鑑・ペット・職業補正）も
//   乗せた状態で測っている（2026-09-06 ユーザー指摘）。素のステだけで測るとHPが足りない。
// ⚠**勘で書き換えない。** 帯ごとに編成の枠数もエリアボスの強さも違うので、
//   「戦闘力 × 一定」では出せない（①〜④と⑤〜⑧で必要な倍率が3倍ちがう）。
//   触るときは `node tools/v2-raid-tune.mjs` を回して、出た表をそのまま貼ること。
export const RAID_HP = {
  1:1900000, 2:4800000, 3:15000000, 4:19000000,
  5:260000000, 6:580000000, 7:930000000, 8:1500000000,
}
export const raidHpOfTier = (tier) => RAID_HP[tier] || RAID_HP[1]
export const raidHpOfArea = (areaId) => raidHpOfTier(tierOf(areaId))

// ===== 1回の挑戦 =====
// ★30ターンで強制終了。ボスは**1ターンごとに火力+RAMP_ATK%・耐久+RAMP_DEF%**（たかぶり）。
//   後半はほとんど通らなくなり、こちらが先に倒れる＝**短期決戦を組めた人ほど削れる**。
//   解釈は battle.js の liveStats（fighter.ramp を渡したときだけ効く）。
// ★1発でHPの何分の1まで削れるか（サーバーの申告チェック）。
//   実測の1発は HP の 1/1800 なので、**まっとうな挑戦がこの上限に当たることはない**。
//   自分の帯より下のレイドを手伝う人（＝格上）だけが当たるが、それでも10回で削り切れる。
//   ⚠これは**でたらめな数字を弾くだけ**の網。ちゃんと防ぐには戦闘をサーバーで回すしかない
//     （出撃・アリーナと同じ穴。一般公開の前にまとめて直す）。
export const HIT_CAP_DIV = 10
export const hitCapOf = (hpMax) => Math.floor((hpMax || 0) / HIT_CAP_DIV)

export const RAID_TURNS = 30
export const RAMP_ATK = 8   // 1ターンごとの火力(+STR/INT%)
export const RAMP_DEF = 6   // 1ターンごとの耐久(+VIT%)
export const rampText = () => `1ターンごとに 火力+${RAMP_ATK}% ／ 耐久+${RAMP_DEF}%`
// n ターン目（1始まり）の上がり幅
export const rampAt = (turn) => ({ atk: RAMP_ATK * Math.max(0, turn - 1), def: RAMP_DEF * Math.max(0, turn - 1) })

// runBattle に渡せる形。uses は1回の挑戦で技を何回使えるか（30ターンなので多めに要る）
export const bossStatsOf = (boss, tier) => ({
  name: boss.name, kind: boss.kind, dist: boss.dist, skills: boss.skills, power: raidPowerOfTier(tier),
})
export const toRaidFighter = (boss, tier, hpLeft = null) => {
  const f = toFighter(bossStatsOf(boss, tier), 10)
  const max = raidHpOfTier(tier)
  f.stats = {
    ...f.stats,
    // ★HPはレイドのもの（削れた状態）に差し替える
    hp: Math.max(1, hpLeft == null ? max : hpLeft),
    // ★攻撃ステだけ**低い戦闘力**で作り直す（上の RAID_ATK_MULT）
    ...atkStatsOf(boss, tier),
  }
  f.ramp = { atk: RAMP_ATK, def: RAMP_DEF }
  return f
}
// 攻撃ステ（STR / INT）だけを低い戦闘力から作る。ボスごとの配分の比はそのまま残す
export const atkStatsOf = (boss, tier) => {
  const a = statsOf({ dist: boss.dist, power: raidAtkPowerOfTier(tier) })
  return { str: a.str, int_stat: a.int_stat }
}
// 表示用（ステータスの中身を見せるとき）
export const bossBaseStats = (boss, tier) => {
  const full = statsOf(bossStatsOf(boss, tier))
  return { ...full, hp: raidHpOfTier(tier), ...atkStatsOf(boss, tier) }
}
export const tierMark = markOf
export const TIERS = Array.from({ length: TIER_MAX }, (_, i) => i + 1)

// ===== 報酬（2026-09-06 ユーザー指示で決め直した）=====
// ★報酬は**3枠**あり、条件を満たせば**重ねて受け取れる**。
//     ① 貢献度  … share（自分の与ダメ ÷ 最大HP）で ティアA〜D
//     ② 主催の箱 … そのレイドを呼んだ人
//     ③ MVPの箱  … いちばん削った人
//   ＝**主催者がMVPを取って貢献度もAなら、3つとも**受け取る。
//   ⚠②③が別枠になったので、**貢献度のティアは純粋に share だけ**で決める
//     （前にあった「主催者とMVPはA確定」は無くした）。

export const shareOf = (dmg, maxHp) => (maxHp > 0 ? Math.min(1, Math.max(0, (dmg || 0) / maxHp)) : 0)

// ---- ① 貢献度のティア ----
export const REWARD_TIERS = ['A', 'B', 'C', 'D']
export const TIER_LABEL = { A:'ティアA', B:'ティアB', C:'ティアC', D:'ティアD' }
export const TIER_COLOR = { A:'#ffcc00', B:'#44ff88', C:'#88ccff', D:'#7fa6d0' }
// このshare以上でそのティア（上から見る）
export const TIER_SHARE = { A: 0.25, B: 0.10, C: 0.03, D: 0 }
export const tierOfShare = (share) => {
  const s = Math.min(1, Math.max(0, Number(share) || 0))
  return REWARD_TIERS.find(t => s >= TIER_SHARE[t]) || 'D'
}
export const rewardTierOf = tierOfShare

// 参加者の中でいちばん削った人（同点なら先に見つかったほう。与ダメ0はMVPにしない）
export const mvpIdOf = (members) => {
  let best = null
  for (const m of members || []) {
    if (Number(m.damage || 0) <= 0) continue
    if (!best || Number(m.damage) > Number(best.damage)) best = m
  }
  return best ? String(best.player_id) : null
}

// ---- 素材の数（ティアごとの範囲から1つ引く）----
// ★帯ボーナスは無し。もらった数字そのまま（2026-09-06 ユーザー決定）
export const TIER_MAT_RANGE = { A: [5, 7], B: [3, 5], C: [2, 3], D: [1, 2] }
export const matRangeOf = (rewardTier) => TIER_MAT_RANGE[rewardTier] || TIER_MAT_RANGE.D
export const matCountOf = (rewardTier, rng = Math.random) => {
  const [lo, hi] = matRangeOf(rewardTier)
  return lo + Math.floor(rng() * (hi - lo + 1))
}
export const matRangeText = (rewardTier) => {
  const [lo, hi] = matRangeOf(rewardTier)
  return `${lo}〜${hi}個`
}

// ---- レア度 ----
// 激レアの確率(%)。**帯だけで決まる**（2026-09-06 ユーザー指示「①で3%・最高でも7%」）
export const TIER_ULTRA = { 1:3, 2:3, 3:4, 4:4, 5:5, 6:5, 7:6, 8:7 }
export const ultraPctOf = (tier) => TIER_ULTRA[tier] ?? TIER_ULTRA[1]
// レアの確率(%)。**ティアだけで決まる**。★いちばん低いDでも激レアの上限(7%)より多い
export const TIER_RARE = { A: 30, B: 24, C: 18, D: 12 }
export const rarePctOf = (rewardTier) => TIER_RARE[rewardTier] ?? TIER_RARE.D

// ⚠**通常＞レア＞激レア**を崩さないこと（テストで固定してある）
export const rarityTableOf = (rewardTier, tier) => {
  const ultra = ultraPctOf(tier)
  const rare = rarePctOf(rewardTier)
  return { normal: 100 - rare - ultra, rare, ultra }
}
export const rollRarityFrom = (table, rng = Math.random) => {
  const r = rng() * 100
  if (r < table.ultra) return 'ultra'
  if (r < table.ultra + table.rare) return 'rare'
  return 'normal'
}
export const rollRarity = (rewardTier, tier, rng = Math.random) =>
  rollRarityFrom(rarityTableOf(rewardTier, tier), rng)

// 合成素材（貢献度ぶん）は**討伐できたときだけ・固定1%**
export const FUSION_PCT = 1
export const fusionChanceOf = () => FUSION_PCT

// ---- ②③ 主催の箱／MVPの箱 ----
// ★**中身は同じ**（2026-09-06 ユーザー決定）。素材3個固定で、激レアと合成素材が出やすい。
//   帯でもティアでも変わらない＝「取った人へのご褒美」の枠。
export const BOX_KINDS = ['host', 'mvp']
export const BOX_LABEL = { host: '主催の箱', mvp: 'MVPの箱' }
export const BOX_COLOR = { host: '#ffcc00', mvp: '#ff88cc' }
export const BOX_MAT_COUNT = 3
export const BOX_RARITY = { normal: 60, rare: 30, ultra: 10 }
export const BOX_FUSION_PCT = 3
export const boxRarityTable = () => ({ ...BOX_RARITY })

// ===== EXP（2026-09-06 ユーザー指示「レイドでも経験値を稼げるように」）=====
// ★出撃の通常敵と同じ 8〜11。レイドはスタミナを使わないが、
//   ドロップも素材もその場では出ないので、出撃より旨くはならない。
//   ⚠**抽選も付与もサーバー**（v2_raid_attack が v2_apply_exp を呼ぶ）。言い値では入らない
export const RAID_EXP_MIN = 8
export const RAID_EXP_MAX = 11
export const raidExpOf = (rng = Math.random) =>
  RAID_EXP_MIN + Math.floor(rng() * (RAID_EXP_MAX - RAID_EXP_MIN + 1))

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
