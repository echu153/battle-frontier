// v2cap：装備の名前に【レア】などの頭の表記を付けない（2026-10-13 ユーザー指示「【レジェンダリー】【レア】ここら辺の表記もいらない」）：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// 出撃のログのドロップ「🎁 【ノーマル】「◯◯」を入手！」だけは 2026-10-12 にユーザーが決めた形のまま
const KEEP = new Set(['V2capSortie.jsx'])

test('【確定】装備の名前は名前だけ（レア度は色で出す）：【レア】のような頭の表記が戻らないように', () => {
  const dirs = [new URL('../components/', import.meta.url), new URL('./', import.meta.url)]
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter(n => /\.(jsx?|mjs)$/.test(n) && !/\.test\.js$/.test(n))) {
      // コメントの行は見ない
      const code = readFileSync(new URL(f, dir), 'utf8').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')
      assert.ok(!/\b(RarityTag|itemLabel)\b/.test(code), `${f}：レア度の頭の表記（RarityTag／itemLabel）は使わない`)
      if (KEEP.has(f)) continue
      assert.ok(!/【[^】\n]*(rarityLabel|RARITY_LABEL)/.test(code), `${f}：名前の頭に【レア度】を付けない（色で出す）`)
    }
  }
})
