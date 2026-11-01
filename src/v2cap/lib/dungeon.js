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
//   ・報酬はボスの専用の装備（あとで作る）と、削った量での差
//   ・ボスの技：HPの節目（75%・50%・25%）で1回ずつ必ず撃ち、そのあとも確率で使う・HP50%以下は毎回技（atb.js の pattern）
// 【確定】2026-10-31 ユーザー「これは『挑戦』にして」「ここに『強敵』ってカテゴリを作って、ここにヴァルゼノクとあまざ入れて、ここに旧レイドのボスを入れる予定」＋選択「ボスごとに1日1回」：
//   メニューの名前は「挑戦」（コードと DB の dungeon の名前はそのまま）。呼べるのは**ボスごとに1日1回**・同時に1体
// 【確定】2026-10-31 ユーザー選択「EXPとGoldを渡す」：倒したら EXP と Gold（diffs の reward）。呼んだ人は全部・救援の人は削った割合（最低 HELPER_REWARD_MIN_PCT%）・ダメージ0は無し。
//   【確定】2026-11-01 ユーザー「後報酬は1人で倒されずにソロ攻略したら報酬豪華になるようにして」→選択「3倍なんだけど、今の報酬が少し大きすぎるから半分にして」：
//   基本の報酬を半分に・ひとりで倒されずに倒したら SOLO_REWARD_MULT 倍（ほかの人が1回も挑んでいない・負け／途中でやめた／戻らなかった挑戦が無い。時間切れは負けではない）
//   【確定】同じ日 ユーザー選択「信号を出す人の条件」：救援信号は1回挑戦してから。救援に入る人に条件は付けない
//   渡すのはサーバー（v2cap_dungeon_pay_reward）。自分の挑戦の終わりで倒れていたらその場で、その場にいなかった人は入口で受け取る。
// 【確定】2026-10-31 ユーザー選択「サーバーの計算で入れる」：削った量はサーバーが同じ戦闘を回し直して決める（dungeonVerify.js）。画面の申告は比べるだけ
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
export const HELPER_REWARD_MIN_PCT = 30 // 救援の人の報酬の最低の割合（%）
export const SOLO_REWARD_MULT = 3      // ひとりで倒されずに倒したときの報酬の倍率

export const DIFF_KEYS = ['normal', 'hard', 'expert', 'master']
export const DIFF_COLOR = { normal:'#66dd88', hard:'#ffaa44', expert:'#ff5566', master:'#cc77ff' }   // 難易度の文字の色（入口・報酬画面）

// ボス。dist＝戦闘力に対するステの割合（%）・skills＝技（倍率・状態異常）・pattern＝技の出し方・diffs＝難易度ごとの強さ
//   diffs の中身：area＝呼べるようになるエリア・recLv＝推奨LV・recPower＝推奨戦闘力・power＝守りと速さの戦闘力・atk＝攻撃（STR・INT）だけの倍率・hp＝全体のHP
//   power と atk・hp は測って決めた（推奨戦闘力の人で：半分は1回の挑戦で負けずに倒し、残りは2回目で倒す）。
//   power は推奨LVの場所のボスの戦闘力（ノーマル＝②-③の474・ハード＝⑥-①959と⑥-②1163の間を推奨LVで割った1027）
//     reward＝倒したときの報酬（EXP＝推奨の場所のボス5体ぶん・Gold＝推奨LV×50＝デイリー半分）
//   ready:false の難易度はまだ呼べない（数字を決めていない）
//   summon:false のボスはまだ呼べない（試し撃ちだけ。いまは無い）
// 黒龍の強さ（雨摩座とゼルギアスも同じ数字を使う）
const VARUZENOKU_DIFFS = {
  // 2026-10-29 鈍足を「ゲージ20%遅く」にしてエンジンで測り直した（前はノーマル 攻撃0.42倍・HP7000）。
  //   ノーマル：0.42倍・7000だと1回で倒せたのが22人中6人に減った → 0.35倍・6500で12人（残りも全員2回目）
  //   ハード：0.42倍だと3回かかる人が1人いた → 0.4倍で22人中13人が1回・全員2回まで
  // 2026-10-30 HPの節目のバフ（60%で守り+25%・30%で攻撃+25%）を入れて測り直した（HPはそのまま＝サーバーの表は変えない）：
  //   ノーマル：0.35倍のままだと1回で倒せたのが22人中10人 → 0.33倍で12人（全員2回まで）
  //   ハード：0.4倍のままだと12人・3回かかる人が1人 → 0.38倍で12人（全員2回まで）
  // 2026-10-30 25%の大技が切ってすぐ出る（防御が間に合いにくい）ようにして測り直した：
  //   ノーマル：0.33倍のまま11人（全員2回まで）／ハード：0.38倍のままだと11人・3回かかる人が1人（聖騎士）→ 0.36倍で12人（全員2回まで）
  // 【確定】2026-11-01 ユーザー「レイドボスのHP少ない気がするから2倍ぐらいにしてほしい」→選択「2倍」：ノーマル 6500→13000・ハード 15000→30000（攻撃はそのまま）。
  //   測り直し（22人×3通りの乱数＝66回）：1回で倒せた ノーマル 27〜29→0〜1回／ハード 21〜26→0回。3回以上 40〜48回。合計 約2分→約4分。
  //   完全ソロ討伐は推奨戦闘力ではほぼ無理＝強くなってから狙う形（ユーザーが選んだ）
  // 【確定】2026-11-01 ユーザー「攻撃倍率少し上げていい」（技の調整と一緒に）：0.33→0.36・0.36→0.40（どちらも約1割）
  normal: { label: 'ノーマル', area: 2, recLv: 25, recPower: 500, power: 474, atk: 0.36, hp: 13000, reward: { exp: 175, gold: 1250 } },
  hard: { label: 'ハード', area: 5, recLv: 45, recPower: 1050, power: 1027, atk: 0.4, hp: 30000, reward: { exp: 350, gold: 2250 } },
  expert: { label: 'エキスパート', area: 8, recLv: 65, ready: false },
  master: { label: 'マスター', area: 12, recLv: 80, ready: false },
}
// 【確定】2026-11-01 ユーザーの調整（技リストを見て）：
//   黒龍＝ハードから黒爪に出血20%・黒翼烈風は鈍足をやめて2回の多段（合計1.8倍のまま）で1発ごとに出血50%・終焉の黒焔は4倍＋回復阻害（回復量−30%）
//   雨摩座＝ハードから雨礫に鈍足20%・水縛の帯は魔法に・篠突く雨は INT+35%（STRは上げない）・水天葬は4倍＋相手のHPが40%未満なら1.5倍／10%以下なら3倍（重ねない）
//   hardNormalAil＝ハードから通常攻撃に付く状態異常（dungeonFighter が normalAil にする）
// 【確定】2026-10-31 ユーザー「モンスターの能力ちょっと低いかも、AGIとDEXもう少し上げていい」：配分 DEX 7→12・AGI 7→8（ノーマル DEX33→57・AGI33→38／ハード DEX72→123・AGI72→82）。
//   HP の配分は使っていない（難易度の hp で決まる）ので、そこから移して合計100のまま。同じ強さの場所のボス（盗賊団のリーダー）は DEX12・AGI9。攻撃の倍率は変えない。
//   測り直し（22人×3通りの乱数＝66回。1回で倒せた・3回以上かかった・ボスの攻撃の外れ）：ノーマル 37〜38→26〜29回・0→0回・26%→12〜15%／ハード 37〜43→20〜24回・0〜1→1〜2回・22%→12%。
//   DEX12・AGI9 だと 1回で倒せるのが21〜23回／18〜21回・ハードで3回以上が4〜5回に増えた（上げすぎ）
export const DUNGEON_BOSSES = {
  varuzenoku: {
    name: '黒龍ヴァルゼノク', kind: 'phys', race: 'ドラゴン',
    dist: { hp: 34, mp: 6, str: 16, dex: 12, agi: 8, int_stat: 12, vit: 9, luk: 3 },
    // 通常攻撃が黒爪（物理1.0倍）。技は節目で出る3つ（proc は100＝クールダウンは使わない・パターンが決める）
    hardNormalAil: { key: 'bleed', chance: 20 },
    skills: [
      { name: '焦熱の吐息', kind: 'mag', mult: 1.6, proc: 100, mp: 0, ail: { key: 'burn', chance: 70 } },
      { name: '黒翼烈風', kind: 'phys', mult: 0.9, hits: 2, proc: 100, mp: 0, ail: { key: 'bleed', chance: 50 }, ailPerHit: true },
      // 倍率2.5以上＝撃つ前に構え（防御で半分）。【確定】2026-10-30 ユーザー「溜めモーションは4秒でいい」：
      //   castSec＝構えの長さ 3.5秒（このあと吐く直前に引く0.5秒＝lib/bossIllust.js の castSkipMs から吐くまで）＝構えはじめから吐くまで4秒
      { name: '終焉の黒焔', kind: 'mag', mult: 4.0, proc: 100, mp: 0, castSec: 3.5, ail: { key: 'healCut', chance: 100, pct: 30 } },
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
        // 【確定】2026-11-01 ユーザー「HP25％以下の大技使用率もう少し上げてほしい、3回に1回くらいうつ感じで」：大技の直後は大技を引かない（atb.js の patternPick）ので、
        //   引ける番の50%で行動3回に1回になる（33%だと4回に1回・前の20%は6回に1回）
        { min: -1, weights: { '焦熱の吐息': 25, '黒翼烈風': 25, '終焉の黒焔': 50 } },
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
    dist: { hp: 34, mp: 6, str: 12, dex: 12, agi: 8, int_stat: 16, vit: 9, luk: 3 },
    // 通常攻撃が雨礫（魔法1.0倍）
    hardNormalAil: { key: 'slow', chance: 20 },
    skills: [
      { name: '氷雨', kind: 'mag', mult: 1.6, proc: 100, mp: 0, ail: { key: 'slow', chance: 70 } },
      { name: '水縛の帯', kind: 'mag', mult: 1.8, proc: 100, mp: 0, ail: { key: 'paralyze', chance: 30 } },
      // 倍率2.5以上＝撃つ前に構え（防御で半分）。黒龍の終焉の黒焔と同じ（ユーザー「同じにする」）：構え3.5秒＋振り下ろす直前の0.5秒＝振り下ろすまで4秒
      { name: '水天葬', kind: 'mag', mult: 4.0, proc: 100, mp: 0, castSec: 3.5, hpSteps: [{ below: 40, mult: 1.5 }, { upTo: 10, mult: 3 }] },
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
        { min: -1, weights: { '氷雨': 25, '水縛の帯': 25, '水天葬': 50 } },   // 行動3回に1回（黒龍と同じ）
      ],
      // 名前は雨から（霧雨で身を包む→篠突く雨＝激しく降る）
      buffs: [
        { at: 0.6, name: '霧雨の帳', table: { vit: 25 } },
        { at: 0.3, name: '篠突く雨', table: { int_stat: 35 } },
      ],
    },
    diffs: VARUZENOKU_DIFFS,
  },
  // 【確定】2026-11-01 ユーザー「ゼルギアスと閻魔も一緒に作りたい」→技の案に「これでいい」→「進めて」：3体目。ぜんぶ物理の機神。
  //   節目・技の出る割合・強さ（diffs）は黒龍と同じ。種族は魔物（機神は生き物でないので、いろいろなものが混ざった魔物へ）
  //   測った（22人×3通りの乱数＝66回。職ごとの挑戦回数の平均・合計の時間の平均）：ノーマル 3.7回・251秒（雨摩座 3.3回・259秒／黒龍 3.0回・227秒）／ハード 4.8回・296秒（4.2回・298秒／3.4回・247秒）
  zerugiasu: {
    name: '雷鋼機神ゼルギアス', kind: 'phys', race: '魔物',
    dist: { hp: 34, mp: 6, str: 16, dex: 12, agi: 8, int_stat: 12, vit: 9, luk: 3 },
    // 通常攻撃が雷鋼弾（物理1.0倍）
    hardNormalAil: { key: 'blind', chance: 20 },
    skills: [
      { name: '雷霆掃射', kind: 'phys', mult: 0.55, hits: 3, proc: 100, mp: 0, ail: { key: 'silence', chance: 70 } },
      { name: '神雷崩撃', kind: 'phys', mult: 1.8, proc: 100, mp: 0, ail: { key: 'paralyze', chance: 40 } },
      // 倍率2.5以上＝撃つ前に構え（防御で半分）。構えは黒龍と同じ4秒。必ず当たる・麻痺していると1.5倍（当てると麻痺は消える）
      { name: '神雷終焉', kind: 'phys', mult: 4.0, proc: 100, mp: 0, castSec: 3.5, sureHit: true, burstAil: { key: 'paralyze', perStack: 0.5 } },
    ],
    pattern: {
      steps: [
        { at: 0.75, skill: '雷霆掃射' },
        { at: 0.5, skill: '神雷崩撃' },
        { at: 0.25, skill: '神雷終焉', now: true },   // 切ったらゲージを待たずに構えに入る（黒龍と同じ）
      ],
      bands: [
        { min: 0.75, weights: {} },
        { min: 0.5, weights: { '雷霆掃射': 30 } },
        { min: 0.25, weights: { '雷霆掃射': 50, '神雷崩撃': 50 } },
        { min: -1, weights: { '雷霆掃射': 25, '神雷崩撃': 25, '神雷終焉': 50 } },   // 行動3回に1回（黒龍と同じ）
      ],
      // 名前は機神の体から（鋼の装甲で固める→炉心が臨界を超えて攻めも速さも上がる）
      buffs: [
        { at: 0.6, name: '雷鋼装甲', table: { vit: 25 } },
        { at: 0.3, name: '炉心臨界', table: { str: 25, agi: 25 } },
      ],
    },
    diffs: VARUZENOKU_DIFFS,
  },
}

// 「挑戦」のカテゴリ（入口の見出しとボス）。旧レイドの残りの1体（閻魔）も四凶に足す予定。
//   【確定】2026-11-01 ユーザー「今の強敵のグループ名を良い感じに変えたい」→選んだ「四凶」（しきょう・八獄と同じ「数＋不吉な字」・「四強」と同じ読み）。key はそのまま
//   ★八獄・天穹十二宮もカテゴリに足す予定だが、ユーザー「※まだ入れないで」＝まだ足さない
export const CHALLENGE_CATS = [
  { key: 'rival', label: '四凶', bosses: ['varuzenoku', 'amaza', 'zerugiasu'] },
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
    normalAil: b.hardNormalAil && diffKey !== 'normal' ? b.hardNormalAil : null,
    hpNow: hpNow == null ? null : Math.max(1, Math.min(d.hp, hpNow)),
  }
}

// 貢献度（%）：与えたダメージがボスの全体のHPの何割か（ユーザー「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」）。
//   救援の人の報酬の割合と同じ物差し。同じときに殴っていると合計が100%を超えることがあるので、1人ぶんは100%まで
export const contributionPctOf = (damage, hpMax) => Math.min(100, (Number(damage) / Math.max(1, Number(hpMax))) * 100)

// 残り時間（ミリ秒）。endsAt＝ISO の時刻
export const msLeftOf = (endsAt, now = Date.now()) => Math.max(0, new Date(endsAt).getTime() - now)
