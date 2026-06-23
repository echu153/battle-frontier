import Phaser from 'phaser'
import { controls } from './controls'

// ============================================================
// アクションRPG 最小プロト — コアループだけ
//   移動 → クリック/タップで攻撃(HITコンボ) → 撃破でEXP → レベルアップ
//   敵に接触するとこちらもダメージを受ける(HP0でやられ→復活)
// 見た目は今はコード生成の四角/丸。後でドット絵に差し替える箇所には
//   [ART] というコメントを付けてある。
// ============================================================

const PLAYER_SPEED = 160       // プレイヤー移動速度(px/秒)
const ATTACK_RANGE = 60        // 攻撃が届く距離
const ATTACK_INTERVAL = 600    // 攻撃間隔(ms)＝クールタイム
const COMBO_TIMEOUT = 3000     // この時間倒さないとコンボ途切れる(ms)
const SLIME_COUNT = 8

const ENEMY_ATTACK_RANGE = 38   // 敵がこちらを殴れる距離(接触)
const ENEMY_ATTACK_INTERVAL = 900 // 敵の攻撃間隔(ms)

export default class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene')
  }

  init() {
    this.player = null
    this.slimes = null
    this.lastAttack = 0
    this.combo = 0
    this.lastKill = 0
    this.dead = false
    // セーブ対象になる進行データ（プロトなのでメモリのみ）
    this.state = { level: 1, exp: 0, expNext: 20, hp: 100, hpMax: 100, mp: 30, mpMax: 30 }
    this.lastMapEmit = 0
    this.mpAccum = 0
    this.facingAngle = 0 // 攻撃の向き(ラジアン、初期は右)
    this.autoMode = false // オート戦闘ON/OFF
  }

  preload() {
    // [ART] public/action-rpg/hero.png があれば読む。無くてもエラーにせず四角で動かす。
    //   本番で4方向歩きにするときは spritesheet に差し替え:
    //   this.load.spritesheet('hero', '/action-rpg/hero.png', { frameWidth: 48, frameHeight: 48 })
    // public/ に置いた画像があれば使う。無くてもエラーにせず四角/丸で動かす。
    // key(name) → 実ファイルの対応。差し替えるときはここを変える。
    this.missingArt = new Set()
    const ART_FILES = {
      hero: '/syoumen.png',        // 下(正面)
      up: '/4houmenusiro.png',     // 上(後ろ姿)
      left: '/4houmenhidari.png',  // 左
      right: '/4houmenmigi.png',   // 右
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
    for (const name of ['hero', 'up', 'left', 'right', 'slime']) {
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

    // 4方向テクスチャ。3方向の画像が揃っていれば向きで差し替える(無ければ正面のみ＝flip運用)
    this.dirKeys = {
      down: this.spriteKey('hero'), up: this.spriteKey('up'),
      left: this.spriteKey('left'), right: this.spriteKey('right'),
    }
    this.hasDir = ['up', 'left', 'right'].every(
      (n) => this.textures.exists(`${n}_png`) && !this.missingArt.has(`${n}_png`))
    this.curDir = 'down'

    // --- 敵(スライム) ---
    this.slimes = this.physics.add.group()
    for (let i = 0; i < SLIME_COUNT; i++) this.spawnSlime()

    // --- 入力 ---
    // 移動: PCはWASD/矢印、スマホは左半分のバーチャルパッド(controls.moveX/Y)。
    // 攻撃: 右半分のボタン or スペースキー(action('attack')をシーンがlisten)。
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE')
    this.input.keyboard.on('keydown-SPACE', () => this.tryAttack())
    this._onAction = (e) => {
      if (e.detail === 'attack') this.tryAttack()
      else if (e.detail === 'auto:on') this.autoMode = true
      else if (e.detail === 'auto:off') this.autoMode = false
      // 例: else if (e.detail === 'skill:heal') this.useHeal()  ← スキルはここに足す
    }
    window.addEventListener('arpg-action', this._onAction)
    this.events.once('shutdown', () => window.removeEventListener('arpg-action', this._onAction))

    // カメラはプレイヤー追従。世界はちょい広め。
    this.physics.world.setBounds(0, 0, 1600, 1200)
    this.cameras.main.setBounds(0, 0, 1600, 1200)
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
  }

  drawGround() {
    if (this.art('grass') === 'grass_png') {
      // 草原画像はワールド全体に敷き詰める(TileSpriteでタイル繰り返し)
      const ts = this.add.tileSprite(0, 0, 1600, 1200, 'grass_png').setOrigin(0).setDepth(0)
      // 元画像が大きいので縮小して細かい草が見えるように
      const src = this.textures.get('grass_png').getSourceImage()
      ts.setTileScale(384 / src.width, 384 / src.height)
    } else {
      for (let y = 0; y < 1200; y += 32)
        for (let x = 0; x < 1600; x += 32)
          this.add.image(x, y, 'grass').setOrigin(0).setDepth(0)
    }
  }

  spawnSlime() {
    const x = Phaser.Math.Between(100, 1500)
    const y = Phaser.Math.Between(100, 1100)
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

  update(time, delta) {
    // ミニマップ用の座標を間引いて配信(毎フレームは重いので150ms毎)
    if (time - this.lastMapEmit > 150) { this.lastMapEmit = time; this.emitMap() }
    this.updateHeroVisual(delta) // 見た目を物理ボディに追従＋歩行バウンド
    if (this.dead) return
    if (this.autoMode) this.handleAuto()
    else this.handleMovement()
    this.handleWander(delta)
    this.handleEnemyAttacks(time)
    // MPの自然回復(1秒に+2、上限まで)
    this.mpAccum += delta
    if (this.mpAccum >= 500 && this.state.mp < this.state.mpMax) {
      this.mpAccum = 0
      this.state.mp = Math.min(this.state.mpMax, this.state.mp + 1)
      this.emitHud()
    }
    // コンボの時間切れ
    if (this.combo > 0 && time - this.lastKill > COMBO_TIMEOUT) {
      this.combo = 0
      this.emitHud()
    }
  }

  // ミニマップ用：ワールドサイズ・自分・敵の座標をReactへ
  emitMap() {
    if (!this.player) return
    const enemies = []
    this.slimes.getChildren().forEach((s) => {
      if (s && s.active) enemies.push({ x: Math.round(s.x), y: Math.round(s.y) })
    })
    window.dispatchEvent(new CustomEvent('arpg-map', { detail: {
      worldW: 1600, worldH: 1200,
      player: { x: Math.round(this.player.x), y: Math.round(this.player.y) },
      enemies,
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
      // 移動方向で見た目の向きを切り替え
      if (this.hasDir) this.setHeroDir(this.dirFromAngle(Math.atan2(v.y, v.x)))
    } else {
      this.walkPhase = 0
    }
    this.hero.x = this.player.x + this.lunge.x
    this.hero.y = this.player.y + this.lunge.y + bobY
  }

  // 角度→4方向(down/up/left/right)。0=右, +y=下。
  dirFromAngle(a) {
    const c = Math.cos(a), s = Math.sin(a)
    if (Math.abs(c) > Math.abs(s)) return c > 0 ? 'right' : 'left'
    return s > 0 ? 'down' : 'up'
  }

  // 向きが変わった時だけテクスチャ差し替え(毎フレームsetTextureは無駄なので)
  setHeroDir(dir) {
    if (!this.hasDir || dir === this.curDir) return
    this.curDir = dir
    this.hero.setTexture(this.dirKeys[dir]).setFlipX(false)
    this.hero.setDisplaySize(64, 64) // テクスチャごとにサイズが違っても64pxに揃える
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
    // 動いている向きを覚えておく(敵がいない時の攻撃方向に使う)
    this.facingAngle = Math.atan2(vy, vx)
    this.player.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED)
  }

  // オート戦闘：一番近い敵へ接近し、射程に入ったら自動攻撃
  handleAuto() {
    let target = null, best = Infinity
    this.slimes.getChildren().forEach((s) => {
      if (!s || !s.active) return
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y)
      if (d < best) { best = d; target = s }
    })
    if (!target) { this.player.setVelocity(0, 0); return }
    const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y)
    this.facingAngle = ang
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

  // クリック/タップ or スペースで発動。常に斬撃モーションは出し、射程内に敵がいればダメージ。
  tryAttack() {
    if (this.dead) return
    const time = this.time.now
    if (time - this.lastAttack < ATTACK_INTERVAL) return
    this.lastAttack = time

    let target = null, best = ATTACK_RANGE
    this.slimes.getChildren().forEach((s) => {
      if (!s || !s.active) return
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y)
      if (d < best) { best = d; target = s }
    })

    // 攻撃方向：敵がいればその方向、いなければ最後に向いた方向(初期は右)
    const ang = target
      ? Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y)
      : (this.facingAngle ?? 0)
    this.playAttackFx(ang)

    if (!target) return // 空振り：エフェクトだけ

    const dmg = Phaser.Math.Between(8, 14)
    target.hp -= dmg
    this.showDamage(target.x, target.y, dmg)
    // 被弾リアクション：白く点滅＋少しのけぞる(相対スケール)
    target.setTint(0xffffff)
    this.time.delayedCall(80, () => { if (target.active) target.clearTint() })
    this.tweens.add({ targets: target, scale: '*=1.25', duration: 60, yoyo: true })

    if (target.hp <= 0) this.killSlime(target)
  }

  // 攻撃モーション：向く→前に踏み込む→キュッと伸び→斬撃エフェクト
  playAttackFx(ang) {
    // 攻撃方向に向く：4方向画像があればテクスチャ差し替え、無ければ左右フリップ
    if (this.hasDir) this.setHeroDir(this.dirFromAngle(ang))
    else if (Math.abs(Math.cos(ang)) > 0.2) this.hero.setFlipX(Math.cos(ang) < 0)

    // 踏み込み：見た目を前方へグイッと出して戻す(物理と分離したので自由に動かせる)
    this.tweens.killTweensOf(this.lunge)
    this.lunge.x = Math.cos(ang) * 16
    this.lunge.y = Math.sin(ang) * 16
    this.tweens.add({ targets: this.lunge, x: 0, y: 0, duration: 180, ease: 'Back.easeOut' })

    // 縦に伸びる踏み込みっぽいスケール(相対=素材スケールに依存しない)
    this.tweens.add({ targets: this.hero, scaleX: '*=1.18', scaleY: '*=0.9', duration: 70, yoyo: true })

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
  }

  damagePlayer(dmg) {
    if (this.dead) return
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

  killSlime(s) {
    this.combo += 1
    this.lastKill = this.time.now
    this.gainExp(s.expReward)
    this.showFloatText(s.x, s.y - 16, `+${s.expReward} EXP`, '#ffe87a')
    s.destroy()
    // 倒した分また湧かす
    this.time.delayedCall(800, () => this.spawnSlime())
    this.emitHud()
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
    window.dispatchEvent(new CustomEvent('arpg-hud', { detail: {
      level: this.state.level, exp: this.state.exp, expNext: this.state.expNext,
      hp: this.state.hp, hpMax: this.state.hpMax,
      mp: this.state.mp, mpMax: this.state.mpMax, combo: this.combo,
    } }))
  }
}
