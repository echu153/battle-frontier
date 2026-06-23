// React側の画面操作UI(左＝バーチャルパッド/右＝ボタン)と
// Phaser側のゲームループをつなぐ共有入力。
//   moveX/moveY : -1〜1 の移動ベクトル(バーチャルパッドが書き込む/ゲームが毎フレーム読む)
//   action()    : 攻撃・スキル等の単発操作を発火(ボタンが呼ぶ/シーンがlistenする)
export const controls = { moveX: 0, moveY: 0 }

export function setMove(x, y) {
  controls.moveX = x
  controls.moveY = y
}

// 単発アクション。name 例: 'attack' / 'skill:heal' など
export function action(name) {
  window.dispatchEvent(new CustomEvent('arpg-action', { detail: name }))
}
