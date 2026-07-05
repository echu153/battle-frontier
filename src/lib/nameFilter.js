// 名前バリデーション（プレイヤー名・ペット名 共通）
// ※NG_WORDS_EXTRAは ../constants/ngWords.js で管理（巨大リスト）
import { NG_WORDS_EXTRA } from '../constants/ngWords'

// 部分一致でNG（名前の一部に含まれていても弾く）
export const NG_WORDS_PARTIAL = [
  // 暴言・侮辱
  '死ね','しね','ころす','殺す','殺害','自殺','きえろ','消えろ',
  'ばか','バカ','あほ','アホ','かす','カス','ごみ','ゴミ','くず','クズ',
  '無能','低能','池沼','知恵遅れ','キチガイ','きちがい','ガイジ',
  'ざこ','雑魚','カモ','ハゲ','デブ','ブス','ブサイク','害悪',
  // 性的
  'エロ','えろ','ERO','ero','SEX','sex','セックス','性交','性交渉','性的',
  'アダルト','成人向け','18禁','R18','R-18','グラビア','ヌード',
  '裸','全裸','半裸','下着','パンツ','ぱんつ','ブラ',
  '巨乳','爆乳','美乳','貧乳','微乳',
  '援助交際','売春','風俗','ソープ','デリヘル','ヘルス','キャバクラ','ホスト',
  'オフパコ','個通','通話募集','恋人募集','彼女募集','彼氏募集',
  '愛人','不倫','浮気','ナンパ','逆ナン','マッチング','パパ活','ママ活','出会い系','援交',
  // 性的（ローマ字・ASCII表記の抜け対策）
  'unko','unco','manko','mannko','omanko','chinko','chinnko','chinpo','chinnpo',
  'anal','oppai','ero','sex','fuck',
  // 不正行為
  'マクロ','RMT','代行','不正ツール','改造','チート販売','アカウント販売','垢販売','業者',
  // なりすまし
  '運営','管理人','Admin','admin','Administrator','administrator',
  'GM','gm','GameMaster','gamemaster','System','system','Moderator','moderator',
  // 犯罪・危険物
  '詐欺','犯罪','闇バイト','強盗','窃盗','爆弾','爆破','脅迫',
  '覚醒剤','麻薬','大麻','コカイン','MDMA','ドラッグ',
  // 英語スラング
  'fuck','shit','bitch','asshole','idiot','moron','kill','die','stupid','nigger','faggot','retard',
  // 連絡先誘導
  '個チャ','個人チャット','連絡先','連絡先交換','メールアドレス','電話番号',
]

// 完全一致でNG（短すぎて部分一致にすると誤爆するもの）
export const NG_WORDS_EXACT = [
  'AV','av',
]

const ALLOWED_NAME_RE = /^[ぁ-んァ-ヶー一-龯a-zA-Zａ-ｚＡ-Ｚ0-9０-９_\-・]+$/

// 名前を検証。問題なければ null、NGならエラーメッセージ文字列を返す。
// opts.maxLen: 最大文字数（既定16）／opts.label: エラー文言に使う呼称（既定「名前」）
export function validateName(name, { maxLen = 16, label = '名前' } = {}) {
  const trimmed = (name ?? '').trim()
  if (trimmed.length === 0) return `${label}を入力してください`
  if (trimmed !== name) return `${label}の前後にスペースは使えません`
  if (/\s/.test(name)) return `${label}にスペースは使えません`
  if (trimmed.length < 1 || trimmed.length > maxLen) return `${label}は1〜${maxLen}文字にしてください`
  if (!ALLOWED_NAME_RE.test(trimmed)) return '使用できない文字が含まれています（日本語・英数字・_・-のみ）'
  const lower = trimmed.toLowerCase()
  for (const w of [...NG_WORDS_PARTIAL, ...NG_WORDS_EXTRA]) {
    if (lower.includes(w.toLowerCase())) return 'その名前は使用できません'
  }
  for (const w of NG_WORDS_EXACT) {
    if (lower === w.toLowerCase()) return 'その名前は使用できません'
  }
  return null
}
