import Phaser from 'phaser'
import { controls } from './controls'

// ============================================================
// アクションRPG プロト
//   移動 → 攻撃/スキル(すべて「向いている方向」に発動) → 撃破でEXP → レベルアップ
//   ・通常攻撃: 手前(向き±75°)の扇なぎ払い
//   ・衝撃波  : 直線に飛ぶ貫通弾(MP8/CT3秒)
//   ・疾風斬  : 直線ダッシュ+経路上の敵にダメージ+無敵(MP12/CT5秒)
//   ・マップ右上にボス区画(キングスライム: 踏みつけAoE/弾幕/アグロ管理)
// 見た目は今はコード生成の四角/丸。後でドット絵に差し替える箇所には
//   [ART] というコメントを付けてある。
// ============================================================

const WORLD_W = 1600
const WORLD_H = 1200

const PLAYER_SPEED = 160       // プレイヤー移動速度(px/秒)
const ATTACK_RANGE = 60        // 通常攻撃が届く距離
const ATTACK_ARC = Phaser.Math.DegToRad(75) // 攻撃の扇の半角(向き±75°=計150°に当たる)
const ATTACK_INTERVAL = 600    // 攻撃間隔(ms)＝クールタイム
const COMBO_TIMEOUT = 3000     // この時間倒さないとコンボ途切れる(ms)
const SLIME_COUNT = 14
const AUTO_ENGAGE_RANGE = 700  // オート時にこの距離内の敵だけ追う(遠い敵は無視)
const HIT_INVULN = 450         // 被弾後の無敵時間(ms)。多数に囲まれた瞬間死を防ぐ

const ENEMY_ATTACK_RANGE = 38   // 敵がこちらを殴れる距離(接触)
const ENEMY_ATTACK_INTERVAL = 900 // 敵の攻撃間隔(ms)

// --- スキル定義(向いている方向に発動) ---
const SKILLS = {
  wave: { name: '衝撃波', mp: 8, cd: 3000 },   // 直線に飛ぶ貫通弾
  dash: { name: '疾風斬', mp: 12, cd: 5000 },  // 直線ダッシュ攻撃
}
const WAVE_SPEED = 460      // 衝撃波の弾速(px/秒)
const WAVE_LIFE = 1100      // 衝撃波の寿命(ms)≒射程500px
const DASH_TIME = 240       // ダッシュ時間(ms)
const DASH_SPEED = 900      // ダッシュ速度(px/秒)≒距離220px

// --- ボス区画(マップ右上) ---
const BOSS_ZONE = { x: 1100, y: 0, w: 500, h: 460 }
const BOSS = {
  name: 'キングスライム',
  hp: 600, expReward: 300,
  contactDmg: 14,        // 接触ダメージ
  slamRadius: 110, slamDmg: 22,  // 踏みつけ(予兆→炸裂)
  bulletDmg: 10, bulletSpeed: 190, // 弾幕
  respawnMs: 25000,
}

export default class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene')
  }

  init() {
    this.player = null
    this.slimes = null
    this.boss = null
    this.lastAttack = 0
    this.combo = 0
    this.lastKill = 0
    this.dead = false
    // セーブ対象になる進行データ（プロトなのでメモリのみ）
    this.state = { level: 1, exp: 0, expNext: 20, hp: 100, hpMax: 100, mp: 30, mpMax: 30 }
    this.lastMapEmit = 0
    this.lastHudEmit = 0
    this.mpAccum = 0
    this.facingAngle = 0 // 攻撃の向き(ラジアン、初期は右)
    this.autoMode = false // オート戦闘ON/OFF
    // スキル関係
    this.cdUntil = { wave: 0, dash: 0 } // クールタイム明けの時刻
    this.waves = []       // 飛んでいる衝撃波 {spr, vx, vy, born, hit:Set}
    this.bullets = []     // 敵弾 {spr, vx, vy, born}
    this.dashUntil = 0    // ダッシュ終了時刻(0=非ダッシュ)
    this.dashAng = 0
    this.dashHit = null   // ダッシュ中に既に当てた敵(多段ヒット防止)
    this.lastTrail = 0
    this.invulnUntil = 0  // 被弾無敵の終了時刻
  }

  preload() {
    // [ART] public/action-rpg/hero.png があれば読む。無くてもエラーにせず四角で動かす。
    //   本番で4方向歩きにするときは spritesheet に差し替え:
    //   this.load.spritesheet('hero', '/action-rpg/hero.png', { frameWidth: 48, frameHeight: 48 })
    // public/ に置いた画像があれば使う。無くてもエラーにせず四角/丸で動かす。
    // key(name) → 実ファイルの対応。差し替えるときはここを変える。
    this.missingArt = new Set()
    const ART_FILES = {
      hero: '/hero_front.webp',    // 正面①(左右はエンジン側のflipで表現)
      slime: '/2dsuraimu.png',
      grass: '/2dheigen.png',
    }
    for (const [name, path] of Object.entries(ART_FILES)) {
      this.load.image(`${name}_png`, path)
    }
    this.load.on('loaderror', (file) => { if (file?.key) this.missingArt.add(file.key) })
  }

  // 画像があればそのキー、無ければコード生成テクスチャのキーを返す
  art(name) {
    const key = `${name}_png`
    return (this.textures.exists(key) && !this.missingArt.has(key)) ? key : name
  }

  // 透過処理後のキー優先。無ければ art() にフォールバック
  spriteKey(name) {
    const c = `${name}_c`
    return this.textures.exists(c) ? c : this.art(name)
  }

  // hero/slime の白背景を透過に(縁から繋がった白だけをフラッドフィルで抜く)
  prepareArt() {
    for (const name of ['hero', 'slime']) {
      const key = `${name}_png`
      if (!this.textures.exists(key) || this.missingArt.has(key)) continue
      try {
        const img = this.textures.get(key).getSourceImage()
        const cv = this.removeWhiteBackground(img)
        if (cv) this.textures.addCanvas(`${name}_c`, cv)
      } catch (e) {
        // 失敗時は白背景のまま表示(クラッシュさせない)
        console.warn('[action-rpg] 背景透過に失敗:', name, e)
      }
    }
  }

  removeWhiteBackground(img) {
    const w = img.width, h = img.height
    if (!w || !h) return null
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const imgData = ctx.getImageData(0, 0, w, h)
    const px = imgData.data
    const isWhite = (p) => px[p * 4] > 225 && px[p * 4 + 1] > 225 && px[p * 4 + 2] > 225
    const visited = new Uint8Array(w * h)
    const stack = []
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const p = y * w + x
      if (visited[p] || !isWhite(p)) return
      visited[p] = 1; stack.push(p)
    }
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
    while (stack.length) {
      const p = stack.pop()
      px[p * 4 + 3] = 0 // alpha=0
      const x = p % w, y = (p - x) / w
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
    }
    ctx.putImageData(imgData, 0, 0)
    return cv
  }

  create() {
    this.generateTextures()
    this.prepareArt() // 白背景の画像を透過に(縁から繋がった白のみ抜く＝目や光沢は残す)
    this.drawGround()

    // --- プレイヤー ---
    // 物理ボディ(透明)と見た目(this.hero)を分離。これで見た目を物理に縛られず
    // 自由にバウンド/踏み込み/スケールできる(=アクション感を出せる)。
    const heroKey = this.spriteKey('hero')
    this.player = this.physics.add.image(800, 600, heroKey).setVisible(false)
    this.player.setCollideWorldBounds(true)
    this.player.body.setSize(24, 24, true) // 足元の当たり判定(テクスチャ中央に小さく)

    this.hero = this.add.image(800, 600, heroKey).setDepth(10)
    this.hero.setDisplaySize(64, 64)
    this.hero.setOrigin(0.5, 0.62) // 足元を基準にすると接地感が出る
    this.walkPhase = 0
    this.lunge = { x: 0, y: 0 } // 攻撃の踏み込みオフセット(tweenで0に戻す)

    // 向きは1枚の正面画像をflip(反転)で表現。右=反転なし / 左=反転。
    this.hero.setFlipX(false)

    // 向きインジケータ(足元の三角矢印)。方向攻撃なので今どこを向いてるか見えるように
    this.faceInd = this.add.image(800, 600, 'faceInd').setDepth(9).setAlpha(0.55).setTint(0x99e0ff)

    // --- 敵(スライム) ---
    this.slimes = this.physics.add.group()
    for (let i = 0; i < SLIME_COUNT; i++) this.spawnSlime()

    // --- ボス ---
    this.spawnBoss()

    // --- 入力 ---
    // 移動: PCはWASD/矢印、スマホは左半分のバーチャルパッド(controls.moveX/Y)。
    // 攻撃: 右半分のボタン or スペースキー。スキル: 1/2キー or ボタン。
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE')
    this.input.keyboard.on('keydown-SPACE', () => this.tryAttack())
    this.input.keyboard.on('keydown-ONE', () => this.trySkill('wave'))
    this.input.keyboard.on('keydown-TWO', () => this.trySkill('dash'))
    this._onAction = (e) => {
      if (e.detail === 'attack') this.tryAttack()
      else if (e.detail === 'skill:wave') this.trySkill('wave')
      else if (e.detail === 'skill:dash') this.trySkill('dash')
      else if (e.detail === 'auto:on') this.autoMode = true
      else if (e.detail === 'auto:off') this.autoMode = false
    }
    window.addEventListener('arpg-action', this._onAction)
    this.events.once('shutdown', () => window.removeEventListener('arpg-action', this._onAction))

    // カメラはプレイヤー追従。世界はちょい広め。
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1)

    this.emitHud()
    if (typeof window !== 'undefined') window.__arpgScene = this // デバッグ用
  }

  // ---- 当面の見た目をコードで生成（[ART]で差し替え予定）----
  generateTextures() {
    // 草タイル
    let g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x3a7d3a).fillRect(0, 0, 32, 32)
    g.fillStyle(0x347036).fillRect(0, 0, 16, 16).fillRect(16, 16, 16, 16)
    g.generateTexture('grass', 32, 32); g.destroy()

    // 勇者(青い四角)
    g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x2b6cff).fillRect(0, 0, 28, 28)
    g.fillStyle(0xffffff).fillRect(6, 8, 5, 5).fillRect(17, 8, 5, 5)
    g.generateTexture('hero', 28, 28); g.destroy()

    // スライム(緑の丸)
    g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x6fcf4f).fillCircle(14, 16, 13)
    g.fillStyle(0x000000).fillRect(9, 13, 3, 3).fillRect(17, 13, 3, 3)
    g.generateTexture('slime', 28, 30); g.destroy()

    // 斬撃エフェクト(三日月)：太い白＋外側に薄い水色のグローで見やすく
    g = this.make.graphics({ x: 0, y: 0 })
    g.lineStyle(14, 0x88ddff, 0.5)
    g.beginPath(); g.arc(48, 48, 38, Phaser.Math.DegToRad(-62), Phaser.Math.DegToRad(62), false); g.strokePath()
    g.lineStyle(7, 0xffffff, 1)
    g.beginPath(); g.arc(48, 48, 38, Phaser.Math.DegToRad(-58), Phaser.Math.DegToRad(58), false); g.strokePath()
    g.generateTexture('slash', 96, 96); g.destroy()

    // 衝撃波(直線スキルの弾)：水色の光弾
    g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x66e0ff, 0.35).fillEllipse(24, 12, 46, 22)
    g.fillStyle(0xaef4ff, 0.9).fillEllipse(24, 12, 34, 14)
    g.fillStyle(0xffffff, 1).fillEllipse(27, 12, 16, 7)
    g.generateTexture('wave', 48, 24); g.destroy()

    // 敵弾(赤いオーブ)
    g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0xff5533, 0.45).fillCircle(8, 8, 8)
    g.fillStyle(0xffdd66, 1).fillCircle(8, 8, 4)
    g.generateTexture('ebullet', 16, 16); g.destroy()

    // 向きインジケータ(小さな三角)
    g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0xffffff, 1)
    g.fillTriangle(0, 0, 0, 12, 10, 6)
    g.generateTexture('faceInd', 10, 12); g.destroy()
  }

  drawGround() {
    if (this.art('grass') === 'grass_png') {
      // 草原画像はワールド全体に敷き詰める(TileSpriteでタイル繰り返し)
      const ts = this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'grass_png').setOrigin(0).setDepth(0)
      // 元画像が大きいので縮小して細かい草が見えるように
      const src = this.textures.get('grass_png').getSourceImage()
      ts.setTileScale(384 / src.width, 384 / src.height)
    } else {
      for (let y = 0; y < WORLD_H; y += 32)
        for (let x = 0; x < WORLD_W; x += 32)
          this.add.image(x, y, 'grass').setOrigin(0).setDepth(0)
    }

    // --- ボス区画(右上)。地面を赤黒く染めて境界線を引く ---
    const z = BOSS_ZONE
    this.add.rectangle(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, 0x661111, 0.22).setDepth(1)
    const gfx = this.add.graphics().setDepth(1)
    gfx.lineStyle(3, 0xff4444, 0.5).strokeRect(z.x, z.y, z.w, z.h)
    this.add.text(z.x + z.w / 2, z.y + z.h - 18, '⚠ ボスのすみか', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ff9b9b',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(1)
  }

  // 座標がボス区画内か(margin>0で区画を広げて判定)
  inBossZone(x, y, margin = 0) {
    const z = BOSS_ZONE
    return x > z.x - margin && x < z.x + z.w + margin && y > z.y - margin && y < z.y + z.h + margin
  }

  spawnSlime() {
    // ボス区画の中に雑魚は湧かせない
    let x, y, tries = 0
    do {
      x = Phaser.Math.Between(100, WORLD_W - 100)
      y = Phaser.Math.Between(100, WORLD_H - 100)
      tries++
    } while (this.inBossZone(x, y, 60) && tries < 25)
    const key = this.spriteKey('slime')
    const s = this.slimes.create(x, y, key)
    s.setDepth(5)
    if (key !== 'slime') {
      s.setDisplaySize(40, 40)
      s.body.setSize(s.width * 0.6, s.height * 0.6, true)
    }
    s.hp = 30
    s.hpMax = 30
    s.expReward = 15
    // ゆっくり徘徊
    s.wanderTimer = 0
    // ぷるぷる(常時のスクワッシュ＆ストレッチでスライムらしさ)
    s.setOrigin(0.5, 0.85)
    s.bounce = this.tweens.add({
      targets: s, scaleY: s.scaleY * 0.82, scaleX: s.scaleX * 1.08,
      duration: Phaser.Math.Between(420, 620), yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
  }

  // --- ボス出現。雑魚スライムの巨大赤色版 [ART]専用ドット絵に差し替え予定 ---
  spawnBoss() {
    const z = BOSS_ZONE
    const key = this.spriteKey('slime')
    const b = this.physics.add.image(z.x + z.w / 2, z.y + z.h / 2, key)
    b.setDepth(6).setDisplaySize(130, 130).setTint(0xff7766)
    b.setOrigin(0.5, 0.8)
    b.setCollideWorldBounds(true)
    b.body.setSize(b.width * 0.5, b.height * 0.4, true)
    b.isBoss = true
    b.hp = BOSS.hp
    b.hpMax = BOSS.hp
    b.expReward = BOSS.expReward
    b.aggro = false
    b.nextAtk = 0
    b.atkIdx = 0
    b.lastAttack = 0
    b.bounce = this.tweens.add({
      targets: b, scaleY: b.scaleY * 0.9, scaleX: b.scaleX * 1.06,
      duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
    this.boss = b
  }

  // 生きている敵(雑魚＋ボス)をまとめて返す
  getTargets() {
    const arr = this.slimes.getChildren().filter((s) => s && s.active)
    if (this.boss && this.boss.active) arr.push(this.boss)
    return arr
  }

  update(time, delta) {
    // ミニマップ用の座標を間引いて配信(毎フレームは重いので150ms毎)
    if (time - this.lastMapEmit > 150) { this.lastMapEmit = time; this.emitMap() }
    // HUD(スキルCTの残り時間表示)も間引いて配信
    if (time - this.lastHudEmit > 120) { this.lastHudEmit = time; this.emitHud() }
    this.updateHeroVisual(delta) // 見た目を物理ボディに追従＋歩行バウンド
    this.updateFaceInd()
    this.updateProjectiles(time, delta) // 衝撃波・敵弾は死んでても飛び続ける
    if (this.dead) return
    if (this.dashUntil > time) this.updateDash(time)
    else if (this.autoMode) this.handleAuto()
    else this.handleMovement()
    this.handleWander(delta)
    this.updateBoss(time)
    this.handleEnemyAttacks(time)
    // MPの自然回復(1秒に+2、上限まで)
    this.mpAccum += delta
    if (this.mpAccum >= 500 && this.state.mp < this.state.mpMax) {
      this.mpAccum = 0
      this.state.mp = Math.min(this.state.mpMax, this.state.mp + 1)
    }
    // コンボの時間切れ
    if (this.combo > 0 && time - this.lastKill > COMBO_TIMEOUT) {
      this.combo = 0
      this.emitHud()
    }
  }

  // ミニマップ用：ワールドサイズ・自分・敵・ボスの座標をReactへ
  emitMap() {
    if (!this.player) return
    const enemies = []
    this.slimes.getChildren().forEach((s) => {
      if (s && s.active) enemies.push({ x: Math.round(s.x), y: Math.round(s.y) })
    })
    window.dispatchEvent(new CustomEvent('arpg-map', { detail: {
      worldW: WORLD_W, worldH: WORLD_H,
      player: { x: Math.round(this.player.x), y: Math.round(this.player.y) },
      enemies,
      boss: (this.boss && this.boss.active) ? { x: Math.round(this.boss.x), y: Math.round(this.boss.y) } : null,
      zone: BOSS_ZONE,
    } }))
  }

  // 見た目スプライトを物理ボディへ追従。移動中はぴょこぴょこ跳ねる。
  // ※回転(angle)は攻撃/被弾/死亡のtweenが持つので、ここでは触らない(競合回避)。
  updateHeroVisual(delta) {
    if (!this.hero || !this.player) return
    const v = this.player.body.velocity
    const speed = Math.hypot(v.x, v.y)
    let bobY = 0
    if (!this.dead && speed > 5) {
      this.walkPhase += delta * 0.02
      bobY = -Math.abs(Math.sin(this.walkPhase)) * 6 // 接地→ジャンプの上下動
      // 横移動の向きで左右反転(右=反転/左=反転なし)。ほぼ真上下なら現状維持。
      if (v.x > 5) this.hero.setFlipX(true)
      else if (v.x < -5) this.hero.setFlipX(false)
    } else {
      this.walkPhase = 0
    }
    this.hero.x = this.player.x + this.lunge.x
    this.hero.y = this.player.y + this.lunge.y + bobY
  }

  // 足元の向き矢印。攻撃/スキルが飛ぶ方向を常に見えるように
  updateFaceInd() {
    if (!this.faceInd || !this.player) return
    const a = this.facingAngle ?? 0
    this.faceInd.setVisible(!this.dead)
    this.faceInd.x = this.player.x + Math.cos(a) * 36
    this.faceInd.y = this.player.y + Math.sin(a) * 36 + 6
    this.faceInd.rotation = a
  }

  handleMovement() {
    const k = this.keys
    let vx = 0, vy = 0
    if (k.A.isDown || k.LEFT.isDown) vx = -1
    if (k.D.isDown || k.RIGHT.isDown) vx = 1
    if (k.W.isDown || k.UP.isDown) vy = -1
    if (k.S.isDown || k.DOWN.isDown) vy = 1

    if (vx === 0 && vy === 0) {
      // キー入力が無ければ左半分のバーチャルパッドの値を使う
      vx = controls.moveX
      vy = controls.moveY
    }
    const len = Math.hypot(vx, vy)
    if (len < 0.01) { this.player.setVelocity(0, 0); return }
    // 動いている向きを覚えておく(攻撃・スキルの発動方向になる)
    this.facingAngle = Math.atan2(vy, vx)
    this.player.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED)
  }

  // オート戦闘：一定距離内で一番近い敵へ接近し、射程に入ったら自動攻撃
  handleAuto() {
    let target = null, best = Infinity
    for (const s of this.getTargets()) {
      // ボスは体が大きいので実効距離を縮めて評価
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y) - (s.isBoss ? 45 : 0)
      if (d < best) { best = d; target = s }
    }
    // 近くに敵がいなければ追わずその場待機(マップ端まで走って壁にこすりつくのを防ぐ)
    if (!target || best > AUTO_ENGAGE_RANGE) { this.player.setVelocity(0, 0); return }
    const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y)
    this.facingAngle = ang
    // 中距離なら衝撃波も使う(CT/MPが許せば)
    if (best < 420 && best > ATTACK_RANGE && this.skillReady('wave') && this.state.mp >= SKILLS.wave.mp) {
      this.trySkill('wave')
    }
    if (best > ATTACK_RANGE - 8) {
      // まだ遠い→近づく
      this.player.setVelocity(Math.cos(ang) * PLAYER_SPEED, Math.sin(ang) * PLAYER_SPEED)
    } else {
      // 射程内→止まって攻撃(クールタイムはtryAttack側で制御)
      this.player.setVelocity(0, 0)
      this.tryAttack()
    }
  }

  handleWander(delta) {
    this.slimes.getChildren().forEach((s) => {
      if (!s || !s.active) return
      s.wanderTimer -= delta
      if (s.wanderTimer <= 0) {
        s.wanderTimer = Phaser.Math.Between(800, 2000)
        s.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(-30, 30))
      }
    })
  }

  // ============================================================
  // 攻撃・スキル(すべて「向いている方向」基準)
  // ============================================================

  // 通常攻撃：今向いている方向へ扇状になぎ払い。扇の中の敵すべてに当たる。
  tryAttack() {
    if (this.dead) return
    const time = this.time.now
    if (time - this.lastAttack < ATTACK_INTERVAL) return
    this.lastAttack = time

    // 攻撃方向は常に「今向いている方向」(移動 or 最後に向いた向き。初期は右)
    const ang = this.facingAngle ?? 0
    this.playAttackFx(ang)

    // 射程内かつ扇の内側にいる敵を全員ヒット(ボスは体が大きいので射程を延長)
    for (const s of this.getTargets()) {
      const reach = ATTACK_RANGE + (s.isBoss ? 45 : 0)
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y)
      if (d > reach) continue
      // 向いてる方向からの角度差が扇の半角以内なら命中(それ以外＝横/背後はスカ)
      const toEnemy = Phaser.Math.Angle.Between(this.player.x, this.player.y, s.x, s.y)
      if (Math.abs(Phaser.Math.Angle.Wrap(toEnemy - ang)) > ATTACK_ARC) continue
      this.damageEnemy(s, Phaser.Math.Between(8, 14))
    }
  }

  // --- スキル発動の入口。CT/MPをチェックして各スキルへ ---
  skillReady(key) {
    return this.time.now >= (this.cdUntil[key] || 0)
  }

  trySkill(key) {
    if (this.dead) return
    if (this.dashUntil > this.time.now) return // ダッシュ中は他スキル不可
    const cfg = SKILLS[key]
    if (!cfg || !this.skillReady(key)) return
    if (this.state.mp < cfg.mp) {
      this.showFloatText(this.player.x, this.player.y - 26, 'MP不足', '#7fb6ff', 13)
      return
    }
    this.state.mp -= cfg.mp
    this.cdUntil[key] = this.time.now + cfg.cd
    if (key === 'wave') this.castWave()
    else if (key === 'dash') this.castDash()
    this.emitHud()
  }

  // スキル1「衝撃波」：向いている方向へ直線に飛ぶ貫通弾
  castWave() {
    const ang = this.facingAngle ?? 0
    if (Math.abs(Math.cos(ang)) > 0.2) this.hero.setFlipX(Math.cos(ang) > 0)
    // 発射の反動(少し後ろへ引いて戻す)
    this.tweens.killTweensOf(this.lunge)
    this.lunge.x = -Math.cos(ang) * 8
    this.lunge.y = -Math.sin(ang) * 8
    this.tweens.add({ targets: this.lunge, x: 0, y: 0, duration: 160, ease: 'Quad.easeOut' })

    const spr = this.add.image(
      this.player.x + Math.cos(ang) * 26,
      this.player.y + Math.sin(ang) * 26 - 6,
      'wave',
    ).setDepth(20).setRotation(ang).setScale(0.9)
    this.tweens.add({ targets: spr, scale: 1.3, duration: WAVE_LIFE }) // 飛びながら少し育つ
    this.waves.push({ spr, vx: Math.cos(ang) * WAVE_SPEED, vy: Math.sin(ang) * WAVE_SPEED, born: this.time.now, hit: new Set() })
  }

  // スキル2「疾風斬」：向いている方向へ直線ダッシュ。経路上の敵にダメージ＋無敵。
  castDash() {
    const ang = this.facingAngle ?? 0
    if (Math.abs(Math.cos(ang)) > 0.2) this.hero.setFlipX(Math.cos(ang) > 0)
    const now = this.time.now
    this.dashUntil = now + DASH_TIME
    this.dashAng = ang
    this.dashHit = new Set()
    this.lastTrail = 0
    this.invulnUntil = Math.max(this.invulnUntil, this.dashUntil + 80) // ダッシュ中＋直後は無敵
    this.cameras.main.shake(120, 0.003)
  }

  // ダッシュ中の毎フレーム処理：高速移動＋残像＋経路上の敵にヒット
  updateDash(time) {
    this.player.setVelocity(Math.cos(this.dashAng) * DASH_SPEED, Math.sin(this.dashAng) * DASH_SPEED)
    // 残像
    if (time - this.lastTrail > 40) {
      this.lastTrail = time
      const t = this.add.image(this.hero.x, this.hero.y, this.hero.texture.key)
        .setDepth(9).setDisplaySize(64, 64).setFlipX(this.hero.flipX)
        .setAlpha(0.4).setTint(0x88ccff)
      t.setOrigin(0.5, 0.62)
      this.tweens.add({ targets: t, alpha: 0, duration: 220, onComplete: () => t.destroy() })
    }
    // 経路上の敵にヒット(1回のダッシュで同じ敵には1回だけ)
    for (const s of this.getTargets()) {
      if (this.dashHit.has(s)) continue
      const rad = s.isBoss ? 75 : 48
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y) < rad) {
        this.dashHit.add(s)
        this.damageEnemy(s, Phaser.Math.Between(14, 20))
      }
    }
  }

  // 衝撃波(貫通弾)と敵弾の移動＆命中判定
  updateProjectiles(time, delta) {
    const dt = delta / 1000
    // --- 自分の衝撃波 ---
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]
      w.spr.x += w.vx * dt
      w.spr.y += w.vy * dt
      for (const s of this.getTargets()) {
        if (w.hit.has(s)) continue
        const rad = s.isBoss ? 62 : 34
        if (Phaser.Math.Distance.Between(w.spr.x, w.spr.y, s.x, s.y) < rad) {
          w.hit.add(s) // 貫通(同じ敵には1回だけ)
          this.damageEnemy(s, Phaser.Math.Between(16, 24))
        }
      }
      const out = w.spr.x < -40 || w.spr.x > WORLD_W + 40 || w.spr.y < -40 || w.spr.y > WORLD_H + 40
      if (time - w.born > WAVE_LIFE || out) {
        w.spr.destroy()
        this.waves.splice(i, 1)
      }
    }
    // --- 敵弾 ---
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.spr.x += b.vx * dt
      b.spr.y += b.vy * dt
      let gone = time - b.born > 2800
      if (!this.dead && Phaser.Math.Distance.Between(b.spr.x, b.spr.y, this.player.x, this.player.y) < 24) {
        this.damagePlayer(BOSS.bulletDmg)
        gone = true
      }
      if (gone) {
        b.spr.destroy()
        this.bullets.splice(i, 1)
      }
    }
  }

  // 攻撃モーション：向く→前に踏み込む→斬撃エフェクト
  playAttackFx(ang) {
    // 攻撃方向に向く(横成分があれば左右反転)
    if (Math.abs(Math.cos(ang)) > 0.2) this.hero.setFlipX(Math.cos(ang) > 0)

    // 踏み込み：見た目を前方へグイッと出して戻す(物理と分離したので自由に動かせる)
    this.tweens.killTweensOf(this.lunge)
    this.lunge.x = Math.cos(ang) * 16
    this.lunge.y = Math.sin(ang) * 16
    this.tweens.add({ targets: this.lunge, x: 0, y: 0, duration: 180, ease: 'Back.easeOut' })
    // ※以前あったスケール伸び演出は、向き切替のsetDisplaySizeと競合してサイズがズレる
    //   バグの原因だったので撤去。迫力は踏み込み(lunge)＋斬撃で表現する。

    // 斬撃の三日月：前方に大きく出して、振り抜くように回転＋フェード
    const sx = this.player.x + Math.cos(ang) * 30
    const sy = this.player.y + Math.sin(ang) * 30
    const slash = this.add.image(sx, sy, 'slash')
      .setDepth(20).setRotation(ang - 0.9).setScale(0.6).setAlpha(1)
    this.tweens.add({
      targets: slash,
      rotation: ang + 0.9, scale: 1.7, alpha: 0,
      duration: 240, ease: 'Cubic.easeOut',
      onComplete: () => slash.destroy(),
    })
  }

  // ============================================================
  // ダメージ処理(敵側)
  // ============================================================

  // 敵1体へのダメージ＋被弾リアクション。雑魚/ボス共通。
  damageEnemy(s, dmg) {
    if (!s || !s.active) return
    s.hp -= dmg
    this.showDamage(s.x, s.y, dmg)
    // 被弾リアクション：白く点滅(ボスは元の赤に戻す)
    s.setTint(0xffffff)
    this.time.delayedCall(80, () => {
      if (!s.active) return
      if (s.isBoss) s.setTint(0xff7766)
      else s.clearTint()
    })
    // 雑魚だけのけぞりスケール(ボスは常時ぷるぷるtweenと競合するので省略)
    if (!s.isBoss) this.tweens.add({ targets: s, scale: '*=1.25', duration: 60, yoyo: true })

    if (s.hp <= 0) {
      if (s.isBoss) this.killBoss()
      else this.killSlime(s)
    }
  }

  killSlime(s) {
    this.combo += 1
    this.lastKill = this.time.now
    this.gainExp(s.expReward)
    this.showFloatText(s.x, s.y - 16, `+${s.expReward} EXP`, '#ffe87a')
    this.deathPoof(s.x, s.y, 0x8fe06f, 7)
    this.tweens.killTweensOf(s)
    s.destroy()
    // 倒した分また湧かす
    this.time.delayedCall(800, () => this.spawnSlime())
    this.emitHud()
  }

  killBoss() {
    const b = this.boss
    if (!b) return
    this.combo += 1
    this.lastKill = this.time.now
    this.gainExp(b.expReward)
    this.showFloatText(b.x, b.y - 50, `${BOSS.name} 討伐！ +${b.expReward} EXP`, '#ffd23f', 18)
    this.deathPoof(b.x, b.y, 0xff8877, 16)
    this.cameras.main.shake(300, 0.01)
    this.tweens.killTweensOf(b)
    b.destroy()
    this.boss = null
    // しばらくして再出現
    this.time.delayedCall(BOSS.respawnMs, () => { if (!this.boss) this.spawnBoss() })
    this.emitHud()
  }

  // 撃破エフェクト：小さな粒が飛び散る
  deathPoof(x, y, color, n = 7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const d = 20 + Math.random() * 34
      const c = this.add.circle(x, y, 3 + Math.random() * 3, color, 0.9).setDepth(19)
      this.tweens.add({
        targets: c, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0,
        duration: 320 + Math.random() * 160, onComplete: () => c.destroy(),
      })
    }
  }

  // ============================================================
  // ボスAI：区画内で待機→侵入でアグロ→追跡＋踏みつけ/弾幕を交互に
  // ============================================================
  updateBoss(time) {
    const b = this.boss
    if (!b || !b.active) return
    const z = BOSS_ZONE
    const playerIn = this.inBossZone(this.player.x, this.player.y, 90) && !this.dead

    if (!b.aggro && playerIn) {
      b.aggro = true
      b.nextAtk = time + 2200
      this.showFloatText(b.x, b.y - 80, '！！', '#ff5555', 26)
      this.cameras.main.shake(180, 0.004)
    } else if (b.aggro && !playerIn) {
      b.aggro = false // 区画から離れたら追わない(リセット)
    }

    if (b.aggro) {
      const d = Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y)
      const ang = Phaser.Math.Angle.Between(b.x, b.y, this.player.x, this.player.y)
      if (d > 70) b.setVelocity(Math.cos(ang) * 65, Math.sin(ang) * 65)
      else b.setVelocity(0, 0)
      // 踏みつけ→弾幕を交互に
      if (time > b.nextAtk) {
        b.nextAtk = time + Phaser.Math.Between(3400, 4300)
        if (b.atkIdx++ % 2 === 0) this.bossSlam()
        else this.bossRing()
      }
    } else {
      // 巣の中央へゆっくり戻る
      const cx = z.x + z.w / 2, cy = z.y + z.h / 2
      const d = Phaser.Math.Distance.Between(b.x, b.y, cx, cy)
      if (d > 30) {
        const ang = Phaser.Math.Angle.Between(b.x, b.y, cx, cy)
        b.setVelocity(Math.cos(ang) * 40, Math.sin(ang) * 40)
      } else {
        b.setVelocity(0, 0)
      }
    }
    // ボスは区画から出ない
    b.x = Phaser.Math.Clamp(b.x, z.x + 50, z.x + z.w - 50)
    b.y = Phaser.Math.Clamp(b.y, z.y + 50, z.y + z.h - 50)
  }

  // ボス攻撃1「踏みつけ」：プレイヤーの足元に予兆(赤円)→0.9秒後に炸裂
  bossSlam() {
    const tx = this.player.x, ty = this.player.y
    const R = BOSS.slamRadius
    const tel = this.add.circle(tx, ty, R, 0xff3333, 0.18).setDepth(2)
    const ring = this.add.circle(tx, ty, R, 0x000000, 0).setStrokeStyle(3, 0xff5555, 0.8).setDepth(2)
    this.tweens.add({ targets: tel, alpha: 0.38, duration: 240, yoyo: true, repeat: 2 })
    // ボスが跳ぶ演出
    if (this.boss?.active) {
      this.tweens.add({ targets: this.boss, y: this.boss.y - 40, duration: 430, yoyo: true, ease: 'Quad.easeOut' })
    }
    this.time.delayedCall(900, () => {
      tel.destroy(); ring.destroy()
      // 炸裂
      const boom = this.add.circle(tx, ty, 20, 0xffaa66, 0.7).setDepth(20)
      this.tweens.add({ targets: boom, radius: R, alpha: 0, duration: 280, onComplete: () => boom.destroy() })
      this.cameras.main.shake(200, 0.008)
      if (!this.dead && Phaser.Math.Distance.Between(this.player.x, this.player.y, tx, ty) <= R) {
        this.damagePlayer(BOSS.slamDmg)
      }
    })
  }

  // ボス攻撃2「弾幕」：全方位8方向に弾をばらまく
  bossRing() {
    const b = this.boss
    if (!b || !b.active) return
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8
      const spr = this.add.image(b.x, b.y - 24, 'ebullet').setDepth(15)
      this.bullets.push({ spr, vx: Math.cos(a) * BOSS.bulletSpeed, vy: Math.sin(a) * BOSS.bulletSpeed, born: this.time.now })
    }
    this.showFloatText(b.x, b.y - 90, '弾幕！', '#ffb0a0', 13)
  }

  // ============================================================
  // ダメージ処理(プレイヤー側)
  // ============================================================

  // 敵の攻撃：接触中の敵が一定間隔でこちらにダメージ
  handleEnemyAttacks(time) {
    this.slimes.getChildren().forEach((s) => {
      if (!s || !s.active) return
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y)
      if (d > ENEMY_ATTACK_RANGE) return
      if (time - (s.lastAttack || 0) < ENEMY_ATTACK_INTERVAL) return
      s.lastAttack = time
      const dmg = Phaser.Math.Between(4, 8)
      this.damagePlayer(dmg)
    }, this)
    // ボスの接触攻撃(体が大きいので判定広め・ダメージ大)
    const b = this.boss
    if (b && b.active && b.aggro) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y)
      if (d < 78 && time - (b.lastAttack || 0) > 1100) {
        b.lastAttack = time
        this.damagePlayer(BOSS.contactDmg)
      }
    }
  }

  damagePlayer(dmg) {
    if (this.dead) return
    const now = this.time.now
    if (now < this.invulnUntil) return // 被弾直後/ダッシュ中の無敵
    this.invulnUntil = now + HIT_INVULN
    this.state.hp = Math.max(0, this.state.hp - dmg)
    this.showFloatText(this.player.x, this.player.y - 18, String(dmg), '#ff6b6b', 14)
    // 被弾フラッシュ(赤く明滅)＋のけぞり
    this.hero.setTint(0xff3b3b).setTintMode(Phaser.TintModes.FILL)
    this.time.delayedCall(110, () => { if (this.hero) this.hero.clearTint() })
    this.tweens.add({ targets: this.hero, angle: { from: -12, to: 0 }, duration: 200, ease: 'Quad.easeOut' })
    this.emitHud()
    if (this.state.hp <= 0) this.onDeath()
  }

  onDeath() {
    this.dead = true
    this.player.setVelocity(0, 0)
    this.dashUntil = 0
    this.showFloatText(this.player.x, this.player.y - 30, 'やられた…', '#ff5555', 22)
    this.cameras.main.shake(250, 0.01)
    // 倒れる演出(回転＋半透明)
    this.tweens.add({ targets: this.hero, angle: 90, alpha: 0.4, duration: 300 })
    this.time.delayedCall(1500, () => {
      // 復活：HP全回復・中央へ戻る・コンボリセット
      this.dead = false
      this.state.hp = this.state.hpMax
      this.combo = 0
      this.player.setPosition(800, 600)
      this.hero.setAngle(0).setAlpha(1).clearTint()
      this.emitHud()
    })
  }

  gainExp(amount) {
    this.state.exp += amount
    while (this.state.exp >= this.state.expNext) {
      this.state.exp -= this.state.expNext
      this.state.level += 1
      this.state.expNext = Math.floor(this.state.expNext * 1.4)
      this.state.hpMax += 20
      this.state.hp = this.state.hpMax
      this.showFloatText(this.player.x, this.player.y - 30, 'LEVEL UP!', '#ffd23f', 22)
    }
  }

  // ---- 表示ヘルパー ----
  showDamage(x, y, dmg) {
    this.showFloatText(x, y - 10, String(dmg), '#ffffff', 14)
  }

  showFloatText(x, y, text, color, size = 16) {
    const t = this.add.text(x, y, text, {
      fontFamily: 'monospace', fontSize: `${size}px`, color, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(100)
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() })
  }

  // React側HUDへ現在値を通知（window CustomEvent経由＝疎結合）
  emitHud() {
    const now = this.time?.now ?? 0
    const skills = {}
    for (const k of Object.keys(SKILLS)) {
      skills[k] = {
        cdLeft: Math.max(0, (this.cdUntil[k] || 0) - now),
        cdTotal: SKILLS[k].cd,
        mp: SKILLS[k].mp,
      }
    }
    const b = this.boss
    const boss = (b && b.active && b.aggro) ? { name: BOSS.name, hp: Math.max(0, b.hp), hpMax: b.hpMax } : null
    window.dispatchEvent(new CustomEvent('arpg-hud', { detail: {
      level: this.state.level, exp: this.state.exp, expNext: this.state.expNext,
      hp: this.state.hp, hpMax: this.state.hpMax,
      mp: this.state.mp, mpMax: this.state.mpMax, combo: this.combo,
      skills, boss,
    } }))
  }
}
