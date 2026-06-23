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
  }

  preload() {
    // [ART] public/action-rpg/hero.png があれば読む。無くてもエラーにせず四角で動かす。
    //   本番で4方向歩きにするときは spritesheet に差し替え:
    //   this.load.spritesheet('hero', '/action-rpg/hero.png', { frameWidth: 48, frameHeight: 48 })
    // public/ に置いた画像があれば使う。無くてもエラーにせず四角/丸で動かす。
    // key(name) → 実ファイルの対応。差し替えるときはここを変える。
    this.missingArt = new Set()
    const ART_FILES = { hero: '/syoumen.png', slime: '/2dsuraimu.png', grass: '/2dheigen.png' }
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

  create() {
    this.generateTextures()
    this.drawGround()

    // --- プレイヤー ---
    const heroKey = this.art('hero')
    this.player = this.physics.add.image(800, 600, heroKey)
    this.player.setDepth(10).setCollideWorldBounds(true)
    if (heroKey === 'hero_png') {
      // 高解像度の1枚絵は当たり判定用に小さく表示(後でドット絵スプライトに差し替え予定)
      this.player.setDisplaySize(48, 48)
      this.player.body.setSize(this.player.width * 0.45, this.player.height * 0.45, true)
    }

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

    // 斬撃エフェクト(白い三日月)
    g = this.make.graphics({ x: 0, y: 0 })
    g.lineStyle(5, 0xffffff, 1)
    g.beginPath()
    g.arc(24, 24, 20, Phaser.Math.DegToRad(-55), Phaser.Math.DegToRad(55), false)
    g.strokePath()
    g.generateTexture('slash', 48, 48); g.destroy()
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
    const key = this.art('slime')
    const s = this.slimes.create(x, y, key)
    s.setDepth(5)
    if (key === 'slime_png') {
      s.setDisplaySize(34, 34)
      s.body.setSize(s.width * 0.6, s.height * 0.6, true)
    }
    s.hp = 30
    s.hpMax = 30
    s.expReward = 15
    // ゆっくり徘徊
    s.wanderTimer = 0
  }

  update(time, delta) {
    // ミニマップ用の座標を間引いて配信(毎フレームは重いので150ms毎)
    if (time - this.lastMapEmit > 150) { this.lastMapEmit = time; this.emitMap() }
    if (this.dead) return
    this.handleMovement()
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

  // 攻撃モーション：指定方向に向く→スケール→斬撃エフェクト
  playAttackFx(ang) {
    // 左右の向き(右向き素材を基準に、左ならフリップ)
    if (Math.abs(Math.cos(ang)) > 0.2) this.player.setFlipX(Math.cos(ang) < 0)

    // プレイヤーをキュッと一瞬大きく(相対=素材スケールに依存しない)
    // ※位置の踏み込みは物理ボディが毎フレーム上書きするので使わず、スケール＋斬撃で表現
    this.tweens.add({ targets: this.player, scale: '*=1.12', duration: 55, yoyo: true })

    // 斬撃の三日月：敵との間に出して、振り抜くように回転＋フェード
    const sx = this.player.x + Math.cos(ang) * 22
    const sy = this.player.y + Math.sin(ang) * 22
    const slash = this.add.image(sx, sy, 'slash')
      .setDepth(20).setRotation(ang - 0.5).setScale(0.5).setAlpha(0.95)
    this.tweens.add({
      targets: slash,
      rotation: ang + 0.6, scale: 1.25, alpha: 0,
      duration: 180, ease: 'Cubic.easeOut',
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
    // 被弾フラッシュ(赤く明滅)
    this.player.setTint(0xff3b3b).setTintMode(Phaser.TintModes.FILL)
    this.time.delayedCall(110, () => { if (this.player) this.player.clearTint() })
    this.emitHud()
    if (this.state.hp <= 0) this.onDeath()
  }

  onDeath() {
    this.dead = true
    this.player.setVelocity(0, 0)
    this.showFloatText(this.player.x, this.player.y - 30, 'やられた…', '#ff5555', 22)
    this.cameras.main.shake(250, 0.01)
    this.time.delayedCall(1500, () => {
      // 復活：HP全回復・中央へ戻る・コンボリセット
      this.dead = false
      this.state.hp = this.state.hpMax
      this.combo = 0
      this.player.setPosition(800, 600).clearTint()
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
