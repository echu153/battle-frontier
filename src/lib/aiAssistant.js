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
    a: `📊 ステータスの意味\n・攻撃(A)＝物理ダメージの元（剣/斧/槍/弓/短剣/拳/銃/刀）\n・防御(B)＝物理被ダメ軽減\n・特殊攻撃(C)＝魔法ダメージの元（杖/魔導書/オーブ）\n・特殊防御(D)＝魔法被ダメ軽減\n・素早さ(S)＝先攻/回避/クリティカル率\n・HP/MP＝体力と消費資源\nクラスと武器に合わせて伸ばすステを決めましょう。` },
  { id: 'stat-allocate', keywords: ['ステ振り', 'ステータスポイント', '振り分け', '振る', '振り方'],
    a: `🔧 ステータス振り分けは「プロフィール」や街の「ステータスを振り分ける」から行えます。\n迷ったら「おすすめ強化」と聞いてください。あなたのクラスに合わせて提案します。` },
  { id: 'class-change', keywords: ['転職', 'クラスチェンジ', 'クラス変更', '職業', '上位職'],
    a: `🛐 転職は街の「神殿」から。\n・基本職(戦士/弓使い/魔法使い/僧侶/格闘家)はいつでも可\n・上位職は条件(特定クラスをLV100など)で解放\n・賢者/魔法剣士/聖騎士/魔銃士は2クラスをLV50まで\n・ギャンブラー/竜騎士は専用の証明アイテムが必要\n「〇〇になるには？」と職名で聞くと条件を答えます。` },
  { id: 'retraining', keywords: ['再修練', '上限解放', 'レベル上限', 'lv300', '神殿'],
    a: `⚡ 再修練は神殿で現在のクラス(本職)に対して行えます。\n1回ごとにそのクラスのスキルが1段強化され、5回でLV上限が100→300に解放されます。` },
  { id: 'where-facility', keywords: ['施設', '行き方', '場所', '解放条件', 'メニュー', '開放'],
    a: `🧭 各施設は右上「☰ メニュー」から。LVで段階開放：\n・LV5：釣り場/博物館/美容院/交換所\n・LV10：賭博場/ペット/ダンジョン/かかし修練場/錬金部屋\n・LV30：レイドボス/奈落闘技場\n装備・スキル・商店・鍛冶屋・プロフィールは最初から。` },
  { id: 'smithy', keywords: ['鍛冶屋', '装備強化', '強化石', 'プラス強化'],
    a: `⚒ 鍛冶屋では装備を「強化石」で+強化できます。強化値が上がると固定ボーナス増加。\n強化石は商店・ドロップ・錬金部屋（自動生成）で入手。` },
  { id: 'alchemy', keywords: ['錬金', '錬金部屋'],
    a: `🧪 錬金部屋(LV10)は時間経過で強化石を自動生成(最大4枠)。放置で素材が貯まります。` },
  { id: 'gems', keywords: ['宝石', 'ジェム', 'ルビー', 'サファイア', '埋め込み'],
    a: `💎 宝石(ジェム)は装備に埋め込んで追加効果。\n・攻撃系(ルビー等)→武器/装飾\n・防御系(サファイア等)→防具/装飾\n・HP/MP系→防具/装飾\n・％系(クリ/命中/回避)→装飾品のみ\nランクが上がるほど1.5倍ずつ強力(F→SSS)。交換所・博物館報酬等で入手。` },
  { id: 'scarecrow', keywords: ['かかし', '修練場', '熟練度'],
    a: `🌾 かかし修練場(LV10)で武器の熟練度を安全に上げられます。熟練度が上がると固定ボーナスに倍率がかかり実効ステUP。` },
  { id: 'levelup', keywords: ['レベル上げ', '経験値', 'レベルあげ', 'exp', 'レベリング'],
    a: `📈 レベル上げは「出撃」で敵を倒すのが基本。デイリーダンジョンの経験値ダンジョンが効率的。LVで施設も開放。` },
  { id: 'sortie', keywords: ['出撃', 'バトル', '戦闘', 'エリア'],
    a: `⚔ 「出撃」で各エリアの敵と戦えます(ソロ・パーティ無し)。装備強化・ステ振り・スキルを整えてから挑みましょう。` },
  { id: 'raid', keywords: ['レイド', 'レイドボス', 'あまざ', 'ヴァルゼノク'],
    a: `⚔ レイドボス(LV30)は毎日21時/22時出現の高HPボス。与ダメに応じて報酬(EXP/素材/強化石)。素材は交換所で専用装備等と交換。日替わりでボス交替。` },
  { id: 'dungeon', keywords: ['ダンジョン', 'ローグライク', 'もぐる'],
    a: `🕳 ダンジョン(LV10)はペットで挑むローグライク。奥ほど報酬増だが死亡で持ち物半分ロスト。倉庫預けは安全。撤退も大事。` },
  { id: 'pets', keywords: ['ペット', '懐き', '進化', 'チャーム'],
    a: `🐾 ペット(LV10)は育てて懐かせ、進化やチャーム強化が可能。ダンジョンのお供。スキンシップや出撃で懐き度UP。` },
  { id: 'abyss', keywords: ['奈落', '闘技場', '挑戦'],
    a: `⚔ 奈落闘技場(LV30)は20階の順番制。週1挑戦でGold・強化石・宝石が報酬。総合力を上げてから。` },
  { id: 'casino', keywords: ['賭博', '賭博場', 'カジノ', 'スロット'],
    a: `🎰 賭博場(LV10)はATを使ってスロット等で遊べ、景品と交換可。あくまで運。使いすぎ注意。` },
  { id: 'fishing', keywords: ['釣り', '釣り場'],
    a: `🎣 釣り場(LV5)で素材やアイテムが入手可。放置気味でも稼げるサブコンテンツ。` },
  { id: 'exchange', keywords: ['交換所', '交換'],
    a: `🔄 交換所(LV5)でレイド素材等を装備・強化石・宝石と交換。集めた素材の使い道はここ。` },
  { id: 'museum', keywords: ['博物館', '寄贈', 'コレクション'],
    a: `🏛 博物館(LV5)でアイテム寄贈しコレクションを埋め報酬獲得。ダブり品の使い道に。` },
  { id: 'territory', keywords: ['領地', '建国', '亡命', '国'],
    a: `🏰 領地は9カ国から所属選択。建国はLV500、亡命は週1回、領地拡大は総合力依存(先行公開中)。` },
  { id: 'gold', keywords: ['gold', 'ゴールド', 'お金', '稼ぎ'],
    a: `💰 Goldは出撃・ダンジョン・釣り等で稼げ、商店購入や強化に使用。効率重視ならデイリーダンジョン周回。` },
  { id: 'heal', keywords: ['回復', '宿屋', 'ポーション'],
    a: `💊 HP/MPはポーションや宿屋で回復。出撃前に整えましょう。回復効果を持つスキル・装備もあります。` },
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
  lines.push('・かかし修練場：使用武器の熟練度を上げ固定ボーナスに倍率')
  if (pending > 0) lines.push(`・今ステータスポイントが ${pending} 残っています。上記の優先ステに振りましょう`)
  return lines.join('\n')
}

// ============================================================
// DBライブ検索（Supabase 読み取り＝無料）
// ============================================================
// クエリから検索語（エンティティ名）を抽出：末尾の疑問・助詞表現を除去
const SUFFIXES = [
  'について教えて', 'について', 'ってどんなスキル', 'ってどんな', 'ってどういう', 'ってなんですか',
  'ってなに', 'って何', 'とはなに', 'とは何', 'とは', 'の効果は', 'の効果', 'の威力', 'のステ',
  'の性能', 'を教えて', 'を知りたい', '教えて', '知りたい', 'になるには', 'になりたい',
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

// 名前でスキル/アイテム/武器を横断検索
const lookupEntity = async (term) => {
  if (!term || term.length < 2) return null
  const like = `%${term}%`
  const [sk, it, wp] = await Promise.all([
    supabase.from('skills').select('name, class_name, required_lv, mp_cost, type, description').ilike('name', like).limit(3),
    supabase.from('items').select('name, description, buy_price').ilike('name', like).limit(3),
    supabase.from('weapons').select('name, weapon_type, rarity, base_atk, base_matk, atk_bonus, matk_bonus').ilike('name', like).limit(3),
  ])
  // 完全一致を優先
  const exact = (arr) => arr?.find((x) => x.name === term) || (arr && arr[0])
  const s = exact(sk.data), w = exact(wp.data), i = exact(it.data)
  if (s) {
    return `⚡ ${s.name}（${s.class_name || ''}スキル / LV${s.required_lv} / MP${s.mp_cost ?? '-'}）\n${s.description || '（説明データなし）'}`
  }
  if (w) {
    const atk = (w.base_atk || 0) + (w.atk_bonus || 0)
    const matk = (w.base_matk || 0) + (w.matk_bonus || 0)
    const stats = [atk ? `攻撃${atk}` : '', matk ? `特攻${matk}` : ''].filter(Boolean).join(' / ') || 'ステータスデータなし'
    return `🗡 ${w.name}（武器${w.weapon_type ? '・' + w.weapon_type : ''}${w.rarity ? ' / ' + String(w.rarity).toUpperCase() + '級' : ''}）\n${stats}`
  }
  if (i) {
    return `📦 ${i.name}${i.buy_price ? `（${i.buy_price}G）` : ''}\n${i.description || '（説明データなし）'}`
  }
  return null
}

// ============================================================
// 公開API：問い合わせに回答（async）
//   returns: { text, kind }  kind = advice|class|kb|db|fallback
// ============================================================
const ADVICE_TRIGGER = /おすすめ|オススメ|お勧め|強化したい|なにを伸ば|何を伸ば|どこを伸ば|どう強く|ビルド|育て方|振り方|戦闘スタイル|強くなりたい/

export const askAssistant = async (query, ctx = {}) => {
  const raw = (query || '').trim()
  if (!raw) return { text: '質問を入力してください。例：「狂戦士になるには？」「メテオストライクの効果は？」「おすすめ強化」', kind: 'fallback' }

  // 1) 強化アドバイス
  if (ADVICE_TRIGGER.test(raw)) return { text: buildAdvice(ctx, raw), kind: 'advice' }

  // 2) クラス質問（職名を含む）
  const cls = findClassInQuery(raw)
  if (cls) {
    // 「○○のスキル」ならDBからスキル一覧
    if (/スキル|技|わざ|アビリティ/.test(raw)) {
      try {
        const sk = await lookupClassSkills(cls)
        if (sk) return { text: sk, kind: 'db' }
      } catch { /* DB失敗時は下の静的回答へ */ }
    }
    return { text: classInfoText(cls), kind: 'class' }
  }

  // 3) 静的KB（施設・仕組み）
  const kb = searchKB(raw)
  if (kb) return { text: kb.a, kind: 'kb' }

  // 4) DBライブ検索（スキル名・アイテム名・武器名）
  try {
    const term = extractEntity(raw)
    const hit = await lookupEntity(term)
    if (hit) return { text: hit, kind: 'db' }
  } catch { /* ネット失敗時はフォールバック */ }

  // 5) フォールバック
  return {
    text: 'うまく聞き取れませんでした。こんな質問ができます：\n・「狂戦士になるには？」（職名で転職条件）\n・「元素使いのスキル」（クラスのスキル一覧）\n・「メテオストライクの効果は？」（スキル名）\n・「宝石ってなに？」「レベル上げの効率は？」\n・「おすすめ強化」（あなた専用アドバイス）',
    kind: 'fallback',
  }
}

export const QUICK_QUESTIONS = [
  'おすすめ強化',
  '狂戦士になるには？',
  '転職について',
  '宝石ってなに？',
  'レベル上げの効率は？',
  'レイドボスってなに？',
]
