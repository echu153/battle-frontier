// ============================================================
// 「レベルキャップあり」版（v2cap）— IDダンジョン（ボスを呼び、HPを持ち越して倒す・ATB戦闘）
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
// ⚠数値の正はこのファイル。supabase_v2cap_dungeon_20261029.sql に同じ値（HP・スタミナ・時間・回数・人数・解禁のエリア）があり、
//   dungeon.test.js が突き合わせる（片方だけ直すと落ちる）
// ============================================================
import { statsOf } from '../core/enemies.js'
import { CAP_RULES } from './rules.js'

export const DUNGEON_MIN = 90          // 呼んだときから倒せる時間（分）
export const DUNGEON_TRY_SEC = 180     // 挑戦1回の長さ（秒）＝ATBの時間切れ
export const SUMMONS_PER_DAY = 1       // 全部の難易度を合わせて1日に呼べる回数
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
export const DUNGEON_BOSSES = {
  varuzenoku: {
    name: '黒龍ヴァルゼノク', kind: 'phys', race: 'ドラゴン',
    dist: { hp: 40, mp: 6, str: 16, dex: 7, agi: 7, int_stat: 12, vit: 9, luk: 3 },
    // 通常攻撃が黒爪（物理1.0倍）。技は節目で出る3つ（proc は100＝クールダウンは使わない・パターンが決める）
    skills: [
      { name: '焦熱の吐息', kind: 'mag', mult: 1.6, proc: 100, mp: 0, ail: { key: 'burn', chance: 70 } },
      { name: '黒翼烈風', kind: 'phys', mult: 1.8, proc: 100, mp: 0, ail: { key: 'slow', chance: 50 } },
      { name: '終焉の黒焔', kind: 'mag', mult: 3.0, proc: 100, mp: 0 },   // 倍率2.5以上＝撃つ前に構え（5秒・防御で半分）
    ],
    pattern: {
      steps: [
        { at: 0.75, skill: '焦熱の吐息' },
        { at: 0.5, skill: '黒翼烈風' },
        { at: 0.25, skill: '終焉の黒焔' },
      ],
      bands: [
        { min: 0.75, weights: {} },                                                       // 75%より上＝黒爪だけ
        { min: 0.5, weights: { '焦熱の吐息': 30 } },                                      // 残りは黒爪
        { min: 0.25, weights: { '焦熱の吐息': 50, '黒翼烈風': 50 } },                     // 50%以下は毎回技
        { min: -1, weights: { '焦熱の吐息': 40, '黒翼烈風': 40, '終焉の黒焔': 20 } },
      ],
    },
    diffs: {
      // 2026-10-29 鈍足を「ゲージ20%遅く」にしてエンジンで測り直した（前はノーマル 攻撃0.42倍・HP7000）。
      //   ノーマル：0.42倍・7000だと1回で倒せたのが22人中6人に減った → 0.35倍・6500で12人（残りも全員2回目）
      //   ハード：0.42倍だと3回かかる人が1人いた → 0.4倍で22人中13人が1回・全員2回まで
      normal: { label: 'ノーマル', area: 2, recLv: 25, recPower: 500, power: 474, atk: 0.35, hp: 6500 },
      hard: { label: 'ハード', area: 5, recLv: 45, recPower: 1050, power: 1027, atk: 0.4, hp: 15000 },
      expert: { label: 'エキスパート', area: 8, recLv: 65, ready: false },
      master: { label: 'マスター', area: 12, recLv: 80, ready: false },
    },
  },
}

export const diffOf = (bossKey, diffKey) => DUNGEON_BOSSES[bossKey]?.diffs?.[diffKey] || null
export const isDiffReady = (bossKey, diffKey) => { const d = diffOf(bossKey, diffKey); return !!d && d.ready !== false }
// 行ったことのあるエリアの一番先（sortie.js の openAreaOf）で、その難易度を呼べるか
export const isDiffUnlocked = (bossKey, diffKey, reachedArea) => isDiffReady(bossKey, diffKey) && (reachedArea || 1) >= diffOf(bossKey, diffKey).area

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
