// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ユニーク装備（ボス固有）の一覧
// ------------------------------------------------------------
// ★名前・能力の文・ステはユーザーが案のシートで決めたもの（2026-10-18〜21・https://claude.ai/artifact/Uo9AC6Wo7zMiBSJ448WW3p 版22）。
//   ここを手で書き換えるときは、シートの案（v2cap-tools/unique-1018/unique-draft.mjs）も合わせる
// 【確定】ユーザーが決めたこと（細かい決まりは equipment.js の「ユニーク」と docs/v2cap-design.md）：
//   ・落とすのはボスだけ。①②のボスは1つ・大ボス（③のボス）は2つ＝60個
//   ・ボスに勝ったとき0.5%（サーバーの v2cap_sortie_settle が引く）。大ボスは落ちたら2つのどちらかを50%ずつ
//   ・武器はいまの職業が使えない種類でもそのまま落とす／必要LVはどれも80
//   ・ステはユーザーが1つずつ決めた値（LV80・強化+0のときのステ）。強化と必要LVに足りないときは、この割合のまま増える・減る
//   ・固有の能力（fx）は戦闘の src/v2/lib/battleSet.js が読む（セット能力と同じ入れ物・src/v2cap/lib/fxMerge.js でまとめる）
//   ・同じユニークは1つまで（装飾品の2枠に同じものは着けられない）・装備とセットの毎ターン回復は合計6%まで
//   ・LV80より低いLVでも固有の能力は全部効く（ステだけLV相当に小さくなる）
// spot … 落とす場所（エリアk の ①＝3k−2・②＝3k−1・③＝3k）／ boss … その場所のボス（areas.js の名簿と同じか unique.test.js が見る）
// ⚠「年輪の書」のステは合計161（ほかは種類ごとに 武器160・鎧105・頭／腕／足80・装飾品65）＝ユーザーの入力のまま
// ============================================================
export const UNIQUE_DEFS = [
  { spot: 1, boss: 'オヤブンネズミ', kind: '短剣', name: '蝕毒の牙', text: '攻撃ヒット時、30％で毒にする。毒状態へのダメージ＋20％', stats: {str: 30, dex: 35, agi: 50, luk: 45}, fx: {onHitAils: [{key: 'poison', chance: 30}], vsAilDmg: [{key: 'poison', pct: 20}]} },
  { spot: 2, boss: 'クイーンアント', kind: '重鎧鎧', name: '巣母の甲殻鎧', text: '受けるダメージ−10%', stats: {agi: 20, vit: 85}, fx: {takenCut: 10} },
  { spot: 3, boss: 'ビッグスライム', kind: '片手剣', name: '蒼蝕の魔剣', text: '攻撃ヒット時、40％の確率でVIT−5%（重複最大50％）', stats: {str: 60, dex: 30, agi: 10, int_stat: 20, vit: 30, luk: 10}, fx: {onHitStack: [{stat: 'vit', pct: -5, chance: 40, cap: -50}]} },
  { spot: 3, boss: 'ビッグスライム', kind: 'リング', name: 'ビッグスライムの指輪', text: '受ける物理ダメージ−10%\n毎ターンHP3％回復', stats: {str: 10, dex: 10, agi: 10, int_stat: 10, vit: 10, luk: 15}, fx: {physCut: 10, regenPct: 3} },
  { spot: 4, boss: '群れ長グレイファング', kind: '両手剣', name: 'ブラッドハウル', text: '攻撃時、30％で出血。\n出血している相手への与ダメージ+20%', stats: {str: 128, dex: 16, vit: 16}, fx: {onHitAils: [{key: 'bleed', chance: 30}], vsAilDmg: [{key: 'bleed', pct: 20}]} },
  { spot: 5, boss: 'ゴブリンチーフ', kind: 'ベルト', name: 'ウォードラムベルト', text: '戦闘開始から7ターン、STR+20%', stats: {str: 25, agi: 10, vit: 30}, fx: {earlyBuff: {turns: 7, table: {str: 20}}} },
  { spot: 6, boss: '盗賊団のリーダー', kind: '短剣', name: '簒奪の刃', text: '攻撃ヒット時、50%で出血\n出血状態の敵へ攻撃時、与ダメの10％回復', stats: {str: 40, dex: 30, agi: 70, luk: 20}, fx: {onHitAils: [{key: 'bleed', chance: 50}], drainIfAil: [{key: 'bleed', pct: 10}]} },
  { spot: 6, boss: '盗賊団のリーダー', kind: '軽装足', name: '影縫いのブーツ', text: '戦闘開始時、敵のAGI10％吸収、吸収した値を自身のAGIに加算する', stats: {str: 10, agi: 50, vit: 20}, fx: {agiSteal: 10} },
  { spot: 7, boss: 'コボルト族長ドグラ', kind: '斧', name: 'ケイヴキーパー', text: 'HP30%以下のとき与ダメージ+40%', stats: {str: 120, dex: 20, vit: 20}, fx: {lowHpDeal: [{at: 30, pct: 40}]} },
  { spot: 8, boss: 'ボーンジェネラル', kind: '重鎧頭', name: '亡将の鉄兜', text: 'バトル開始時、その後6ターンごとに状態異常を1回防ぐバフを獲得', stats: {str: 20, int_stat: 20, vit: 40}, fx: {ward: {every: 6}} },
  { spot: 9, boss: '古代の番人', kind: 'ネックレス', name: '番人の心核', text: '最大MPの20%をINTに加算', stats: {dex: 10, int_stat: 40, vit: 15}, fx: {convertAdds: [{from: 'mp', to: 'int_stat', pct: 20}]} },
  { spot: 9, boss: '古代の番人', kind: '杖', name: '虚葬の錫杖', text: '相手の魔法防御を30%無視', stats: {dex: 20, int_stat: 110, luk: 30}, fx: {defIgnore: {mag: 30}} },
  { spot: 10, boss: '鉄鋏ヨロイガニ', kind: '重鎧腕', name: '磯蟹の大篭手', text: '物理ダメージを受けたら、次の物理ダメージ−15％。\n魔法ダメージを受けたら、次の魔法ダメージ−15％。', stats: {str: 10, dex: 12, vit: 58}, fx: {nextSameCut: 15} },
  { spot: 11, boss: '海賊船長ガルシオ', kind: '片手剣', name: '黒潮のカトラス', text: '攻撃で倒したとき、レア以上の装備がドロップする確率1.4倍', stats: {str: 80, dex: 40, agi: 20, luk: 20}, fx: {rareDropMult: 1.4} },
  { spot: 12, boss: 'シーサーペント', kind: 'ネックレス', name: '海竜の蒼鱗', text: '受ける魔法ダメージ−15％', stats: {dex: 20, agi: 20, vit: 25}, fx: {magCut: 15} },
  { spot: 12, boss: 'シーサーペント', kind: '軽装頭', name: 'タイダルクラウン', text: '状態異常になる確率−40%', stats: {str: 10, dex: 30, agi: 20, int_stat: 10, vit: 10}, fx: {resistAll: 0.6} },
  { spot: 13, boss: '砂地獄アントリオン', kind: '投擲', name: 'サンドトラップ', text: '鈍足の相手への与ダメージ+15%', stats: {str: 20, dex: 50, agi: 40, int_stat: 20, vit: 30}, fx: {vsAilDmg: [{key: 'slow', pct: 15}]} },
  { spot: 14, boss: 'ミイラ大神官', kind: '軽装頭', name: 'フューネラルクラウン', text: '自分が受ける状態異常の持続−1ターン\n状態異常完治時にHP5％回復', stats: {dex: 20, agi: 35, vit: 25}, fx: {ailTurnsCut: 1, cureHeal: 5} },
  { spot: 15, boss: '砂皇スカラベウス', kind: '投擲', name: 'ソリスティス', text: 'HPが50％以上なら与ダメ＋15％、50％未満なら与ダメ＋5%', stats: {str: 32, dex: 64, agi: 32, int_stat: 32}, fx: {hpDeal: [{at: 50, hi: 15, lo: 5}]} },
  { spot: 15, boss: '砂皇スカラベウス', kind: '重鎧頭', name: 'ケプリの仮面', text: '戦闘中1回、HP30%以下になったら最大HPの30%を回復', stats: {dex: 12, vit: 58, luk: 10}, fx: {lowHpHealOnce: {at: 30, pct: 30}} },
  { spot: 16, boss: '岩砕きグリズリー', kind: '軽装鎧', name: '熊王の戦装束', text: 'VITの15%をSTRに加算', stats: {str: 30, dex: 10, agi: 30, vit: 35}, fx: {convertAdds: [{from: 'vit', to: 'str', pct: 15}]} },
  { spot: 17, boss: '峠守ギガトロール', kind: 'ベルト', name: '不死身の大帯', text: '受けたダメージの15%を次のターンに回復', stats: {str: 12, agi: 13, vit: 40}, fx: {rootHealPct: 15} },
  { spot: 18, boss: '雷鷲サンダーロック', kind: '拳', name: '嵐鷲の爪牙', text: 'AGIの15%をSTRに加算', stats: {str: 80, dex: 15, agi: 65}, fx: {convertAdds: [{from: 'agi', to: 'str', pct: 15}]} },
  { spot: 18, boss: '雷鷲サンダーロック', kind: '重鎧鎧', name: '嵐纏の重鎧', text: 'ダメージを受けたとき、その10%を相手に返す', stats: {str: 20, dex: 25, agi: 50, vit: 10}, fx: {reflect: 10} },
  { spot: 19, boss: '妖蛾ポイズンモス', kind: 'イヤリング', name: 'ダスクウィングピアス', text: '毒になる確率−50%\n攻撃ヒット時、20％の確率で毒にする', stats: {str: 15, dex: 20, agi: 15, int_stat: 15}, fx: {resist: {poison: 0.5}, onHitAils: [{key: 'poison', chance: 20}]} },
  { spot: 20, boss: '霧魔女ミルヴァ', kind: '宝珠', name: 'ミストシーア', text: 'INT＋30％', stats: {dex: 30, agi: 40, int_stat: 70, luk: 20}, fx: {statPct: {int_stat: 30}} },
  { spot: 21, boss: '森王エルダートレント', kind: '重鎧足', name: '千年根の具足', text: '最大HP＋10％\n毎ターン最大HPの3%を回復', stats: {agi: 20, vit: 60}, fx: {maxHpPct: 10, regenPct: 3} },
  { spot: 21, boss: '森王エルダートレント', kind: '書', name: '年輪の書', text: 'スキルの発動率＋10％\n毎ターンINT+2%（最大+20%）', stats: {dex: 40, int_stat: 97, vit: 24}, fx: {procBonus: 10, turnGrow: [{stat: 'int_stat', per: 2, max: 20}]} },
  { spot: 22, boss: '氷牙マンモス', kind: '槍', name: '永久凍牙', text: 'DEXの15％をSTRに変換', stats: {str: 90, dex: 50, vit: 20}, fx: {convertAdds: [{from: 'dex', to: 'str', pct: 15}]} },
  { spot: 23, boss: '晶獣グラキエス', kind: '宝珠', name: 'プリズムハート', text: 'MPの消費量＋20％\nスキルダメージ＋35％', stats: {dex: 40, int_stat: 70, luk: 50}, fx: {mpCut: -20, skillDeal: 35} },
  { spot: 24, boss: '氷霊フロストバーン', kind: '銃', name: '絶零の魔導砲', text: '攻撃ヒット時、30％で鈍足\n鈍足の敵にヒット時、20％で麻痺', stats: {str: 50, dex: 30, int_stat: 50, luk: 30}, fx: {onHitAils: [{key: 'slow', chance: 30}], onHitAilIf: [{if: 'slow', key: 'paralyze', chance: 20}]} },
  { spot: 24, boss: '氷霊フロストバーン', kind: '重鎧鎧', name: 'フロストバーンの聖鎧', text: 'ダメージを受けたとき、30%で相手を鈍足\n鈍足状態の敵からダメージを受けたとき、20％で麻痺', stats: {int_stat: 30, vit: 75}, fx: {counterAil: [{key: 'slow', chance: 30}], counterAilIf: [{if: 'slow', key: 'paralyze', chance: 20}]} },
  { spot: 25, boss: '妖獣ヌエ', kind: '刀', name: '妖刀・鵺斬', text: 'スキル発動率−10％\n命中率・与ダメ＋20％', stats: {str: 96, dex: 24, agi: 40}, fx: {procBonus: -10, hitBonus: 20, dealPct: 20} },
  { spot: 26, boss: '雷槌ギガース', kind: '鈍器', name: 'サンダーフォール', text: 'スキル発動率・命中率−10％\n物理ダメージ＋50％', stats: {str: 150, luk: 10}, fx: {procBonus: -10, hitBonus: -10, kindDeal: {phys: 50}} },
  { spot: 27, boss: '雷帝ケラウノス', kind: 'イヤリング', name: 'ストームロードピアス', text: 'クリティカル率＋20％', stats: {str: 15, agi: 20, luk: 30}, fx: {critBonus: 20} },
  { spot: 27, boss: '雷帝ケラウノス', kind: '重鎧腕', name: '天罰の剛甲', text: 'スキルダメージを受けた際、30％の確率で相手を1ターン封印する（MPを使うスキルがすべて使えない）', stats: {str: 16, dex: 12, int_stat: 16, vit: 36}, fx: {counterSeal: {chance: 30}} },
  { spot: 28, boss: '岩甲亀ヴォルカン', kind: '重鎧頭', name: '亀甲の大兜', text: '状態異常にかかっていないとき、受けるダメージ−15％', stats: {str: 12, dex: 16, int_stat: 12, vit: 40}, fx: {calmCut: 15} },
  { spot: 29, boss: '溶岩竜ラヴァウルム', kind: '軽装腕', name: '炎竜鱗の手甲', text: '火傷にかからなくなる\nダメージを受けたとき、20％で相手を火傷', stats: {str: 25, dex: 15, agi: 20, vit: 20}, fx: {immune: ['burn'], counterAil: [{key: 'burn', chance: 20}]} },
  { spot: 30, boss: '深紅のサラマンダー', kind: 'リング', name: '深紅の牙輪', text: 'スキルの枠を5つ全部うめて、パッシブ以外を全部使うと、その戦闘中STR+30%', stats: {str: 30, dex: 15, agi: 10, luk: 10}, fx: {allSkillsBuff: {str: 30}} },
  { spot: 30, boss: '深紅のサラマンダー', kind: 'イヤリング', name: '深紅の魔眼石', text: 'スキルの枠を5つ全部うめて、パッシブ以外を全部使うと、その戦闘中INT+30%', stats: {dex: 10, agi: 10, int_stat: 30, luk: 15}, fx: {allSkillsBuff: {int_stat: 30}} },
  { spot: 31, boss: '沼主ガヴィアル', kind: '斧', name: 'デスロール', text: '攻撃を当てるたび与ダメージ+5%（最大+25%）\n攻撃を外すと元に戻る', stats: {str: 100, dex: 20, vit: 20, luk: 20}, fx: {hitStreak: {per: 5, max: 25}} },
  { spot: 32, boss: '沼呪師ザルグ', kind: '杖', name: 'カースバインド', text: '攻撃ヒット時、20％で呪い\n呪いの相手への与ダメージ+15％', stats: {dex: 20, int_stat: 100, vit: 10, luk: 30}, fx: {onHitAils: [{key: 'curse', chance: 20}], vsAilDmg: [{key: 'curse', pct: 15}]} },
  { spot: 33, boss: '毒龍ヴェノムヒュドラ', kind: '軽装鎧', name: '九頭の鱗衣', text: '毒にかからなくなる\n毎ターン最大HPの2％を回復\nHP50％以下なら4％', stats: {dex: 20, agi: 30, vit: 55}, fx: {immune: ['poison'], regenPct: 2, regenLow: {at: 50, add: 2}} },
  { spot: 33, boss: '毒龍ヴェノムヒュドラ', kind: '弓', name: 'ブライトレイン', text: '攻撃ヒット時、30％で毒\n毒の相手には、40％でもう1回当たる（2回目の威力50％）', stats: {str: 40, dex: 80, agi: 30, luk: 10}, fx: {onHitAils: [{key: 'poison', chance: 30}], chaseIfAil: [{key: 'poison', chance: 40, mult: 0.5}]} },
  { spot: 34, boss: '掘削機兵ドリラー', kind: '拳', name: 'パンツァーブレッヒャー', text: '相手の物理防御を30%無視', stats: {str: 90, dex: 40, agi: 30}, fx: {defIgnore: {phys: 30}} },
  { spot: 35, boss: '奈落蜘蛛アラクネ', kind: '軽装鎧', name: 'シャドウシルクドレス', text: 'ダメージを受けたとき、30％で相手を鈍足\n鈍足の相手から受けるダメージ−15％', stats: {dex: 30, agi: 45, int_stat: 10, vit: 20}, fx: {counterAil: [{key: 'slow', chance: 30}], vsSlowCut: 15} },
  { spot: 36, boss: '巌喰いガイアモール', kind: '両手剣', name: 'ベルクシュパルター', text: '攻撃を当てるたびVIT+3％（最大+30％）', stats: {str: 100, dex: 10, vit: 50}, fx: {hitGrow: [{stat: 'vit', per: 3, max: 30}]} },
  { spot: 36, boss: '巌喰いガイアモール', kind: '重鎧足', name: '地潜りの鉄靴', text: '戦闘開始から2ターン、受けるダメージ−50％（地中に潜る）', stats: {str: 20, agi: 20, vit: 40}, fx: {earlyCut: {turns: 2, pct: 50}} },
  { spot: 37, boss: '空鯨ネブラ', kind: '軽装足', name: 'エウロスブーツ', text: '回避+10％\n回避したとき、最大HPの5％を回復', stats: {dex: 15, agi: 45, int_stat: 10, vit: 10}, fx: {evaBonus: 10, dodgeHeal: 5} },
  { spot: 38, boss: '天騎士長セレスト', kind: '槍', name: '聖光の旗槍', text: '攻撃ヒット時、STRの15％ぶんの追加ダメージ（相手の魔法防御で受ける）', stats: {str: 70, dex: 30, int_stat: 40, vit: 20}, fx: {addDmg: [{stat: 'str', rate: 0.15, kind: 'mag'}]} },
  { spot: 39, boss: '天空覇龍ウラノス', kind: '銃', name: 'ウラノスの天砲', text: '攻撃ヒット時、クリティカルダメージ+10％（最大5重複）', stats: {str: 60, dex: 40, int_stat: 40, luk: 20}, fx: {critDmgStack: {per: 10, max: 50}} },
  { spot: 39, boss: '天空覇龍ウラノス', kind: 'リング', name: '蒼天龍の指輪', text: 'STR・INT+10%\nクリティカルを出すたび、さらに+2%（最大+30%）', stats: {str: 15, int_stat: 15, luk: 35}, fx: {statPct: {str: 10, int_stat: 10}, critGrow: {stats: ['str', 'int_stat'], per: 2, max: 20}} },
  { spot: 40, boss: '古代機兵ゼクス', kind: 'ベルト', name: 'クロックワークベルト', text: '3ターンごとに、次の攻撃の与ダメージ+50％（歯車がかみ合う）', stats: {str: 20, dex: 20, vit: 25}, fx: {burstEvery: {every: 3, pct: 50}} },
  { spot: 41, boss: '大司書ノクトゥア', kind: '書', name: '禁書アポクリファ', text: '戦闘開始から3ターン目、8ターン目、13ターン目に相手にかかっている強化バフをすべて消す', stats: {dex: 30, int_stat: 100, luk: 30}, fx: {dispelTurns: [3, 8, 13]} },
  { spot: 42, boss: '時星龍アイオーン', kind: '刀', name: '刹那の星刀', text: 'その戦闘で初めて使うスキルのダメージ＋80％', stats: {str: 80, dex: 40, agi: 30, luk: 10}, fx: {firstSkill: 80} },
  { spot: 42, boss: '時星龍アイオーン', kind: '弓', name: '刻弓レトログラー', text: '5ターンごとに、その間に与えたダメージの30％をもう一度与える（時の反響）', stats: {str: 30, dex: 70, agi: 40, luk: 20}, fx: {echo: {every: 5, pct: 30}} },
  { spot: 43, boss: '大海月ルミナ', kind: '軽装腕', name: '常若の手甲', text: '戦闘中1回、倒れるダメージを受けてもHP30％で復活する', stats: {dex: 20, agi: 30, int_stat: 10, vit: 20}, fx: {revive: 30} },
  { spot: 44, boss: '深海魔女キルケ', kind: '鈍器', name: 'ヴァンドルング', text: '攻撃ヒット時、20％で相手のSTR・INT−15％（2ターン）', stats: {str: 50, int_stat: 80, vit: 30}, fx: {onHitTimed: [{chance: 20, turns: 2, table: {str: -15, int_stat: -15}}]} },
  { spot: 45, boss: '深海覇王リヴァイアサン', kind: 'ネックレス', name: '海王の潮汐ペンダント', text: '奇数ターンは与ダメージ+20％、偶数ターンは受けるダメージ−15％（潮の満ち引き）', stats: {str: 15, int_stat: 15, vit: 25, luk: 10}, fx: {tide: {odd: 20, even: 15}} },
  { spot: 45, boss: '深海覇王リヴァイアサン', kind: '重鎧足', name: '深淵歩きの脚甲', text: '鈍足・麻痺にかからなくなる', stats: {str: 20, agi: 10, vit: 50}, fx: {immune: ['slow', 'paralyze']} },
]
