// ============================================================
// 「レベルキャップあり」版（v2cap）— ダンジョンのボスのイラスト版（大きなイラスト＋パーツを画面で動かす・グラブル型）
// ------------------------------------------------------------
// 【確定】2026-10-28 ユーザー「ATBの敵はグラブルの戦闘みたいにどんと大きく、かつこんな感じのイラストで」→「イラスト＋パーツで行きたい」
//   →「今のドット絵VERも試したいから、それぞれ分けて作れるようにして」→「イラスト版も作ったからドット絵版は別バージョンで作っておいて」
//   ＝試し撃ちで「イラスト版／ドット絵版」を選べる（はじめはイラスト版）。ドット絵版は lib/bossArt.js のまま
//   元の絵（ユーザーが ChatGPT で作って置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/イラスト版/
//     立ち絵.png … 戦闘用の全身（パーツを重ねる目安。画面には出さない）
//     体.png・頭.png・翼_手前.png（・翼_奥.png）… パーツ。ChatGPT は立ち絵と同じ大きさ・場所には描かない
//       ＝道具（tools/v2cap-boss-illust.mjs）が形と溶岩の筋の明るさで、倍率・角度・位置を探して立ち絵に重ねる
//       翼_奥.png が無ければ、立ち絵からほかのパーツを除いた残り（左上の翼）を切り出す。頭の後ろに隠れていた穴はまわりの色で埋める
//     <技の名前>_飛ぶ.png・<技の名前>_当たる.png … 塗りのエフェクト（1つにつき1枚・動きは画面で付ける）
//   画面で使う版：public/v2cap-art/boss/<key>-il-<パーツ>.webp・<key>-il-fx-<技>-<fly|hit>.webp、一覧は bossIllustList.js（道具が書く）
// 動かし方（このファイルの illustPoseAt・純関数）：
//   待機＝翼を付け根から回して羽ばたく（振り下ろしは速く）・体が上下に浮き沈み・首が少し揺れる
//   技＝決まった姿勢（キーフレーム）のあいだをなめらかにつなぐ。当たる時刻（hitMs）に飛ぶエフェクトが口から出る
//     黒爪＝身を引いてから前へ踏み込む／焦熱の吐息＝首を引いて口に火をため、突き出して吐く／
//     黒翼烈風＝翼を高く上げて叩きつける／終焉の黒焔＝のけぞって大きくため、突き出して撃つ
//   【確定】2026-10-28 ユーザー「爪攻撃のときもっとひっかくモーションが欲しい」「ブレス吐くときは口をしっかり開けて吐くモーションが欲しい」
//     「翼の風ももっと翼から出すように見せたい」：
//     ・前脚（arm）と下あご（jaw）を体・頭から切り分けて別に回す（cuts＝道具が 640px の立ち絵の上の多角形で切る）
//       黒爪＝前脚を振り上げて振り下ろす（爪の先に残像の筋）・当たる絵は右上から左下へ引いて出す（wipe）
//       焦熱の吐息・終焉の黒焔＝下あごを大きく開けて吐く（開いた口の中は画面で描く・火は口の中から出る）
//     ・黒翼烈風＝（2026-10-29 作り直し）翼を大きく広げてから一気に打ち下ろす・翼のふちに風の筋・風は胸の前と両方の翼の先から（shots）
// 【確定】2026-10-29 2体目 雨摩座（ユーザー「あまざイラスト作った、とりあえず動かしてみて」・技はまだ＝黒龍のあと）：
//   人の形なので、パーツの並びと元の絵の名前はボスごと（layers・files・無ければ竜の並び）。
//   ChatGPT の体・髪・奥の腕は立ち絵と形が違って重ならなかった＝立ち絵そのものを体にして（base: 'stand'）、
//   頭・手前の手・奥の手は立ち絵から多角形で切り分ける（立ち止まっているときは立ち絵と同じ）。動いて見える体のすき間は ChatGPT の体で埋める（fill）
//   待機＝ゆっくりした揺れの足し算（idle.sway）：浮き沈み・頭・両手・水の帯
// 【確定】2026-10-29 雨摩座の技（ユーザー「つぎはスキルとそのエフェクトを決めたい、黒龍と同じ感じの条件で」→選んだ4つ・
//   エフェクト7枚はユーザーが描いた「技も作り終えた」）：
//   雨礫＝手前の手を振り上げて払い、水の礫を手から撃つ／氷雨＝天を仰いで奥の手を差し上げ、手前の手を振り下ろす＝相手の頭上の雨雲から雨（飛ばない）／
//   水縛の帯＝身を引いて手前の手を突き出す＝水の帯が手から飛んで相手に巻きつく／
//   水天葬＝構え（5秒）のあいだ両手を掲げて震え、相手の頭上に渦の雲（ためる）→手を振り下ろすと雲から滝のような水が落ちる
//   相手の頭上・足元に出すエフェクトは on（'head' 頭上・'feet' 下を足元にそろえる・'body' 体の真ん中）で、大きさは自分の絵の枠の幅に対して
// ============================================================
import { BOSS_ILLUST } from './bossIllustList.js'
import { BOSS_DEFS, BOSS_ART_DIR, bossFileOf, bossArtOf } from './bossArt.js'

export const BOSS_ILLUST_SRC = 'イラスト版'   // 元の絵のフォルダの中
export const BOSS_ILLUST_SIZE = 640          // 立ち絵の大きさ（画面で使う版・正方形のpx）。パーツの位置はこの大きさで持つ
// 奥から手前へ重ねる順。neck（首）・arm（前脚）・jaw（下あご）は体・頭から切り分けたパーツ（元の絵は無い）。
//   首の中に頭、頭の中に下あごを重ねる（親といっしょに回る）。前脚は頭より手前（振り上げた爪が頭に隠れない・頭に覆われていた付け根は道具が除く＝over）
export const ILLUST_PARTS = ['wingF', 'wingN', 'body', 'neck', 'head', 'arm', 'jaw']
export const ILLUST_PART_FILES = { wingF: '翼_奥', wingN: '翼_手前', body: '体', head: '頭' }
// ボスごとの並びと元の絵の名前（BOSS_ILLUST_DEFS の layers・files。無ければ竜の並び）
export const illustPartsOf = (key) => BOSS_ILLUST_DEFS[key]?.layers || ILLUST_PARTS
export const illustFilesOf = (key) => BOSS_ILLUST_DEFS[key]?.files || ILLUST_PART_FILES

export const illustKindOf = (part) => `il-${part}`
export const illustFxKindOf = (motion, kind) => `il-fx-${motion}-${kind}`
const srcOf = (key, kind) => {
  const v = BOSS_ILLUST[key]?.v?.[kind]
  return `${BOSS_ART_DIR}/${bossFileOf(key, kind)}${v ? `?v=${v}` : ''}`
}

// 姿勢：x・y＝全体のずれ（枠の大きさに対する割合）／r＝全体の角度（°・時計回り）／neck＝首の付け根の角度／head＝首の中ほどから上の角度／
//   wingN・wingF＝翼の角度／wingNSq・wingFSq＝翼を長さの向きに縮める割合（振り下ろしで翼が手前へ来て短く見える）／
//   arm＝前脚の角度（＋で爪が上がる）／jaw＝下あごの角度（−で開く）／glow＝口の火（0〜1）
//   ＋の角度は時計回り：右へ伸びる手前の翼は＋で下がる・左へ伸びる奥の翼と首は＋で上がる
//   人の形（雨摩座）：armN・armF＝手前・奥の手の角度（左へ伸びる手は＋で上がる）／water＝水の帯の角度
//     armCOn・armUOn＝右腕の構えの絵（胸元・真上）に切り替える割合（0〜1・swapOpacityOf）／armD・armC・armU＝その腕の角度（ふだんは 0）
const ZERO = { x: 0, y: 0, r: 0, neck: 0, head: 0, wingN: 0, wingF: 0, wingNSq: 0, wingFSq: 0, arm: 0, jaw: 0, glow: 0, armN: 0, armF: 0, water: 0,
  armD: 0, armC: 0, armU: 0, armCOn: 0, armUOn: 0 }
// 技ごとの動き：keys＝[時刻ミリ秒, 姿勢（待機に足す）]・hitMs＝当たる（撃ち出す）時刻
//   trails＝残像の筋（part のパーツの点 pts を、lagMs 前からいまの時刻までたどる。fromMs〜toMs のあいだだけ・kind＝claw 爪／wind 風）
//   shots＝飛ぶ絵の出どころ（無ければ口から1つ）。{ part, pt（パーツの点）, delayMs（hitMs からの遅れ・−で先に出る）, size（飛ぶ絵の大きさの倍率） }
//     1つめ（delayMs 0）が届いた時刻がダメージ（impactMs）
//   charge＝撃つ前に口でためる火の玉（kind のエフェクトの絵を fromMs〜toMs のあいだ口で大きくする・size＝枠の幅に対する大きさ）
//     エフェクトに on があれば口ではなく相手の頭上（雨摩座の水天葬の渦の雲）：toMs のあと holdMs で薄れる・構えのあいだも出す
// ボスごとの idleKeep＝技のあいだも残す待機のぶん（無ければ IDLE_KEEP）・cast＝構え（大技の詠唱）のあいだの姿勢 pose と震え shake
// 雨摩座の手の通り道（立ち絵 640px の上の点・水の筋 arcs）：SWEEP＝胸元の手（構えの絵）→差しのべた指先／THROW＝真上に掲げた手→差しのべた指先
const SWEEP = [[285, 168], [230, 182], [160, 205], [100, 228], [54, 251]]
const THROW = [[110, -8], [62, 40], [34, 110], [36, 180], [54, 251]]
export const BOSS_ILLUST_DEFS = {
  varuzenoku: {
    // 待機：1回の羽ばたき（ミリ秒）・翼の振れ幅（°・上げきり→下ろしきり）・下ろしきりで縮める割合・奥の翼の振れ幅（手前の何倍）・体の浮き沈み（枠の割合）
    //   【確定】2026-10-28 ユーザー「羽ノーモーション、付け根が外れて見えてる」：羽ばたきを大きく（回す＋縮める）・奥の翼は付け根で回す（pivots）
    idle: { periodMs: 1100, wingUp: -14, wingDown: 16, squash: 0.16, farK: 0.6, bob: 0.014, headSway: 1.5, armSway: 2 },
    // 回す中心を決める（道具が出す「体との重なりの真ん中」の代わり）：奥の翼＝付け根（首と手前の翼の後ろに隠れる所）・頭＝首を切った所の真ん中
    pivots: { wingF: [292, 240], head: [232, 316] },
    // 奥の翼（立ち絵から切り出す）のうち、背中のとげ（翼といっしょに動くと外れて見える）は体に入れる
    wingFToBody: [[270, 240], [362, 188], [362, 272], [270, 272]],
    // 切り分け（立ち絵 640px の上の点）：take＝切り出す所・drop＝親から消す所（無ければ take と同じ）・pivot＝回す中心（付け根）
    //   take を drop より付け根の側へ広く取る＝付け根は親にも残り、回してもすき間が見えない
    //   over＝そのパーツより手前に出す（そのパーツに覆われていた所は切り出さない＝止まっているときは立ち絵と同じ）
    //   adopt＝切り出した方が親になる（首：頭から首を切り、頭は首の子＝首を上げると頭もついてくる）
    //   下あご：line＝口の線（先から付け根へ）。開くと line と回した line のあいだに口の中を描く・mouth＝火が出る所（line の上の点）
    cuts: {
      arm: { from: 'body', over: 'head', pivot: [182, 343],
        take: [[44, 304], [150, 300], [172, 300], [186, 312], [194, 340], [198, 372], [196, 396], [44, 402]],
        drop: [[44, 304], [158, 300], [166, 318], [171, 345], [176, 372], [182, 396], [44, 402]] },
      jaw: { from: 'head', pivot: [114, 272],
        line: [[40, 291], [52, 286], [70, 280], [90, 274], [114, 270]],
        take: [[40, 291], [52, 286], [70, 280], [90, 274], [114, 270], [124, 282], [124, 302], [100, 307], [62, 314], [40, 314]],
        mouth: [50, 290] },
      // 【確定】2026-10-28 ユーザー「大技は首真上に上げて溜めるモーションから」：首を中ほどで切り、付け根と中ほどの2か所で曲げる
      neck: { from: 'head', adopt: true, pivot: [255, 385],
        take: [[140, 280], [330, 314], [330, 470], [140, 470]],
        drop: [[140, 298], [330, 332], [330, 470], [140, 470]] },
    },
    motions: {
      // 【確定】2026-10-28 ユーザー「ひっかきモーションもうちょっと激しく」：大きくのけぞって振りかぶり、60ms で振り下ろして深く踏み込む
      claw: { totalMs: 950, hitMs: 370, keys: [
        [0, {}],
        [230, { x: 0.05, y: -0.02, r: 9, neck: 6, head: 10, arm: 62, wingN: -16, wingF: 12, jaw: -10 }],
        [310, { x: 0.055, y: -0.02, r: 10, neck: 7, head: 11, arm: 68, wingN: -18, wingF: 13, jaw: -12 }],
        [370, { x: -0.17, y: 0.035, r: -13, neck: -8, head: -10, arm: -52, wingN: 16, wingF: -10, jaw: -24 }],
        [430, { x: -0.155, y: 0.03, r: -11, neck: -7, head: -8, arm: -46, wingN: 12, wingF: -8, jaw: -20 }],
        [560, { x: -0.15, y: 0.03, r: -10, neck: -6, head: -7, arm: -44, wingN: 10, wingF: -6, jaw: -14 }],
        [950, {}],
      ], trails: [
        { kind: 'claw', part: 'arm', pts: [[58, 336], [55, 369], [96, 392]], fromMs: 310, toMs: 370, lagMs: 60, fadeMs: 150 },
      ] },
      breath: { totalMs: 1250, hitMs: 620, keys: [
        [0, {}],
        [450, { x: 0.03, r: 4, neck: 8, head: 14, glow: 0.8, jaw: -12, arm: -8 }],
        [540, { x: 0.03, r: 4, neck: 9, head: 15, glow: 0.9, jaw: -14, arm: -10 }],
        [620, { x: -0.05, r: -3, neck: -8, head: -8, glow: 1, jaw: -36, arm: -26 }],
        [920, { x: -0.045, r: -2, neck: -6, head: -7, glow: 0.5, jaw: -32, arm: -22 }],
        [1250, {}],
      ] },
      // 【確定】2026-10-29 ユーザー「羽根の攻撃がおかしい、もっと羽を大きく広げて敵に向かってバフってやってもらいたい」
      //   （10-28 の「後ろへ引いて前へ2回あおぐ」は翼がワイパーのように倒れて見えた）：
      //   大きくのけぞって両方の翼を高く広げ（長さの向きに伸ばす＝Sq を−）、一瞬ためて、体ごと相手の方へ踏み込みながら一気に打ち下ろす（縮める＝手前へ来る）。
      //   打ち下ろした時刻に、翼の先と胸の前から風が相手へ飛ぶ（胸の前のがいちばん大きい＝1つめ・ダメージ）
      gale: { totalMs: 1350, hitMs: 640, keys: [
        [0, {}],
        [380, { x: 0.04, y: -0.05, r: 9, neck: 10, head: 8, wingN: -20, wingNSq: -0.28, wingF: 30, wingFSq: -0.22, arm: 12, jaw: -10 }],
        [520, { x: 0.045, y: -0.055, r: 10, neck: 11, head: 9, wingN: -22, wingNSq: -0.3, wingF: 32, wingFSq: -0.24, arm: 13, jaw: -12 }],
        [640, { x: -0.09, y: 0.035, r: -10, neck: -8, head: -10, wingN: 38, wingNSq: 0.32, wingF: -26, wingFSq: 0.26, arm: -14, jaw: -20 }],
        [780, { x: -0.085, y: 0.03, r: -9, neck: -7, head: -9, wingN: 34, wingNSq: 0.28, wingF: -24, wingFSq: 0.22, arm: -12, jaw: -16 }],
        [1020, { x: -0.04, y: 0.01, r: -4, wingN: 10, wingNSq: 0.08, wingF: -8, wingFSq: 0.05 }],
        [1350, {}],
      ], trails: [
        { kind: 'wind', part: 'wingN', pts: [[530, 8], [600, 92], [630, 230], [616, 330]], fromMs: 520, toMs: 640, lagMs: 100, fadeMs: 220 },
        { kind: 'wind', part: 'wingF', pts: [[18, 192], [62, 118], [130, 62], [268, 30]], fromMs: 520, toMs: 640, lagMs: 100, fadeMs: 220 },
      ], shots: [
        { part: 'body', pt: [150, 250], delayMs: 0, size: 1.45 },
        { part: 'wingF', pt: [18, 192], delayMs: -30, size: 0.9 },
        { part: 'wingN', pt: [560, 120], delayMs: 30, size: 0.9 },
      ] },
      // 首を真上に上げ、口に黒い火の玉をためて（震える）、突き出して撃つ
      doom: { totalMs: 1800, hitMs: 1080, keys: [
        [0, {}],
        [480, { x: 0.03, y: -0.05, r: 10, neck: 28, head: 40, wingN: 12, wingF: -14, jaw: -22, glow: 0.8, arm: 10 }],
        [640, { x: 0.035, y: -0.055, r: 11, neck: 30, head: 44, wingN: 15, wingF: -16, jaw: -26, glow: 1, arm: 12 }],
        [800, { x: 0.03, y: -0.05, r: 10.5, neck: 29, head: 42, wingN: 13, wingF: -15, jaw: -24, glow: 1, arm: 11 }],
        [960, { x: 0.035, y: -0.056, r: 11.5, neck: 31, head: 46, wingN: 16, wingF: -17, jaw: -28, glow: 1, arm: 12 }],
        [1080, { x: -0.08, y: 0.02, r: -8, neck: -14, head: -16, wingN: -12, wingF: 10, jaw: -40, glow: 1, arm: -26 }],
        [1400, { x: -0.07, y: 0.02, r: -6, neck: -10, head: -12, jaw: -34, glow: 0.4, arm: -22 }],
        [1800, {}],
      ], charge: { kind: 'hit', fromMs: 380, toMs: 1080, size: 0.3 } },
    },
    // 塗りのエフェクト（元の絵の名前はドット絵版と同じ・フォルダが違う）。size＝枠の幅に対する横幅
    //   飛ぶ＝flyMs で口（か shots）から自分の体の真ん中へ／当たる＝durMs のあいだ大きくなりながら消える（spin＝回る角度°）
    //   wipe＝大きくせず、右上から左下へ引いたように出す（爪の跡）
    effects: [
      { file: '黒爪_当たる', motion: 'claw', kind: 'hit', size: 0.5, durMs: 520, spin: 0, wipe: true },
      { file: '焦熱の吐息_飛ぶ', motion: 'breath', kind: 'fly', size: 0.36, flyMs: 300 },
      { file: '焦熱の吐息_当たる', motion: 'breath', kind: 'hit', size: 0.5, durMs: 620, spin: 0 },
      { file: '黒翼烈風_飛ぶ', motion: 'gale', kind: 'fly', size: 0.42, flyMs: 360 },
      { file: '黒翼烈風_当たる', motion: 'gale', kind: 'hit', size: 0.56, durMs: 620, spin: 70 },
      { file: '終焉の黒焔_飛ぶ', motion: 'doom', kind: 'fly', size: 0.48, flyMs: 420 },
      { file: '終焉の黒焔_当たる', motion: 'doom', kind: 'hit', size: 0.72, durMs: 760, spin: 0 },
    ],
  },
  // 【確定】2026-10-29 雨摩座（ユーザー「とりあえず動かしてみて」→技4つ・エフェクト7枚）
  amaza: {
    // 立ち絵そのものが体。ChatGPT の体（fill）は、切り分けで空いた所（頭や手が動くと見える）を埋めるだけに使う
    base: 'stand', fill: '体',
    // 奥から手前へ。水の帯は立ち絵に無いので、描いた場所のまま置く（fixed・s＝立ち絵の大きさに合わせたうえでの倍率）
    //   右腕（手前の腕）は3つの絵を切り替える（swaps）：armD＝立ち絵の差しのべた腕（手前の手 armN はこの中）・armC＝胸元に構えた腕・armU＝真上に掲げた腕。
    //   ふだんの腕と手は頭の後ろ、構えの腕は頭より手前（掲げた腕は冠の前を通る）
    layers: ['water', 'body', 'armF', 'armD', 'armN', 'head', 'armC', 'armU'],
    files: { water: '水の帯' },
    fixed: { water: { s: 1.06 } },
    // 【確定】2026-10-29 ユーザー「攻撃するとき、水の帯は干渉せずに動いてほしい（水の帯まで動いてると違和感ある）」：
    //   水の帯は体の動き（技・構えの傾き・ずれ）から切り離し、いつも待機の揺れのまま（free・illustFreePoseAt）
    free: ['water'],
    // 【確定】2026-10-29 手振り（ユーザー「技を撃つとき、もっと手振りとかのモーション増やしてほしい、一回水平に右手を胸元まで持ってきて手前にさっと
    //   持っていくやつ（いけー！）」「大技は右手を真上に掲げて相手に向かって放つ感じ」→選んだ「腕の絵を2枚描き足す」）：
    //   右腕だけを描き変えた立ち絵2枚を立ち絵に重ね（fitPart・掲げる絵は人物が少し小さく描き変わったので胴のまわり fitOn で合わせ直す）、
    //   腕のまわり（armZone＝3つの腕と袖が入る所・頭は除く）だけを切り取る。体からはその所を抜き、3つの絵のどれか1つで埋める（穴が出ない）。
    //   構えの絵のふちは feather px でぼかして立ち絵になじませる。掲げた腕は冠の横を通る（extra・頭の所も描く）・指先が枠の上へ出る（top px）
    swaps: {
      armD: { base: true },
      armC: { file: '立ち絵_胸元', on: 'armCOn' },
      armU: { file: '立ち絵_掲げる', on: 'armUOn', top: 64, fitOn: [[180, 140], [340, 140], [350, 330], [180, 330]],
        extra: [[[55, -50], [165, -50], [170, 35], [215, 100], [240, 140], [165, 150], [120, 90], [85, 40]]] },
    },
    armZone: [[[30, 215], [120, 205], [165, 150], [200, 138], [245, 148], [312, 148], [318, 200], [262, 212], [250, 300], [262, 420], [262, 525],
      [150, 545], [60, 525], [40, 420], [28, 300]]],
    swapFeather: 10,
    // 腕を回すとき（ふだんは回さない）の中心＝肩
    pivots: { armD: [200, 185], armC: [200, 185], armU: [200, 140] },
    // 軽くする（パーツは 120KB まで）：体は立ち絵まるごとなので少し粗く・水の帯は柔らかいので細かさを6割に
    quality: 80, shrink: { water: 0.6 },
    // 届いたが今は使わない絵（髪・奥の腕は立ち絵と形が違って重ならなかった・頭と手前の腕は立ち絵から切るほうが同じ見た目）
    spare: ['頭', '髪', '腕_手前', '腕_奥'],
    // 待機：[振れ幅（y は枠の割合・ほかは°）, 1回のミリ秒, ずらし（0〜1）] の揺れの足し算。周期をずらして、水の中で漂うように
    idle: { sway: {
      y: [0.012, 4200, 0], r: [0.7, 6100, 0.2], head: [1.6, 5300, 0.35],
      armN: [4, 3700, 0.1], armF: [6, 4300, 0.6], water: [6, 7000, 0],
    } },
    // 技のあいだも揺れはそのまま（止めると技の頭と終わりで手や水の帯がぴくっと跳ねる）
    //   （水の帯の角度も数字としては残す。画面では水の帯は切り離して待機の姿勢で動かす＝free）
    idleKeep: { y: 1, r: 1, head: 1, armN: 1, armF: 1, water: 1 },
    // 構え（水天葬の5秒）：天を仰いで右腕を真上に掲げ（armU）、小さく震える。水天葬のためのいちばん上と同じ形
    cast: { pose: { x: 0.02, y: -0.038, r: 4.8, head: 6.5, armF: -13, armUOn: 1 }, shake: { r: 0.35, armF: 1.4 } },
    // 切り分け（立ち絵 640px の上の点）。頭＝冠と顔（首の付け根で傾ける）・手前の手＝袖口から先（ふだんの腕 armD から切る）・奥の手＝袖口から先（袖口で回す）
    cuts: {
      head: { from: 'body', pivot: [230, 145],
        take: [[140, 0], [320, 0], [320, 128], [255, 128], [245, 145], [215, 150], [200, 145], [185, 115], [178, 163], [155, 163], [155, 75], [140, 60]] },
      armN: { from: 'armD', pivot: [124, 231],
        take: [[40, 222], [95, 214], [120, 215], [126, 220], [127, 242], [100, 256], [80, 285], [40, 290]] },
      armF: { from: 'body', pivot: [396, 154],
        take: [[355, 95], [410, 95], [410, 155], [382, 155], [367, 135], [355, 130]] },
    },
    // 技。どれも「右手を胸元に引き寄せて（armC）ため、相手の方へさっと払う（ふだんの差しのべた腕へ戻る＝いけー！）」・大技は「真上に掲げて（armU）振り下ろす」。
    //   払う・振り下ろすときは、手の通り道に水の筋（arcs＝立ち絵の点をなめらかにつないだ線を fromMs〜toMs で描き、fadeMs で薄れる）。
    //   構えの絵のあいだは手前の手（armN）が見えないので、払う直前に上げておき（＋）、払った瞬間に下へ振る（－）
    //   [54, 251]＝手前の手の指先（雨礫と水縛の帯が出る所）
    motions: {
      // 雨礫：胸元に引き寄せて一瞬ため、さっと払って指先から水の礫
      shot: { totalMs: 1000, hitMs: 420, keys: [
        [0, {}],
        [150, { x: 0.012, y: -0.006, r: 1.5, head: 1.5, armF: 3 }],
        [230, { x: 0.026, y: -0.012, r: 3, head: 2.5, armF: 6, armCOn: 1, armN: 18 }],
        [340, { x: 0.03, y: -0.014, r: 3.4, head: 2.8, armF: 6, armCOn: 1, armN: 18 }],
        [420, { x: -0.05, y: 0.008, r: -3.5, head: -2, armN: -10, armF: -4 }],
        [600, { x: -0.045, y: 0.006, r: -3, head: -1.5, armN: -8, armF: -3 }],
        [1000, {}],
      ], arcs: [{ kind: 'water', pts: SWEEP, fromMs: 345, toMs: 420, fadeMs: 200 }],
      shots: [{ part: 'armN', pt: [54, 251], delayMs: 0, size: 1 }] },
      // 氷雨：天を仰いで奥の手を差し上げ、右手を胸元に引き寄せてため、さっと払う＝相手の頭上に雨雲（飛ぶ絵は無い）
      sleet: { totalMs: 1350, hitMs: 560, keys: [
        [0, {}],
        [200, { x: 0.015, y: -0.02, r: 3, head: 5, armF: -8 }],
        [300, { x: 0.02, y: -0.03, r: 3.6, head: 6.5, armF: -12, armCOn: 1, armN: 18 }],
        [480, { x: 0.022, y: -0.033, r: 3.9, head: 7, armF: -13, armCOn: 1, armN: 18 }],
        [560, { x: -0.04, y: 0.006, r: -2.5, head: -2, armN: -12, armF: 6 }],
        [840, { x: -0.035, y: 0.005, r: -2, head: -1.5, armN: -10, armF: 5 }],
        [1350, {}],
      ], arcs: [{ kind: 'water', pts: SWEEP, fromMs: 485, toMs: 560, fadeMs: 220 }] },
      // 水縛の帯：身を引いて（水の帯も大きく振れる）右手を胸元へ、長めにためてから突き出すように払う＝帯が指先から相手へ
      bind: { totalMs: 1250, hitMs: 520, keys: [
        [0, {}],
        [130, { x: 0.012, y: -0.006, r: 1.8, head: 1.2, armF: 4 }],
        [220, { x: 0.026, y: -0.013, r: 3.6, head: 2.6, armF: 7, armCOn: 1, armN: 18 }],
        [440, { x: 0.034, y: -0.017, r: 4.4, head: 3.3, armF: 9, armCOn: 1, armN: 18 }],
        [520, { x: -0.065, y: 0.01, r: -4.8, head: -3, armN: -14, armF: -6 }],
        [760, { x: -0.058, y: 0.008, r: -4.2, head: -2.5, armN: -12, armF: -5 }],
        [1250, {}],
      ], arcs: [{ kind: 'water', pts: SWEEP, fromMs: 445, toMs: 520, fadeMs: 220 }],
      shots: [{ part: 'armN', pt: [54, 251], delayMs: 0, size: 1 }] },
      // 水天葬：右腕を真上に掲げて（構えの姿勢と同じ形）ため、相手の方へ振り下ろす＝相手の頭上の渦の雲から滝が落ちる
      //   【確定】2026-10-29 ユーザー「大技はもうちょっと溜めていい」：掲げてから振り下ろすまで 0.9秒→1.5秒。だんだん高く浮いてのけぞり、震えも大きくなる（shake）
      deluge: { totalMs: 2500, hitMs: 1600, keys: [
        [0, {}],
        [120, { x: 0.006, y: -0.012, r: 1.8, head: 2.2, armF: -4, armUOn: 1 }],
        [300, { x: 0.016, y: -0.033, r: 4.3, head: 5.6, armF: -11, armUOn: 1 }],
        [860, { x: 0.02, y: -0.038, r: 4.8, head: 6.5, armF: -13, armUOn: 1 }],
        [1200, { x: 0.026, y: -0.047, r: 5.6, head: 7.6, armF: -15, armUOn: 1 }],
        [1520, { x: 0.031, y: -0.055, r: 6.4, head: 8.4, armF: -17, armUOn: 1, armN: 22 }],
        [1600, { x: -0.07, y: 0.018, r: -6, head: -3.5, armN: -14, armF: 6 }],
        [1950, { x: -0.062, y: 0.014, r: -5.2, head: -2.8, armN: -12, armF: 5 }],
        [2500, {}],
      ], shake: { fromMs: 300, toMs: 1520, amp: { r: 0.7, armF: 2.2, head: 0.6 } },
      arcs: [{ kind: 'water', pts: THROW, fromMs: 1525, toMs: 1600, fadeMs: 260 }],
      charge: { kind: 'charge', fromMs: 0, toMs: 1600, holdMs: 700 } },
    },
    // on＝相手のどこに出すか（大きさは自分の絵の枠の幅に対して）・anim＝見せ方（drop＝上から下へ降りる・bind＝外から締まる）・
    //   lead＝絵が出はじめてから当たるまで（降りきった時刻がダメージ）・fadeTop＝絵の上のはしをぼかす割合（滝の上を雲になじませる）
    effects: [
      { file: '雨礫_飛ぶ', motion: 'shot', kind: 'fly', size: 0.34, flyMs: 300 },
      { file: '雨礫_当たる', motion: 'shot', kind: 'hit', size: 0.46, durMs: 560, spin: 0 },
      { file: '氷雨_当たる', motion: 'sleet', kind: 'hit', on: 'feet', size: 1.4, anim: 'drop', lead: 260, durMs: 1150 },
      { file: '水縛の帯_飛ぶ', motion: 'bind', kind: 'fly', size: 0.46, flyMs: 380 },
      { file: '水縛の帯_当たる', motion: 'bind', kind: 'hit', on: 'body', size: 0.95, anim: 'bind', durMs: 950 },
      // 渦の雲は滝より手前に重ねる（滝が雲から落ちて見える）＝並びは滝が先
      { file: '水天葬_当たる', motion: 'deluge', kind: 'hit', on: 'feet', size: 1.3, anim: 'drop', lead: 240, durMs: 1300, fadeTop: 0.16 },
      { file: '水天葬_ためる', motion: 'deluge', kind: 'charge', on: 'head', size: 1.3 },
    ],
  },
}

const smooth = (k) => k * k * (3 - 2 * k)
const lerpPose = (a, b, k) => Object.fromEntries(Object.keys(ZERO).map(f => [f, (a[f] ?? 0) + ((b[f] ?? 0) - (a[f] ?? 0)) * k]))
// 技の姿勢（待機に足すぶん）。流し終わったら null
export const motionPoseAt = (keys, ms) => {
  if (ms < 0 || ms >= keys.at(-1)[0]) return null
  let i = 0
  while (i < keys.length - 2 && ms >= keys[i + 1][0]) i++
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]
  return lerpPose(p0, p1, smooth((ms - t0) / (t1 - t0)))
}
// 待機の姿勢（時刻 tMs）。振り下ろし（はじめの35%）は速く、振り上げはゆっくり
//   sway があれば（人の形）、揺れの足し算だけ
export const idlePoseAt = (idle, tMs) => {
  if (idle.sway) return { ...ZERO, ...Object.fromEntries(Object.entries(idle.sway).map(([k, [amp, per, ph]]) => [k, amp * Math.sin(2 * Math.PI * (tMs / per + ph))])) }
  const ph = ((tMs % idle.periodMs) + idle.periodMs) % idle.periodMs / idle.periodMs
  const down = ph < 0.35 ? smooth(ph / 0.35) : 1 - smooth((ph - 0.35) / 0.65)
  const w = idle.wingUp + (idle.wingDown - idle.wingUp) * down, far = idle.farK ?? 0.8
  return { ...ZERO, y: -idle.bob * down, head: idle.headSway * Math.sin(2 * Math.PI * (ph - 0.15)), wingN: w, wingF: -w * far,
    wingNSq: (idle.squash || 0) * down, wingFSq: (idle.squash || 0) * 0.7 * down,
    arm: (idle.armSway || 0) * Math.sin(2 * Math.PI * (ph - 0.3)) }
}
// 技のあいだも残す待機のぶん（羽ばたきは弱めて残す・浮き沈みは半分）。ボスごとに idleKeep があればそちら
const IDLE_KEEP = { wingN: 0.35, wingF: 0.35, wingNSq: 0.35, wingFSq: 0.35, y: 0.5 }
// 構え：はじめの CAST_IN_MS で構えの姿勢へ移る／構えのすぐあとの技は、はじめの CAST_OUT_MS で構えの姿勢から技の動きへつなぐ
export const CAST_IN_MS = 500
export const CAST_OUT_MS = 320
// いまの姿勢：motion（bossIllustOf の motions の1つ）を流しはじめて ms たったとき。技のあいだは羽ばたきを弱める
//   fromCast＝構えのすぐあとに撃った技（構えの姿勢からつなぐ＝手を掲げたままの形から急に待機に戻らない）
export const illustPoseAt = (key, motion, ms, tMs, fromCast = false) => {
  const def = BOSS_ILLUST_DEFS[key]
  const idle = idlePoseAt(def.idle, tMs)
  const add = motion ? motionPoseAt(motion.keys, ms) : null
  if (!add) return idle
  const keep = def.idleKeep || IDLE_KEEP, cp = fromCast && def.cast ? def.cast.pose : null
  const w = cp ? 1 - smooth(Math.min(1, Math.max(0, ms) / CAST_OUT_MS)) : 0
  // 溜めの震え（motion.shake）：fromMs〜toMs のあいだ、だんだん大きく（約9回/秒）
  const sh = motion.shake, q = sh && ms >= sh.fromMs && ms < sh.toMs ? Math.sin(ms / 18) * (0.3 + 0.7 * (ms - sh.fromMs) / (sh.toMs - sh.fromMs)) : 0
  return Object.fromEntries(Object.keys(ZERO).map(f => [f, idle[f] * (keep[f] || 0) + add[f] + (cp?.[f] || 0) * w + (q ? (sh.amp[f] || 0) * q : 0)]))
}
// 体の動きから切り離したパーツ（def.free・雨摩座の水の帯）の姿勢：技・構えのあいだも待機のまま
export const illustFreePoseAt = (key, tMs) => idlePoseAt(BOSS_ILLUST_DEFS[key].idle, tMs)
// 構え（大技の詠唱）のあいだの姿勢：castMs＝構えはじめてからのミリ秒。構えの決まり（cast）が無いボスは待機のまま
export const illustCastPoseAt = (key, castMs, tMs) => {
  const def = BOSS_ILLUST_DEFS[key]
  const idle = idlePoseAt(def.idle, tMs)
  if (!def.cast) return idle
  const keep = def.idleKeep || IDLE_KEEP
  const k = smooth(Math.min(1, Math.max(0, castMs) / CAST_IN_MS)), q = Math.sin(castMs / 18) * k   // 震え（約9回/秒）
  return Object.fromEntries(Object.keys(ZERO).map(f => [f, idle[f] * (keep[f] || 0) + (def.cast.pose[f] || 0) * k + (def.cast.shake?.[f] || 0) * q]))
}

// 点（立ち絵の px）を姿勢で動かした先（同じ px）。パーツ→親のパーツ→全体の順に回す（画面の rotate と同じ時計回り）
export const rotPoint = ([x, y], [cx, cy], deg) => {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t)
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]
}
// パーツ p（一覧の px・py＝回す中心・ax＝長さの向き°）1つぶんの動き：長さの向きに pose[<key>Sq] だけ縮めてから pose[<key>] 回す
//   画面の CSS では rotate(deg) rotate(ax) scaleX(1 − sq) rotate(−ax)（中心は px・py）
export const partMove = (pt, p, pose) => {
  const c = [p.px, p.py], sq = pose[`${p.key}Sq`] || 0
  let q = pt
  if (sq) {
    q = rotPoint(q, c, -(p.ax || 0))
    q = rotPoint([c[0] + (q[0] - c[0]) * (1 - sq), q[1]], c, p.ax || 0)
  }
  return rotPoint(q, c, pose[p.key] || 0)
}
export const illustPointAt = (key, pose, pt, part = 'head') => {
  const a = BOSS_ILLUST[key]
  let p = pt
  for (let q = part, pp = a.parts[q]; pp; q = pp.parent, pp = a.parts[q]) p = partMove(p, { ...pp, key: q }, pose)
  p = rotPoint(p, a.pivot, pose.r)
  return [p[0] + pose.x * BOSS_ILLUST_SIZE, p[1] + pose.y * BOSS_ILLUST_SIZE]
}
// 開いた口の火が出る所（頭の上の点）：口の線の上の mouth を、下あごの半分の角度だけ回す（上あごと下あごの真ん中）
export const mouthPointOf = (key, pose) => {
  const j = BOSS_ILLUST_DEFS[key]?.cuts?.jaw
  return j ? rotPoint(j.mouth, j.pivot, (pose.jaw || 0) / 2) : BOSS_ILLUST[key].mouth
}

// 腕の構えの絵の濃さ（0〜1）：切り替える割合 w の前半で新しい絵が出きり、後半で前の絵（ふだんの腕）が消える
//   （途中で両方が透けて、抜いた体の穴が見えないように）。swap＝{ on: 'armCOn' }（構えの絵）か { others: [...] }（ふだんの腕）
export const swapOpacityOf = (swap, pose) => {
  const w = (f) => Math.min(1, Math.max(0, pose[f] || 0))
  if (swap.on) return smooth(Math.min(1, 2 * w(swap.on)))
  return 1 - smooth(Math.max(0, 2 * Math.max(0, ...swap.others.map(w)) - 1))
}
// 点の列をなめらかにつなぐ（Catmull-Rom・1区間 n 点）
const smoothPath = (pts, n = 6) => {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t
      out.push([0, 1].map(c => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)))
    }
  }
  out.push(pts.at(-1))
  return out
}

// 残像の筋（引っかく爪・翼の風）：motion.trails の点を、少し前からいまの時刻までたどった線（立ち絵の px）
//   → [{ kind, line: [[x, y], …（古い→新しい）], alpha }]。toMs を過ぎたら fadeMs で薄れながら縮む
//   motion.arcs（雨摩座の払う手の水の筋）：決まった通り道を fromMs〜toMs で先へ描き足し、toMs のあと fadeMs で根もとから消える（体の傾き・ずれに合わせる）
export const illustTrailsAt = (key, motion, ms, tMs) => {
  const out = []
  for (const a of motion?.arcs || []) {
    if (ms < a.fromMs || ms >= a.toMs + a.fadeMs) continue
    const path = smoothPath(a.pts), last = path.length - 1
    const head = Math.max(1, Math.round(Math.min(1, (ms - a.fromMs) / (a.toMs - a.fromMs)) * last))
    const fade = ms <= a.toMs ? 0 : (ms - a.toMs) / a.fadeMs
    const tail = Math.min(head - 1, Math.floor(fade * last))
    const pose = illustPoseAt(key, motion, ms, tMs)
    out.push({ kind: a.kind, alpha: 1 - fade, line: path.slice(tail, head + 1).map(p => illustPointAt(key, pose, p, 'body')) })
  }
  for (const tr of motion?.trails || []) {
    if (ms < tr.fromMs || ms >= tr.toMs + tr.fadeMs) continue
    const t1 = Math.min(ms, tr.toMs), t0 = Math.max(tr.fromMs, ms - tr.lagMs)
    if (t1 - t0 < 1) continue
    const n = Math.max(2, Math.ceil((t1 - t0) / 10))
    const alpha = ms <= tr.toMs ? 1 : 1 - (ms - tr.toMs) / tr.fadeMs
    const poses = Array.from({ length: n + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / n; return illustPoseAt(key, motion, t, tMs - (ms - t)) })
    for (const pt of tr.pts) out.push({ kind: tr.kind, alpha, line: poses.map(p => illustPointAt(key, p, pt, tr.part)) })
  }
  return out
}

// 画面で使う形（無ければ null）。lib/bossArt.js の bossArtOf と同じ並び（kind で見分ける）
//   { kind:'illust', key, name, base（＝640）, illust（遭遇のイラスト）, parts:[{ key, src, x, y, w, h, px, py, ax（長さの向き°）, parent?, nest }], pivot, mouth,
//     jaw:{ line, pivot, mouth }（口の中を描く）,
//     motions:{ <key>: { label, keys, trails, totalMs, hitMs, flyMs, impactMs, front（当たる時刻の口・px）,
//       shots:[{ front, delayMs, size }]（飛ぶ絵の出どころ・1つめが front）, fx:{ fly?, hit?, charge?（どれも on・anim・lead つき） }, charge? } }, srcs }
export const bossIllustOf = (key) => {
  const def = BOSS_ILLUST_DEFS[key], art = BOSS_ILLUST[key], base = BOSS_DEFS[key]
  if (!def || !art?.parts || !base) return null
  // nest＝親の中に重ねる（親が回るパーツのとき＝頭は首・下あごは頭の中）。前脚の親（体）は回らないので、ほかのパーツと同じ並びで重ねる
  //   swap＝腕の構えの絵（swapOpacityOf に渡す・雨摩座）
  const ons = Object.values(def.swaps || {}).map(s => s.on).filter(Boolean)
  const parts = illustPartsOf(key).filter(p => art.parts[p]).map(p => ({ key: p, src: srcOf(key, illustKindOf(p)), ...art.parts[p],
    nest: !!art.parts[p].parent && art.parts[p].parent in ZERO,
    swap: def.swaps?.[p] ? (def.swaps[p].on ? { on: def.swaps[p].on } : { others: ons }) : null,
    free: !!def.free?.includes(p) }))
  const motions = {}
  for (const m of base.motions) {
    const md = def.motions[m.key]
    if (!md) continue
    const fx = {}
    let flyMs = 0
    for (const d of def.effects.filter(d => d.motion === m.key)) {
      const a = art.fx?.[m.key]?.[d.kind]
      if (!a) continue
      fx[d.kind] = { ...a, frames: 1, src: srcOf(key, illustFxKindOf(m.key, d.kind)), size: d.size, durMs: d.durMs, spin: d.spin || 0, wipe: !!d.wipe,
        on: d.on || null, anim: d.anim || null, lead: d.lead || 0, fadeTop: d.fadeTop || 0 }
      if (d.kind === 'fly') flyMs = d.flyMs
    }
    const poseAt = (ms) => ({ ...ZERO, ...motionPoseAt(md.keys, ms) })
    const shots = (md.shots || [{ delayMs: 0, size: 1 }]).map(sh => {
      const p = poseAt(md.hitMs + sh.delayMs)
      const front = sh.part ? illustPointAt(key, p, sh.pt, sh.part) : illustPointAt(key, p, mouthPointOf(key, p), 'head')
      return { front: front.map(Math.round), delayMs: sh.delayMs, size: sh.size ?? 1 }
    })
    // 当たる時刻＝撃ち出す時刻＋飛ぶ時間＋当たる絵が降りきるまで（lead・氷雨と水天葬）
    motions[m.key] = { label: m.file, keys: md.keys, trails: md.trails || [], arcs: md.arcs || [], shake: md.shake || null, totalMs: md.totalMs, hitMs: md.hitMs, flyMs, impactMs: md.hitMs + flyMs + (fx.hit?.lead || 0),
      front: shots[0].front, shots, fx: Object.keys(fx).length ? fx : null, charge: md.charge && fx[md.charge.kind] ? md.charge : null }
  }
  const jaw = def.cuts?.jaw && art.parts.jaw ? { line: def.cuts.jaw.line, pivot: def.cuts.jaw.pivot, mouth: def.cuts.jaw.mouth } : null
  // 遭遇のイラストはドット絵版と同じ
  const illust = bossArtOf(key)?.illust || null
  return {
    kind: 'illust', key, name: base.name, base: BOSS_ILLUST_SIZE, illust, parts, pivot: art.pivot, mouth: art.mouth, jaw, motions,
    srcs: [...parts.map(p => p.src), ...Object.values(motions).flatMap(m => Object.values(m.fx || {}).map(f => f.src))],
  }
}
