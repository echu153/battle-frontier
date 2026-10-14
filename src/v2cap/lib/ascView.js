// ============================================================
// v2cap アセンションの盤面の拡大・移動（画面 V2capAscension.jsx）
// ------------------------------------------------------------
// 【確定】2026-10-14 ユーザー指示「スキルツリーをマウスのホイールとかでズームインできるようにして」：
//   マウスのホイールで、マウスのある所を中心に拡大・縮小（スマホは2本指）。拡大したらドラッグ（スマホは1本指）で動かす。
//   ＋・−・全体のボタンでも。いちばん小さく＝盤面の全体（今までの見え方）
// 座標は盤の画面の座標（マス目＝1・起点が0,0）。
//   view   ＝ { k: 倍率（1＝全体）, cx, cy: 見ている真ん中 }
//   bounds ＝ { min, max }（盤の端。正方形）
// ============================================================

// いちばん大きくしたとき、横に見えるマスの数（の目安）
export const ASC_ZOOM_CELLS = 3
export const zoomMaxOf = (bounds) => Math.max(1, (bounds.max - bounds.min) / ASC_ZOOM_CELLS)
export const centerOf = (bounds) => (bounds.min + bounds.max) / 2
export const fitView = (bounds) => ({ k: 1, cx: centerOf(bounds), cy: centerOf(bounds) })

// 見えている範囲（SVG の viewBox）
export const viewBoxOf = (view, bounds) => {
  const w = (bounds.max - bounds.min) / view.k
  return { x: view.cx - w / 2, y: view.cy - w / 2, w }
}

// 倍率を 1〜いちばん大きい に、真ん中を「盤の外が見えない」所に収める
export const clampView = (view, bounds) => {
  const k = Math.min(zoomMaxOf(bounds), Math.max(1, Number.isFinite(view?.k) ? view.k : 1))
  const half = (bounds.max - bounds.min) / k / 2
  const c = centerOf(bounds)
  const fit = (v) => (k <= 1 + 1e-9 ? c : Math.min(bounds.max - half, Math.max(bounds.min + half, Number.isFinite(v) ? v : c)))
  return { k, cx: fit(view?.cx), cy: fit(view?.cy) }
}

// 盤の点（ux, uy）を画面の同じ所に保ったまま、倍率を factor 倍にする（マウスの下の点が動かない）
export const zoomAt = (view, factor, ux, uy, bounds) => {
  const next = clampView({ ...view, k: view.k * factor }, bounds)
  const r = view.k / next.k
  return clampView({ k: next.k, cx: ux - (ux - view.cx) * r, cy: uy - (uy - view.cy) * r }, bounds)
}

// 盤の座標で動かす
export const panBy = (view, dux, duy, bounds) => clampView({ ...view, cx: view.cx + dux, cy: view.cy + duy }, bounds)

// 画面の点（clientX, clientY）→ 盤の座標。rect＝SVG の getBoundingClientRect（盤も SVG も正方形）
export const toBoard = (view, bounds, rect, clientX, clientY) => {
  const vb = viewBoxOf(view, bounds)
  return [vb.x + ((clientX - rect.left) / rect.width) * vb.w, vb.y + ((clientY - rect.top) / rect.height) * vb.w]
}
// 画面の 1px が盤の座標でいくつか
export const unitsPerPx = (view, bounds, rect) => (bounds.max - bounds.min) / view.k / Math.max(1, rect.width)

// ホイール1回ぶんの倍率（上へ回すと大きく）。deltaMode 1＝行・2＝ページ
export const wheelFactorOf = (deltaY, deltaMode = 0) => Math.exp(-deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1) * 0.0015)

// その点が見えている範囲（端から margin マス内側）に入っているか
export const isInView = (view, bounds, x, y, margin = 0.5) => {
  const vb = viewBoxOf(view, bounds)
  return x >= vb.x + margin && x <= vb.x + vb.w - margin && y >= vb.y + margin && y <= vb.y + vb.w - margin
}
