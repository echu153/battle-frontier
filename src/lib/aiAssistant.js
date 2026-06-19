// ============================================================
// AI相談アシスタント（ルールベース＋DB検索・LLM不使用・完全無料）
//   1) クラス知識（転職条件・役割）……全クラス網羅（静的）
//   2) 施設/仕組みのQ&A（静的KB・キーワード長重み付けスコア）
//   3) DBライブ検索（Supabaseの読み取りは無料）……skills / items / weapons を
//      名前で照合し、「○○ってなに？」「○○の効果は？」に動的回答
// すべてフロント＋無料読み取りで完結（リアルマネー不要）。
// ============================================================
import { supabase } from '../supabase'

// 入力正規化：全角英数→半角、空白・記号を除去
const normalize = (s) => (s || '')
  .toString()
  .toLowerCase()
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/\s+/g, '')
  .replace(/[、。，．・！!？?「」『』（）()【】_~〜:：]/g, '')

// LIKE/ILIKE のワイルドカード( % _ \ )をエスケープし、ユーザー入力を文字どおり扱う
const escapeLike = (s) => (s || '').replace(/[\\%_]/g, '\\$&')

// レーベンシュタイン編集距離（タイポ・言いかけの「もしかして」推測に使用）
const editDistance = (a, b) => {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

// ============================================================
// クラス知識
// ============================================================
export const INITIAL_CLASSES = ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家']

export const PHYSICAL_CLASSES = ['戦士', '弓使い', '格闘家', '侍', '狂戦士', '狩人', '暗殺者', '体術師', '竜騎士']
export const MAGICAL_CLASSES = ['魔法使い', '僧侶', '元素使い', '死霊使い', '聖職者', '異端審問官', '賢者']
export const HYBRID_CLASSES = ['魔法剣士', '聖騎士', '魔銃士', 'サイキッカー', 'ギャンブラー']

// 転職条件（Game.jsx の ADVANCED_CLASSES と同期。requiresLv 既定=100）
const ADVANCED_REQ = {
  '侍': { requires: '戦士' },
  '狂戦士': { requires: '戦士' },
  '狩人': { requires: '弓使い' },
  '暗殺者': { requires: '弓使い' },
  '元素使い': { requires: '魔法使い' },
  '死霊使い': { requires: '魔法使い' },
  '聖職者': { requires: '僧侶' },
  '異端審問官': { requires: '僧侶' },
  '賢者': { requires: '僧侶', requiresLv: 50, requires2: '魔法使い', requires2Lv: 50 },
  'サイキッカー': { requires: '格闘家' },
  '体術師': { requires: '格闘家' },
  '魔銃士': { requires: '弓使い', requiresLv: 50, requires2: '魔法使い', requires2Lv: 50 },
  'ギャンブラー': { requiresItem: '賭博場で「ギャンブラーの証」を入手する' },
  '魔法剣士': { requires: '戦士', requiresLv: 50, requires2: '魔法使い', requires2Lv: 50 },
  '聖騎士': { requires: '戦士', requiresLv: 50, requires2: '僧侶', requires2Lv: 50 },
  '竜騎士': { requiresItem: 'ドラゴン討伐で「竜騎士の証明」を入手する' },
}

// 各クラスの役割（ひとこと説明）
const CLASS_ROLE = {
  '戦士': '物理アタッカーの基本職。剣などの物理武器で戦う。',
  '弓使い': '弓で戦う基本職。命中・素早さ寄り。',
  '魔法使い': '特殊攻撃(魔法)で戦う基本職。',
  '僧侶': '回復・補助が得意な基本職。',
  '格闘家': '拳で戦う手数型の基本職。',
  '侍': '刀の物理上位職。居合斬・防御無視・月影が強力。',
  '狂戦士': '高火力・高リスクの物理上位職。バーサクで与ダメ増だが被ダメも増。',
  '狩人': '弓の物理上位職。毒矢・三連射・絶影狙撃。',
  '暗殺者': '出血特化の物理上位職。急所突きで一気に削る。',
  '元素使い': '属性魔法アタッカー。スタン・やけど・落雷。',
  '死霊使い': '召喚とドレインの魔法職。バリアや弱体も。',
  '聖職者': '回復・聖属性の僧侶上位職。神罰執行で攻めも可。',
  '異端審問官': '攻撃寄りの僧侶上位職。回復封じを持つ。',
  '賢者': '高位魔法アタッカー。メテオストライクが切り札。',
  'サイキッカー': '物理＋魔法の混合職。スタンを絡める。',
  '体術師': '連撃・出血の格闘上位職。HPが減るほど火力上昇。',
  '魔銃士': '銃で物理＋魔法を撃つ混合職。命中が高い。',
  'ギャンブラー': '運で性能が変動する特殊職。証明アイテムで転職。',
  '魔法剣士': '物理＋魔法の剣士。変換と連続強化が軸。',
  '聖騎士': '物理＋魔法＋回復をこなす重装の混合職。',
  '竜騎士': '防御貫通の物理職。竜の力で大ダメージ。',
}

export const ALL_CLASSES = [...INITIAL_CLASSES, ...Object.keys(ADVANCED_REQ)]

const classType = (c) =>
  MAGICAL_CLASSES.includes(c) ? '魔法型' : HYBRID_CLASSES.includes(c) ? '混合型' : '物理型'

// クラスの転職条件・役割を文章化
const classInfoText = (c) => {
  const role = CLASS_ROLE[c] || ''
  let how
  if (INITIAL_CLASSES.includes(c)) {
    how = '最初から選べる基本職。街の「神殿」でいつでも転職できます。'
  } else {
    const r = ADVANCED_REQ[c]
    if (!r) how = '神殿で条件を満たすと転職できます。'
    else if (r.requiresItem) how = `${r.requiresItem}と、神殿で転職できます。`
    else if (r.requires2) how = `「${r.requires}」をLV${r.requiresLv || 100}、かつ「${r.requires2}」をLV${r.requires2Lv || 100}まで上げると、神殿で転職できます。`
    else how = `「${r.requires}」をLV${r.requiresLv || 100}まで上げると、神殿で転職できます。`
  }
  return `🛐 ${c}（${classType(c)}）\n${role}\n【転職条件】${how}\nクラスごとにLVは別管理。転職後に再修練を5回行うとLV上限が100→300に解放されます。`
}

// クエリ内に登場するクラス名を返す（最長一致優先）
const findClassInQuery = (raw) => {
  const hits = ALL_CLASSES.filter((c) => raw.includes(c))
  if (!hits.length) return null
  return hits.sort((a, b) => b.length - a.length)[0]
}

// ============================================================
// 静的KB（施設・仕組み）
// ============================================================
export const KB = [
  { id: 'stat-meaning', keywords: ['ステータス', 'abcd', '攻撃力', '防御力', '特攻', '特防', '素早さ'],
    a: `📊 ステータスの意味\n・攻撃(A)＝物理ダメージの元（剣/斧/槍/弓/短剣/拳/銃/刀）\n・防御(B)＝物理被ダメ軽減\n・特殊攻撃(C)＝魔法ダメージの元（杖/ワンド/魔導書/オーブ）\n・特殊防御(D)＝魔法被ダメ軽減\n・素早さ(S)＝先攻/回避/クリティカル率\n・HP/MP＝体力と消費資源\nクラスと武器に合わせて伸ばすステを決めましょう。` },
  { id: 'stat-allocate', keywords: ['ステ振り', 'ステータスポイント', '振り分け', '振る', '振り方'],
    a: `🔧 ステータス振り分けは「プロフィール」や街の「ステータスを振り分ける」から行えます。\n迷ったら「おすすめ強化」と聞いてください。あなたのクラスに合わせて提案します。` },
  { id: 'class-change', keywords: ['転職', 'クラスチェンジ', 'クラス変更', '職業', '上位職'],
    a: `🛐 転職は街の「神殿」から。\n・基本職(戦士/弓使い/魔法使い/僧侶/格闘家)はいつでも可\n・上位職は条件(特定クラスをLV100など)で解放\n・賢者/魔法剣士/聖騎士/魔銃士は2クラスをLV50まで\n・ギャンブラー/竜騎士は専用の証明アイテムが必要\n「〇〇になるには？」と職名で聞くと条件を答えます。` },
  { id: 'retraining', keywords: ['再修練', '上限解放', 'レベル上限', 'レベル限界', 'レベルの限界', 'カンスト', 'lv300', '神殿'],
    a: `⚡ 再修練は神殿で現在のクラス(本職)に対して行えます。\n1回ごとにそのクラスのスキルが1段強化され、5回でLV上限が100→300に解放されます。` },
  { id: 'where-facility', keywords: ['施設', '行き方', '場所', '解放条件', 'メニュー', '開放'],
    a: `🧭 各施設は右上「☰ メニュー」から。キャラLVで段階開放：\n・LV5：釣り場/博物館/美容院/交換所\n・LV10：賭博場/ペット/ダンジョン/かかし修練場\n・LV30：レイドボス/奈落闘技場\n・錬金部屋は「エリア③ボス撃破」で解放（LV条件ではない）\n装備・スキル・商店・鍛冶屋・プロフィールは最初から。` },
  { id: 'smithy', keywords: ['鍛冶屋', '装備強化', '強化石', 'プラス強化'],
    a: `⚒ 鍛冶屋では装備を「強化石」で+強化できます。強化値が上がると固定ボーナス増加。\n強化石は商店・ドロップ・錬金部屋（自動生成）で入手。` },
  { id: 'alchemy', keywords: ['錬金', '錬金部屋'],
    a: `🧪 錬金部屋（エリア③ボス撃破で解放）\n時間経過で強化石を自動生成できます（最大4枠）。\n放置で素材が貯まるので、装備強化の素材源に。` },
  { id: 'gems', keywords: ['宝石', 'ジェム', 'ルビー', 'サファイア', '埋め込み'],
    a: `💎 宝石(ジェム)は装備に埋め込んで追加効果。\n・攻撃系(ルビー等)→武器/装飾\n・防御系(サファイア等)→防具/装飾\n・HP/MP系→防具/装飾\n・％系(クリ/命中/回避)→装飾品のみ\nランクが上がるほど1.5倍ずつ強力(F→SSS)。デイリーの宝石ダンジョン・奈落闘技場・レイド・ペットダンジョンなどで入手。` },
  { id: 'scarecrow', keywords: ['かかし', '修練場', '熟練度'],
    a: `🌾 かかし修練場（キャラLV10で解放）\n3〜8時間の放置で経験値(EXP)を安全に稼げます。もらえるのはEXPのみ（装備ドロップや熟練度の獲得はありません）。\n利用には修練回数が必要：通常出撃100回ごとに1回チャージ（週5回まで・月曜朝5時リセット）。\n途中で解除すると報酬なし。修練中は他の出撃のEXPは入りません。\n※武器の熟練度は「出撃・戦闘」で上がります（かかしでは上がりません）。熟練度が上がると固定ボーナスに倍率がかかり実効ステUP。` },
  { id: 'levelup', keywords: ['レベル上げ', '経験値', 'レベルあげ', 'exp', 'レベリング'],
    a: `📈 レベル上げのコツ\n・基本は「出撃」で敵を倒す\n・デイリーダンジョンの経験値ダンジョンが効率的\n・LVが上がるとステ振りポイントと施設が解放されます` },
  { id: 'sortie', keywords: ['出撃', 'バトル', '戦闘', 'エリア'],
    a: `⚔ 出撃について\n各エリアの敵と戦えます（ソロ・パーティ編成はありません）。\n勝つとEXP・Gold・ドロップが手に入ります。\n装備強化・ステ振り・スキルを整えてから挑みましょう。` },
  { id: 'raid', keywords: ['レイド', 'レイドボス', 'あまざ', 'ヴァルゼノク'],
    a: `⚔ レイドボス（キャラLV30で解放）\n・毎日21時／22時に出現する高HPボス\n・与えたダメージに応じて報酬（EXP・素材・強化石）\n・集めた素材は交換所で専用装備などと交換\n・日替わりでボスが入れ替わります` },
  { id: 'dungeon', keywords: ['ダンジョン', 'ローグライク', 'もぐる'],
    a: `🕳 ダンジョン（キャラLV10で解放）\n・ペットで挑むローグライク\n・奥へ進むほど報酬は増える\n・死亡すると持ち物の半分をロスト\n・倉庫に預けた物は安全。無理せず撤退も大事` },
  { id: 'pets', keywords: ['ペット', '懐き', '進化', 'チャーム'],
    a: `🐾 ペット（キャラLV10で解放）\n育てて懐かせ、進化やチャーム強化ができます。\nダンジョン攻略のお供になります。\nスキンシップや出撃で懐き度が上がります。` },
  { id: 'abyss', keywords: ['奈落', '闘技場', '挑戦'],
    a: `⚔ 奈落闘技場（キャラLV30で解放）\n・1階から順番に挑むチャレンジ（全20階予定／現在は19階まで実装。撃破済みの階は再取得不可）\n・毎週月曜朝5時(JST)に進捗がリセット\n・報酬はGold・強化石・宝石\n総合力をしっかり上げてから挑みましょう。` },
  { id: 'casino', keywords: ['賭博', '賭博場', 'カジノ', 'スロット'],
    a: `🎰 賭博場（キャラLV10で解放）\nゴールドをメダルに両替（100G＝1メダル）し、メダルを賭けてスロットやハイローで遊べます。\n当たると出玉が増え、たまに「アシストタイム(AT)」に突入して大量獲得のチャンス。\n貯めたメダルは景品と交換できますが、あくまで運。使いすぎ注意です。` },
  { id: 'fishing', keywords: ['釣り', '釣り場'],
    a: `🎣 釣り場（キャラLV5で解放）\n釣りで素材やアイテムが手に入ります。\n放置気味でも資源を稼げるサブコンテンツです。` },
  { id: 'exchange', keywords: ['交換所', '交換'],
    a: `🔄 交換所（キャラLV5で解放）\nレイドボスの素材などを、装備や強化石と交換できます。\n集めた素材の使い道はここです。` },
  { id: 'museum', keywords: ['博物館', '寄贈', 'コレクション'],
    a: `🏛 博物館（キャラLV5で解放）\nアイテムを寄贈してコレクションを埋め、報酬を得られます。\nダブったアイテムの使い道にも。` },
  { id: 'territory', keywords: ['領地', '建国', '亡命', '国'],
    a: `🏰 領地システム\n・地図上に9つの大陸（加盟国は最大8つ＋どこにも属さない非加盟国）\n・条件を満たすと建国できます：キャラLV100以上＋非加盟国に所属＋空き大陸\n・プレイヤーが建てた国へ「亡命」で加入できます（NPC国へは不可）。所属国を抜けて非加盟国へ戻ることもできます（元帥は移動不可）\n・所属国から他国へ移ると7日間は領地拡大・建国ができません（非加盟国からの加入はペナルティなし）\n・領地拡大は1時間に1回、獲得量は総合力に応じて変動します` },
  { id: 'gold', keywords: ['gold', 'ゴールド', 'お金', '稼ぎ'],
    a: `💰 Goldの稼ぎ方\n・出撃・ダンジョン・釣りなどで入手\n・商店での購入や装備強化などに使用\n効率重視ならデイリーダンジョン周回がおすすめ。` },
  { id: 'heal', keywords: ['回復', '宿屋', 'ポーション'],
    a: `💊 HP/MPの回復\nポーションや宿屋で回復できます。出撃前に整えておきましょう。\n回復効果を持つスキルや装備もあります。` },
]

const searchKB = (raw) => {
  const q = normalize(raw)
  let best = null, bestScore = 0
  for (const entry of KB) {
    let score = 0
    for (const kw of entry.keywords) {
      const n = normalize(kw)
      if (n && q.includes(n)) score += n.length
    }
    if (score > bestScore) { bestScore = score; best = entry }
  }
  return bestScore > 0 ? best : null
}

// ============================================================
// 強化アドバイザー
// ============================================================
const detectStyle = (ctx, query) => {
  const q = normalize(query)
  if (/まほう|魔法|とくこう|特攻|matk|魔法型|魔法特化/.test(q)) return 'magical'
  if (/ぶつり|物理|攻撃型|物理型|物理特化/.test(q)) return 'physical'
  const cls = ctx?.profile?.class
  if (cls && MAGICAL_CLASSES.includes(cls)) return 'magical'
  if (cls && PHYSICAL_CLASSES.includes(cls)) return 'physical'
  const eff = ctx?.eff || {}
  if ((eff.matk || 0) > (eff.atk || 0) * 1.1) return 'magical'
  if ((eff.atk || 0) > (eff.matk || 0) * 1.1) return 'physical'
  return 'hybrid'
}

export const buildAdvice = (ctx, query) => {
  const profile = ctx?.profile
  if (!profile) return 'プレイヤー情報が読み込めませんでした。街の画面で再度お試しください。'
  const eff = ctx?.eff || {}
  const cls = profile.class || '冒険者'
  const style = detectStyle(ctx, query)
  const pending = profile.pending_stat_points || 0
  const lines = [`🤖 ${profile.name || 'あなた'}（${cls}）への強化アドバイス`]

  if (style === 'magical') {
    lines.push('🔮 タイプ：魔法型')
    lines.push('・最優先で「特殊攻撃(C)」。火力が一番伸びます')
    lines.push('・打たれ弱いので「HP」「特殊防御(D)」も確保')
    lines.push('・宝石：アメジスト(特攻)=武器/装飾、エメラルド(特防)=防具/装飾')
    lines.push('・命中が不安なら装飾品にオパール(命中)を')
  } else if (style === 'physical') {
    lines.push('⚔ タイプ：物理型')
    lines.push('・最優先で「攻撃(A)」。火力が一番伸びます')
    lines.push('・前線で殴るなら「HP」「防御(B)」も確保')
    lines.push('・「素早さ(S)」は先攻・クリ率・回避に効く')
    lines.push('・宝石：ルビー(攻撃)=武器/装飾、サファイア(防御)=防具/装飾')
  } else {
    lines.push('⚖ タイプ：混合型(物理＋魔法)')
    lines.push('・攻撃(A)と特殊攻撃(C)の両方を使う。主力スキルが使う方を厚めに')
    lines.push('・どっち付かずを避け、まず片方に寄せると火力が安定')
    lines.push('・宝石：ローズクォーツ(攻撃＋特攻)が好相性')
  }

  const def = eff.def || 0, mdef = eff.mdef || 0
  if (def > 0 && mdef > 0) {
    if (def < mdef * 0.6) lines.push('⚠ 物理防御(B)が手薄。サファイアや防具で補強を')
    else if (mdef < def * 0.6) lines.push('⚠ 特殊防御(D)が手薄。エメラルドや防具で補強を')
  }
  lines.push('—')
  lines.push('🛠 強化の進め方')
  lines.push('・鍛冶屋：強化石で武器/防具を+強化(錬金部屋で石を自動生成)')
  lines.push('・熟練度：出撃・戦闘で使用武器の熟練度が上がると固定ボーナスに倍率がかかる(かかし修練場はEXP稼ぎ用)')
  if (pending > 0) lines.push(`・今ステータスポイントが ${pending} 残っています。上記の優先ステに振りましょう`)
  return lines.join('\n')
}

// 「強くなるには？」「何をすればいい？」のような漠然とした相談に、
// プレイヤーのLV・状態を見て“今やるべき優先順位”を返す総合アドバイス。
export const buildProgressionAdvice = (ctx) => {
  const profile = ctx?.profile
  if (!profile) return 'プレイヤー情報が読み込めませんでした。街の画面で再度お試しください。'
  const eff = ctx?.eff || {}
  const lv = profile.char_lv || profile.lv || 1
  const cls = profile.class || '冒険者'
  const pending = profile.pending_stat_points || 0
  const style = detectStyle(ctx, '')
  const focus = style === 'magical' ? '特殊攻撃(C)' : style === 'physical' ? '攻撃(A)' : '攻撃(A)か特殊攻撃(C)（主力スキルが使う方）'

  const steps = []
  // 1) 余っているステは即振り
  if (pending > 0) steps.push(`① 余っているステータスポイント ${pending} を「${focus}」に振る（プロフィール画面）`)
  // 2) 火力ステを伸ばす
  steps.push(`${pending > 0 ? '②' : '①'} 出撃やデイリーダンジョンでLVを上げ、貯まったポイントを「${focus}」中心に振る`)
  // 3) 装備
  steps.push('・装備を整える：商店/ドロップで強い武器防具を入手 → 鍛冶屋で強化石を使って+強化（錬金部屋＝エリア③ボス撃破で解放＝で強化石を自動生成）')
  // 4) 熟練度（出撃・戦闘で上がる。かかしはEXP用）
  steps.push('・出撃・戦闘で使用武器の熟練度が上がる＝固定ボーナスに倍率がかかり実効ステUP')
  if (lv >= 10) steps.push('・かかし修練場（放置3〜8時間）でEXPを安全に稼げる（出撃100回ごとに1チャージ・週5回まで）')
  // 5) 宝石
  steps.push('・装飾品や装備に宝石を埋める（攻撃系=武器、防御系=防具、％系=装飾品）。交換所・博物館報酬で入手')
  // 6) スキル/再修練
  steps.push('・スキル画面で習得スキルを確認。本職を極めたら神殿で「再修練」5回でスキル強化＆そのクラスのLV上限が100→300に解放')
  // 7) コンテンツでの素材集め
  if (lv >= 30) steps.push('・レイドボスの素材を集め、交換所で専用装備や強化石(S)と交換すると一段強くなれる')

  // 守りの偏りを指摘
  const def = eff.def || 0, mdef = eff.mdef || 0
  let warn = ''
  if (def > 0 && mdef > 0) {
    if (def < mdef * 0.6) warn = '\n⚠ 物理防御(B)が手薄。物理が痛い敵はサファイアや防具で補強を'
    else if (mdef < def * 0.6) warn = '\n⚠ 特殊防御(D)が手薄。魔法が痛い敵はエメラルドや防具で補強を'
  }

  const nextGate = lv < 5 ? '\n🔓 LV5で釣り場/博物館/美容院/交換所が開放されます'
    : lv < 10 ? '\n🔓 LV10で賭博場/ペット/ダンジョン/かかし修練場が開放されます（錬金部屋はエリア③ボス撃破で別途解放）'
    : lv < 30 ? '\n🔓 LV30でレイドボス/奈落闘技場が開放されます' : ''

  return `🤖 ${profile.name || 'あなた'}（${cls}・LV${lv}）が強くなる手順\n` +
    `あなたは${style === 'magical' ? '魔法型' : style === 'physical' ? '物理型' : '混合型'}なので火力の軸は「${focus}」です。\n\n` +
    steps.join('\n') + warn + nextGate +
    '\n\n（「おすすめ強化」で振り方の詳細、「○○のスキル」で習得技も確認できます）'
}

// ============================================================
// DBライブ検索（Supabase 読み取り＝無料）
// ============================================================
// クエリから検索語（エンティティ名）を抽出：末尾の疑問・助詞表現を除去
const SUFFIXES = [
  'について教えて', 'について', 'ってどんなスキル', 'ってどんな', 'ってどういう', 'ってなんですか',
  'ってなに', 'って何', 'とはなに', 'とは何', 'とは', 'の効果は', 'の効果', 'の威力', 'のステ',
  'の性能', 'の使い方', '使い方', 'の使い道', '使い道', 'の使いみち', 'を教えて', 'を知りたい', '教えて', '知りたい', 'になるには', 'になりたい',
  'になるためには', 'はどこ', 'ってどこ', 'はどう', 'ってどう', 'です', 'ですか',
]
const extractEntity = (raw) => {
  let s = (raw || '').trim().replace(/[？?！!。、\s]+$/g, '')
  for (let i = 0; i < 3; i++) {
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf)) { s = s.slice(0, -suf.length); break }
    }
  }
  return s.replace(/^[のはをがで]+|[のはをがで]+$/g, '').trim()
}

// ============================================================
// 検索レジストリ（公開マスタ表のみ。プレイヤー個人情報を含む表は対象外）
//   表を1件追加するだけで横断検索の対象を増やせる設計。
//   format(row) … 表示整形。score時は name のみ使用。
// ============================================================
const SEARCH_TABLES = [
  {
    table: 'skills', cols: 'name, class_name, required_lv, mp_cost, type, description',
    format: (s) => `⚡ ${s.name}（${s.class_name || ''}スキル / LV${s.required_lv} / MP${s.mp_cost ?? '-'}）\n${s.description || '（説明データなし）'}`,
  },
  {
    table: 'weapons', cols: 'name, weapon_type, rarity, class, base_atk, base_matk, atk_bonus, matk_bonus',
    format: (w) => {
      const atk = (w.base_atk || 0) + (w.atk_bonus || 0)
      const matk = (w.base_matk || 0) + (w.matk_bonus || 0)
      const stats = [atk ? `攻撃${atk}` : '', matk ? `特攻${matk}` : ''].filter(Boolean).join(' / ') || 'ステータスデータなし'
      return `🗡 ${w.name}（武器${w.weapon_type ? '・' + w.weapon_type : ''}${w.rarity ? ' / ' + String(w.rarity).toUpperCase() + '級' : ''}）\n${stats}`
    },
  },
  {
    table: 'items', cols: 'name, description, buy_price',
    format: (i) => `📦 ${i.name}${i.buy_price ? `（${i.buy_price}G）` : ''}\n${i.description || '（説明データなし）'}`,
  },
  {
    table: 'titles', cols: 'name, category, description',
    format: (t) => `🏅 ${t.name}${t.category ? `（${t.category}）` : ''}\n${t.description || '（説明データなし）'}`,
  },
  {
    table: 'exchange_shop', cols: 'name, description, reward_type',
    format: (e) => `🔄 ${e.name}（交換所）\n${e.description || '（説明データなし）'}`,
  },
]

// 完全一致を全マスタ表に問い合わせ（レジストリ順で最初のヒットを採用）
const lookupExact = async (term) => {
  if (!term || term.length < 2) return null
  const results = await Promise.all(
    SEARCH_TABLES.map((t) => supabase.from(t.table).select(t.cols).eq('name', term).limit(1)),
  )
  for (let i = 0; i < SEARCH_TABLES.length; i++) {
    const row = results[i].data?.[0]
    if (row) return SEARCH_TABLES[i].format(row)
  }
  return null
}

// 部分一致を全マスタ表で検索し、明示的にスコアリング（前方一致＞含む、短い名前ほど上位）
const lookupPartial = async (term) => {
  if (!term || term.length < 2) return null
  const like = `%${escapeLike(term)}%`
  const results = await Promise.all(
    SEARCH_TABLES.map((t) => supabase.from(t.table).select(t.cols).ilike('name', like).limit(5)),
  )
  const cands = []
  results.forEach((r, i) => {
    for (const row of (r.data || [])) {
      const name = row.name || ''
      let score = name === term ? 1000 : name.startsWith(term) ? 500 - name.length : 100 - name.length
      cands.push({ name, score, format: () => SEARCH_TABLES[i].format(row) })
    }
  })
  if (!cands.length) return null
  cands.sort((a, b) => b.score - a.score)
  // 上位が突出していれば確定、そうでなければ候補を聞き返す（非決定的な黙采用を避ける）
  const uniqNames = [...new Set(cands.map((c) => c.name))]
  if (uniqNames.length === 1 || cands[0].score - (cands[1]?.score ?? -999) >= 100) {
    return cands[0].format()
  }
  return `🔎 候補が複数あります。どれですか？\n${uniqNames.slice(0, 6).map((n) => '・' + n).join('\n')}`
}

// クラスのスキル一覧をDBから取得
const lookupClassSkills = async (cls) => {
  const { data } = await supabase.from('skills').select('name, required_lv, mp_cost, description')
    .eq('class_name', cls).order('required_lv')
  if (!data || !data.length) return null
  const lines = [`⚡ ${cls}のスキル`]
  for (const s of data) {
    lines.push(`・${s.name}（LV${s.required_lv} / MP${s.mp_cost ?? '-'}）${s.description ? '：' + s.description : ''}`)
  }
  return lines.join('\n')
}

// クラスと武器の相性（このゲームは装備にクラス縛りが無く、weapon_typeで物理/魔法
// スケールが決まる。よって「相性の良い武器種」を案内する静的回答）。
const PHYS_WEAPONS = '剣・斧・槍・弓・短剣・拳・銃・刀'
const MAG_WEAPONS = '杖・ワンド・魔導書・オーブ'
const classWeaponText = (cls) => {
  const t = classType(cls)
  let body
  if (t === '魔法型') body = `魔法武器（${MAG_WEAPONS}）が「特殊攻撃」で計算され火力に直結します。`
  else if (t === '物理型') body = `物理武器（${PHYS_WEAPONS}）が「攻撃」で計算され火力に直結します。`
  else body = `物理武器（${PHYS_WEAPONS}）と魔法武器（${MAG_WEAPONS}）の両方を使えます。主力スキルが使う方の武器を選ぶと火力が安定します。`
  return `🗡 ${cls}（${t}）の武器相性\n${body}\n※このゲームは装備にクラス縛りはありません（どの武器種も装備可能）。上記は火力が伸びやすい組み合わせです。`
}

// 「○○に勝ちたい」：相手プレイヤーを profiles から照会し、対策アドバイスを返す。
// 相手名は「(名前) に勝ち/勝て/勝つ/倒し/より強く」の前半から抽出する（敬称は剥がさず保持）。
const extractOpponent = (raw) => {
  const m = raw.match(/^(.+?)\s*(?:に|を|より)\s*(?:勝ち|勝て|勝つ|勝てる|倒し|倒す|強く|超え)/)
  return m ? m[1].trim() : null
}
const PROFILE_COLS = 'username, class, char_lv, atk, def, matk, mdef, spd, hp_max'
// usernameを完全一致(大小無視)で1件に特定。複数ヒットは曖昧として候補を返す。
const findProfileExact = async (nm) => {
  if (!nm) return { kind: 'none' }
  const { data } = await supabase.from('profiles').select(PROFILE_COLS).ilike('username', escapeLike(nm)).limit(3)
  if (!data || !data.length) return { kind: 'none' }
  if (data.length === 1) return { kind: 'one', opp: data[0] }
  return { kind: 'ambiguous', names: data.map((d) => d.username) }
}
// 戻り値: 文字列(=回答/候補提示) または null(=該当なし→呼び出し側で通常処理へフォールバック)
const buildMatchupAdvice = async (ctx, name) => {
  // ①フルネームで完全一致 → ②敬称を剥がして完全一致 → ③部分一致(一意のみ採用)
  let res = await findProfileExact(name)
  if (res.kind === 'none') {
    const stripped = name.replace(/(さん|くん|ちゃん|様|氏)$/u, '')
    if (stripped && stripped !== name) res = await findProfileExact(stripped)
  }
  if (res.kind === 'none') {
    const { data } = await supabase.from('profiles').select(PROFILE_COLS).ilike('username', `%${escapeLike(name)}%`).limit(6)
    const names = [...new Set((data || []).map((d) => d.username))]
    if (names.length === 1) res = { kind: 'one', opp: (data || [])[0] }
    else if (names.length > 1) res = { kind: 'ambiguous', names }
  }
  if (res.kind === 'none') return null // 該当プレイヤー無し → matchupを確定しない
  if (res.kind === 'ambiguous') {
    return `🔎 「${name}」に近いプレイヤーが複数います。正確なユーザー名で聞いてください。\n${res.names.slice(0, 6).map((n) => '・' + n).join('\n')}`
  }

  const opp = res.opp
  const t = classType(opp.class) // 相手クラスの「傾向」（職によっては実攻撃属性は断定不可）
  const counter = t === '物理型'
    ? '相手は主に物理寄り。防御(B)とHPを厚くし、サファイアや防具で物理被ダメを抑えるのが有効です。'
    : t === '魔法型'
      ? '相手は主に魔法寄り。特殊防御(D)とHPを厚くし、エメラルドや防具で魔法被ダメを抑えるのが有効です。'
      : '相手は物理・魔法の混合寄り。防御(B)と特殊防御(D)をバランス良く確保しましょう。'

  // 自分の火力軸は「自分の」クラス/ステで決める（相手タイプに引きずられない）
  const myStyle = detectStyle(ctx, '')
  const myFocus = myStyle === 'magical' ? '特殊攻撃(C)' : myStyle === 'physical' ? '攻撃(A)' : '主力スキルが使う攻撃ステ'

  const meLv = ctx?.profile?.char_lv || ctx?.profile?.lv
  const lvNote = meLv && opp.char_lv
    ? (meLv >= opp.char_lv ? `あなた(LV${meLv})は相手以上のレベルです。あとは装備・宝石・熟練度の詰めで上回れます。`
      : `あなた(LV${meLv})は相手(LV${opp.char_lv})よりレベルが低め。出撃やデイリーダンジョンでLV・総合力を上げるのが先決です。`)
    : ''

  return `⚔ ${opp.username} 対策\n` +
    `相手：${opp.class}（主に${t}の傾向）／キャラLV${opp.char_lv}\n` +
    `${counter}\n` +
    `自分の火力（あなたは${myStyle === 'magical' ? '魔法型' : myStyle === 'physical' ? '物理型' : '混合型'}なので「${myFocus}」）も伸ばし、総合力で上回ることが基本です。\n` +
    (lvNote ? lvNote + '\n' : '') +
    `相手の基礎ステ（※装備・宝石を除く参考値）: 攻${opp.atk ?? '-'} 防${opp.def ?? '-'} 特攻${opp.matk ?? '-'} 特防${opp.mdef ?? '-'} 速${opp.spd ?? '-'}\n` +
    `※表示は基礎ステのみ。実戦では装備・宝石・熟練度の差が大きく影響します。`
}

// ============================================================
// 公開API：問い合わせに回答（async）
//   returns: { text, kind }  kind = meta|matchup|advice|class|db|kb|fallback
//   解決順：挨拶等メタ(早期) → 対戦相手 → クラス+スキル/武器 → 強化/進行 → クラス説明
//            → DB完全一致 → 静的KB → DB部分一致 → HELP/LIMITメタ → フォールバック
// ============================================================
const ADVICE_TRIGGER = /おすすめ|オススメ|お勧め|強化したい|なにを伸ば|何を伸ば|どこを伸ば|ビルド|振り方|戦闘スタイル|ステ振り|どこに振/
// 漠然とした「強くなるには/何をすれば/どうすれば」系 → 総合の攻略アドバイス
const PROGRESSION_TRIGGER = /強くなるに|強くなりたい|強くなれ|強くなるた|どうすれば強|どうしたら強|どう強く|何をすれ|なにをすれ|何すれ|なにすれ|何から|なにから|伸び悩|勝てない|進め方|育て方|育成|効率よく強|次に何|次は何|つよくな/
const CLASS_INTENT = /なるには|なりたい|なるためには|転職|どんな職|どういう職|どんなクラス|職業|の条件|になれ/

// メタ/雑談系（「答えられない」を避け、できることを前向きに案内するため）
// 挨拶/お礼は文全体がそれだけのとき限定（ゲームエンティティの誤食いを防ぐためアンカー）
const GREETING_TRIGGER = /^(こんにちは|こんばんは|おはようございます|おはよう?|やあ|よお|よっ|はじめまして|ハロー|hello|hi|hey|へい|ヘイ|どうも|やっほー?)[\sー！!。.,~〜?？]*$/i
const THANKS_TRIGGER = /^(ほんとに|本当に|どうも|いつも|まじ)?\s*(ありがとう?(ございます)?|あざ(す|っす)|サンキュー|さんきゅ[ーう]?|感謝(です|してる)?|thank(s| you)?|thx)[\sー！!。.,~〜]*$/i
// 自己紹介：主語(あなた/君/AI等)が伴うか、文全体が「誰？/何者？」のときだけ
const WHOAMI_TRIGGER = /(あなた|きみ|君|お前|おまえ|あんた)(って|は)?(誰|だれ|何者|なにもの|何なの|なになの|なに)|^(誰|だれ|何者|なにもの)[\sー！!。?？]*$|自己紹介(して)?|あなたについて|ai(なの|ですか)|ボットなの/i
const HELP_TRIGGER = /何ができ|なにができ|できること|できる事|使い方|つかいかた|ヘルプ|help|何が聞け|なにが聞け|何を聞け|なにを聞け|どんなこと(が|を)?(聞|質問|きけ|分か)|機能|メニュー|何を質問/
// 「あなた/AIの苦手・限界・答えられない」など、対象がメタだと分かる表現に限定（裸の苦手/限界は除外）
const LIMIT_TRIGGER = /答えられない|こたえられない|答えれない|こたえれない|答えら?んない|(あなた|きみ|君|ai|ボット|案内役|お前|おまえ)(の|が|は|って)?(苦手|限界|できないこと|わからない|不得意)|苦手な質問|答えられる(の|か|こと)|何は答え/i

// メタ応答（ゲームのことなら何でも、を前向きに伝える）
const HELP_TEXT = `🤖 ぼくに聞けること\nこのゲームのことなら、いろいろお手伝いできます！例えば：\n・職業/転職：「狂戦士になるには？」\n・スキル/装備/アイテム：「メテオストライクの効果は？」\n・施設の使い方：「錬金部屋ってなに？」「奈落闘技場は？」\n・強化の相談：「おすすめ強化」「強くなるには？」\n・対戦相手の対策：「○○に勝ちたい」\n気軽に何でも聞いてくださいね😊`
const LIMIT_TEXT = `🤖 基本的に、このゲームに関することなら何でも答えられるよう頑張ります！\nスキル・装備・アイテム・施設・転職・強化のコツ・対戦相手の対策など、ゲームのことならお任せください。\nもしすぐ答えられない質問があれば、今後の回答改善の参考にさせてもらいます。\nまずは「おすすめ強化」や「○○ってなに？」を試してみてください！`
const GREETING_TEXT = `やあ！🤖 バトルフロンティアの案内役です。\nゲームのことなら何でも聞いてくださいね。\n例：「おすすめ強化」「狂戦士になるには？」「○○ってなに？」`
const THANKS_TEXT = `どういたしまして！😊 また何かあればいつでも聞いてください。`
const WHOAMI_TEXT = `🤖 ぼくはバトルフロンティアのAI案内役です。\nゲームの疑問に答えたり、あなたに合った強化を提案したりします。\n「何ができる？」と聞いてくれれば、できることの一覧を出しますよ。`

// 相づち・短い雑談（会話を続ける返事。文全体がそれだけのとき限定）
const SMALLTALK = [
  { re: /^(へえ|へぇ|へー|ほー|ほぉ|ふーん|ふうん|ふむ|ふんふん|なるほど|なるほどね|そっか|そうか|そうなんだ|そうなのか|まじか|マジか|へえそうなんだ)[\sー!！。….~〜]*$/i,
    a: 'でしょ？😊 ほかにも気になることがあれば何でも聞いてくださいね。例えば「おすすめ強化」や「○○ってなに？」など。' },
  { re: /^(うん|はい|おう|おっけ|おっけー|ok|オーケー|了解|わかった|わかりました|りょ|りょうかい)[\sー!！。~〜]*$/i,
    a: '👍 では、知りたいことがあればいつでも聞いてください！「強くなるには？」もおすすめです。' },
  { re: /^(すごい|スゴイ|すご!|つよい|強い|やば|ヤバ|やばい|かっこいい|いいね)[\sー!！。~〜]*$/i,
    a: 'ありがとう！😆 もっと強くなりたいなら「強くなるには？」や「おすすめ強化」を聞いてみてください。' },
  { re: /^(つかれた|疲れた|ねむい|眠い|だるい|ひま|暇)[\sー!！。~〜]*$/i,
    a: 'お疲れさま！🍵 無理せずどうぞ。ゲームの相談があればいつでも聞いてくださいね。' },
]
const smalltalk = (raw) => SMALLTALK.find((s) => s.re.test(raw))?.a || null

// 日常の雑談（天気・体調・気分など）に会話っぽく共感して返し、ゲームへ自然に橋渡し。
// ゲーム検索より後（フォールバック直前）に判定するので、ゲーム質問は誤食いしない。
const CHITCHAT = [
  { re: /暑|あつ(い|すぎ|か)|猛暑/, a: 'ほんと暑いですよね🥵 水分補給して無理しないでくださいね。ゲームの相談があればいつでもどうぞ！' },
  { re: /寒|さむ|冷え/, a: '寒いですね🧣 あたたかくしてお過ごしください。ゲームのことなら何でも聞いてくださいね。' },
  { re: /いい天気|晴れ|快晴/, a: 'いい天気だと気分も上がりますね☀️ ゲームの相談があればどうぞ！' },
  { re: /雨|あめ|台風|くもり|曇り/, a: 'こんな日はおうちでゆっくりゲーム日和ですね☔ 何かお手伝いしましょうか？' },
  { re: /眠い|ねむい|疲れ|つかれ|だるい|しんどい/, a: 'お疲れさまです🍵 無理せずどうぞ。気が向いたらゲームの相談もしてくださいね。' },
  { re: /お腹|おなか|腹減|はらへ|ごはん|ご飯|腹減った/, a: 'ごはん大事ですよね🍙 食べたら、また一緒に強くなりましょう！' },
  { re: /楽しい|たのしい|面白い|おもしろい|最高|たのし/, a: 'それは良かったです😆 もっと楽しめるよう、強化の相談ものってますよ！' },
  { re: /つまらん|つまんない|飽きた|あきた/, a: 'そんなときは新しい目標を立ててみるのもアリです💡 「強くなるには？」や「○○に勝ちたい」を試してみてください！' },
]
const chitchat = (raw) => CHITCHAT.find((c) => c.re.test(raw))?.a || null

// タイポ・言いかけの挨拶を推測（「こんにち」→「こんにちは」で確認を挟む）
const GREET_CANON = ['こんにちは', 'こんばんは', 'おはよう']
// 挨拶の言いかけ/誤記を検知（呼び出し側で挨拶と同一扱い＝確認せずGREETING_TEXTを返す）。
const guessGreeting = (raw) => {
  const q = normalize(raw)
  if (q.length < 3 || q.length > 7) return null
  // 正しい挨拶の「言いかけ/1字違い」（完全一致は GREETING が先に処理するため除外）
  for (const g of GREET_CANON) {
    if (g !== q && (g.startsWith(q) || editDistance(q, g) === 1)) return g
  }
  // よくある誤記（こんにちわ/こんばんわ）は完全一致でも挨拶として扱う
  if (editDistance(q, 'こんにちわ') <= 1) return 'こんにちは'
  if (editDistance(q, 'こんばんわ') <= 1) return 'こんばんは'
  return null
}

// フォールバック時の「もしかして○○？」推測（よく使う語＋クラス名に対する近似一致）
// 近似一致で「もしかして○○?」の候補。各語は単体で askAssistant が回答できるもののみ
// （自己解決しない曖昧語＝「強化」「スキル」は入れない＝そのまま回答できないため）。
const VOCAB = [
  '転職', 'おすすめ強化', '宝石', 'ステータス', 'ステ振り', '再修練', 'レベル上げ',
  'レイドボス', 'ダンジョン', '奈落闘技場', '錬金部屋', 'かかし修練場', '賭博場', '釣り', '交換所',
  '博物館', '領地', 'ペット', '鍛冶屋', '回復', 'ゴールド', '出撃',
]
// 近似一致で「もしかして○○？」候補を返す（0〜3件）。
// extractEntityで疑問・助詞ノイズを剥いてから比較し、「ステータってなに？」も拾えるように。
const didYouMean = (raw) => {
  const ent = extractEntity(raw)
  const q = normalize(ent && ent.length >= 2 ? ent : raw)
  if (q.length < 2 || q.length > 40) return [] // 長すぎる入力は誤字推測の対象外（負荷対策）
  const scored = []
  for (const term of [...VOCAB, ...ALL_CLASSES]) {
    const tn = normalize(term)
    const thr = tn.length <= 3 ? 1 : tn.length <= 6 ? 2 : 3
    if (Math.abs(q.length - tn.length) > thr) continue // 長さ差が閾値超ならDP不要
    if (tn.length <= 3 && tn[0] !== q[0]) continue      // 短語は先頭文字一致を要求（距離1で別語になりやすい）
    const d = editDistance(q, tn)
    if (d <= thr) scored.push({ term, d })
  }
  if (!scored.length) return []
  const minD = Math.min(...scored.map((s) => s.d))
  return [...new Set(scored.filter((s) => s.d === minD).map((s) => s.term))].slice(0, 3)
}

// _depth: 「もしかして○○?」推測で内部的に再帰呼び出しする際の深さ（無限再帰防止。0=ユーザー入力）
export const askAssistant = async (query, ctx = {}, _depth = 0) => {
  // 入力は最大300字にクランプ（巨大入力での編集距離計算・DB検索の負荷/DoSを防ぐ）
  const raw = (query || '').trim().slice(0, 300)
  if (!raw) return { text: '質問を入力してください。例：「狂戦士になるには？」「メテオストライクの効果は？」「おすすめ強化」', kind: 'fallback' }

  const cls = findClassInQuery(raw)

  // 0) 挨拶・お礼・自己紹介・相づち（短い雑談にも気持ちよく返す。ゲーム語を含まないもののみ）
  if (!cls) {
    if (THANKS_TRIGGER.test(raw)) return { text: THANKS_TEXT, kind: 'meta' }
    if (GREETING_TRIGGER.test(raw)) return { text: GREETING_TEXT, kind: 'meta' }
    if (WHOAMI_TRIGGER.test(raw)) return { text: WHOAMI_TEXT, kind: 'meta' }
    const st = smalltalk(raw)
    if (st) return { text: st, kind: 'meta' }
    // 挨拶の言いかけ/誤記（こんにちわ・こんにち 等）は挨拶と同一扱い＝確認せずそのまま挨拶を返す
    if (guessGreeting(raw)) return { text: GREETING_TEXT, kind: 'meta' }
  }

  // 1) 対戦相手の対策（「○○に勝ちたい」）。PROGRESSIONの「勝てない」と被るので先に判定。
  //    相手がDBに居る場合のみ matchup を確定。居なければ null で通常処理へフォールバック。
  if (/に勝|を倒|より強く|を超え/.test(raw)) {
    const opp = extractOpponent(raw)
    if (opp && !findClassInQuery(opp)) {
      try {
        const m = await buildMatchupAdvice(ctx, opp)
        if (m) return { text: m, kind: 'matchup' }
      } catch { /* DB失敗時は下の通常処理へ */ }
    }
  }

  // 2) 「クラス＋スキル/武器」の具体質問は、汎用おすすめ/進行相談より先に専用回答へ。
  //    （「狂戦士におすすめの武器」が ADVICE_TRIGGER に吸われるのを防ぐ）
  if (cls) {
    try {
      if (/スキル|わざ|アビリティ|何ができ|なにができ|できること|技(?!術)/.test(raw)) {
        const sk = await lookupClassSkills(cls)
        if (sk) return { text: sk, kind: 'db' }
      }
      if (/武器|ぶき/.test(raw)) {
        return { text: classWeaponText(cls), kind: 'class' }
      }
    } catch { /* DB失敗時は下へ */ }
  }

  // 3) 強化アドバイス（具体）／総合攻略アドバイス（漠然とした相談）
  if (ADVICE_TRIGGER.test(raw)) return { text: buildAdvice(ctx, raw), kind: 'advice' }
  if (PROGRESSION_TRIGGER.test(raw)) return { text: buildProgressionAdvice(ctx), kind: 'advice' }

  // 4) クラス説明（転職意図あり、または職名以外がノイズだけのとき）
  if (cls) {
    const remainder = normalize(raw.replace(cls, '')).replace(/って|なに|なん|です|とは|どんな|どういう|について|の|は|を|が/g, '')
    if (CLASS_INTENT.test(raw) || remainder === '') {
      return { text: classInfoText(cls), kind: 'class' }
    }
    // それ以外（「狂戦士が使える○○」等）は後続の汎用検索に流す
  }

  // 3) DB完全一致（「強化石(F)ってなに？」など。静的KBより先に確定させる）
  const term = extractEntity(raw)
  try {
    const exact = await lookupExact(term)
    if (exact) return { text: exact, kind: 'db' }
  } catch { /* ネット失敗時は静的KBへ */ }

  // 4) 静的KB（施設・仕組み）
  const kb = searchKB(raw)
  if (kb) return { text: kb.a, kind: 'kb' }

  // 5) DB部分一致（曖昧名・候補聞き返し）
  try {
    const hit = await lookupPartial(term)
    if (hit) return { text: hit, kind: 'db' }
  } catch { /* フォールバックへ */ }

  // 6) メタ案内（「何ができる？」「答えられない質問は？」等は前向きに案内）
  if (HELP_TRIGGER.test(raw)) return { text: HELP_TEXT, kind: 'meta' }
  if (LIMIT_TRIGGER.test(raw)) return { text: LIMIT_TEXT, kind: 'meta' }
  const cc = chitchat(raw)
  if (cc) return { text: cc, kind: 'meta' }

  // 7) フォールバック（柔らかめに。「もしかして○○？」推測も挟む。記録はKB育成用）
  const guesses = didYouMean(raw)
  // 候補が1つに絞れたら、確認だけでなく“その語の回答”をそのまま出す（解決時は未回答記録しない）
  if (guesses.length === 1 && _depth === 0) {
    try {
      const sub = await askAssistant(guesses[0], ctx, 1)
      if (sub && sub.kind !== 'fallback') {
        return { text: `もしかして「${guesses[0]}」のことでしょうか？ そうなら：\n\n${sub.text}`, kind: sub.kind }
      }
    } catch { /* 解決できなければ下の通常フォールバック（記録あり）へ */ }
  } else if (guesses.length > 1) {
    // 複数候補で意味が大きく変わる場合は、どれか聞き返す（＝答えられていないので記録）
    if (_depth === 0) logUnanswered(raw)
    const label = guesses.map((g) => `「${g}」`).join('か')
    return {
      text: `うーん、ぴったりの答えが見つかりませんでした💦\nもしかして${label}のことでしょうか？ 知りたい方を「○○ってなに？」と聞いてください😊`,
      kind: 'fallback',
    }
  }
  // ここに到達＝本当に答えられなかった（候補なし or 単一候補が解決せず）→ 1回だけ記録
  if (_depth === 0) logUnanswered(raw)
  return {
    text: 'うーん、その質問はまだうまく答えられないみたい💦\nでも、このゲームのことならいろいろお手伝いできます！例えば：\n・「狂戦士になるには？」（職業・転職条件）\n・「メテオストライクの効果は？」（スキル/装備/アイテム名）\n・「錬金部屋ってなに？」（施設の使い方）\n・「おすすめ強化」「強くなるには？」（強化の相談）\n・「○○に勝ちたい」（対戦相手の対策）\nもっと具体的に聞いてもらえれば答えやすいです😊',
    kind: 'fallback',
  }
}

// 答えられなかった質問を ai_unanswered テーブルへ記録（fire-and-forget）。
// 同じ質問は normalize したキーで集約し hits を加算（RPC側で upsert）。
// 記録失敗してもユーザー体験は止めない。
const logUnanswered = (raw) => {
  const q = (raw || '').trim()
  if (!q || q.length < 2) return
  try {
    // norm も asker もサーバ側で生成・取得する（クライアント指定を信用しない）
    supabase.rpc('log_unanswered', { q })
      .then(() => {}, () => {}) // エラーは握りつぶす（記録は補助機能）
  } catch { /* noop */ }
}

export const QUICK_QUESTIONS = [
  'おすすめ強化',
  '狂戦士になるには？',
  '転職について',
  '宝石ってなに？',
  'レベル上げの効率は？',
  'レイドボスってなに？',
]
