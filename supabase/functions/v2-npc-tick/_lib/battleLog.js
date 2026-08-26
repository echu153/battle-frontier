// ============================================================
// バトルフロンティアⅡ（リメイク版）— 戦闘ログの文面
// ------------------------------------------------------------
// runBattle が返す log を、画面（V2LogLine）が読める行に組み立てる。
//
// ★出撃とアリーナで**同じ関数を使う**。2か所に書いていたころ、アリーナ側だけ
//   状態異常・不発・追加行動などの行が抜けていた（後から足した行が片方に入らない）。
//
// ★**どちらの行動かが必ず分かるように、行の頭に必ず名前を出す**（2026-08-17 ユーザー指摘）。
//   それまで自分の行だけ名前が無く、「ライト！ 盗賊に756ダメージ！」が誰の攻撃か
//   分からなかった。敵側は最初から「盗賊の〜」と出ていたので、そちらへ揃える。
// ============================================================

export const LOG_COLOR = {
  mine:  '#ffcc00',   // 自分が与えた
  foe:   '#ff4444',   // 自分が受けた
  miss:  '#94a7bb',
  heal:  '#44ff88',
  buff:  '#44aaff',
  extra: '#ffcc44',
  ail:   '#cc66ff',
  guard: '#66ccff',
}

// r … runBattle の返り値 ／ you … 自分の名前 ／ foe … 相手の名前
export const buildBattleLog = (r, you, foe) => {
  const out = []
  for (const l of r?.log || []) {
    // side は行動した側（または効果を受けた側）の名前
    const mine = l.side === you
    const actor = mine ? you : foe          // その行の主語
    const target = mine ? foe : you         // その行の相手

    if (l.type === 'hp') {
      out.push({ type:'hp', turn:l.turn, playerHp:l.a, playerMax:l.aMax, playerName:you,
        enemyHp:l.b, enemyMax:l.bMax, enemyName:foe })
    } else if (l.type === 'skill') {
      if (l.hits === 0) {
        out.push({ text:`⚔ ${actor}の「${l.skill}」！ しかし${target}にかわされた`, color: LOG_COLOR.miss })
      } else {
        out.push({
          text: `⚔ ${actor}の「${l.skill}」！ ${target}に${l.damage.toLocaleString()}ダメージ！`
            + (l.crit ? ' 💥クリティカル！' : '')
            + (mine && l.drain ? ` HPが${l.drain.toLocaleString()}回復した！` : ''),
          color: mine ? LOG_COLOR.mine : LOG_COLOR.foe,
        })
      }
    } else if (l.type === 'normal') {
      if (!l.hit) {
        out.push({ text:`${actor}の攻撃！ しかし${target}にかわされた`, color: LOG_COLOR.miss })
      } else {
        out.push({
          text: `${actor}の攻撃！ ${target}に${l.damage.toLocaleString()}ダメージ！`
            + (l.crit ? ' 💥クリティカル！' : ''),
          color: mine ? LOG_COLOR.mine : LOG_COLOR.foe,
        })
      }
    } else if (l.type === 'misfire') {
      out.push({ text:`${actor}は${l.skill}を出そうとしたが不発！`, color: LOG_COLOR.miss })
    } else if (l.type === 'heal') {
      out.push({ text:`💚 ${actor}の${l.skill}！ HPが${l.heal.toLocaleString()}回復した！`, color: LOG_COLOR.heal })
    } else if (l.type === 'regenTick') {
      out.push({ text:`💚 ${actor}のHPが${l.heal.toLocaleString()}回復した！`, color: LOG_COLOR.heal })
    } else if (l.type === 'buff') {
      out.push({ text:`✨ ${actor}の${l.skill}！`, color: LOG_COLOR.buff })
    } else if (l.type === 'extra') {
      out.push({ text:`⚡ ${actor}は素早く動いた！`, color: LOG_COLOR.extra })
    } else if (l.type === 'wall') {
      out.push({ text:`💀 ${actor}の骸の壁が攻撃を和らげた！`, color:'#cc44ff' })
    } else if (l.type === 'debuffGuard') {
      out.push({ text:`🛡 ${actor}の心身一如！ 弱体化を打ち消した！`, color:'#44ffaa' })
    } else if (l.type === 'ailment') {
      // 状態異常が入ったとき。side は「かかった側」
      out.push({ text:`☠ ${actor}は${l.ail}になった！`, color: LOG_COLOR.ail })
    } else if (l.type === 'ailTick') {
      out.push({ text:`☠ ${l.ail}！ ${actor}に${l.damage.toLocaleString()}ダメージ！`
        + (l.stacks > 1 ? `（${l.stacks}スタック）` : ''), color: LOG_COLOR.ail })
    } else if (l.type === 'consumeAil') {
      out.push({ text:`🩸 ${actor}の${l.ail}が弾けた！（${l.stacks}スタック消費・威力${l.mult.toFixed(1)}倍）`, color: LOG_COLOR.ail })
    } else if (l.type === 'guard') {
      // ATB専用（オート戦闘は出さない）
      out.push({ text:`🛡 ${actor}は身を守っている！（${l.sec}秒・被ダメージ-${l.cut}%）`, color: LOG_COLOR.guard })
    } else if (l.type === 'air') {
      out.push({ text:`🕊 ${actor}は跳び上がった！`, color: LOG_COLOR.extra })
    } else if (l.type === 'land') {
      out.push({ text:`🥾 ${actor}は地上へ降りた！`, color: LOG_COLOR.extra })
    } else if (l.type === 'form') {
      out.push({ text:`🐾 ${actor}の${l.skill}！ ${l.form}を呼んだ！`, color: LOG_COLOR.buff })
    } else if (l.type === 'ritual') {
      out.push({ text:`🔯 ${actor}の${l.skill}！ 呪力が${l.stacks}になった！`, color: LOG_COLOR.buff })
    } else if (l.type === 'charge') {
      out.push({ text:`🐉 ${actor}の${l.skill}！ 竜気が${l.stacks}になった！`, color: LOG_COLOR.buff })
    } else if (l.type === 'stance') {
      out.push({ text:`🗡 ${actor}の${l.skill}！ 構えた！`, color: LOG_COLOR.buff })
    } else if (l.type === 'frenzy') {
      out.push({ text:`💢 ${actor}の${l.skill}！ 我を忘れた！`, color:'#ff8844' })
    } else if (l.type === 'foresight') {
      out.push({ text:`👁 ${actor}の${l.skill}！ 相手の動きを見切っている！`, color: LOG_COLOR.guard })
    } else if (l.type === 'dispel') {
      out.push({ text:`✂ ${actor}の強化が1つ消えた！`, color: LOG_COLOR.ail })
    } else if (l.type === 'bigGuard') {
      const span = l.sec > 0 ? `${l.sec}秒のあいだ` : '1ターンのあいだ'
      out.push({ text:`🛡 ${actor}の${l.skill}！ ${span}受けるダメージ-${l.cut}%！`, color: LOG_COLOR.guard })
    } else if (l.type === 'cure') {
      out.push({ text:`🌿 ${actor}の${l.skill}！ ${l.ail}が治った！`, color: LOG_COLOR.heal })
    } else if (l.type === 'hpCost') {
      out.push({ text:`🩸 ${actor}は${l.skill}のために${l.damage.toLocaleString()}のHPを削った！`, color:'#ff8844' })
    } else if (l.type === 'regen') {
      out.push({ text:`💚 ${actor}の${l.skill}！ しばらくHPが戻り続ける！`, color: LOG_COLOR.heal })
    } else if (l.type === 'mpRegen') {
      out.push({ text:`💙 ${actor}の${l.skill}！ しばらくMPが戻り続ける！`, color:'#66aaff' })
    } else if (l.type === 'mpRegenTick') {
      out.push({ text:`💙 ${actor}のMPが${(l.mp || 0).toLocaleString()}回復した！`, color:'#66aaff' })
    } else if (l.type === 'dodgeCut') {
      out.push({ text:`🐉 ${actor}の鱗が攻撃を弾いた！`, color: LOG_COLOR.guard })
    } else if (l.type === 'guts') {
      // 武器の進化「不屈」。1戦に1回だけ致命傷をHP1で耐える
      out.push({ text:`💢 ${actor}は倒れずに踏み止まった！`, color:'#ffcc44' })
    } else if (l.type === 'paralyzed') {
      out.push({ text:`⚡ ${actor}は麻痺して動けない！`, color:'#ffdd44' })
    } else if (l.type === 'reflect') {
      out.push({ text:`🔮 ${actor}はダメージを${l.damage.toLocaleString()}跳ね返した！`, color:'#88ddff' })
    } else if (l.type === 'enCut') {
      out.push({ text:`🛡 ${actor}のエンチャントが攻撃を和らげた！`, color: LOG_COLOR.guard })
    }
  }
  return out
}
