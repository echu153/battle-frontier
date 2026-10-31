// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦（ボスを呼び、HPを持ち越して倒す・ATB戦闘）
// ------------------------------------------------------------
// 【確定】2026-10-29 ユーザー選択（経緯は docs/v2cap-design.md §6-14 の「IDダンジョン」）：
//   ・**自分で呼ぶ**（入口で難易度を選ぶ）。呼べるのは**全部の難易度を合わせて1日1回**（日本時間の朝5時に戻る）
//   ・呼んだときから**90分**。**HPは持ち越し**＝負けても残ったHPから挑み直せる。挑戦1回は ATB の180秒まで
//   ・スタミナ：**呼んだ人は最初の1回0・そのあと3**／**救援で入った人は挑むたびに5**（自分の「1日1回」は使わない）
//   ・**救援信号**：だれでも（入口の「救援の一覧」）・**先着5人**（呼んだ人と合わせて6人。それぞれ自分の画面で同じボスを殴る）
//   ・難易度は**そのエリアに着いたら**呼べる（②ノーマル・⑤ハード・⑧エキスパート・⑫マスター）。**いまはハードまで**
//     （ユーザー「一旦ハードまでの実装でいい」。エキスパート・マスターの決まりは設計書にある＝大技を止める・怒り・ギミック）
//   ・報酬は**黒龍の専用の装備**（あとで作る）。いまは無し＝**削った量だけ数える**（報酬は削った量で差を付ける）
//   ・ボスの技：HPの節目（75%・50%・25%）で1回ずつ必ず撃ち、そのあとも確率で使う・HP50%以下は毎回技（atb.js の pattern）
// 【確定】2026-10-31 ユーザー「これは『挑戦』にして」「ここに『強敵』ってカテゴリを作って、ここにヴァルゼノクとあまざ入れて、ここに旧レイドのボスを入れる予定」＋選択「ボスごとに1日1回」：
//   メニューの名前は「挑戦」（コードと DB の dungeon の名前はそのまま）。呼べるのは**ボスごとに1日1回**・同時に1体
// ⚠数値の正はこのファイル。supabase_v2cap_dungeon_20261029.sql に同じ値（HP・スタミナ・時間・回数・人数・解禁のエリア）があり、
//   dungeon.test.js が突き合わせる（片方だけ直すと落ちる）
// ============================================================
import { statsOf } from '../core/enemies.js'
import { CAP_RULES } from './rules.js'

export const DUNGEON_MIN = 90          // 呼んだときから倒せる時間（分）
export const DUNGEON_TRY_SEC = 180     // 挑戦1回の長さ（秒）＝ATBの時間切れ
export const SUMMONS_PER_DAY = 1       // ボスごとに、全部の難易度を合わせて1日に呼べる回数
export const STAMINA_OWNER_FIRST = 0   // 呼んだ人の最初の1回
export const STAMINA_OWNER = 3         // 呼んだ人の2回目から
export const STAMINA_HELPER = 5        // 救援で入った人（毎回）
export const HELPERS_MAX = 5           // 救援で入れる人数（呼んだ人のほか）

export const DIFF_KEYS = ['normal', 'hard', 'expert', 'master']

// ボス。dist＝戦闘力に対するステの割合（%）・skills＝技（倍率・状態異常）・pattern＝技の出し方・diffs＝難易度ごとの強さ
//   diffs の中身：area＝呼べるようになるエリア・recLv＝推奨LV・recPower＝推奨戦闘力・power＝守りと速さの戦闘力・atk＝攻撃（STR・INT）だけの倍率・hp＝全体のHP
//   power と atk・hp は測って決めた（推奨戦闘力の人で：半分は1回の挑戦で負けずに倒し、残りは2回目で倒す）。
//   power は推奨LVの場所のボスの戦闘力（ノーマル＝②-③の474・ハード＝⑥-①959と⑥-②1163の間を推奨LVで割った1027）
//   ready:false の難易度はまだ呼べない（数字を決めていない）
//   summon:false のボスはまだ呼べない（試し撃ちだけ。いまは無い）
// 黒龍の強さ（雨摩座も同じ数字を使う）
const VARUZENOKU_DIFFS = {
  // 2026-10-29 鈍足を「ゲージ20%遅く」にしてエンジンで測り直した（前はノーマル 攻撃0.42倍・HP7000）。
  //   ノーマル：0.42倍・7000だと1回で倒せたのが22人中6人に減った → 0.35倍・6500で12人（残りも全員2回目）
  //   ハード：0.42倍だと3回かかる人が1人いた → 0.4倍で22人中13人が1回・全員2回まで
  // 2026-10-30 HPの節目のバフ（60%で守り+25%・30%で攻撃+25%）を入れて測り直した（HPはそのまま＝サーバーの表は変えない）：
  //   ノーマル：0.35倍のままだと1回で倒せたのが22人中10人 → 0.33倍で12人（全員2回まで）
  //   ハード：0.4倍のままだと12人・3回かかる人が1人 → 0.38倍で12人（全員2回まで）
  // 2026-10-30 25%の大技が切ってすぐ出る（防御が間に合いにくい）ようにして測り直した：
  //   ノーマル：0.33倍のまま11人（全員2回まで）／ハード：0.38倍のままだと11人・3回かかる人が1人（聖騎士）→ 0.36倍で12人（全員2回まで）
  normal: { label: 'ノーマル', area: 2, recLv: 25, recPower: 500, power: 474, atk: 0.33, hp: 6500 },
  hard: { label: 'ハード', area: 5, recLv: 45, recPower: 1050, power: 1027, atk: 0.36, hp: 15000 },
  expert: { label: 'エキスパート', area: 8, recLv: 65, ready: false },
  master: { label: 'マスター', area: 12, recLv: 80, ready: false },
}
export const DUNGEON_BOSSES = {
  varuzenoku: {
    name: '黒龍ヴァルゼノク', kind: 'phys', race: 'ドラゴン',
    dist: { hp: 40, mp: 6, str: 16, dex: 7, agi: 7, int_stat: 12, vit: 9, luk: 3 },
    // 通常攻撃が黒爪（物理1.0倍）。技は節目で出る3つ（proc は100＝クールダウンは使わない・パターンが決める）
    skills: [
      { name: '焦熱の吐息', kind: 'mag', mult: 1.6, proc: 100, mp: 0, ail: { key: 'burn', chance: 70 } },
      { name: '黒翼烈風', kind: 'phys', mult: 1.8, proc: 100, mp: 0, ail: { key: 'slow', chance: 50 } },
      // 倍率2.5以上＝撃つ前に構え（防御で半分）。【確定】2026-10-30 ユーザー「溜めモーションは4秒でいい」：
      //   castSec＝構えの長さ 3.5秒（このあと吐く直前に引く0.5秒＝lib/bossIllust.js の castSkipMs から吐くまで）＝構えはじめから吐くまで4秒
      { name: '終焉の黒焔', kind: 'mag', mult: 3.0, proc: 100, mp: 0, castSec: 3.5 },
    ],
    pattern: {
      steps: [
        { at: 0.75, skill: '焦熱の吐息' },
        { at: 0.5, skill: '黒翼烈風' },
        // now＝切ったらゲージを待たずに構えに入る（ユーザー「大技に入るとき、ATBリセットしてるでしょ？そのHPを切ったらすぐモーションに移行していいよ」・atb.js の nowStep）
        { at: 0.25, skill: '終焉の黒焔', now: true },
      ],
      bands: [
        { min: 0.75, weights: {} },                                                       // 75%より上＝黒爪だけ
        { min: 0.5, weights: { '焦熱の吐息': 30 } },                                      // 残りは黒爪
        { min: 0.25, weights: { '焦熱の吐息': 50, '黒翼烈風': 50 } },                     // 50%以下は毎回技
        { min: -1, weights: { '焦熱の吐息': 40, '黒翼烈風': 40, '終焉の黒焔': 20 } },
      ],
      // HPの節目で付くバフ（消えない・消せない・atb.js の checkHpBuffs）。名前は黒龍の鱗と怒りから
      buffs: [
        { at: 0.6, name: '黒鱗の鎧', table: { vit: 25 } },
        { at: 0.3, name: '逆鱗', table: { str: 25, int_stat: 25 } },
      ],
    },
    diffs: VARUZENOKU_DIFFS,
  },
  // 【確定】2026-10-30 ユーザー「あまざも黒龍と同じような行動パターンにして」→選択「黒龍の裏返し」：
  //   黒龍の物理と魔法を入れ替えた形（魔法が主）。節目・技の出る割合・強さ（diffs）は黒龍と同じ。
  //   【確定】2026-10-31 ユーザー「ヴァルゼノクとあまざ入れて」：強敵として呼べる（サーバーの表にも入れた）
  amaza: {
    name: '雨摩座', kind: 'mag', race: '妖精',   // 雨の精霊＝妖精（精霊も入れる・monsterRace.js）
    dist: { hp: 40, mp: 6, str: 12, dex: 7, agi: 7, int_stat: 16, vit: 9, luk: 3 },
    // 通常攻撃が雨礫（魔法1.0倍）
    skills: [
      { name: '氷雨', kind: 'mag', mult: 1.6, proc: 100, mp: 0, ail: { key: 'slow', chance: 70 } },
      { name: '水縛の帯', kind: 'phys', mult: 1.8, proc: 100, mp: 0, ail: { key: 'paralyze', chance: 30 } },
      // 倍率2.5以上＝撃つ前に構え（防御で半分）。黒龍の終焉の黒焔と同じ（ユーザー「同じにする」）：構え3.5秒＋振り下ろす直前の0.5秒＝振り下ろすまで4秒
      { name: '水天葬', kind: 'mag', mult: 3.0, proc: 100, mp: 0, castSec: 3.5 },
    ],
    pattern: {
      steps: [
        { at: 0.75, skill: '氷雨' },
        { at: 0.5, skill: '水縛の帯' },
        { at: 0.25, skill: '水天葬', now: true },   // 切ったらゲージを待たずに構えに入る（黒龍と同じ）
      ],
      bands: [
        { min: 0.75, weights: {} },
        { min: 0.5, weights: { '氷雨': 30 } },
        { min: 0.25, weights: { '氷雨': 50, '水縛の帯': 50 } },
        { min: -1, weights: { '氷雨': 40, '水縛の帯': 40, '水天葬': 20 } },
      ],
      // 名前は雨から（霧雨で身を包む→篠突く雨＝激しく降る）
      buffs: [
        { at: 0.6, name: '霧雨の帳', table: { vit: 25 } },
        { at: 0.3, name: '篠突く雨', table: { str: 25, int_stat: 25 } },
      ],
    },
    diffs: VARUZENOKU_DIFFS,
  },
}

// 「挑戦」のカテゴリ（入口の見出しとボス）。旧レイドのボスは強敵に足す予定。
//   ★八獄・天穹十二宮もカテゴリに足す予定だが、ユーザー「※まだ入れないで」＝まだ足さない
export const CHALLENGE_CATS = [
  { key: 'rival', label: '強敵', bosses: ['varuzenoku', 'amaza'] },
]

export const diffOf = (bossKey, diffKey) => DUNGEON_BOSSES[bossKey]?.diffs?.[diffKey] || null
export const isDiffReady = (bossKey, diffKey) => { const d = diffOf(bossKey, diffKey); return !!d && d.ready !== false }
// 行ったことのあるエリアの一番先（sortie.js の openAreaOf）で、その難易度を呼べるか
// 呼べるボスか（summon:false＝まだ呼べない・試し撃ちだけ）
export const isSummonable = (bossKey) => !!DUNGEON_BOSSES[bossKey] && DUNGEON_BOSSES[bossKey].summon !== false
export const isDiffUnlocked = (bossKey, diffKey, reachedArea) => isSummonable(bossKey) && isDiffReady(bossKey, diffKey) && (reachedArea || 1) >= diffOf(bossKey, diffKey).area
export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮']
// いま挑戦できないわけ（入口のボスの行に出す・挑戦できるなら null）。「挑戦する」のボタンもこれで決める＝言葉とボタンが食い違わない
//   summoned＝きょうこのボスに挑戦した／ownActive＝いま自分の挑戦中のボスがいる／reached＝行ったエリアの一番先
export const summonBlockOf = (bossKey, { summoned, ownActive, reached }) => {
  if (summoned) return '挑戦済み'
  if (ownActive) return 'いま挑戦中のボスがいます'
  if (!DIFF_KEYS.some(k => isDiffUnlocked(bossKey, k, reached))) return `エリア${CIRCLED[diffOf(bossKey, DIFF_KEYS[0]).area - 1]}に着くと挑戦できます`
  return null
}

// 挑戦1回に使うスタミナ。owner＝呼んだ人か・tries＝その人がこのボスにもう挑んだ回数
export const tryStaminaOf = (owner, tries) => (owner ? (tries > 0 ? STAMINA_OWNER : STAMINA_OWNER_FIRST) : STAMINA_HELPER)

// 戦闘用のボス（ATB の相手）。hpNow＝いまのHP（持ち越し）。最大HPは全体の hp
export const dungeonFighter = (bossKey, diffKey, hpNow = null) => {
  const b = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diffKey)
  if (!b || !isDiffReady(bossKey, diffKey)) return null
  const stats = statsOf({ power: d.power, dist: b.dist })
  stats.str = Math.round(stats.str * d.atk)
  stats.int_stat = Math.round(stats.int_stat * d.atk)
  stats.hp = d.hp
  return {
    ...CAP_RULES, name: b.name, kind: b.kind, race: b.race, boss: true, stats,
    slots: b.skills.map(skill => ({ skill, uses: 9999 })), taken: null, pattern: b.pattern,
    hpNow: hpNow == null ? null : Math.max(1, Math.min(d.hp, hpNow)),
  }
}

// 残り時間（ミリ秒）。endsAt＝ISO の時刻
export const msLeftOf = (endsAt, now = Date.now()) => Math.max(0, new Date(endsAt).getTime() - now)
