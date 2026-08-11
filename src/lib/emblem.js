// ============================================================
// 紋章（もんしょう）— 第5の装備枠 データ定義
// ------------------------------------------------------------
// ・全プレイヤーに1つ自動付与（player_emblem テーブル・LV1/上限値1から）
// ・レベル＝結晶を振れる「上限値」。レベルが上がってもステは増えない。
// ・レベルアップは八獄でドロップする「紋章の成長石」を消費（emblem_level_up RPC）
// ・LV100/125/150/175 で上限開放が必要（八獄ボス8体の魂、175は＋記憶8種）
// ・能力は「結晶」を1個使うごとに+1（1項目MAX50・合計はレベルまで）
// ・現状【is_admin開発限定】で公開
// ============================================================

// 結晶の使用個数（合計振り数）→ランク（表示用）
// ※2026-07-16変更: ランクはレベルではなく「結晶を使った個数」で決まる
export const EMBLEM_RANKS = [
  { max: 20,  rank: 'F' },
  { max: 40,  rank: 'E' },
  { max: 60,  rank: 'D' },
  { max: 80,  rank: 'C' },
  { max: 100, rank: 'B' },
  { max: 125, rank: 'A' },
  { max: 150, rank: 'S' },
  { max: 175, rank: 'SS' },
  { max: 200, rank: 'SSS' },
]
export const EMBLEM_MAX_LEVEL = 200
export const getEmblemRank = (level) => {
  for (const r of EMBLEM_RANKS) if (level <= r.max) return r.rank
  return 'SSS'
}
export const EMBLEM_RANK_COLOR = {
  F:'#888888', E:'#6699cc', D:'#ff8844', C:'#44bb44', B:'#4488ff',
  A:'#ff4444', S:'#ffcc00', SS:'#ffcc00', SSS:'#ffcc00',
}

// 上限開放段階: cap_stage 0..4 → そのときのレベル上限
export const EMBLEM_CAP_STAGES = [100, 125, 150, 175, 200]
export const emblemLevelCap = (capStage) => EMBLEM_CAP_STAGES[Math.min(capStage || 0, 4)]
// 開放コスト（魂は8ボス「各種」必要）。stage=現在のcap_stage（0→1の開放は souls:1）
export const EMBLEM_CAP_UNLOCK_COST = [
  { souls: 1,  memories: false },  // LV100 → 125
  { souls: 3,  memories: false },  // LV125 → 150
  { souls: 5,  memories: false },  // LV150 → 175
  { souls: 10, memories: true },   // LV175 → 200（＋各地獄HELL初回クリアの記憶 各1）
]

// レベルアップに必要な「紋章の成長石」数（次のレベル nextLv に上がるコスト）
// LV2〜50:1個 / 51〜100:2個 / 101〜150:3個 / 151〜200:4個（合計約500個）
export const emblemLevelUpCost = (nextLv) => {
  if (nextLv <= 50) return 1
  if (nextLv <= 100) return 2
  if (nextLv <= 150) return 3
  return 4
}

// ===== 結晶（22種）=====
// per=+1あたりの上昇量, max=50振り時の合計が仕様のMAX値になる
// kind: flat=ステ直加算 / pct=率(%) / dot=状態異常ダメージUP(%) / res=状態異常耐性(%)
export const EMBLEM_CRYSTALS = {
  chikara:    { name: '力の結晶',       label: '攻撃力',            per: 25,  unit: '',  kind: 'flat', stat: 'atk' },
  butsuri:    { name: '物理の結晶',     label: '物理ダメージ',      per: 0.3, unit: '%', kind: 'pct',  key: 'physDmg' },
  chie:       { name: '知恵の結晶',     label: '特殊攻撃',          per: 25,  unit: '',  kind: 'flat', stat: 'matk' },
  tokushu:    { name: '特殊の結晶',     label: '特殊ダメージ',      per: 0.3, unit: '%', kind: 'pct',  key: 'specialDmg' },
  hakou:      { name: '破甲の結晶',     label: '物理防御貫通',      per: 0.3, unit: '%', kind: 'pct',  key: 'defPen' },
  hama:       { name: '破魔の結晶',     label: '特殊防御貫通',      per: 0.3, unit: '%', kind: 'pct',  key: 'mdefPen' },
  resshou:    { name: '裂傷の結晶',     label: '出血ダメージ',      per: 1,   unit: '%', kind: 'dot',  key: 'bleed' },
  kashou:     { name: '火傷の結晶',     label: 'やけどダメージ',    per: 1,   unit: '%', kind: 'dot',  key: 'burn' },
  moudoku:    { name: '猛毒の結晶',     label: '毒/猛毒ダメージ',   per: 1,   unit: '%', kind: 'dot',  key: 'poison' },
  bkyuushuu:  { name: '物理吸収の結晶', label: '物理吸収',          per: 0.2, unit: '%', kind: 'pct',  key: 'physDrain' },
  tkyuushuu:  { name: '特殊吸収の結晶', label: '特殊吸収',          per: 0.2, unit: '%', kind: 'pct',  key: 'specialDrain' },
  shugo:      { name: '守護の結晶',     label: '防御',              per: 30,  unit: '',  kind: 'flat', stat: 'def' },
  kouma:      { name: '抗魔の結晶',     label: '特殊防御',          per: 30,  unit: '',  kind: 'flat', stat: 'mdef' },
  kaihi:      { name: '回避の結晶',     label: '回避率',            per: 0.1, unit: '%', kind: 'pct',  key: 'evasion' },
  // legacy: 旧名（誤字）。DBのアイテム名を改名するSQLを流すまでは旧名の在庫も所持数に数える
  kaishin:    { name: '会心の結晶',     label: 'クリティカル率',    per: 0.2, unit: '%', kind: 'pct',  key: 'crit', legacy: '改心の結晶' },
  chimei:     { name: '致命の結晶',     label: 'クリティカル威力',  per: 1,   unit: '%', kind: 'pct',  key: 'critDmg' },
  kaitai:     { name: '会耐の結晶',     label: 'クリティカル抵抗',  per: 0.3, unit: '%', kind: 'pct',  key: 'critResist' },
  boudoku:    { name: '防毒の結晶',     label: '毒/猛毒耐性',       per: 0.4, unit: '%', kind: 'res',  key: 'poison' },
  bouma:      { name: '防麻の結晶',     label: '麻痺耐性',          per: 0.4, unit: '%', kind: 'res',  key: 'paralysis' },
  bouka:      { name: '防火の結晶',     label: 'やけど耐性',        per: 0.4, unit: '%', kind: 'res',  key: 'burn' },
  bouketsu:   { name: '防血の結晶',     label: '出血耐性',          per: 0.4, unit: '%', kind: 'res',  key: 'bleed' },
  bouzetsu:   { name: '防絶の結晶',     label: 'スタン耐性',        per: 0.2, unit: '%', kind: 'res',  key: 'stun' },
}
export const EMBLEM_ALLOC_MAX = 50  // 1項目に振れる最大
export const EMBLEM_CRYSTAL_KEYS = Object.keys(EMBLEM_CRYSTALS)
// 結晶アイテム名 → key の逆引き（legacy=旧名もそのkeyへ引けるようにする）
export const EMBLEM_CRYSTAL_BY_NAME = Object.fromEntries(
  EMBLEM_CRYSTAL_KEYS.flatMap(k => {
    const c = EMBLEM_CRYSTALS[k]
    return c.legacy ? [[c.name, k], [c.legacy, k]] : [[c.name, k]]
  })
)
// 所持数（name→数量のmap）から結晶の所持数を取る。旧名の在庫も合算する
export const emblemCrystalOwned = (itemMap, key) => {
  const c = EMBLEM_CRYSTALS[key]
  if (!c) return 0
  return (itemMap?.[c.name] || 0) + (c.legacy ? (itemMap?.[c.legacy] || 0) : 0)
}

// alloc(jsonb: key→振り数) の合計
export const emblemAllocTotal = (alloc) =>
  Object.values(alloc || {}).reduce((s, v) => s + (v || 0), 0)

// alloc → 戦闘用ボーナス集約
// 戻り値:
//   flat: {atk,def,matk,mdef}                       … ステ直加算
//   physDmg / specialDmg: 与ダメ%（例 15 → +15%）
//   defPen / mdefPen: 貫通%（gemAcc へ加算する単位=%）
//   dotUp: {bleed,burn,poison}: 状態異常ダメージUP%（毒/猛毒は共通で poison）
//   physDrain / specialDrain: 与ダメ吸収%（物理/特殊）
//   evasion / crit / critDmg / critResist: %（既存の bonus 系へ加算）
//   ailRes: {poison,paralysis,burn,bleed,stun}: 個別状態異常耐性%（無効化確率）
export const calcEmblemBonus = (alloc) => {
  const b = {
    flat: { atk: 0, def: 0, matk: 0, mdef: 0 },
    physDmg: 0, specialDmg: 0,
    defPen: 0, mdefPen: 0,
    dotUp: { bleed: 0, burn: 0, poison: 0 },
    physDrain: 0, specialDrain: 0,
    evasion: 0, crit: 0, critDmg: 0, critResist: 0,
    ailRes: { poison: 0, paralysis: 0, burn: 0, bleed: 0, stun: 0 },
  }
  if (!alloc) return b
  for (const [k, ptsRaw] of Object.entries(alloc)) {
    const c = EMBLEM_CRYSTALS[k]
    const pts = Math.min(ptsRaw || 0, EMBLEM_ALLOC_MAX)
    if (!c || pts <= 0) continue
    const v = c.per * pts
    if (c.kind === 'flat') { b.flat[c.stat] += v; continue }
    if (c.kind === 'dot')  { b.dotUp[c.key] += v; continue }
    if (c.kind === 'res')  { b.ailRes[c.key] += v; continue }
    // pct
    switch (c.key) {
      case 'physDmg':      b.physDmg      += v; break
      case 'specialDmg':   b.specialDmg   += v; break
      case 'defPen':       b.defPen       += v; break
      case 'mdefPen':      b.mdefPen      += v; break
      case 'physDrain':    b.physDrain    += v; break
      case 'specialDrain': b.specialDrain += v; break
      case 'evasion':      b.evasion      += v; break
      case 'crit':         b.crit         += v; break
      case 'critDmg':      b.critDmg      += v; break
      case 'critResist':   b.critResist   += v; break
    }
  }
  // 丸め（0.1刻み）
  const r1 = (x) => Math.round(x * 10) / 10
  b.physDmg = r1(b.physDmg); b.specialDmg = r1(b.specialDmg)
  b.defPen = r1(b.defPen); b.mdefPen = r1(b.mdefPen)
  b.physDrain = r1(b.physDrain); b.specialDrain = r1(b.specialDrain)
  b.evasion = r1(b.evasion); b.crit = r1(b.crit); b.critDmg = r1(b.critDmg); b.critResist = r1(b.critResist)
  for (const k of Object.keys(b.dotUp)) b.dotUp[k] = r1(b.dotUp[k])
  for (const k of Object.keys(b.ailRes)) b.ailRes[k] = r1(b.ailRes[k])
  return b
}

// 紋章の「上昇している能力」をチップ文字列の配列にして返す（Emblem/Profile 等で共用）
export const emblemEffectChips = (alloc) => {
  const bonus = calcEmblemBonus(alloc)
  return [
    bonus.flat.atk  > 0 && `攻撃+${bonus.flat.atk}`,
    bonus.flat.def  > 0 && `防御+${bonus.flat.def}`,
    bonus.flat.matk > 0 && `特攻+${bonus.flat.matk}`,
    bonus.flat.mdef > 0 && `特防+${bonus.flat.mdef}`,
    bonus.physDmg   > 0 && `物理ダメ+${bonus.physDmg}%`,
    bonus.specialDmg> 0 && `特殊ダメ+${bonus.specialDmg}%`,
    bonus.defPen    > 0 && `物防貫通+${bonus.defPen}%`,
    bonus.mdefPen   > 0 && `特防貫通+${bonus.mdefPen}%`,
    bonus.dotUp.bleed  > 0 && `出血ダメ+${bonus.dotUp.bleed}%`,
    bonus.dotUp.burn   > 0 && `やけどダメ+${bonus.dotUp.burn}%`,
    bonus.dotUp.poison > 0 && `毒ダメ+${bonus.dotUp.poison}%`,
    bonus.physDrain > 0 && `物理吸収+${bonus.physDrain}%`,
    bonus.specialDrain > 0 && `特殊吸収+${bonus.specialDrain}%`,
    bonus.evasion   > 0 && `回避+${bonus.evasion}%`,
    bonus.crit      > 0 && `クリ率+${bonus.crit}%`,
    bonus.critDmg   > 0 && `クリ威力+${bonus.critDmg}%`,
    bonus.critResist> 0 && `クリ抵抗+${bonus.critResist}%`,
    bonus.ailRes.poison    > 0 && `毒耐性+${bonus.ailRes.poison}%`,
    bonus.ailRes.paralysis > 0 && `麻痺耐性+${bonus.ailRes.paralysis}%`,
    bonus.ailRes.burn      > 0 && `やけど耐性+${bonus.ailRes.burn}%`,
    bonus.ailRes.bleed     > 0 && `出血耐性+${bonus.ailRes.bleed}%`,
    bonus.ailRes.stun      > 0 && `スタン耐性+${bonus.ailRes.stun}%`,
  ].filter(Boolean)
}

// ===== 八獄（はちごく）関連の紋章素材 =====
export const EMBLEM_SHARD_NAME = '紋章の成長石'
