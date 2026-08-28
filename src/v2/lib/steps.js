// 加速度センサーから歩数を取り出す。
// ★別プロジェクト「歩くRPG」(Desktop/walk-rpg) の src/lib/steps.js をそのまま持ってきたもの。
//   実機で動いている実績があるので、判定のロジックには手を入れていない。
//   直すときは向こうと揃えること（テストも同じものが src/v2/lib/steps.test.js にある）。

// 加速度センサーの生データから「歩数」を取り出す。
//
// 「手を軽く振っただけ」を弾くため、歩数計(iPhoneのヘルスケア等)が使う考え方に寄せてある。
//
//   1. 重力ベクトルを推定し、加速度をその軸へ投影する
//      → 上下動だけを見る。手を横に振る/端末をひねる動きはほぼ0になる
//   2. 投影した波を約3Hzでローパス
//      → 歩行(1〜3歩/秒)より速い小刻みな揺れを潰す
//   3. しきい値を超えた山を「歩の候補」とし、間隔が歩行のテンポ帯
//      (MIN_STEP_MS〜MAX_STEP_MS = 毎分55〜180歩)から外れたら却下
//   4. 一定リズムの候補が streakRequired 回続いて初めて「歩行中」と判定し、
//      そこまでの歩数をまとめて計上する。以降は歩行が途切れるまで1歩ずつ計上
//      → 単発の揺れ・数回のブンブンは0歩のまま。逆に歩き出しの数歩も取りこぼさない
//
// 加速度の単位は m/s^2。

/** 1歩の最短間隔[ms] = 毎分180歩。これより速い振動は歩行ではない */
export const MIN_STEP_MS = 330
/** 1歩の最長間隔[ms] = 毎分55歩。これより遅ければ歩行が途切れたとみなす */
export const MAX_STEP_MS = 1100

export const STRICTNESS = {
  loose: {
    threshold: 1.0,
    streakRequired: 3,
    tolerance: 0.45,
    label: 'ゆるい（すり足やゆっくり歩きも拾う）',
  },
  normal: {
    threshold: 1.6,
    streakRequired: 5,
    tolerance: 0.35,
    label: '標準（数歩続けて歩くと数え始める）',
  },
  strict: {
    threshold: 2.2,
    streakRequired: 7,
    tolerance: 0.28,
    label: '厳しい（しっかり歩いた時だけ数える）',
  },
}

export function createStepDetector(options = {}) {
  const preset = STRICTNESS[options.strictness] || STRICTNESS.normal
  const {
    threshold = preset.threshold,
    streakRequired = preset.streakRequired,
    tolerance = preset.tolerance,
    minInterval = MIN_STEP_MS,
    maxInterval = MAX_STEP_MS,
    // 重力推定のローパス。60Hz で時定数 ≒ 0.8秒
    gravityAlpha = 0.02,
    // 上下動のローパス。60Hz でカットオフ ≒ 3Hz
    smoothAlpha = 0.3,
  } = options

  let gravity = null
  let vertical = 0
  let armed = true
  let lastPeakAt = -Infinity
  let intervals = []
  let streak = 0
  let walking = false
  let count = 0

  function breakRhythm() {
    intervals = []
    streak = 0
    walking = false
  }

  return {
    /**
     * 加速度サンプルを1件投入し、確定した歩数を返す。
     * 歩行と判定された瞬間は、それまで溜めていたぶんをまとめて返す。
     * @param {{x:number,y:number,z:number}} acc 重力込みの加速度
     * @param {number} t タイムスタンプ[ms]
     */
    push(acc, t) {
      if (!acc) return 0
      const { x, y, z } = acc
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0

      if (gravity === null) {
        gravity = { x, y, z }
        return 0
      }
      gravity.x += (x - gravity.x) * gravityAlpha
      gravity.y += (y - gravity.y) * gravityAlpha
      gravity.z += (z - gravity.z) * gravityAlpha

      const gn = Math.sqrt(gravity.x ** 2 + gravity.y ** 2 + gravity.z ** 2)
      // 重力が見えない(= gravity 抜きのデータ)場合は上下方向を特定できないので数えない
      if (gn < 3) return 0

      // 重力軸へ投影して重力ぶんを引く = 上下方向の加速度
      const projected = (x * gravity.x + y * gravity.y + z * gravity.z) / gn - gn
      vertical += (projected - vertical) * smoothAlpha

      // 山の立ち上がりだけを拾う(戻りきるまで次を見ない)
      if (!armed) {
        if (vertical < threshold * 0.4) armed = true
        return 0
      }
      if (vertical <= threshold) return 0
      armed = false

      const dt = t - lastPeakAt
      lastPeakAt = t

      if (dt < minInterval) {
        // 速すぎる = 小刻みな揺れ。リズムを崩して歩行判定を解除する
        breakRhythm()
        return 0
      }
      if (dt > maxInterval) {
        // 間が空きすぎ = 歩行が途切れた。ここを歩き出しの1歩目として数え直す
        intervals = []
        streak = 1
        walking = false
        return 0
      }

      const med = median(intervals)
      if (med !== null && Math.abs(dt - med) / med > tolerance) {
        // テンポが急に変わった
        if (walking) {
          // 歩行中なら継続扱い(信号待ちの歩き直し等で取りこぼさない)
          intervals = [dt]
          count++
          return 1
        }
        intervals = [dt]
        streak = 1
        return 0
      }

      intervals.push(dt)
      if (intervals.length > 4) intervals.shift()
      streak++

      if (walking) {
        count++
        return 1
      }
      if (streak >= streakRequired) {
        walking = true
        count += streak
        return streak
      }
      return 0
    },

    /** 歩行中と判定されているか(UI表示用)。now を渡すと歩行の途切れも見る */
    isWalking(now) {
      if (!walking) return false
      if (!Number.isFinite(now)) return true
      return now - lastPeakAt <= maxInterval
    },

    get count() {
      return count
    },

    reset() {
      gravity = null
      vertical = 0
      armed = true
      lastPeakAt = -Infinity
      intervals = []
      streak = 0
      walking = false
      count = 0
    },
  }
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** iOS 13+ は明示的な許可(ユーザー操作起点)が要る */
export function needsMotionPermission() {
  return (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function'
  )
}
