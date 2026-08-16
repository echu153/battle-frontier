// ============================================================
// バトルフロンティアⅡ（リメイク版）— エンチャントの特殊能力
// ------------------------------------------------------------
// 設計は docs/v2-enchant-design.md。
// ルーンを抽出するとき**稀に1つ付く**追加効果で、中身は**素材を出した敵ごとに決まっている**。
//   付く確率：通常0% / レア1% / 激レア3%（素材5個それぞれで判定し、当たった中から1つ選ぶ）
//   ステータスとは**完全に別枠の＋α**。ルーンの色の判定には影響しない
//   **同じ能力を複数のソケットに付けたら重複する**（例外＝素材ドロップ率upは最大値だけ）
//
// ★ここは「効果の定義」だけを持つ。解釈は battle.js（戦闘）と
//   抽出まわり（未実装）が行う。数値を変えるときはこのファイルだけを直せば済むようにしてある。
//
// effect のキー（battle.js の collectEnchants / liveStats / takeAction が解釈する）
//   statPct        {ステ:%}                 常時ステータス+%
//   bandStatPct    {bands:[], stat, pct}    その時間帯だけステータス+%
//   physDmgPct / magDmgPct  %               与える物理／魔法ダメージ+%
//   bandDmgPct     {bands:[], kind, pct}    その時間帯だけ与ダメージ+%
//   physCutPct / magCutPct  %               受ける物理／魔法ダメージ軽減+%
//   drainPhysPct   %                        物理で与えたダメージの%を回復
//   healPct        %                        回復量+%
//   bandHealPct    {bands:[], pct}          その時間帯だけ回復量+%
//   hitBonus / evaBonus / procBonus  ポイント 命中率／回避率／スキル発動率へ加算
//   onHitAil       {key, chance, kind, pct} 攻撃が当たったとき、確率で状態異常を付与
//   ailResist      {key:'all'|個別, pct}    状態異常の付与確率を下げる
//   startBuff      {cut}                    戦闘開始時に「次に受けるダメージ-cut%」。受けるまで消えない
//   onHitFoeStat   {stats:[], pct, max}     当たったとき相手のステータスを下げる（重複上限つき）
//   onHitSelfStat  {stat, pct, max, kind}   当たったとき自分のステータスを上げる（重複上限つき）
//   convertAdd     {from, to, pct}          from の%を to へ**加算**（★元は減らない。魔導剣術とは別物）
//   reflectFirst   {kind, pct}              最初に受けたそのダメージを%で跳ね返す
//   dropRateMult   倍率                     素材ドロップ率（★戦闘外。サーバーのドロップ判定が読む）
// ============================================================

// 敵の名前 → 特殊能力。名前は enemies.js の name と一致させること
export const ENCHANTS = {
  // ===== ①始まりの森 =====
  'スライム':        { text:'物理ダメージ軽減+2%', effect:{ physCutPct:2 } },
  'コウモリ':        { text:'物理ダメージを与えたとき、与えたダメージの3%を回復', effect:{ drainPhysPct:3 } },
  '毒キノコ':        { text:'毒状態になる確率を10%軽減', effect:{ ailResist:{ key:'poison', pct:10 } } },
  '朝露のフェアリー': { text:'回避率+1%', effect:{ evaBonus:1 } },
  'ひなたトカゲ':    { text:'物理ダメージ+2%', effect:{ physDmgPct:2 } },
  '月夜のフクロウ':  { text:'晩の間、INT+5%', effect:{ bandStatPct:{ bands:['晩'], stat:'int_stat', pct:5 } } },
  'ビッグスライム':  { text:'物理ダメージ軽減+10%', effect:{ physCutPct:10 } },

  // ===== ②荒廃した草原 =====
  'ゴブリン':        { text:'物理攻撃ヒット時、10%で出血付与', effect:{ onHitAil:{ key:'bleed', chance:10, kind:'phys' } } },
  '野良犬':          { text:'AGI+3%', effect:{ statPct:{ agi:3 } } },
  '盗賊':            { text:'素材ドロップ率×1.2', effect:{ dropRateMult:1.2 } },
  '朝霧のワーム':    { text:'朝の間、VIT+5%', effect:{ bandStatPct:{ bands:['朝'], stat:'vit', pct:5 } } },
  '陽炎リザード':    { text:'物理ダメージ+4%', effect:{ physDmgPct:4 } },
  '夜盗の斥候':      { text:'晩の間、AGI+5%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:5 } } },
  '盗賊団のリーダー': { text:'物理攻撃ヒット時、30%で出血付与', effect:{ onHitAil:{ key:'bleed', chance:30, kind:'phys' } } },

  // ===== ③古代の洞窟 =====
  'コボルト':        { text:'物理ダメージ+3%', effect:{ physDmgPct:3 } },
  'スケルトン':      { text:'戦闘開始時、次に受けるダメージを20%軽減するバフを得る', effect:{ startBuff:{ cut:20 } } },
  'ゴーレム':        { text:'魔法ダメージ軽減+4%', effect:{ magCutPct:4 } },
  '曙のガーゴイル':  { text:'INT+4%', effect:{ statPct:{ int_stat:4 } } },
  '石化トカゲ':      { text:'魔法ダメージ+3%', effect:{ magDmgPct:3 } },
  '夜這うレイス':    { text:'晩の間、AGI+8%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:8 } } },
  '古代の番人':      { text:'魔法ダメージ軽減+10%', effect:{ magCutPct:10 } },

  // ===== ④蒼海の入り江 =====
  '深海魚人':        { text:'魔法攻撃ヒット時、5%で鈍足付与', effect:{ onHitAil:{ key:'slow', chance:5, kind:'mag' } } },
  '海賊':            { text:'素材ドロップ率×1.3', effect:{ dropRateMult:1.3 } },
  '毒クラゲ':        { text:'攻撃ヒット時、10%で毒付与', effect:{ onHitAil:{ key:'poison', chance:10, kind:'any' } } },
  '朝凪のセイレーン': { text:'回復量+20%', effect:{ healPct:20 } },
  '潮騒のカニ':      { text:'昼の間、STR+8%', effect:{ bandStatPct:{ bands:['昼'], stat:'str', pct:8 } } },
  '夜光アンコウ':    { text:'晩の間、DEX+8%', effect:{ bandStatPct:{ bands:['晩'], stat:'dex', pct:8 } } },
  'シーサーペント':  { text:'魔法攻撃ヒット時、30%で鈍足付与', effect:{ onHitAil:{ key:'slow', chance:30, kind:'mag' } } },

  // ===== ⑤巨峰山脈 =====
  '山岳ゴブリン':    { text:'物理ダメージ+4%', effect:{ physDmgPct:4 } },
  '岩石ゴーレム':    { text:'物理ダメージ軽減+4%', effect:{ physCutPct:4 } },
  'グリフォン':      { text:'命中率+3%', effect:{ hitBonus:3 } },
  '払暁のワイバーン': { text:'全ての状態異常抵抗+5%', effect:{ ailResist:{ key:'all', pct:5 } } },
  '陽射しの大猿':    { text:'昼の間、物理ダメージ+8%', effect:{ bandDmgPct:{ bands:['昼'], kind:'phys', pct:8 } } },
  '宵闇の山猫':      { text:'素材ドロップ率×1.4', effect:{ dropRateMult:1.4 } },
  '雷鷲サンダーロック': { text:'AGIの5%をSTRに加算', effect:{ convertAdd:{ from:'agi', to:'str', pct:5 } } },

  // ===== ⑥白銀の霊峰 =====
  '雪男':            { text:'攻撃ヒット時、敵のAGI-2%（重複10）', effect:{ onHitFoeStat:{ stats:['agi'], pct:-2, max:10 } } },
  '氷河ドラゴン':    { text:'攻撃ヒット時、敵のSTR-2%（重複10）', effect:{ onHitFoeStat:{ stats:['str'], pct:-2, max:10 } } },
  '霜の精霊':        { text:'INT+5%', effect:{ statPct:{ int_stat:5 } } },
  '朝焼けの氷狼':    { text:'朝の間、AGI+10%', effect:{ bandStatPct:{ bands:['朝'], stat:'agi', pct:10 } } },
  '白光の樹氷精':    { text:'昼の間、INT+10%', effect:{ bandStatPct:{ bands:['昼'], stat:'int_stat', pct:10 } } },
  '極夜のワイト':    { text:'魔法攻撃ヒット時、INT+1%（重複10）', effect:{ onHitSelfStat:{ stat:'int_stat', pct:1, max:10, kind:'mag' } } },
  '氷霊フロストバーン': { text:'攻撃ヒット時、敵のSTRとAGI-2%（重複15）', effect:{ onHitFoeStat:{ stats:['str','agi'], pct:-2, max:15 } } },

  // ===== ⑦煉獄火山 =====
  '炎の精霊':        { text:'INT+6%', effect:{ statPct:{ int_stat:6 } } },
  '溶岩ゴーレム':    { text:'魔法ダメージ軽減+5%', effect:{ magCutPct:5 } },
  'ファイアドレイク': { text:'攻撃ヒット時、回復阻害-20%を付与', effect:{ onHitAil:{ key:'healCut', chance:100, kind:'any', pct:20 } } },
  '暁のフレイムバット': { text:'物理ダメージを与えたとき、与えたダメージの5%を回復', effect:{ drainPhysPct:5 } },
  '陽炎のイフリート': { text:'朝〜昼の間、INT+10%', effect:{ bandStatPct:{ bands:['朝','昼'], stat:'int_stat', pct:10 } } },
  '熾火のデーモン':  { text:'攻撃ヒット時、STR+1.5%（重複10）', effect:{ onHitSelfStat:{ stat:'str', pct:1.5, max:10, kind:'any' } } },
  '深紅のサラマンダー': { text:'攻撃ヒット時、回復阻害-50%を付与', effect:{ onHitAil:{ key:'healCut', chance:100, kind:'any', pct:50 } } },

  // ===== ⑧蒼天の浮遊城 =====
  '天翼のハーピー':  { text:'回避率+3%', effect:{ evaBonus:3 } },
  '雷雲の精霊':      { text:'攻撃ヒット時、5%で麻痺付与', effect:{ onHitAil:{ key:'paralyze', chance:5, kind:'any' } } },
  '天空騎士グリフィオン': { text:'STR・INT+5%', effect:{ statPct:{ str:5, int_stat:5 } } },
  '曙光のセラフ':    { text:'朝〜昼の間、回復量+40%', effect:{ bandHealPct:{ bands:['朝','昼'], pct:40 } } },
  '白昼のペガサス':  { text:'スキル発動率+5%', effect:{ procBonus:5 } },
  '星降りのヴァルキリー': { text:'素材ドロップ率×1.5', effect:{ dropRateMult:1.5 } },
  '天空覇龍ウラノス': { text:'最初に受けた魔法ダメージを100%で跳ね返す', effect:{ reflectFirst:{ kind:'mag', pct:100 } } },
}

export const enchantOf = (enemyName) => ENCHANTS[enemyName] || null
export const ENCHANT_NAMES = Object.keys(ENCHANTS)

// ===== 付く確率 =====
// 素材のレア度ごとに個別抽選する。5個それぞれで引いて、当たった中から1つ選ぶ
export const ENCHANT_CHANCE = { normal: 0, rare: 1, ultra: 3 }
export const enchantChanceOf = (rarity) => ENCHANT_CHANCE[rarity] || 0

// ===== 戦闘用のまとめ =====
// 装備している全ソケットぶんのエンチャントを1つに畳む。**同じ能力でも重複して足す**
// band は '朝' | '昼' | '晩'（時間帯条件つきの能力がここで有効／無効になる）
export const collectEnchants = (list, band = null) => {
  const en = {
    statPct: {},
    physDmgPct: 0, magDmgPct: 0,
    physCutPct: 0, magCutPct: 0,
    drainPhysPct: 0, healPct: 0,
    hitBonus: 0, evaBonus: 0, procBonus: 0,
    onHitAils: [], ailResistAll: 0, ailResist: {},
    startCut: 0,
    onHitFoeStats: [], onHitSelfStats: [],
    convertAdds: [], reflectFirst: null,
    dropRateMult: 1,
  }
  const addStat = (k, v) => { en.statPct[k] = (en.statPct[k] || 0) + v }
  for (const name of list || []) {
    const e = enchantOf(name)?.effect
    if (!e) continue
    if (e.statPct) for (const [k, v] of Object.entries(e.statPct)) addStat(k, v)
    if (e.bandStatPct && (!band || e.bandStatPct.bands.includes(band))) {
      addStat(e.bandStatPct.stat, e.bandStatPct.pct)
    }
    for (const k of ['physDmgPct', 'magDmgPct', 'physCutPct', 'magCutPct', 'drainPhysPct', 'healPct', 'hitBonus', 'evaBonus', 'procBonus']) {
      if (e[k]) en[k] += e[k]
    }
    if (e.bandDmgPct && (!band || e.bandDmgPct.bands.includes(band))) {
      en[e.bandDmgPct.kind === 'mag' ? 'magDmgPct' : 'physDmgPct'] += e.bandDmgPct.pct
    }
    if (e.bandHealPct && (!band || e.bandHealPct.bands.includes(band))) en.healPct += e.bandHealPct.pct
    if (e.onHitAil)      en.onHitAils.push(e.onHitAil)
    if (e.ailResist) {
      if (e.ailResist.key === 'all') en.ailResistAll += e.ailResist.pct
      else en.ailResist[e.ailResist.key] = (en.ailResist[e.ailResist.key] || 0) + e.ailResist.pct
    }
    if (e.startBuff)     en.startCut += e.startBuff.cut
    if (e.onHitFoeStat)  en.onHitFoeStats.push(e.onHitFoeStat)
    if (e.onHitSelfStat) en.onHitSelfStats.push(e.onHitSelfStat)
    if (e.convertAdd)    en.convertAdds.push(e.convertAdd)
    // 跳ね返しは重複させず、いちばん強いものだけ
    if (e.reflectFirst && (!en.reflectFirst || e.reflectFirst.pct > en.reflectFirst.pct)) en.reflectFirst = e.reflectFirst
    // ★素材ドロップ率upだけは重複しない。一番高いものだけが効く
    if (e.dropRateMult) en.dropRateMult = Math.max(en.dropRateMult, e.dropRateMult)
  }
  return en
}

// 状態異常の付与確率。相手の抵抗を引く
export const inflictChance = (chance, foeEn, key) =>
  Math.max(0, chance - (foeEn?.ailResistAll || 0) - (foeEn?.ailResist?.[key] || 0))

// 素材ドロップ率の倍率だけを取り出す（戦闘の外＝サーバーのドロップ判定が使う）
export const dropRateMultOf = (list) => collectEnchants(list).dropRateMult
