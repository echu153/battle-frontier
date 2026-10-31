// v2cap のボスの倒れる動き（lib/bossDeath.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bossIllustOf, BOSS_ILLUST_DEFS } from './bossIllust.js'
import { deathAt, deathLandMs, deathPoseOf, deathShowOf } from './bossDeath.js'

const BOSSES = ['varuzenoku', 'amaza']
const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fight = readFileSync(new URL('../components/V2capAtbFight.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('【確定】2026-10-31 ユーザーが選んだ「ボスの倒れる動き」：新しい絵は描かない＝節目のバフと技のポーズの絵を使い、先に読む絵に入っている', () => {
  for (const key of BOSSES) {
    const a = bossIllustOf(key)
    assert.ok(a.death, `${key} に倒れる動きがある`)
    for (const n of ['roar', 'fall']) {
      assert.match(a.death.arts[n].src, /-il-(buff|pose)-/, `${key} ${n} は今ある絵`)
      assert.ok(a.srcs.includes(a.death.arts[n].src), `${key} ${n} は戦闘の前に読む`)
    }
    assert.notEqual(a.death.arts.roar.src, a.death.arts.fall.src)
  }
})

test('時刻の順：止まる→断末魔→倒れる→光が消える→消える→火の粉も消える', () => {
  for (const key of BOSSES) {
    const d = BOSS_ILLUST_DEFS[key].death
    assert.ok(d.stopMs > 0 && d.stopMs < d.fallAt, key)
    assert.ok(deathLandMs(d) <= d.ashAt && d.ashAt <= d.burnAt, key)
    assert.ok(d.burnAt + d.burnMs <= d.endMs, key)
    assert.ok(d.keys.at(-1)[0] > d.endMs, `${key} 姿勢のキーは終わりまで続く`)
  }
})

test('はじめは倒した瞬間の形で止まって光り、最後は体も粒も残らない', () => {
  for (const key of BOSSES) {
    const d = bossIllustOf(key).death
    const a = deathAt(d, 0)
    assert.equal(a.rig, 1, `${key} 止めた形のまま`)
    assert.deepEqual(a.poses, [])
    assert.equal(a.burn.op, 0)
    assert.ok(a.bright > 1.5, `${key} 白く光る`)
    assert.ok(a.scene.flash > 0.2, `${key} 舞台も光る`)
    assert.ok(Math.abs(a.scene.shake[0]) < 1, '揺れは少し遅れて大きくなる形でも0から')
    // 止まっているあいだは形を変えない
    assert.equal(deathAt(d, d.stopMs - 1).rig, 1)
    assert.deepEqual(deathAt(d, d.stopMs - 1).poses, [])
    const z = deathAt(d, d.endMs)
    assert.equal(z.gone, true)
    assert.equal(z.burn.k, 1)
    assert.equal(z.rig, 0)
    assert.deepEqual(z.poses, [])
    assert.equal(z.scene.sparks.length, 0, `${key} 粒も消える`)
    assert.equal(z.puffs.length, 0, `${key} 煙も消える`)
    assert.equal(z.scene.dim, 0, `${key} 舞台の暗さも戻る`)
    assert.equal(z.behind, 0, `${key} 後ろの色を抜く所も戻る`)
  }
})

test('絵の切り替えの途中で後ろが透けない（新しい絵が前半で出きり、前の絵は後半で消える）', () => {
  for (const key of BOSSES) {
    const d = bossIllustOf(key).death
    for (let ms = 0; ms < d.burnAt; ms += 5) {
      const s = deathAt(d, ms), roar = s.poses[0]?.op || 0
      assert.ok(Math.max(s.rig, roar, s.burn.op) > 0.999, `${key} ${ms}ms：${s.rig} ${roar} ${s.burn.op}`)
    }
  }
})

test('同じ時刻なら同じ形（止めて確かめられる）・軽い表示は粒が減る', () => {
  for (const key of BOSSES) {
    const d = bossIllustOf(key).death
    for (const ms of [100, 600, 1500, 2600, 3200]) assert.deepEqual(deathAt(d, ms), deathAt(d, ms), `${key} ${ms}`)
    const ms = d.burnAt + d.burnMs * 0.5
    assert.ok(deathAt(d, ms).scene.sparks.length > 0, `${key} 消えるあいだに粒が出る`)
    assert.ok(deathAt(d, ms, 0.5).scene.sparks.length < deathAt(d, ms).scene.sparks.length, key)
  }
})

test('黒龍は横へずらさず傾けるだけ（2026-10-30 ユーザー「しっぽが不自然、一緒に動いちゃってる」）・倒れた瞬間に大きく揺れて砂ぼこりが立ち、燃え尽きる', () => {
  const d = bossIllustOf('varuzenoku').death
  for (let ms = 0; ms < d.endMs; ms += 50) {
    const s = deathAt(d, ms)
    assert.equal(s.x, 0)
    assert.equal(s.y, 0)
    assert.equal(s.r, 0)
  }
  const land = deathLandMs(d)
  assert.ok(deathAt(d, d.fallAt - 1).lean < 0, 'のけぞる')
  assert.ok(deathAt(d, land).lean > 0.15, '前へ倒れる')
  assert.ok(Math.hypot(...deathAt(d, land + 12).scene.shake) > 3, '着いた瞬間に揺れる')
  assert.ok(deathAt(d, land + 200).puffs.some(p => p.c === 'dust'), '砂ぼこり')
  assert.equal(deathAt(d, land - 1).puffs.length, 0, '着く前は砂ぼこりが無い')
  assert.equal(d.tone, 'fire')
})

test('雨摩座は浮いているので地面で傾けない・水の帯は落ちて消える・足元に波紋（黒龍に水の帯は無い）', () => {
  const d = bossIllustOf('amaza').death
  for (let ms = 0; ms < d.endMs; ms += 50) assert.equal(deathAt(d, ms).lean, 0)
  assert.ok(deathAt(d, d.endMs).y > 0.03, 'だんだん沈む')
  assert.equal(deathAt(d, 0).freeOp, 1)
  assert.equal(deathAt(d, d.freeOut.at + d.freeOut.ms).freeOp, 0)
  assert.ok(deathAt(d, d.freeOut.at + d.freeOut.ms).freeY > 0.1, '落ちる')
  assert.ok(deathAt(d, 2600).scene.rings.some(r => r.flat), '波紋')
  assert.ok(bossIllustOf('amaza').parts.some(p => p.free))
  assert.equal(bossIllustOf('varuzenoku').death.freeOut, undefined)
})

test('止めた形に重ねる：はじめは止めた形のずれをそのまま・絵が替わったら倒れる動きのずれだけ', () => {
  const d = bossIllustOf('varuzenoku').death
  const pose = { x: 0.1, y: 0.2, r: 3, lean: 0.2, dust: 0.5, neck: 7 }
  const a = deathPoseOf(pose, deathAt(d, 0))
  assert.equal(a.x, 0.1)
  assert.equal(a.lean, 0.2)
  assert.equal(a.dust, 0.5)
  assert.equal(a.neck, 7)
  const s = deathAt(d, d.fallAt)
  const b = deathPoseOf(pose, s)
  assert.equal(b.x, 0)
  assert.equal(b.lean, s.lean)
  assert.equal(b.dust, 0)
  // 技のポーズの絵は止めた形といっしょに消える
  const show = { rig: 0.5, poses: [{ name: 'strike', op: 1 }] }
  assert.deepEqual(deathShowOf(show, deathAt(d, 0)), { rig: 0.5, poses: [{ name: 'strike', op: 1 }] })
  assert.deepEqual(deathShowOf(null, deathAt(d, 0)), { rig: 1, poses: [] })
  const late = deathShowOf(show, deathAt(d, d.stopMs + 500))
  assert.equal(late.rig, 0)
  assert.equal(late.poses[0].op, 0)
  assert.equal(late.poses.at(-1).name, 'roar')
})

test('舞台のつなぎ：止めの一撃の数字が出る時刻から流す・そのあいだボスの技は片付ける・ボスの絵は薄くしない・試し撃ちの［倒れる］', () => {
  // HP が0になった瞬間ではなく、数字が出る時刻（殴る絵の「当たる」コマ）から
  assert.match(stage, /deadAt\.current = lastHitAtOf\(fx, 'b', now\)/)   // 決まりは lib/atbFx.js（テロップと同じ時刻）
  // 倒した瞬間の形で止める
  assert.match(stage, /const clock = death \? death\.t0 : now/)
  assert.match(stage, /const pose = death \? deathPoseOf\(pose0, death\) : pose0/)
  // 倒れる動きの絵があるボスは前の「薄くなるだけ」にしない（ドット絵版と図鑑の絵の敵は前のまま）
  assert.match(stage, /opacity: down && !rig\?\.death \? 0\.25 : 1/)
  // ボスの技のエフェクトと演出は片付ける
  assert.match(stage, /fx=\{death \? fxAll\.filter\(f => f\.side !== 'b' \|\| f\.kind !== 'act'\) : fxAll\}/)
  assert.match(stage, /kept\.current = death \? \[\] :/)
  // 試し撃ちの印で数字が出ない
  assert.match(stage, /f\.kind !== 'rage' && f\.kind !== 'death'/)
  assert.match(fight, /bossArt\.death && \(/)
  assert.match(fight, /kind:'death', side:'b'/)
  // 開発のときだけ（dev の中）
  assert.ok(fight.indexOf('{dev && bossArt && (') < fight.indexOf("kind:'death'"))
  assert.ok(fight.indexOf("kind:'death'") < fight.indexOf('{/* マクロ①〜③ */}'))
})
