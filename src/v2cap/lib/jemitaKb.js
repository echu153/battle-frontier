// ============================================================
// バトルフロンティアⅡ（v2cap）— AI案内役「ジェミータ」に読ませるゲームの資料
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「V2でClaude Consoleを用いてジェミータを作りたい・バトルフロンティアⅡの情報を聞けば答えてくれるもの」
//   ＋ユーザー選択「画面で分かることだけ（強くなりたい質問には状況を照合してアドバイスできるように）」：
//   ・入れるのは**画面で見られること**だけ（職業と技の説明・威力の行・エリアと推奨LV・出る敵と使う状態異常・装備の名前と必要LV・
//     防具のセット能力・施設の使い方）。ここに無いことはジェミータは答えられない＝**入れないことで隠す**
//   ・入れないもの：画面に出ない確率（装備が落ちる%・遭遇率・宝箱・宝樹のくじの重み・賭博場の当たりの重み）、
//     敵の強さの数字、安息の祠（見つけてのお楽しみ）、ユニーク装備の名前と能力（図鑑からも消した・2026-10-24）、
//     看板娘・鍛冶屋の親方の名前や裏設定、まだ無い機能（対人戦の紛争地帯・景品の交換所 など）
//   ・レアモンスターとボスの名前は入れるが、こちらからは挙げない（図鑑は倒すまで ???）＝jemitaPrompt.js の決まり
// ★全部コードの値から作る（手で書いた数字を持たない）＝ゲームを変えたら `node tools/v2cap-jemita-kb.mjs` で作り直す。
//   作り直さないと jemitaKb.test.js が落ちる（資料の版 JEMITA_KB_VERSION と合わなくなる）。
//   サーバー（表 v2cap_jemita_kb）へは、道具が書く supabase_v2cap_jemita_kb.sql をユーザーが流して入れる
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../core/stats.js'
import { AIL_LABEL } from '../core/ailments.js'
import { AREA_LIST, SPOTS, LAST_SPOT, spotLabel, recLvText, recLvOf } from './areas.js'
import { dexAreaOf, dropInfoOf, DEX_ROLES, DEX_AREA_STAM } from './dex.js'
import { raceDefOf } from './monsterRace.js'
import { CLASSES, STAGES, JOB_MAX, ICHIJI_REQ_JLV, mainStatsOf, learnAtOf, nextClassesOf, jobMaxOf, ASC_AP_PER_JLV } from './jobs.js'
import { skillsOf, passiveOf, capPowerText, SKILL_SET_SLOTS } from './skills.js'
import {
  ITEMS, KINDS, RARITIES, RARITY_LABEL, REQ_LV_STEP, SLOT_LABEL, SLOTS, ARMOR_EFFECT, WEAPON_DIST, ARMOR_DIST, ACCESSORY_DIST,
  partLabel, UNIQUE_LV,
} from './equipment.js'
import { ARMOR_SETS, SET_TIERS, SET_PARTS, SET_RARITIES, setTierText } from './armorSets.js'
import { MAX_LV, POINTS_PER_LV, POINTS_STEP, POINTS_ON_STEP, POINT_UNIT, STAMINA_BASE, STAMINA_RECOVER_MS } from './level.js'
import { PLUS_MAX, PLUS_CAP, ENHANCE_RATE, SCRAP_NAMES, SCRAP_YIELD, CRAFT_RARITIES, CRAFT_SCRAP } from './smith.js'
import { SHOP_NAME, BURGERS, TOPPINGS, TOPPING_GROUPS, BURGER_GOLD, TOPPING_GOLD, MEAL_MINUTES, MEAL_STAT_PCT, TOPPING_RESIST_PCT } from './burger.js'
import { DAILY_TASKS } from './daily.js'
import { FORTUNES } from '../core/tree.js'
import { STREAK_MAX_DAY } from './tree.js'
import { MUSEUM_TIERS, MUSEUM_SET_SP, MUSEUM_RARITY_STAM_SEC, MUSEUM_AREA_STAM_SEC } from './museum.js'
import { TOWER_NAME, FLOORS, LOSE_DROP, GUARD_DROP_BONUS } from './tower.js'
import { GOLD_PER_MEDAL } from './casino.js'
import { GENDERS } from './gender.js'
import { ASC_RESET_GOLD_PER_LV } from './ascension.js'
import { V1_BOX_NAMES } from './v1carry.js'
import { JEMITA_RULES } from './jemitaPrompt.js'

const statLabel = (k) => STAT_DEFS[k]?.label || k
const AREA_MARK = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'
const areaTitle = (n) => `エリア${AREA_MARK[n - 1]}「${AREA_LIST[n - 1].name}」`
const kindText = (kind) => (kind === 'mag' ? '魔法' : '物理')
const uniq = (xs) => [...new Set(xs)]

// 状態異常の効き目（画面のログとアイコンの札で分かる範囲。数字は技の説明に書いてあるものだけ）
const AIL_TEXT = {
  bleed: '攻撃が当たるたび重なり、毎ターンHPが減る（重なるほど痛い）',
  poison: '毎ターン最大HPの割合でHPが減る（硬い相手にも通る）',
  burn: 'ターンの終わりにHPが減り、回復量も下がる',
  slow: 'AGIが下がる',
  paralyze: '1ターン動けない（同じ戦闘でかかるたび、次はかかりにくくなる）',
  healCut: '回復量が下がる',
  silence: 'スキルが出にくくなる',
  blind: '攻撃が当たりにくくなる',
  curse: '受けるダメージが増える',
  frenzy: '出る技がランダムになる',
  weaken: '与えるダメージが減る（物理も魔法も）',
  seal: 'MPを使う技が出せず通常攻撃になる（同じ戦闘でかかるたび、次はかかりにくくなる）',
  fear: 'スキルの発動率が下がる',
}

// 敵が使う状態異常（技の ail から）
const ailsOfEnemy = (e) => uniq((e.skills || []).map(s => s.ail?.key).filter(Boolean)).map(k => AIL_LABEL[k] || k)

// 種類の配分の上位2つ（どのステが伸びる装備か。装備のカーソルで出る中身と同じ）
const topStats = (dist, n = 2) => Object.entries(dist || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => statLabel(k)).join('・')

// ===== 1. 基本 =====
const basics = () => {
  const unit = STAT_KEYS.map(k => `${statLabel(k)}+${POINT_UNIT[k]}`).join('・')
  const stats = STAT_KEYS.map(k => `- ${statLabel(k)}（${STAT_DEFS[k].jp}）：${STAT_DEFS[k].detail}`).join('\n')
  const sexes = GENDERS.map(g => `${g.label}＝${g.text}`).join('・')
  return [
    '## 基本',
    '- ソロのゲーム（パーティは無い）。キャラを作って出撃で敵と戦い、LVと装備を上げて先のエリアへ進む。',
    `- LVの上限はLV${MAX_LV}。LVが上がるとステータスポイントが${POINTS_PER_LV}点（LV${POINTS_STEP}の倍数では${POINTS_ON_STEP}点）入り、好きなステに振れる（1点で ${unit}）。`,
    `- 性別はキャラ作成のときに選ぶ：${sexes}（戦闘の中だけ）。`,
    '- 戦闘力＝ステの合計の目安。推奨LVより低くても、戦闘力が高ければ勝てることがある。',
    '',
    '### ステータス',
    stats,
    '',
    '### 職業とCLASS LV',
    `- 職業は初期職${CLASSES.filter(c => c.stage === 'shoki').length}・上位職${CLASSES.filter(c => c.stage === 'ichiji').length}。神殿で転職する。CLASS LVは職業ごとに持ち、戻れば続きから。`,
    `- CLASS LVの上限は初期職${JOB_MAX}・上位職${STAGES.ichiji.max}。CLASS EXPは今の職業にだけ入る（戦闘で入ったEXPと同じ量）。`,
    `- 初期職のCLASS LV${ICHIJI_REQ_JLV}で、その系統の上位職（2つ）に転職できる。上位職は元の初期職の技もそのまま使える。`,
    '- CLASS LVが上がると、その職業で伸びるステが増える（その職業でいるあいだだけ）。技はCLASS LV1から3ずつ上がるたびに上から順に覚える。',
    `- スキルセット：職業ごとに技を${SKILL_SET_SLOTS}枠まで並べ、枠ごとに使う回数を決める。戦闘では上の枠から順に1回ずつ撃ち、一巡したらまた上から（回数を使い切った枠・MPが足りない枠は飛ばす）。`,
    '- 技には発動率がある。不発のときはMPも回数も減らず、次のターンに同じ枠を撃ち直す（発動率の低い技を上に置くとそこで詰まる）。不発のターンと撃てる枠が無いときは通常攻撃。',
    '- 編成の「消費MP×回数」の合計は最大MPまで。',
    `- アセンション：CLASS LVが1上がるごとにAP${ASC_AP_PER_JLV}。盤面のマスを開くとステや技が強くなる（つながったマスだけ開ける）。振り直しはGold（LV×${ASC_RESET_GOLD_PER_LV}G）。`,
    '',
    '### スタミナと出撃',
    `- スタミナの最大は${STAMINA_BASE}＋（LV−1）。${Math.round(STAMINA_RECOVER_MS / 60000)}分ごとに1回復。オート出撃で1回ごとに1使う。手動の出撃（右下の出撃ボタン）はスタミナを使わない。`,
    '- 出撃は場所を選んで戦う。場所のボスを倒すと次の場所が開く。勝つとEXP・Gold、ときどき装備。ボスはまれにユニーク装備を落とす。',
    '- 敵には通常・時間帯（朝5〜13時／昼13〜21時／晩21〜5時に出る）・レア・ボスがいる。',
    `- 推奨LV＝その場所のボスを倒せる目安のLV。最後の場所は推奨LV${recLvOf(LAST_SPOT)}。`,
    '- 装備が入らなかった勝ちで、まれに宝箱（その場所のエリアの残骸）が見つかる。',
  ].join('\n')
}

// ===== 2. 職業 =====
const skillLine = (cls) => {
  const at = learnAtOf(cls)
  return skillsOf(cls).map((s, i) => {
    const pw = capPowerText(s)
    const showPw = (s.kind === 'phys' || s.kind === 'mag' || s.kind === 'heal') && pw && pw !== s.desc
    const parts = [`MP${s.mp}`, `発動率${s.proc}%`]
    if (showPw) parts.push(pw)
    return `  - CLASS LV${at[i] ?? '?'} ${s.name}（${parts.join('・')}）：${s.desc || ''}`.replace(/：$/, '')
  }).join('\n')
}
const classes = () => {
  const out = ['## 職業']
  for (const c of CLASSES) {
    const stage = STAGES[c.stage]?.label
    const head = c.stage === 'ichiji'
      ? `### ${c.id}（${stage}職・${c.req.cls}のCLASS LV${c.req.jlv}から・${kindText(c.kind)}・CLASS LV上限${jobMaxOf(c.id)}）`
      : `### ${c.id}（${stage}職・${kindText(c.kind)}・CLASS LV上限${jobMaxOf(c.id)}）`
    out.push(head)
    out.push(`- 特徴：${c.desc}`)
    out.push(`- 装備できる武器：${(c.weapons || []).join('・')}`)
    out.push(`- CLASS LVでよく伸びるステ：${mainStatsOf(c.id).map(statLabel).join('・')}`)
    const next = nextClassesOf(c.id)
    if (next.length) out.push(`- 上位職：${next.join('・')}`)
    const p = passiveOf(c.id)
    if (p) out.push(`- パッシブ「${p.name}」：${p.desc}`)
    out.push('- 技：')
    out.push(skillLine(c.id))
  }
  return out.join('\n')
}

// ===== 3. エリアと敵 =====
const roleLabel = Object.fromEntries(DEX_ROLES.map(r => [r.key, r.label]))
const enemyTag = (e, src) => {
  const race = raceDefOf(e.name)?.label
  const ails = ailsOfEnemy(src || {})
  return `${e.name}（${[kindText(e.kind), race, ...(ails.length ? [`${ails.join('・')}を使う`] : [])].filter(Boolean).join('・')}）`
}
const areas = () => {
  const out = ['## エリアと場所（出撃）']
  const drops = Object.fromEntries(DEX_ROLES.map(r => [r.key, dropInfoOf(r.key).rarities.map(x => RARITY_LABEL[x]).join('・')]))
  out.push(`- 落とす装備のレア度：${DEX_ROLES.map(r => `${r.label}＝${drops[r.key]}`).join('／')}（そのエリアの装備が落ちる）`)
  out.push(`- モンスター図鑑：エリアの20体（通常6・時間帯6・レア5・ボス3）を全員倒すと、スタミナの最大値+${DEX_AREA_STAM}（ずっと）。倒すまでは名前が ??? になっている。`)
  for (let n = 1; n <= AREA_LIST.length; n++) {
    out.push(`### ${areaTitle(n)}`)
    const rows = dexAreaOf(n)
    const srcOf = Object.fromEntries(SPOTS.filter(s => s.area === n).flatMap(s => [
      ...s.roster.enemies, ...s.roster.timed, ...s.roster.rares, s.roster.boss,
    ]).map(e => [e.name, e]))
    for (const s of SPOTS.filter(x => x.area === n)) {
      const here = rows.filter(e => e.spots.includes(s.id))
      const normal = here.filter(e => e.role === 'normal').map(e => enemyTag(e, srcOf[e.name])).join('、')
      const boss = here.filter(e => e.role === 'boss').map(e => enemyTag(e, srcOf[e.name])).join('、')
      out.push(`- ${spotLabel(s.id)}（${recLvText(s.id)}）通常：${normal}／ボス：${boss}`)
    }
    const timed = rows.filter(e => e.role === 'timed').map(e => `${e.band}・${enemyTag(e, srcOf[e.name])}`).join('、')
    const rare = rows.filter(e => e.role === 'rare').map(e => enemyTag(e, srcOf[e.name])).join('、')
    out.push(`- ${roleLabel.timed}（エリアのどの場所にも出る）：${timed}`)
    out.push(`- ${roleLabel.rare}（エリアのどの場所にも出る）：${rare}`)
  }
  return out.join('\n')
}

// ===== 4. 装備 =====
const gear = () => {
  const out = ['## 装備']
  out.push(`- 枠：${SLOTS.map(s => SLOT_LABEL[s]).join('・')}。レア度は ${RARITIES.map(r => RARITY_LABEL[r]).join('→')} の順に強い（その上にボスだけが落とすユニーク・必要LV${UNIQUE_LV}）。`)
  out.push(`- 必要LV＝${REQ_LV_STEP}×エリアの番号（ノーマル）。レア度が1つ上がるごとに+${REQ_LV_STEP}。必要LVに足りない装備も着けられるが、強さは「いまのLVの同じレア度・種類の装備」と同じまで下がる（要求LV不足と出る）。`)
  out.push(`- 防具は重鎧（${ARMOR_EFFECT.重鎧.label}）と軽装（${ARMOR_EFFECT.軽装.label}）の2系統。どの職業も両方着られる。`)
  out.push('- 種類ごとに伸びるステ：')
  out.push(`  - 武器：${Object.keys(WEAPON_DIST).map(t => `${t}＝${topStats(WEAPON_DIST[t])}`).join('／')}`)
  out.push(`  - 防具：${Object.entries(ARMOR_DIST).flatMap(([line, parts]) => Object.keys(parts).map(p => `${line}${p}＝${topStats(parts[p])}`)).join('／')}`)
  out.push(`  - 装飾品：${Object.keys(ACCESSORY_DIST).map(t => `${t}＝${topStats(ACCESSORY_DIST[t])}`).join('／')}`)
  out.push('- 名前の一覧（エリアごと・ノーマル／レア／エピック／レジェンダリー）：')
  for (let n = 1; n <= AREA_LIST.length; n++) {
    const list = KINDS.map(k => {
      const names = RARITIES.map(r => ITEMS.find(i => i.area === n && i.rarity === r && i.kind === k.key)?.name || '-')
      return `${k.part === '武器' ? k.type : k.part === 'アクセ' ? k.type : `${k.line}${partLabel(k.part)}`}：${names.join('／')}`
    })
    out.push(`  - ${areaTitle(n)}：${list.join('、')}`)
  }
  out.push('')
  out.push('### 防具のセット能力')
  out.push(`- ${SET_RARITIES.filter(r => r !== 'U').map(r => RARITY_LABEL[r]).join('・')}以上の、同じエリアで同じ系統（重鎧／軽装）の防具（${SET_PARTS.join('・')}）を${SET_TIERS[0]}部位以上そろえると効く。`)
  for (let n = 1; n <= ARMOR_SETS.length; n++) {
    const def = ARMOR_SETS[n - 1]
    out.push(`- ${areaTitle(n)}：2部位＝${setTierText(def, 2)}／3部位＝${setTierText(def, 3)}／4部位 重鎧＝${setTierText(def, 4, '重鎧')}／4部位 軽装＝${setTierText(def, 4, '軽装')}`)
  }
  return out.join('\n')
}

// ===== 5. 施設 =====
const facilities = () => {
  const rates = ENHANCE_RATE.map((r, i) => `+${i + 1}＝${r}%`).join('・')
  const burgers = BURGERS.map(b => `${b.name}（${statLabel(b.stat)}+${MEAL_STAT_PCT}%）`).join('・')
  const tops = TOPPING_GROUPS.map(g => `${g.label}：${TOPPINGS.filter(t => t.group === g.key).map(t => `${t.name}（${AIL_LABEL[t.ail]}）`).join('・')}`).join('／')
  return [
    '## 施設',
    '### 鍛冶屋（強化・分解・作成）',
    `- 強化：+${PLUS_MAX}まで。成功率は ${rates}（画面に出る）。Goldと、その装備のエリアの残骸を使う（ノーマルはGoldだけ）。`,
    `- 分解：装備を残骸にする（${RARITIES.map(r => `${RARITY_LABEL[r]}${SCRAP_YIELD[r]}個`).join('・')}）。残骸はエリアごと（${SCRAP_NAMES.slice(0, 3).join('・')}…）。`,
    `- 作成：残骸とGoldで、${CRAFT_RARITIES.map(r => `${RARITY_LABEL[r]}（残骸${CRAFT_SCRAP[r]}個）`).join('・')}の装備を作れる（そのエリアの装備）。`,
    `- V1からの引き継ぎでもらえる券を使うと、ユニークをその券の強化値（最大+${PLUS_CAP}）にできる。`,
    '### 神殿',
    '- 転職する。初期職どうしはいつでも、上位職は条件（元の初期職のCLASS LV）を満たすと就ける。',
    `### ${SHOP_NAME}（ハンバーガー屋）`,
    `- バーガー${BURGER_GOLD.toLocaleString()}Gで${MEAL_MINUTES}分、ステ1つ+${MEAL_STAT_PCT}%：${burgers}。`,
    `- トッピング：メジャー・マイナーをそれぞれ${TOPPING_GOLD}Gで付けられ、付けたグループの中から抽選で1つ選ばれ、その状態異常にかかる確率−${TOPPING_RESIST_PCT}%（食事のあいだ）。${tops}。`,
    '- 店には看板娘がいる。',
    '### 今日のミッション（デイリー）',
    `- 毎朝5時に切り替わり、自動で受注。${DAILY_TASKS.map(t => `${t.label}（${t.goal}${t.unit}）`).join('・')}。全部終えるとEXPとGold（LVに応じた量）。`,
    '### ユグレシアの宝樹',
    `- 1日1回祈れる（朝5時に切り替わる）。くじの結果（${FORTUNES.map(f => f.name).join('・')}）でEXPがもらえる。毎日続けて祈るとボーナスが増える（${STREAK_MAX_DAY}日まで）。`,
    '### モンスター図鑑',
    '- 倒した敵が載る（討伐数・出る場所・物理か魔法か・落とす装備のレア度・種族）。',
    '### 博物館',
    `- 装備を寄贈して登録する（寄贈した装備はなくなる）。登録できる強化値は ${MUSEUM_TIERS.map(t => t.label).join('・')}。`,
    `- 報酬：同じエリア・同じレア度の装備を、ある強化値で全種類そろえるとステータスポイント（${RARITIES.map(r => `${RARITY_LABEL[r]}${MUSEUM_SET_SP[r]}`).join('・')}）。そのレア度を3つの強化値すべてでそろえるとスタミナの回復−${MUSEUM_RARITY_STAM_SEC}秒。エリアをコンプリートするとさらに−${MUSEUM_AREA_STAM_SEC}秒。ユニークは寄贈できない。`,
    `### ${TOWER_NAME}`,
    `- 1〜${FLOORS}層。その層の階層守護者（ほかのプレイヤーの写し、いなければNPC）に挑む。勝つとその層の守護者になり、負けると${LOSE_DROP}層下がる。`,
    `- 守護者でいるあいだは出撃の装備のドロップ率+${GUARD_DROP_BONUS}%。守っているあいだは挑戦できない。`,
    '### 賭博場',
    `- Goldをメダルに替えて遊ぶ（${GOLD_PER_MEDAL}G＝1枚）。スロット・ハイ&ロー・ルーレット。`,
    '### V1からの引き継ぎ',
    `- V1のキャラがあると、Ⅱのキャラ作成のときに引き継げる：EXPのボーナス・いちばん強化した装備に見合うユニークと強化の券・${Object.values(V1_BOX_NAMES).join('と')}（中身は残骸）。`,
  ].join('\n')
}

// ===== 6. 状態異常 =====
const ailments = () => [
  '## 状態異常',
  ...Object.keys(AIL_TEXT).map(k => `- ${AIL_LABEL[k]}：${AIL_TEXT[k]}`),
  '- 同じ状態異常は重ならず上書き（出血だけは重なる）。ハンバーガー屋のトッピングと、防具のセット能力（2部位）でかかりにくくできる。',
].join('\n')

// 資料の全文（# の見出し＋各章）。並びを変えると版が変わる
export const buildJemitaKb = () => [
  '# バトルフロンティアⅡ ゲーム資料',
  basics(),
  ailments(),
  classes(),
  areas(),
  gear(),
  facilities(),
].join('\n\n') + '\n'

// 文字列の短い指紋（FNV-1a 32bit）。資料の版に使う（ブラウザでも Node でも同じ値）
export const fingerprint = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// 決まり（jemitaPrompt.js）と資料をまとめた版。どちらかが変われば変わる
export const jemitaVersionOf = (rules = JEMITA_RULES, body = buildJemitaKb()) => fingerprint(`${rules}\n\n${body}`)

// サーバーの表 v2cap_jemita_kb へ入れる SQL（道具 tools/v2cap-jemita-kb.mjs がファイルに書く）
const SQL_TAG = '$jemita_kb$'
export const buildJemitaSql = (rules = JEMITA_RULES, body = buildJemitaKb()) => {
  if (rules.includes(SQL_TAG) || body.includes(SQL_TAG)) throw new Error(`資料の中に ${SQL_TAG} がある`)
  const version = jemitaVersionOf(rules, body)
  return [
    '-- ============================================================',
    '-- バトルフロンティアⅡ（v2cap）— ジェミータの資料（自動で作ったファイル・手で直さない）',
    '--   作り方：node tools/v2cap-jemita-kb.mjs（元は src/v2cap/lib/jemitaKb.js と jemitaPrompt.js）',
    '--   ★先に supabase_v2cap_jemita.sql を流しておく。何度流してもよい（1行を上書きする）',
    `--   版 ${version}・決まり ${rules.length.toLocaleString()}字・資料 ${body.length.toLocaleString()}字`,
    '-- ============================================================',
    'insert into public.v2cap_jemita_kb (id, version, rules, body, updated_at)',
    `values (1, '${version}', ${SQL_TAG}${rules}${SQL_TAG}, ${SQL_TAG}${body}${SQL_TAG}, now())`,
    'on conflict (id) do update set version = excluded.version, rules = excluded.rules, body = excluded.body, updated_at = now();',
    '',
    `select version, length(rules) as rules_chars, length(body) as body_chars, updated_at from public.v2cap_jemita_kb;`,
    '',
  ].join('\n')
}
