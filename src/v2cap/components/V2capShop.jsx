import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import V2capMerchant, { MerchantSays, MERCHANT_CSS } from './V2capMerchant.jsx'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import { GENDER_BY_KEY, genderOf } from '../lib/gender.js'
import { leftText } from '../lib/burger.js'
import {
  SHOP_COLOR, SHOP_ITEMS, SHOP_ITEM_BY_KEY, FLIP_COLOR, FLIP_MINUTES, FLIP_HOURS,
  flipLeftMsOf, flipPreviewOf, encounterBandOf, otherGenderOf,
} from '../lib/shop.js'
import {
  MERCHANT_ON, MERCHANT_STAGES, MERCHANT_STAGE_EVENTS, pickLine, enterKindOf, askKindOf, boughtKindOf, poorOf,
  stageOf, stageLabelOf, stageEventOf, varsOf, tapKindOf, nextStreak, isNight, fillLine, makeDailyAsker,
} from '../lib/merchant.js'

// ============================================================
// 「レベルキャップあり」版 — 商店（2026-10-31）
//   品物を選ぶ → 確かめのポップアップ（何がどう変わるか）→ 買ったらその場で飲む → 結果のポップアップ
//   ★決まりの正は src/v2cap/lib/shop.js。買う・Gold はサーバー（v2cap_shop_buy）
//   【確定】2026-10-31 商人ソルド（ユーザー指示「糸目の胡散臭いお兄さん、関西弁の守銭奴にする予定」・lib/merchant.js）：
//     品物の右に商人を立たせる（スマホは上）。店を開いたとき・タップ・買う確かめ・買った結果で話す（ユーザー選択）。
//     好感度は看板娘・アレアと同じ形（画面には出さない・サーバーの v2cap_merchant_talk）。絵が届くまで MERCHANT_ON=false＝画面は前のまま
// ============================================================
const gold = (n) => `${Number(n || 0).toLocaleString()}G`
const BAND_STYLE = { color: FLIP_COLOR, fontSize:'13px' }
// その日はじめて話しかけた（好感度+1）をサーバーに聞く窓口（同じ日は1回だけ聞いて答えを使い回す＝lib/clerk.js の makeDailyAsker）
const talkAsker = makeDailyAsker(() => supabase.rpc('v2cap_merchant_talk'))
// 開発用（管理者だけ）：買う確かめと買った結果の反応を見るボタン（反応の商人だけを出す＝本当には買わない）・好感度の段階を仮に置くボタン（サーバーに書かない）
const DEV = SHOP_COLOR
const DEV_REACTS = ['askGender', 'askFlip', 'askFlipMore', 'boughtF', 'boughtM', 'boughtFlip', 'error']

// ♂ 男性（色つき）と性能差の一言
function GenderLine({ g }) {
  const d = GENDER_BY_KEY[g]
  return <><span style={{ color: d.color }}>{d.mark} {d.label}</span><span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{d.text}</span></>
}

// 性別変更薬：いまの性別 → 飲んだあと
function GenderChange({ g }) {
  if (!g) return <div style={{ color:'#ff8844' }}>先にホームで性別を選んでください</div>
  return (
    <>
      <div>いま：<GenderLine g={g} /></div>
      <div>飲むと：<GenderLine g={otherGenderOf(g)} /></div>
    </>
  )
}

// 日月反転の秘薬：いまの時間帯 → 飲んだあと（効いているあいだは残り時間が延びる）
function FlipChange({ prof, now }) {
  const left = flipLeftMsOf(prof, now)
  const p = flipPreviewOf(prof, now)
  return (
    <>
      {left > 0
        ? <div>いま：<span style={BAND_STYLE}>{encounterBandOf(prof, now)}</span><span style={{ marginLeft:'8px' }}>{leftText(left)} → {leftText(p.leftMs)}</span></div>
        : <div>いま：<span style={BAND_STYLE}>{encounterBandOf(prof, now)}</span> → 飲むと：<span style={BAND_STYLE}>{p.to}</span></div>}
      {p.change && <div style={{ color: TEXT.sub, fontSize:'10px' }}>※{p.change.minutes}分後に「{p.change.band}」へ変わります</div>}
    </>
  )
}

const ITEM_TEXT = {
  gender: '飲むと、男女が入れ替わります。',
  flip: `${FLIP_MINUTES}分のあいだ、時間帯が${FLIP_HOURS}時間ずれて、いまとは違う時間帯の敵に出会えます。`,
}

// dev … 開発用（管理者だけ）。商人の反応と段階を確かめるボタンを出す
export default function V2capShop({ prof, onProfile, dev = false }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const [confirm, setConfirm] = useState(null)   // 確かめている品物の key
  const [bought, setBought] = useState(null)     // 結果のポップアップ（サーバーの返事）
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const have = Number(prof?.gold || 0)
  const sex = genderOf(prof)

  // ===== 商人ソルド（lib/merchant.js）=====
  // 好感度（画面には出さない）：aff＝サーバーの好感度（話しかけた日の数）・seen＝見せた段階の場面
  const [aff, setAff] = useState(() => Number(prof?.merchant_affinity) || 0)
  const [seen, setSeen] = useState(() => Number(prof?.merchant_stage_seen) || 0)
  const stage = stageOf(aff)
  // say がいまの段階と呼び方を見られるように控える（say は作り直さない）
  const ctx = useRef(null)
  ctx.current = { stage, vars: varsOf(prof, stage) }
  // いまの表情とセリフ（tick は話すたびに増やす＝同じ表情でも跳ねる）
  const [merchant, setMerchant] = useState(() => {
    const st = stageOf(prof?.merchant_affinity)
    const kind = enterKindOf({ affinity: prof?.merchant_affinity, lastTalk: prof?.merchant_talk_day, poor: poorOf(prof?.gold), flipping: flipLeftMsOf(prof) > 0 })
    return { ...pickLine(kind, { vars: varsOf(prof, st), stage: st }), tick: 0 }
  })
  const [askSay, setAskSay] = useState(null)         // 買う確かめのひとこと { face, text }
  const [boughtSay, setBoughtSay] = useState(null)   // 買った結果のひとこと { face, text }
  const [devSay, setDevSay] = useState(null)         // 開発用に出している反応 { kind, face, text }
  const lastText = useRef(merchant.text)
  // 場面 kind のセリフを選んで吹き出しに出し、選んだもの { face, text } を返す（ポップアップの中にも同じものを出す）
  const say = useCallback((kind) => {
    const { stage: st, vars } = ctx.current
    const line = pickLine(kind, { last: lastText.current, vars, stage: st })
    lastText.current = line.text
    setMerchant(c => ({ ...line, tick: c.tick + 1 }))
    return line
  }, [])
  const sayEvent = (ev) => {
    const text = fillLine(ev.text, ctx.current.vars)
    lastText.current = text
    setMerchant(c => ({ face: ev.face, text, tick: c.tick + 1 }))
  }
  const streak = useRef(null)
  const talked = useRef(false)
  const tapMerchant = () => {
    streak.current = nextStreak(streak.current, Date.now())
    say(tapKindOf(streak.current.n, isNight()))   // 待たせないように、まずすぐ答える
    // その日はじめて話しかけたら、サーバーが好感度を+1（1日1回）。段階が上がっていれば、返事が来たところで
    // その段階の場面のセリフに切り替える（1回だけ）
    if (talked.current) return
    talked.current = true
    talkAsker.get().then(({ data, error: e }) => {
      if (e || !data?.ok) return
      const nextAff = Number(data.affinity) || 0
      const nextStage = stageOf(nextAff)
      setAff(nextAff)
      ctx.current = { stage: nextStage, vars: varsOf(prof, nextStage) }
      if (data.up) onProfile?.()   // 次に開いたときの「今日また」が分かるように、話した日を読み直す
      const ev = stageEventOf(nextStage, Math.max(Number(seen) || 0, Number(data.seen) || 0))
      if (!ev) return
      sayEvent(ev)
      setSeen(ev.stage)
      talkAsker.set({ data: { ...data, seen: ev.stage } })   // 同じ日に商店を開き直しても、もう出さない
      // ★supabase の呼び出しは then を付けないと送られない（結果は待たない＝失敗しても次の日にもう一度出るだけ）
      supabase.rpc('v2cap_merchant_seen', { p_stage: ev.stage }).then(() => {})
    })
  }
  // 開発用：反応を順に見る（本当には買わない）・段階を仮に置く（サーバーに書かない＝閉じて開き直せば本物に戻る）
  const devStep = useRef(0)
  const devReact = () => {
    const kind = DEV_REACTS[devStep.current++ % DEV_REACTS.length]
    setDevSay({ kind, ...say(kind) })
  }
  const devNextStage = () => {
    const next = (stage + 1) % MERCHANT_STAGES.length
    talked.current = true   // 仮の段階を、本物の答えで上書きしない
    setAff(MERCHANT_STAGES[next].min)
    ctx.current = { stage: next, vars: varsOf(prof, next) }
    if (MERCHANT_STAGE_EVENTS[next]) sayEvent(MERCHANT_STAGE_EVENTS[next]); else say('intro')
  }

  // 買う確かめ。開く前の表情とセリフを控えて、「やめる」で戻す（確かめのセリフが残らないように＝看板娘と同じ）
  const beforeAsk = useRef(null)
  const ask = (key) => {
    setError('')
    beforeAsk.current = merchant
    setAskSay(say(askKindOf(key, flipLeftMsOf(prof, now) > 0)))
    setConfirm(key)
  }
  const cancelAsk = () => {
    setConfirm(null)
    const b = beforeAsk.current
    if (!b) return
    lastText.current = b.text
    setMerchant(c => ({ face: b.face, text: b.text, tick: c.tick + 1 }))
  }
  const buy = async () => {
    setBusy(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('v2cap_shop_buy', { p_item: confirm })
      if (e || !data?.ok) { setError(e?.message || data?.error || '買えませんでした'); say('error'); return }
      setBought(data)
      setBoughtSay(say(boughtKindOf(data)))
      setNow(new Date())
      await onProfile?.()
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  const asking = SHOP_ITEM_BY_KEY[confirm]
  const got = SHOP_ITEM_BY_KEY[bought?.item]
  const newSex = GENDER_BY_KEY[bought?.gender]

  return (
    <div style={{ maxWidth: MERCHANT_ON ? '1068px' : '760px' }}>
      {MERCHANT_ON && <style>{MERCHANT_CSS}</style>}
      {asking && (
        <V2Modal title={`${asking.icon} ${asking.name}を飲みますか？`} color={asking.color} busy={busy} confirmLabel={`${gold(asking.gold)}で買う`}
          onConfirm={buy} onClose={cancelAsk}>
          {MERCHANT_ON && askSay && <MerchantSays face={askSay.face} line={askSay.text} />}
          {asking.key === 'gender' ? <GenderChange g={sex} /> : <FlipChange prof={prof} now={now} />}
        </V2Modal>
      )}
      {got && (
        <V2Modal title={`${got.icon} ${got.name}を飲みました`} color={got.color} onClose={() => setBought(null)}>
          {MERCHANT_ON && boughtSay && <MerchantSays face={boughtSay.face} line={boughtSay.text} />}
          {got.key === 'gender' ? (
            <>
              <div><span style={{ color: newSex?.color }}>{newSex?.mark} {newSex?.label}</span>になりました</div>
              <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>{newSex?.text}</div>
            </>
          ) : (
            <>
              <div>いまの時間帯：<span style={BAND_STYLE}>{encounterBandOf({ flip_until: bought.flip_until }, now)}</span></div>
              <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>効果時間：{leftText(flipLeftMsOf({ flip_until: bought.flip_until }, now))}</div>
            </>
          )}
        </V2Modal>
      )}
      {/* 開発用：買う確かめと買った結果の反応（商人だけ・本当には買わない） */}
      {devSay && (
        <V2Modal title="🧪 商人の反応［開発］" color={DEV} keepScroll onClose={() => setDevSay(null)}>
          <MerchantSays face={devSay.face} line={devSay.text} />
          <div style={{ color: DEV, fontSize:'10px' }}>場面：{devSay.kind}</div>
        </V2Modal>
      )}

      <div className={MERCHANT_ON ? 'mer-cols' : undefined}>
        {/* 商人（広い画面は右・狭い画面は上） */}
        {MERCHANT_ON && (
          <div className="mer-side">
            <V2capMerchant face={merchant.face} line={merchant.text} tick={merchant.tick} onTap={tapMerchant} />
            {dev && (
              <div style={{ display:'flex', justifyContent:'center', flexWrap:'wrap', gap:'6px', marginTop:'8px' }}>
                <button type="button" onClick={devReact} style={miniBtn(DEV)}>🧪 商人の反応［開発］</button>
                <button type="button" onClick={devNextStage} style={miniBtn(DEV)}>🧪 段階：{stageLabelOf(stage)}［開発］</button>
              </div>
            )}
          </div>
        )}
        <div className="mer-main">
          <div style={{ ...box, padding:'8px 12px', marginBottom:'8px', fontSize:'11px', color: TEXT.label }}>
            持っているGold <span style={{ color:'#ffcc00', fontSize:'13px' }}>{gold(have)}</span>
          </div>
          {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'8px' }}>
            {SHOP_ITEMS.map(it => {
              const short = have < it.gold
              const noSex = it.key === 'gender' && !sex
              const off = busy || short || noSex
              return (
                <div key={it.key} style={{ ...box, padding:'10px 12px', display:'flex', flexDirection:'column', gap:'6px', minWidth:0 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'8px' }}>
                    <span style={{ color: it.color, fontSize:'13px' }}>{it.icon} {it.name}</span>
                    <span style={{ color:'#ffcc00', fontSize:'12px', whiteSpace:'nowrap' }}>{gold(it.gold)}</span>
                  </div>
                  <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.6 }}>{ITEM_TEXT[it.key]}</div>
                  <div style={{ color: TEXT.body, fontSize:'11px', lineHeight:1.8 }}>
                    {it.key === 'gender' ? <GenderChange g={sex} /> : <FlipChange prof={prof} now={now} />}
                  </div>
                  <button onClick={() => ask(it.key)} disabled={off}
                    style={{ ...btn(it.color), width:'100%', padding:'8px', marginTop:'auto', opacity: off ? 0.5 : 1 }}>
                    {short ? 'Goldが足りません' : '買う'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
