import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import {
  DAILY_TASKS, dailyOf, taskProgressOf, doneCountOf, isDailyComplete, claimErrorOf, nextResetAt, dayOf,
} from '../lib/daily.js'
import { jobUpHead, jobUpNote } from '../lib/jobs.js'
import { gainedExpOf } from '../lib/settleLines.js'
import { TOWER_NAME } from '../lib/tower.js'

// ============================================================
// 「レベルキャップあり」版 — デイリーミッション（ホームの右の一番上・今のⅡと同じ場所）
//   見た目は今のⅡの V2Daily にそろえる（畳んだ見出しに進み具合を出す）。違うのは（2026-10-10 ユーザー決定）：
//   ・難易度はなし。受注してから数える（今のⅡのような、選ぶまで閉じられないポップアップは出さない）
//   ・報酬は受注した時点のLVで決まる（2026-10-24 から画面には報酬の量を出さない・説明は HELP の小窓）
//   ・【確定】2026-10-15 ユーザー指示「ミッションログイン時に自動で受注するように ※ミッションは朝5時リセット」：
//     **受注は自動**。ホームを開いたとき・開いたまま5時を過ぎたときに受注する。「受注する」のボタンは、自動の受注に失敗したときだけ出る
//   ・開け閉めはホーム（V2capHome の useCapFold）が覚えておく（2026-10-15・前は毎回畳んで始めていた）
//   仕組みの正は src/v2cap/lib/daily.js。数える・受注・受け取りはサーバー（v2cap_daily_accept／_claim）
// ============================================================
const resetText = (at) => at.toLocaleString('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })

export default function V2capDaily({ prof, onProfile, open = false, onToggle }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [got, setGot] = useState(null)   // 受け取った結果のポップアップ
  const [help, setHelp] = useState(false) // HELP の小窓
  const [now, setNow] = useState(() => new Date())
  // 朝5時に切り替わったことを、開いたままの画面にも出す（1分ごとに見直す）
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])

  const d = dailyOf(prof, now)
  const done = isDailyComplete(d)
  const claimErr = claimErrorOf(d)

  const call = async (fn) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc(fn)
    if (error || !data?.ok) { setBusy(false); setMsg(error?.message || data?.error || '失敗しました'); return null }
    await onProfile(null)
    setBusy(false)
    return data
  }
  const accept = () => call('v2cap_daily_accept')
  const claim = async () => {
    const data = await call('v2cap_daily_claim')
    if (data) setGot(data)
  }

  // ★自動で受注する（ホームを開いたとき＝ログインしたとき・開いたまま5時を過ぎて日付が変わったとき）。
  //   1日1回だけ試す（失敗したら、下の「受注する」で押し直せる）。戦闘のあいだはこの欄ごと隠れるので、戻ってきたときにもう一度見る
  const today = dayOf(now)
  const tried = useRef('')
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  useEffect(() => {
    if (d.accepted || tried.current === today) return
    tried.current = today
    acceptRef.current()
  }, [d.accepted, today])

  // ★畳んでいても状態が分かるように、見出しに「受注していない」「1/4」「受け取れます」を出す
  const head = (
    <span>
      📋 今日のミッション
      {!d.accepted
        ? <span style={{ color:'#ffcc00', fontSize:'10px', marginLeft:'6px' }}>{busy ? '受注しています...' : 'まだ受注していません'}</span>
        : (
          <>
            <span style={{ color: done ? '#44ff88' : '#ffcc00', fontSize:'11px', marginLeft:'6px' }}>{doneCountOf(d)}/{DAILY_TASKS.length}</span>
            {d.claimed
              ? <span style={{ color:'#44ff88', fontSize:'10px', marginLeft:'6px' }}>受け取り済み</span>
              : done && <span style={{ color:'#ffcc00', fontSize:'10px', marginLeft:'6px' }}>達成！受け取れます</span>}
          </>
        )}
    </span>
  )
  const hot = !d.accepted || (done && !d.claimed)

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px', borderColor: hot ? '#ffcc00' : '#0044aa' }}>
      <button onClick={onToggle}
        style={{ ...miniBtn(hot ? '#ffcc00' : '#7fa6d0'), width:'100%', padding:'5px', textAlign:'left' }}>
        {open ? '▲ ' : '▼ '}{head}
      </button>

      {open && (<>
        <div style={{ display:'grid', gap:'2px', marginTop:'8px' }}>
          {DAILY_TASKS.map(t => {
            const p = taskProgressOf(d, t)
            return (
              <div key={t.key} style={{ background:'#000818', border:'1px solid #002244', padding:'4px 7px',
                display:'flex', alignItems:'center', gap:'6px', fontSize:'11px' }}>
                <span style={{ color: p.done ? '#44ff88' : TEXT.empty, flexShrink:0 }}>{p.done ? '✔' : '□'}</span>
                <span style={{ color: p.done ? '#44ff88' : '#a8c4d6', flex:1 }}>{t.label}</span>
                <span style={{ color: !d.accepted ? TEXT.empty : p.done ? '#44ff88' : '#ffcc00' }}>{d.accepted ? p.now : '—'}</span>
                <span style={{ color: TEXT.empty }}>/ {p.goal}{t.unit}</span>
              </div>
            )
          })}
        </div>
        {/* 2026-10-24 ユーザー指示：報酬の行（受注したLV・EXP・Gold・その中身）は「全部いらない」＝出さない */}
        {!d.accepted ? (
          <button onClick={accept} disabled={busy}
            style={{ ...btn('#ffcc00'), width:'100%', marginTop:'6px', cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? '受注しています...' : '📋 受注する'}
          </button>
        ) : (
          <button onClick={claim} disabled={!!claimErr || busy}
            style={{ ...btn(claimErr ? '#334455' : '#ffcc00'), width:'100%', marginTop:'6px',
              color: claimErr ? '#445566' : '#ffcc00', cursor: claimErr ? 'not-allowed' : 'pointer' }}>
            {busy ? '受け取っています...' : d.claimed ? '受け取り済み' : done ? '🎁 報酬を受け取る' : '達成すると受け取れます'}
          </button>
        )}
        {/* 説明は HELP から（2026-10-24 ユーザー指示「これはHELPにまとめて」） */}
        <div style={{ textAlign:'right', marginTop:'6px' }}>
          <button onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button>
        </div>
        {msg && <div style={{ color:'#ff6666', fontSize:'11px', marginTop:'6px' }}>⚠ {msg}</div>}
      </>)}

      {help && (
        <V2Modal title="❓ HELP" color="#ffcc00" keepScroll onClose={() => setHelp(false)}>
          <div>ミッションはログインすると自動で受注します（報酬はそのときのLVで決まります）。</div>
          <div>{TOWER_NAME}は、受注したときに守護者なら達成済みです。</div>
          <div>日付が変わるのは日本時間の5時です（次は {resetText(nextResetAt(now))}）。</div>
        </V2Modal>
      )}

      {got && (
        <V2Modal title="🎁 ミッション達成！" color="#ffcc00" onClose={() => setGot(null)}>
          <div style={{ color:'#ffcc00', fontSize:'14px' }}>
            EXP +{gainedExpOf(got).toLocaleString()}　Gold +{Number(got.gold).toLocaleString()} を受け取った！
          </div>
          {got.level?.level_ups > 0 && (
            <div style={{ color:'#44ff88', marginTop:'4px' }}>
              🆙 LEVEL UP！ LV{got.level.lv}{typeof got.level.points === 'number' ? `（ステータスポイント+${got.level.points}）` : ''}
            </div>
          )}
          {/* 上がったクラスのステも書く（2026-10-12 ユーザー指示・出撃のログと同じ） */}
          {got.level?.job_ups > 0 && (
            <div style={{ color:'#ffcc00', marginTop:'4px' }}>
              <div>{jobUpHead(prof.class, got.level)}</div>
              <div>{jobUpNote(prof.class, got.level)}</div>
            </div>
          )}
          {(got.level?.learned || []).map(n => <div key={n} style={{ color:'#44ddff', marginTop:'4px' }}>📖 スキル「{n}」を覚えた！{(got.level?.set_added || []).includes(n) ? '（スキルセットの空き枠に入れた）' : ''}</div>)}
          <div style={{ color: TEXT.label, fontSize:'10px', marginTop:'6px' }}>次のミッションは日本時間の5時に切り替わります。</div>
        </V2Modal>
      )}
    </div>
  )
}
