// ============================================================
// 初心者ビンゴミッション ①②（is_admin 開発限定・先行実装）
//   3×3ビンゴ。マス達成→マス報酬 / ライン報酬=揃えたライン本数(1〜8)で解放。フルコンプなし。
//   達成判定・進捗(prog)・付与はすべてサーバー(get/claim_beginner_bingo, p_card)で行う。
//   進捗は「そのビンゴを始めてからの増分」（過去分は含まない）。
//   ライン報酬の各種「エリアボス装備選択箱」は装備タブから redeem。
//   ※ 一般公開時はサーバー側RPCの is_admin チェックを外す。
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// マス定義（index=row-major。サーバー _bingo_eval と一致させること）
//   to=未達成マスをタップしたときの移動先（場所がわからず詰まる初心者向けの誘導）
const CELLS_BY_CARD = {
  1: [
    { label: '出撃10回',    hint: '出撃で通算10回戦う', to: '/game', place: '街（出撃）' },
    { label: '出撃30回',    hint: '出撃で通算30回戦う', to: '/game', place: '街（出撃）' },
    { label: '出撃50回',    hint: '出撃で通算50回戦う', to: '/game', place: '街（出撃）' },
    { label: '出撃100回',   hint: '出撃で通算100回戦う', to: '/game', place: '街（出撃）' },
    { label: 'ログイン1日目', hint: 'ゲームにログインする', center: true },
    { label: '強化1回',     hint: '鍛冶屋で装備を1回強化する', to: '/smithy', place: '鍛冶屋' },
    { label: '強化5回',     hint: '鍛冶屋で装備を5回強化する', to: '/smithy', place: '鍛冶屋' },
    { label: '強化10回',    hint: '鍛冶屋で装備を10回強化する', to: '/smithy', place: '鍛冶屋' },
    { label: '始まりの森ボス', hint: 'エリア①「始まりの森」のボスを倒す', to: '/game', place: '街（出撃）' },
  ],
  2: [
    { label: 'ランクマッチ挑戦', hint: 'ランクマッチに1回挑戦する', to: '/game?open=rankmatch', place: 'ランクマッチ' },
    { label: '釣り放置3時間',   hint: '釣りを3時間以上放置して回収する', to: '/fishing', place: '釣り堀' },
    { label: 'かかし修練3時間', hint: 'かかし修練を3時間以上完了する', to: '/scarecrow', place: 'かかし修練場' },
    { label: '初級の洞窟を踏破', hint: 'ダンジョン「初級の洞窟」を踏破する', to: '/dungeon', place: 'ペットダンジョン' },
    { label: 'レイド参加',      hint: 'レイドボスに1回参加する', center: true, to: '/raid', place: 'レイドボス' },
    { label: '上位職に転職',    hint: '上位クラスへ転職する', to: '/game?open=temple', place: '神殿' },
    { label: '博物館に5個寄贈', hint: '博物館に装備を5個寄贈する', to: '/museum', place: '博物館' },
    { label: '国に所属する',    hint: '非加盟国以外の国に所属／建国する', to: '/territory', place: '領地・国' },
    { label: '奈落 地下5階',    hint: '奈落闘技場の地下5階の敵を倒す', to: '/abyss', place: '奈落闘技場' },
  ],
}

const LINE_TIERS = [1, 2, 3, 4, 5, 6, 7, 8]

// 報酬行 {rewards:[{type,name,qty}],label} → 表示テキスト
const fmtReward = (rw) => {
  if (rw?.label) return rw.label
  const parts = (rw?.rewards || []).map(r =>
    r.type === 'gold' ? `${Number(r.qty || 0).toLocaleString()}G` : `${r.name}${(r.qty || 1) > 1 ? `×${r.qty}` : ''}`)
  return parts.length ? parts.join(' ＋ ') : '（報酬未設定）'
}
const rewardLines = (arr) => (arr || []).map(r =>
  r.type === 'gold' ? `${Number(r.qty || 0).toLocaleString()} Gold` : `${r.name}${(r.qty || 1) > 1 ? ` ×${r.qty}` : ''}`)

export default function BeginnerBingo() {
  const nav = useNavigate()
  const [card, setCard] = useState(1)
  const [card1Cleared, setCard1Cleared] = useState(false)  // ①の全9マス達成で②解放
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [devOnly, setDevOnly] = useState(false)
  const [got, setGot] = useState(null)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      await load(card)
      setLoading(false)
    })()
  }, [])

  const load = async (c = card) => {
    const { data: res, error } = await supabase.rpc('get_beginner_bingo', { p_card: c })
    if (error) { setMsg({ t: `読み込み失敗: ${error.message}`, c: '#ff5555' }); return }
    if (res?.dev_only) { setDevOnly(true); return }
    // ①の全9マス達成で②を解放
    if (c === 1) {
      const cs = res?.cells || []
      setCard1Cleared(cs.length === 9 && cs.every(Boolean))
    }
    setData(res)
  }

  const switchCard = async (c) => {
    if (c === card) return
    if (c === 2 && !card1Cleared) { flash('初心者ビンゴ①を全マス達成すると解放されます', '#ffaa44'); return }
    setCard(c); setData(null); setMsg(null)
    await load(c)
  }

  const flash = (t, c = '#ffcc44') => { setMsg({ t, c }); setTimeout(() => setMsg(null), 2800) }
  const rewardOf = (kind, idx) => (data?.rewards || []).find(r => r.kind === kind && r.idx === idx) || null

  const doClaim = async (kind, idx) => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('claim_beginner_bingo', { p_kind: kind, p_idx: idx, p_card: card })
    setBusy(false)
    if (error) { flash(`受取失敗: ${error.message}`, '#ff5555'); return }
    if (!res?.ok) {
      const map = { already: 'すでに受取済みです', not_completed: 'まだ達成していません', dev_only: '開発限定機能です' }
      flash(map[res?.error] || `受取失敗: ${res?.error || ''}`, '#ff5555')
      return
    }
    const lines = rewardLines(res.rewards)
    const cells = CELLS_BY_CARD[card]
    const title = kind === 'line' ? `${idx}ライン達成 報酬` : `「${cells[idx]?.label || 'ミッション'}」達成 報酬`
    setGot({ title, lines: lines.length ? lines : [res.label || '報酬'] })
    await load(card)
  }

  if (loading) return <div style={{ color: '#ffcc44', textAlign: 'center', marginTop: '40vh', fontFamily: 'monospace' }}>読み込み中...</div>

  const header = (extra) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3a2a0a', paddingBottom: '8px', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 30, paddingTop: '8px', background: '#0a0812' }}>
      <div style={{ color: '#ffcc44', fontSize: '15px', letterSpacing: '3px' }}>🎯 初心者ビンゴ{extra}</div>
      <button onClick={() => nav('/game')} style={{ background: 'none', border: '1px solid #0088ff', color: '#0088ff', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>← 街に戻る</button>
    </div>
  )

  if (devOnly) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0812', padding: '16px', fontFamily: 'monospace' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          {header('')}
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#cc9944' }}>この機能は現在 開発限定 で調整中です。</div>
        </div>
      </div>
    )
  }

  const cellsMeta = CELLS_BY_CARD[card]
  const cells = data?.cells || []
  const prog = data?.prog || []
  const lines = data?.lines || []
  const claimedCells = data?.claimed_cells || []
  const claimedLines = data?.claimed_lines || []
  const doneCount = cells.filter(Boolean).length
  const lineCount = lines.filter(Boolean).length

  const box = { border: '1px solid #3a2a0a', background: '#120e04', padding: '12px', marginBottom: '12px', borderRadius: '2px' }
  const tabBtn = (c) => ({
    flex: 1, padding: '7px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', borderRadius: '3px',
    background: card === c ? '#3a2a06' : '#0e0b04', border: `1px solid ${card === c ? '#ccaa44' : '#2a2418'}`,
    color: card === c ? '#ffdd88' : '#8a7a4a',
  })

  return (
    <div style={{ minHeight: '100vh', background: '#0a0812', padding: '16px', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        {header(card === 1 ? '①' : '②')}

        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          <button onClick={() => switchCard(1)} style={tabBtn(1)}>① 序盤ミッション</button>
          <button onClick={() => switchCard(2)} style={{ ...tabBtn(2), ...(card1Cleared ? {} : { color: '#5a5038', cursor: 'not-allowed' }) }}>
            {card1Cleared ? '② 次のステップ' : '② 🔒 ①クリアで解放'}
          </button>
        </div>

        {msg && (
          <div style={{ color: msg.c, fontSize: '12px', border: `1px solid ${msg.c}55`, background: '#1a1204', padding: '8px 12px', marginBottom: '10px' }}>{msg.t}</div>
        )}

        <div style={{ ...box, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
          <div><div style={{ color: '#888', fontSize: '10px' }}>マス</div><div style={{ color: '#ffcc44', fontSize: '15px' }}>{doneCount}/9</div></div>
          <div><div style={{ color: '#888', fontSize: '10px' }}>ライン</div><div style={{ color: '#ffaa44', fontSize: '15px' }}>{lineCount}/8</div></div>
        </div>

        <div style={{ color: '#6a5c3a', fontSize: '9.5px', marginBottom: '10px', textAlign: 'center' }}>
          ※ 各ミッションは<span style={{ color: '#aa8844' }}>このビンゴを始めてから</span>の達成でカウントされます（過去分は含みません）。<br />
          ※ 未達成のマスを<span style={{ color: '#66aaff' }}>タップするとその場所へ移動</span>できます。
        </div>

        {/* 3×3 ビンゴ盤 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '14px' }}>
          {cellsMeta.map((c, i) => {
            const done = !!cells[i]
            const claimed = claimedCells.includes(i)
            const rw = rewardOf('cell', i)
            const cur = prog[i]?.[0] ?? 0
            const target = prog[i]?.[1] ?? 0
            const pct = target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0
            const showBar = target > 1  // 目標2以上のマスだけ進捗バー表示
            const canGo = !done && !!c.to  // 未達成マスはタップでその場所へ移動できる
            return (
              <div key={i}
                onClick={canGo ? () => nav(c.to) : undefined}
                style={{
                border: `1px solid ${done ? '#7a6a1a' : '#2a2418'}`,
                background: c.center ? '#1a1404' : (done ? '#161002' : '#0e0b04'),
                borderRadius: '3px', padding: '8px 6px', minHeight: '104px',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                boxShadow: c.center ? 'inset 0 0 0 1px #7a5a1a' : 'none',
                cursor: canGo ? 'pointer' : 'default',
              }}>
                <div>
                  <div style={{ fontSize: '15px', textAlign: 'center', marginBottom: '2px' }}>{claimed ? '🎁' : (done ? '✅' : '⬜')}</div>
                  <div style={{ color: done ? '#ffdd88' : '#998866', fontSize: '10.5px', textAlign: 'center', lineHeight: '1.3' }}>{c.label}</div>
                  <div style={{ color: '#6a5c3a', fontSize: '8.5px', textAlign: 'center', lineHeight: '1.25', marginTop: '3px' }}>{c.hint}</div>
                </div>
                <div style={{ marginTop: '4px' }}>
                  {claimed ? (
                    <div style={{ color: '#66aa66', fontSize: '9px', textAlign: 'center' }}>受取済</div>
                  ) : done ? (
                    <button disabled={busy} onClick={() => doClaim('cell', i)} style={{
                      width: '100%', background: '#3a2a06', border: '1px solid #ccaa44', color: '#ffdd88',
                      padding: '3px', cursor: busy ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: '9.5px', borderRadius: '2px',
                    }}>報酬受取</button>
                  ) : (
                    <div style={{ textAlign: 'center' }}>
                      {showBar && (
                        <>
                          <div style={{ height: '4px', background: '#241c08', borderRadius: '2px', overflow: 'hidden', marginBottom: '2px' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#5a4818,#ffcc44)' }} />
                          </div>
                          <div style={{ color: '#b89a4a', fontSize: '8.5px' }}>{cur}/{target}（{pct}%）</div>
                        </>
                      )}
                      <div style={{ color: '#5a5038', fontSize: '8px', marginTop: '2px' }}>{fmtReward(rw)}</div>
                      {canGo && (
                        <div style={{ color: '#66aaff', fontSize: '8.5px', marginTop: '3px' }}>▶ {c.place}へ移動</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ライン報酬（達成したライン本数で解放） */}
        <div style={{ color: '#ffaa44', fontSize: '12px', marginBottom: '6px', letterSpacing: '1px' }}>▍ライン報酬（揃えたライン本数で解放・最大8）</div>
        <div style={{ ...box, padding: '8px' }}>
          {LINE_TIERS.map((n, i) => {
            const done = lineCount >= n
            const claimed = claimedLines.includes(n)
            const rw = rewardOf('line', n)
            return (
              <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', borderBottom: i < LINE_TIERS.length - 1 ? '1px solid #241c08' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px' }}>{claimed ? '🎁' : (done ? '✅' : '⬜')}</span>
                  <span style={{ color: done ? '#ffdd88' : '#998866', fontSize: '11px', minWidth: '56px' }}>{n}ライン</span>
                  <span style={{ color: '#6a5c3a', fontSize: '9.5px' }}>{fmtReward(rw)}</span>
                </div>
                {claimed ? (
                  <span style={{ color: '#66aa66', fontSize: '10px' }}>受取済</span>
                ) : done ? (
                  <button disabled={busy} onClick={() => doClaim('line', n)} style={{ background: '#3a2a06', border: '1px solid #ccaa44', color: '#ffdd88', padding: '3px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: '10px', borderRadius: '2px' }}>受取</button>
                ) : (
                  <span style={{ color: '#4a4230', fontSize: '10px' }}>あと{n - lineCount}本</span>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ color: '#6a5c3a', fontSize: '10px', lineHeight: '1.6' }}>
          ※「〇〇ボス装備選択箱」は<span style={{ color: '#aa8844' }}>装備タブ</span>から使うと、対象エリアのボス装備1つと交換できます。
        </div>
      </div>

      {got && (
        <div onClick={() => setGot(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#140f04', border: '1px solid #ccaa44', borderRadius: '6px', padding: '22px 20px', maxWidth: '340px', width: '100%', fontFamily: 'monospace', textAlign: 'center', boxShadow: '0 0 24px rgba(204,170,68,0.25)' }}>
            <div style={{ fontSize: '40px', marginBottom: '6px' }}>🎉</div>
            <div style={{ color: '#ffdd88', fontSize: '15px', letterSpacing: '1px', marginBottom: '4px' }}>報酬を獲得！</div>
            <div style={{ color: '#9a8a5a', fontSize: '11px', marginBottom: '14px' }}>{got.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
              {got.lines.map((t, i) => (
                <div key={i} style={{ background: '#241a06', border: '1px solid #5a4818', borderRadius: '3px', padding: '9px 10px', color: '#ffe6a6', fontSize: '13px' }}>🎁 {t}</div>
              ))}
            </div>
            <button onClick={() => setGot(null)}
              style={{ width: '100%', background: '#3a2a06', border: '1px solid #ccaa44', color: '#ffdd88', padding: '9px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px', borderRadius: '3px' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
