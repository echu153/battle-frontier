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

  // ============================================================
  // ★ここから下は**同じ難易度帯のもう1つのエリア**の敵（2026-08-22）。
  //   強さは同じ帯の既存エリアと同格なので、能力も**同じくらいの強さ**にしてある
  // ============================================================

  // ===== ④-2 灼砂の遺丘 =====
  '砂喰いワーム':    { text:'VIT+4%', effect:{ statPct:{ vit:4 } } },
  '墓守のミイラ':    { text:'物理ダメージ軽減+4%', effect:{ physCutPct:4 } },
  '砂蠍サンドスコーピオン': { text:'物理攻撃ヒット時、10%で毒付与', effect:{ onHitAil:{ key:'poison', chance:10, kind:'phys' } } },
  '陽炎の砂トカゲ': { text:'朝の間、INT+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'int_stat', pct:8 } } },
  '灼熱のアヌビス':  { text:'昼の間、物理ダメージ+6%', effect:{ bandDmgPct:{ bands:['昼'], kind:'phys', pct:6 } } },
  '月砂のジャッカル': { text:'晩の間、AGI+8%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:8 } } },
  '砂皇スカラベウス': { text:'物理ダメージ軽減+12%', effect:{ physCutPct:12 } },

  // ===== ⑤-2 常闇の樹海 =====
  '食人樹':          { text:'攻撃ヒット時、敵のAGI-2%（重複8）', effect:{ onHitFoeStat:{ stats:['agi'], pct:-2, max:8 } } },
  '毒霧のマンドラゴラ': { text:'攻撃ヒット時、15%で毒付与', effect:{ onHitAil:{ key:'poison', chance:15, kind:'any' } } },
  '影狼シャドウウルフ': { text:'回避率+2%', effect:{ evaBonus:2 } },
  '朝靄のトレント':  { text:'朝の間、VIT+10%', effect:{ bandStatPct:{ bands:['朝'], stat:'vit', pct:10 } } },
  '木漏れ日のピクシー': { text:'回復量+25%', effect:{ healPct:25 } },
  '常闇のバンシー':  { text:'魔法ダメージ+6%', effect:{ magDmgPct:6 } },
  '森王エルダートレント': { text:'最大HP+10%', effect:{ statPct:{ hp:10 } } },

  // ===== ⑥-2 雷鳴の断崖 =====
  '嵐鳥ストームバード': { text:'AGI+6%', effect:{ statPct:{ agi:6 } } },
  '雷刃のガーゴイル': { text:'物理攻撃ヒット時、4%で麻痺付与', effect:{ onHitAil:{ key:'paralyze', chance:4, kind:'phys' } } },
  '断崖のトロール':  { text:'物理ダメージ軽減+5%', effect:{ physCutPct:5 } },
  '暁雲のサンダーホーク': { text:'朝の間、物理ダメージ+10%', effect:{ bandDmgPct:{ bands:['朝'], kind:'phys', pct:10 } } },
  '雷光のエレメンタル': { text:'昼の間、魔法ダメージ+10%', effect:{ bandDmgPct:{ bands:['昼'], kind:'mag', pct:10 } } },
  '雷鳴のワイバーン': { text:'命中率+4%', effect:{ hitBonus:4 } },
  '雷帝ケラウノス':  { text:'攻撃ヒット時、8%で麻痺付与', effect:{ onHitAil:{ key:'paralyze', chance:8, kind:'any' } } },

  // ===== ⑦-2 腐海の沼獄 =====
  '沼のヒュドラ':    { text:'STR+6%', effect:{ statPct:{ str:6 } } },
  '腐食スライム':    { text:'攻撃ヒット時、敵のVIT-2%（重複10）', effect:{ onHitFoeStat:{ stats:['vit'], pct:-2, max:10 } } },
  '沼底のリザードマン': { text:'物理攻撃ヒット時、20%で毒付与', effect:{ onHitAil:{ key:'poison', chance:20, kind:'phys' } } },
  '朝霞のウィルオウィスプ': { text:'MP+10%', effect:{ statPct:{ mp:10 } } },
  '陽だまりの大蛙':  { text:'物理ダメージを与えたとき、与えたダメージの6%を回復', effect:{ drainPhysPct:6 } },
  '夜霧のゾンビ':    { text:'毒状態になる確率を30%軽減', effect:{ ailResist:{ key:'poison', pct:30 } } },
  '毒龍ヴェノムヒュドラ': { text:'攻撃ヒット時、35%で毒付与', effect:{ onHitAil:{ key:'poison', chance:35, kind:'any' } } },

  // ===== ⑦-3 奈落の坑道 =====
  '坑道のグール':    { text:'DEX+6%', effect:{ statPct:{ dex:6 } } },
  '鉱石ゴーレム':    { text:'物理ダメージ軽減+6%', effect:{ physCutPct:6 } },
  '闇喰いコウモリ':  { text:'素材ドロップ率×1.45', effect:{ dropRateMult:1.45 } },
  '曙光のクリスタルワーム': { text:'朝の間、INT+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'int_stat', pct:12 } } },
  '灯火のドワーフ亡霊': { text:'昼の間、STR+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'str', pct:12 } } },
  '深穴のシャドウ':  { text:'晩の間、魔法ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'mag', pct:12 } } },
  '巌喰いガイアモール': { text:'攻撃ヒット時、STR+2%（重複10）', effect:{ onHitSelfStat:{ stat:'str', pct:2, max:10, kind:'any' } } },

  // ===== ⑧-2 星霜の遺跡 =====
  '星読みの石像':    { text:'INT+7%', effect:{ statPct:{ int_stat:7 } } },
  '遺跡の守護機兵':    { text:'戦闘開始時、次に受けるダメージを35%軽減するバフを得る', effect:{ startBuff:{ cut:35 } } },
  '時喰いのクロノワーム': { text:'攻撃ヒット時、敵のAGI-3%（重複15）', effect:{ onHitFoeStat:{ stats:['agi'], pct:-3, max:15 } } },
  '暁星のアストラルナイト': { text:'STR+6%・DEX+4%', effect:{ statPct:{ str:6, dex:4 } } },
  '白日のスフィンクス': { text:'スキル発動率+4%', effect:{ procBonus:4 } },
  '星宿の月狼ルナウルフ':  { text:'晩の間、INT+15%', effect:{ bandStatPct:{ bands:['晩'], stat:'int_stat', pct:15 } } },
  '時星龍アイオーン': { text:'最初に受けた物理ダメージを100%で跳ね返す', effect:{ reflectFirst:{ kind:'phys', pct:100 } } },

  // ===== ⑧-3 深淵の海溝 =====
  '深淵のクラーケン': { text:'物理ダメージ+8%', effect:{ physDmgPct:8 } },
  '海淵のリヴァイアサン幼体': { text:'最大HP+12%', effect:{ statPct:{ hp:12 } } },
  '冥暗のシーウィッチ': { text:'魔法攻撃ヒット時、10%で鈍足付与', effect:{ onHitAil:{ key:'slow', chance:10, kind:'mag' } } },
  '朝凪の海竜':      { text:'朝の間、DEX+15%', effect:{ bandStatPct:{ bands:['朝'], stat:'dex', pct:15 } } },
  '陽射しの巨鯨':    { text:'昼の間、VIT+15%', effect:{ bandStatPct:{ bands:['昼'], stat:'vit', pct:15 } } },
  '深海のセイレーン': { text:'晩の間、回復量+40%', effect:{ bandHealPct:{ bands:['晩'], pct:40 } } },
  '深海覇王リヴァイアサン': { text:'物理ダメージを与えたとき、与えたダメージの10%を回復', effect:{ drainPhysPct:10 } },

  // ============================================================
  // ===== レアモンスター（各エリア5体・2026-08-25）=====
  // ★同じエリアの通常敵よりひとまわり強い効果にしてある。素材の値も1.5倍なので、
  //   「見かけたら必ず倒す」だけの理由を持たせる枠。
  // ============================================================
  // ①始まりの森
  'ジェイドスライム':   { text:'物理ダメージ軽減+4%', effect:{ physCutPct:4 } },
  'エンシェントトレント':   { text:'HP+4%', effect:{ statPct:{ hp:4 } } },
  'オーロラフェアリー':         { text:'朝の間、INT+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'int_stat', pct:8 } } },
  'サンリザード':         { text:'物理ダメージ+4%', effect:{ physDmgPct:4 } },
  'ナイトオウル':       { text:'晩の間、DEX+8%', effect:{ bandStatPct:{ bands:['晩'], stat:'dex', pct:8 } } },

  // ②荒廃した草原
  'ホブゴブリン':   { text:'物理攻撃ヒット時、18%で出血付与', effect:{ onHitAil:{ key:'bleed', chance:18, kind:'phys' } } },
  'シルバーフェンリル':       { text:'AGI+6%', effect:{ statPct:{ agi:6 } } },
  'ミストワーム':       { text:'朝の間、HP+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'hp', pct:8 } } },
  'フレアバジリスク':       { text:'攻撃ヒット時、14%で毒付与', effect:{ onHitAil:{ key:'poison', chance:14, kind:'any' } } },
  'シャドウシーフ':           { text:'ルーン素材のドロップ率×1.3', effect:{ dropRateMult:1.3 } },

  // ③古代の洞窟
  'オブシディアンコボルト':       { text:'STR+6%', effect:{ statPct:{ str:6 } } },
  'スケルトンナイト':   { text:'戦闘開始時、被ダメージ-25%（1回受けると消える）', effect:{ startBuff:{ cut:25 } } },
  'ドーンガーゴイル':     { text:'朝の間、VIT+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'vit', pct:8 } } },
  'ロックバジリスク':       { text:'物理ダメージ軽減+6%', effect:{ physCutPct:6 } },
  'ダークレイス':     { text:'魔法ダメージ+6%', effect:{ magDmgPct:6 } },

  // ④蒼海の入り江
  'コーラルナイト':     { text:'魔法ダメージ軽減+6%', effect:{ magCutPct:6 } },
  'ベビークラーケン':     { text:'攻撃ヒット時、敵のAGI-3%（重複10）', effect:{ onHitFoeStat:{ stats:['agi'], pct:-3, max:10 } } },
  'サンライズセイレーン':           { text:'朝の間、魔法ダメージ+8%', effect:{ bandDmgPct:{ bands:['朝'], kind:'mag', pct:8 } } },
  'ジャイアントクラブ':           { text:'VIT+6%', effect:{ statPct:{ vit:6 } } },
  'ランタンアンコウ':       { text:'晩の間、物理ダメージ+8%', effect:{ bandDmgPct:{ bands:['晩'], kind:'phys', pct:8 } } },

  // ⑤巨峰山脈
  'ストームグリフォン': { text:'回避率+3%', effect:{ evaBonus:3 } },
  'マウンテンゴーレム': { text:'物理ダメージ軽減+7%', effect:{ physCutPct:7 } },
  'ドーンワイバーン':           { text:'朝の間、STR+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'str', pct:8 } } },
  'ブレイズゴリラ':           { text:'STR+7%', effect:{ statPct:{ str:7 } } },
  'シャドウキャット':           { text:'晩の間、AGI+10%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:10 } } },

  // ⑥白銀の霊峰
  'イエティロード':   { text:'攻撃ヒット時、敵のAGI-4%（重複12）', effect:{ onHitFoeStat:{ stats:['agi'], pct:-4, max:12 } } },
  'グレイシアドラゴン': { text:'VIT+7%', effect:{ statPct:{ vit:7 } } },
  'ブリザードウルフ':         { text:'朝の間、AGI+10%', effect:{ bandStatPct:{ bands:['朝'], stat:'agi', pct:10 } } },
  'アイスドライアド':         { text:'昼の間、INT+10%', effect:{ bandStatPct:{ bands:['昼'], stat:'int_stat', pct:10 } } },
  'ワイトキング':         { text:'攻撃ヒット時、自分のSTR+3%（重複8）', effect:{ onHitSelfStat:{ stat:'str', pct:3, max:8, kind:'any' } } },

  // ⑦煉獄火山
  'イフリートロード':     { text:'魔法ダメージ+8%', effect:{ magDmgPct:8 } },
  'マグマゴーレム':   { text:'物理ダメージ軽減+9%', effect:{ physCutPct:9 } },
  'ブレイズバット':   { text:'朝の間、物理ダメージ+10%', effect:{ bandDmgPct:{ bands:['朝'], kind:'phys', pct:10 } } },
  'サラマンダーロード':   { text:'攻撃ヒット時、40%で回復阻害-30%を付与', effect:{ onHitAil:{ key:'healCut', chance:40, kind:'any', pct:30 } } },
  'アークデーモン':           { text:'攻撃ヒット時、自分のSTR+4%（重複8）', effect:{ onHitSelfStat:{ stat:'str', pct:4, max:8, kind:'any' } } },

  // ⑧蒼天の浮遊城
  'ハーピークイーン': { text:'AGI+8%', effect:{ statPct:{ agi:8 } } },
  'ストームエレメンタル':           { text:'攻撃ヒット時、5%で麻痺付与', effect:{ onHitAil:{ key:'paralyze', chance:5, kind:'any' } } },
  'アークセラフ':           { text:'受ける回復量+15%', effect:{ healPct:15 } },
  'ペガサスロード':           { text:'昼の間、AGI+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'agi', pct:12 } } },
  'ヴァルキリーロード':       { text:'最初に受けた物理ダメージを60%で跳ね返す', effect:{ reflectFirst:{ kind:'phys', pct:60 } } },

  // ⑨灼砂の遺丘
  'サンドワーム':   { text:'HP+8%', effect:{ statPct:{ hp:8 } } },
  'ゴールデンマミー':       { text:'ルーン素材のドロップ率×1.4', effect:{ dropRateMult:1.4 } },
  'ミラージュリザード':           { text:'朝の間、回避率+4%', effect:{ bandStatPct:{ bands:['朝'], stat:'agi', pct:10 } } },
  'フレイムアヌビス':     { text:'昼の間、物理ダメージ+10%', effect:{ bandDmgPct:{ bands:['昼'], kind:'phys', pct:10 } } },
  'デザートウルフ':             { text:'晩の間、AGI+12%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:12 } } },

  // ⑩常闇の樹海
  'キラープラント':           { text:'攻撃ヒット時、敵のSTR-3%（重複12）', effect:{ onHitFoeStat:{ stats:['str'], pct:-3, max:12 } } },
  'クイーンマンドラゴラ':     { text:'攻撃ヒット時、20%で毒付与', effect:{ onHitAil:{ key:'poison', chance:20, kind:'any' } } },
  'ミストトレント':           { text:'朝の間、VIT+10%', effect:{ bandStatPct:{ bands:['朝'], stat:'vit', pct:10 } } },
  'サンライトピクシー':       { text:'昼の間、受ける回復量+20%', effect:{ bandHealPct:{ bands:['昼'], pct:20 } } },
  'クイーンバンシー':           { text:'晩の間、魔法ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'mag', pct:12 } } },

  // ⑪雷鳴の断崖
  'ストームイーグル':   { text:'命中率+4%', effect:{ hitBonus:4 } },
  'サンダーガーゴイル':     { text:'攻撃ヒット時、6%で麻痺付与', effect:{ onHitAil:{ key:'paralyze', chance:6, kind:'any' } } },
  'サンダーバード':           { text:'朝の間、DEX+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'dex', pct:12 } } },
  'サンダーエレメンタル':           { text:'魔法ダメージ+9%', effect:{ magDmgPct:9 } },
  'ボルトワイバーン':           { text:'晩の間、物理ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'phys', pct:12 } } },

  // ⑫腐海の沼獄
  'ヒュドラロード':       { text:'攻撃ヒット時、24%で毒付与', effect:{ onHitAil:{ key:'poison', chance:24, kind:'any' } } },
  'アシッドスライム':   { text:'毒状態になる確率を30%軽減', effect:{ ailResist:{ key:'poison', pct:30 } } },
  'グレーターウィスプ':           { text:'朝の間、魔法ダメージ+12%', effect:{ bandDmgPct:{ bands:['朝'], kind:'mag', pct:12 } } },
  'ポイズンフロッグ':       { text:'VIT+9%', effect:{ statPct:{ vit:9 } } },
  'グレーターゾンビ':             { text:'攻撃ヒット時、敵のVIT-4%（重複12）', effect:{ onHitFoeStat:{ stats:['vit'], pct:-4, max:12 } } },

  // ⑬奈落の坑道
  'グールキング':           { text:'物理ダメージを与えたとき、与えたダメージの6%を回復', effect:{ drainPhysPct:6 } },
  'ミスリルゴーレム':       { text:'物理ダメージ軽減+10%', effect:{ physCutPct:10 } },
  'クリスタルワームロード':           { text:'朝の間、INT+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'int_stat', pct:12 } } },
  'ドワーフキング':       { text:'スキルの発動率+4%', effect:{ procBonus:4 } },
  'グレーターシャドウ':             { text:'晩の間、回避率が上がる（AGI+12%）', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:12 } } },

  // ⑭星霜の遺跡
  'スターゴーレム':         { text:'INT+9%', effect:{ statPct:{ int_stat:9 } } },
  'ガーディアンゴーレム':         { text:'魔法ダメージ軽減+10%', effect:{ magCutPct:10 } },
  'セレスティアルナイト':         { text:'朝の間、STR+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'str', pct:12 } } },
  'スフィンクスロード':           { text:'昼の間、魔法ダメージ+14%', effect:{ bandDmgPct:{ bands:['昼'], kind:'mag', pct:14 } } },
  'ルナウルフキング':           { text:'晩の間、INT+14%', effect:{ bandStatPct:{ bands:['晩'], stat:'int_stat', pct:14 } } },

  // ⑮深淵の海溝
  'クラーケンキング':     { text:'攻撃ヒット時、敵のAGIとDEX-3%（重複12）', effect:{ onHitFoeStat:{ stats:['agi','dex'], pct:-3, max:12 } } },
  'エンシェントドラゴン':             { text:'STR+9%', effect:{ statPct:{ str:9 } } },
  'アビスサーペント':           { text:'朝の間、物理ダメージ+14%', effect:{ bandDmgPct:{ bands:['朝'], kind:'phys', pct:14 } } },
  'グレートホエール':         { text:'HP+10%', effect:{ statPct:{ hp:10 } } },
  'セイレーンクイーン':         { text:'ルーン素材のドロップ率×1.5', effect:{ dropRateMult:1.5 } },

  // ============================================================
  // ===== 追加の通常敵・時間帯の敵（2026-08-25）=====
  // ★レアより控えめにしてある（レアは「ひとまわり強い」枠のままにするため）
  // ============================================================
  // エリア1
  '森ネズミ': { text:'AGI+2%', effect:{ statPct:{ agi:2 } } },
  'オオアリ': { text:'HP+2%', effect:{ statPct:{ hp:2 } } },
  'つるヘビ': { text:'攻撃ヒット時、8%で毒付与', effect:{ onHitAil:{ key:'poison', chance:8, kind:'any' } } },
  '朝もやのカエル': { text:'朝の間、HP+5%', effect:{ bandStatPct:{ bands:['朝'], stat:'hp', pct:5 } } },
  'ひなたのチョウ': { text:'昼の間、魔法ダメージ+5%', effect:{ bandDmgPct:{ bands:['昼'], kind:'mag', pct:5 } } },
  '夜鳴きのコオロギ': { text:'晩の間、DEX+5%', effect:{ bandStatPct:{ bands:['晩'], stat:'dex', pct:5 } } },
  // エリア2
  '草原オオカミ': { text:'AGI+3%', effect:{ statPct:{ agi:3 } } },
  'ゴブリン射手': { text:'命中率+2%', effect:{ hitBonus:2 } },
  '野伏せのイノシシ': { text:'物理ダメージ軽減+3%', effect:{ physCutPct:3 } },
  '朝露のオオバッタ': { text:'朝の間、AGI+6%', effect:{ bandStatPct:{ bands:['朝'], stat:'agi', pct:6 } } },
  '炎天のハゲタカ': { text:'昼の間、物理ダメージ+6%', effect:{ bandDmgPct:{ bands:['昼'], kind:'phys', pct:6 } } },
  '夜盗の番犬': { text:'晩の間、STR+6%', effect:{ bandStatPct:{ bands:['晩'], stat:'str', pct:6 } } },
  // エリア3
  '洞窟グモ': { text:'攻撃ヒット時、10%で毒付与', effect:{ onHitAil:{ key:'poison', chance:10, kind:'any' } } },
  'コボルト投石手': { text:'物理ダメージ+3%', effect:{ physDmgPct:3 } },
  'スケルトンドッグ': { text:'AGI+3%', effect:{ statPct:{ agi:3 } } },
  '朝陰のオオムカデ': { text:'朝の間、STR+6%', effect:{ bandStatPct:{ bands:['朝'], stat:'str', pct:6 } } },
  '石窟のサソリ': { text:'昼の間、VIT+6%', effect:{ bandStatPct:{ bands:['昼'], stat:'vit', pct:6 } } },
  '亡霊コボルト': { text:'晩の間、魔法ダメージ+6%', effect:{ bandDmgPct:{ bands:['晩'], kind:'mag', pct:6 } } },
  // エリア4
  '入り江のサメ': { text:'物理ダメージ+4%', effect:{ physDmgPct:4 } },
  '大ウミヘビ': { text:'攻撃ヒット時、10%で鈍足付与', effect:{ onHitAil:{ key:'slow', chance:10, kind:'any' } } },
  '海賊の砲手': { text:'DEX+4%', effect:{ statPct:{ dex:4 } } },
  '朝凪のトビウオ': { text:'朝の間、AGI+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'agi', pct:8 } } },
  '日照りのウミガメ': { text:'昼の間、VIT+8%', effect:{ bandStatPct:{ bands:['昼'], stat:'vit', pct:8 } } },
  '夜光のタコ': { text:'晩の間、魔法ダメージ+8%', effect:{ bandDmgPct:{ bands:['晩'], kind:'mag', pct:8 } } },
  // エリア5
  '峰のオオワシ': { text:'回避率+2%', effect:{ evaBonus:2 } },
  '山岳トロール': { text:'HP+5%', effect:{ statPct:{ hp:5 } } },
  '岩場のヒグマ': { text:'STR+5%', effect:{ statPct:{ str:5 } } },
  '払暁のハヤブサ': { text:'朝の間、DEX+10%', effect:{ bandStatPct:{ bands:['朝'], stat:'dex', pct:10 } } },
  '陽射しのヤマアラシ': { text:'昼の間、VIT+10%', effect:{ bandStatPct:{ bands:['昼'], stat:'vit', pct:10 } } },
  '宵闇のオオカミ': { text:'晩の間、物理ダメージ+10%', effect:{ bandDmgPct:{ bands:['晩'], kind:'phys', pct:10 } } },
  // エリア6
  '氷壁のゴーレム': { text:'物理ダメージ軽減+5%', effect:{ physCutPct:5 } },
  '白銀のシロクマ': { text:'STR+5%', effect:{ statPct:{ str:5 } } },
  '霜のスケルトン': { text:'攻撃ヒット時、敵のAGI-2%（重複10）', effect:{ onHitFoeStat:{ stats:['agi'], pct:-2, max:10 } } },
  '朝焼けのアイスドレイク': { text:'朝の間、魔法ダメージ+10%', effect:{ bandDmgPct:{ bands:['朝'], kind:'mag', pct:10 } } },
  '白光のスノーハーピー': { text:'昼の間、DEX+10%', effect:{ bandStatPct:{ bands:['昼'], stat:'dex', pct:10 } } },
  '極夜のリッチ': { text:'晩の間、INT+10%', effect:{ bandStatPct:{ bands:['晩'], stat:'int_stat', pct:10 } } },
  // エリア7
  '溶岩スライム': { text:'魔法ダメージ軽減+6%', effect:{ magCutPct:6 } },
  '火口のヘルハウンド': { text:'AGI+6%', effect:{ statPct:{ agi:6 } } },
  '燃えさかるインプ': { text:'魔法ダメージ+6%', effect:{ magDmgPct:6 } },
  '暁炎のフェニックス': { text:'朝の間、受ける回復量+20%', effect:{ bandHealPct:{ bands:['朝'], pct:20 } } },
  '陽炎のケルベロス': { text:'昼の間、STR+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'str', pct:12 } } },
  '熾火のワイバーン': { text:'晩の間、物理ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'phys', pct:12 } } },
  // エリア8
  '蒼天のロック鳥': { text:'STR+6%', effect:{ statPct:{ str:6 } } },
  '浮遊するゴーレム': { text:'物理ダメージ軽減+6%', effect:{ physCutPct:6 } },
  '天空の弓兵': { text:'命中率+3%', effect:{ hitBonus:3 } },
  '曙光のケルビム': { text:'朝の間、受ける回復量+25%', effect:{ bandHealPct:{ bands:['朝'], pct:25 } } },
  '白昼のユニコーン': { text:'昼の間、AGI+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'agi', pct:12 } } },
  '星降りのワイバーン': { text:'晩の間、物理ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'phys', pct:12 } } },
  // エリア9
  '遺丘のハゲワシ': { text:'AGI+4%', effect:{ statPct:{ agi:4 } } },
  '砂のゴーレム': { text:'物理ダメージ軽減+4%', effect:{ physCutPct:4 } },
  '墓荒らしの盗掘者': { text:'素材ドロップ率×1.25', effect:{ dropRateMult:1.25 } },
  '朝日のスカラベ': { text:'朝の間、VIT+8%', effect:{ bandStatPct:{ bands:['朝'], stat:'vit', pct:8 } } },
  '灼熱のコブラ': { text:'昼の間、物理ダメージ+8%', effect:{ bandDmgPct:{ bands:['昼'], kind:'phys', pct:8 } } },
  '月下のハイエナ': { text:'晩の間、AGI+8%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:8 } } },
  // エリア10
  '樹海のオオグモ': { text:'攻撃ヒット時、12%で毒付与', effect:{ onHitAil:{ key:'poison', chance:12, kind:'any' } } },
  '苔むしたゴーレム': { text:'魔法ダメージ軽減+5%', effect:{ magCutPct:5 } },
  '人喰いのツタ': { text:'物理ダメージを与えたとき、与えたダメージの4%を回復', effect:{ drainPhysPct:4 } },
  '朝靄のマイコニド': { text:'朝の間、魔法ダメージ+10%', effect:{ bandDmgPct:{ bands:['朝'], kind:'mag', pct:10 } } },
  '木漏れ日のオオカブト': { text:'昼の間、STR+10%', effect:{ bandStatPct:{ bands:['昼'], stat:'str', pct:10 } } },
  '常闇のオオコウモリ': { text:'晩の間、AGI+10%', effect:{ bandStatPct:{ bands:['晩'], stat:'agi', pct:10 } } },
  // エリア11
  '断崖のコンドル': { text:'AGI+5%', effect:{ statPct:{ agi:5 } } },
  '帯電のゴーレム': { text:'魔法ダメージ軽減+5%', effect:{ magCutPct:5 } },
  '雷牙のオオカミ': { text:'攻撃ヒット時、3%で麻痺付与', effect:{ onHitAil:{ key:'paralyze', chance:3, kind:'any' } } },
  '暁雲のグリフォン': { text:'朝の間、物理ダメージ+10%', effect:{ bandDmgPct:{ bands:['朝'], kind:'phys', pct:10 } } },
  '雷光のドレイク': { text:'昼の間、INT+10%', effect:{ bandStatPct:{ bands:['昼'], stat:'int_stat', pct:10 } } },
  '雷鳴のハーピー': { text:'晩の間、DEX+10%', effect:{ bandStatPct:{ bands:['晩'], stat:'dex', pct:10 } } },
  // エリア12
  '沼のオオワニ': { text:'物理ダメージ+6%', effect:{ physDmgPct:6 } },
  '腐肉のオオバエ': { text:'攻撃ヒット時、16%で毒付与', effect:{ onHitAil:{ key:'poison', chance:16, kind:'any' } } },
  '泥のゴーレム': { text:'VIT+6%', effect:{ statPct:{ vit:6 } } },
  '朝霞のオオヒル': { text:'朝の間、HP+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'hp', pct:12 } } },
  '陽だまりのオオヘビ': { text:'昼の間、物理ダメージ+12%', effect:{ bandDmgPct:{ bands:['昼'], kind:'phys', pct:12 } } },
  '夜霧のバジリスク': { text:'晩の間、INT+12%', effect:{ bandStatPct:{ bands:['晩'], stat:'int_stat', pct:12 } } },
  // エリア13
  '坑道のオオネズミ': { text:'AGI+6%', effect:{ statPct:{ agi:6 } } },
  '錆びた自動人形': { text:'物理ダメージ軽減+6%', effect:{ physCutPct:6 } },
  '奈落のスケルトン兵': { text:'物理攻撃ヒット時、14%で出血付与', effect:{ onHitAil:{ key:'bleed', chance:14, kind:'phys' } } },
  '曙光のクリスタルゴーレム': { text:'朝の間、INT+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'int_stat', pct:12 } } },
  '灯火のドワーフ坑夫': { text:'昼の間、STR+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'str', pct:12 } } },
  '深穴のオオグモ': { text:'晩の間、DEX+12%', effect:{ bandStatPct:{ bands:['晩'], stat:'dex', pct:12 } } },
  // エリア14
  '星霜のゴーレム': { text:'HP+6%', effect:{ statPct:{ hp:6 } } },
  '遺跡の魔導兵': { text:'魔法ダメージ+6%', effect:{ magDmgPct:6 } },
  '時喰いのカゲロウ': { text:'回避率+3%', effect:{ evaBonus:3 } },
  '暁星のケンタウロス': { text:'朝の間、DEX+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'dex', pct:12 } } },
  '白日のマンティコア': { text:'昼の間、STR+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'str', pct:12 } } },
  '星宿の月蛾': { text:'晩の間、魔法ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'mag', pct:12 } } },
  // エリア15
  '深海のメガロドン': { text:'物理ダメージ+6%', effect:{ physDmgPct:6 } },
  '海溝のダイオウイカ': { text:'物理ダメージを与えたとき、与えたダメージの5%を回復', effect:{ drainPhysPct:5 } },
  '冥暗のマーマン': { text:'DEX+6%', effect:{ statPct:{ dex:6 } } },
  '朝凪のシャチ': { text:'朝の間、STR+12%', effect:{ bandStatPct:{ bands:['朝'], stat:'str', pct:12 } } },
  '陽射しのマンタ': { text:'昼の間、AGI+12%', effect:{ bandStatPct:{ bands:['昼'], stat:'agi', pct:12 } } },
  '深海のオオダコ': { text:'晩の間、魔法ダメージ+12%', effect:{ bandDmgPct:{ bands:['晩'], kind:'mag', pct:12 } } },
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
