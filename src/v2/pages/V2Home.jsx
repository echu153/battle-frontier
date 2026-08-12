import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { validateName } from '../../lib/nameFilter'
import { reportDevAccess } from '../../lib/devAccess'
import {
  STAT_KEYS, STAT_DEFS, MAX_LV, ROLLS_PER_LV, JOB_CHANGE_POWER,
  calcPower, expToNext, expPerLv, canJobChange,
} from '../lib/stats.js'
import { TIER_LABEL, TIER_ORDER, TIER_COLOR, missingReqs, canBecome, reqText, proofCount } from '../lib/classes.js'
import { skillsOf, powerText, expectedDamage, expectedHeal, KIND_LABEL, KIND_COLOR } from '../lib/skills.js'
import { damageOf, healOf } from '../lib/combat.js'

// ============================================================
// バトルフロンティアⅡ（リメイク版）ホーム — 開発限定
//  現時点の中身は「ステータスと成長」だけ。EXPを入れて上がり方を確かめるための画面。
//  ステの更新は必ずサーバー（v2_apply_exp）が行い、ここは結果を表示するだけ。
// ============================================================

const box = { border:'1px solid #0044aa', background:'#001040', fontFamily:'monospace' }
const btn = (color) => ({
  background:'#001840', border:`1px solid ${color}`, color, padding:'8px 12px',
  cursor:'pointer', fontFamily:'monospace', fontSize:'12px',
})

export default function V2Home() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [sqlError, setSqlError] = useState('')   // supabase_v2_core.sql 未適用の案内用
  const [prof, setProf] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [classes, setClasses] = useState([])           // 職業マスタ（正はDBの v2_classes）
  const [confirmJob, setConfirmJob] = useState(null)   // 転職はステが初期値に戻るので1段確認する（選んだ職業を保持）
  const [showJobList, setShowJobList] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { nav('/login'); return }
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
        // 開発限定。非管理者は旧BFへ戻す（アクセスは管理者へ通知）
        if (!p?.is_admin) { reportDevAccess('v2_remake', 'リメイク版[開発]'); nav('/game'); return }
        if (!alive) return
        setName(p.username || '')
        const [{ data: v2, error: e2 }, { data: cls, error: e3 }] = await Promise.all([
          supabase.from('v2_profiles').select('*').eq('id', user.id).maybeSingle(),
          supabase.from('v2_classes').select('*').order('sort'),
        ])
        if (!alive) return
        if (e2 || e3) { setSqlError((e2 || e3).message || String(e2 || e3)); setLoading(false); return }
        setProf(v2 || null)
        setClasses(cls || [])
      } catch (err) {
        setSqlError(err.message || String(err))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [nav])

  const create = async (e) => {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) { setError(nameErr); return }
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_create_character', { p_username: name.trim() })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '作成に失敗しました'); return }
    setProf(data.profile)
  }

  const gainExp = async (amount) => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_debug_gain_exp', { p_amount: amount })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || 'EXPの付与に失敗しました'); return }
    const before = prof
    setProf(data.profile)
    const gains = data.gains || {}
    setLog(l => [{
      id: `${Date.now()}-${Math.random()}`,
      amount,
      ups: data.level_ups,
      lvFrom: before?.lv, lvTo: data.profile.lv,
      gains: STAT_KEYS.filter(k => gains[k] > 0).map(k => `${STAT_DEFS[k].label}+${gains[k]}`).join(' / ') || 'なし',
    }, ...l].slice(0, 12))
  }

  const changeJob = async (classId) => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_change_job', { p_class: classId })
    setBusy(false); setConfirmJob(null)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '転職に失敗しました'); return }
    setProf(data.profile)
    setShowJobList(false)
    const alloc = data.alloc || {}
    setLog(l => [{
      id: `${Date.now()}-${Math.random()}`,
      job: data.job_changes,
      className: data.class,
      points: data.points,
      usedProof: data.used_proof,
      gains: STAT_KEYS.filter(k => alloc[k] > 0).map(k => `${STAT_DEFS[k].label}+${alloc[k]}`).join(' / ') || 'なし',
    }, ...l].slice(0, 12))
  }

  const grantProofs = async () => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_debug_grant_proofs')
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '証の付与に失敗しました'); return }
    setProf(data.profile)
  }

  // 転職条件の判定に使う状態（サーバー側 v2_change_job と同じ条件を画面にも出す）
  const jobState = { jobCounts: prof?.job_counts || {}, proofs: prof?.proofs || {} }

  if (loading) {
    return <div style={{ minHeight:'100vh', background:'#000820', color:'#0088ff', fontFamily:'monospace', padding:'40px', textAlign:'center' }}>読み込み中...</div>
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'560px', margin:'0 auto' }}>

        {/* ヘッダ */}
        <div style={{ ...box, padding:'12px 14px', marginBottom:'12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
          <div>
            <div style={{ color:'#ffcc00', fontSize:'15px', letterSpacing:'2px' }}>BATTLE FRONTIER Ⅱ</div>
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>リメイク版 <span style={{ color:'#8877aa' }}>[開発]</span></div>
          </div>
          <button onClick={() => nav('/game')} style={btn('#446688')}>← 旧版へ戻る</button>
        </div>

        {/* SQL未適用の案内 */}
        {sqlError && (
          <div style={{ ...box, borderColor:'#aa4400', background:'#1a0a00', padding:'14px', color:'#ffaa66', fontSize:'12px', lineHeight:'1.9' }}>
            <div style={{ color:'#ff8844', marginBottom:'6px' }}>⚠ v2のテーブルが見つかりません</div>
            <div><code style={{ color:'#ffcc88' }}>supabase_v2_core.sql</code> をSupabaseで実行してください。</div>
            <div style={{ color:'#886644', fontSize:'10px', marginTop:'8px', wordBreak:'break-all' }}>{sqlError}</div>
          </div>
        )}

        {/* キャラクター作成 */}
        {!sqlError && !prof && (
          <form onSubmit={create} style={{ ...box, padding:'16px' }}>
            <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'10px' }}>キャラクターを作成</div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>冒険者名</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={16} required
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', boxSizing:'border-box', marginBottom:'10px' }} />
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'10px' }}>
              {busy ? '作成中...' : '▶ はじめる'}
            </button>
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
              旧版のキャラクターとは完全に別のデータです（同じアカウントで両方遊べます）。
            </div>
          </form>
        )}

        {/* ステータス */}
        {prof && (
          <>
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:'10px' }}>
                <div>
                  <span style={{ color:'#88ccff', fontSize:'14px' }}>{prof.username}</span>
                  <span style={{ color:TIER_COLOR[classes.find(c => c.id === prof.class)?.tier] || '#88aaff', fontSize:'11px', marginLeft:'8px' }}>{prof.class}</span>
                  {prof.job_changes > 0 && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'6px' }}>転職{prof.job_changes}回</span>}
                </div>
                <div style={{ color:'#ffcc00', fontSize:'13px' }}>LV {prof.lv}{prof.lv >= MAX_LV && <span style={{ color:'#ff8844', fontSize:'10px', marginLeft:'4px' }}>MAX</span>}</div>
              </div>

              {/* EXPバー。必要EXPは転職回数で重くなる */}
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'3px' }}>
                EXP {prof.exp} / {expToNext(prof.lv, prof.job_changes) || '—'}
              </div>
              <div style={{ height:'6px', background:'#001028', border:'1px solid #002244', marginBottom:'12px' }}>
                <div style={{ height:'100%', width:`${Math.min(100, (prof.exp / expPerLv(prof.job_changes)) * 100)}%`, background:'#44aaff' }} />
              </div>

              {/* 戦闘力 */}
              <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px 10px', marginBottom:'12px', display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#446688', fontSize:'11px' }}>戦闘力</span>
                <span style={{ color:'#ffcc00', fontSize:'14px' }}>{calcPower(prof)}</span>
              </div>

              {/* ステータス8種 */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'6px' }}>
                {STAT_KEYS.map(k => {
                  const d = STAT_DEFS[k]
                  return (
                    <div key={k} title={d.desc} style={{ background:'#000818', border:'1px solid #002244', padding:'7px 9px', display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                      <span style={{ color:'#446688', fontSize:'11px' }}>
                        <span style={{ color:d.color }}>{d.label}</span>
                        <span style={{ fontSize:'9px', marginLeft:'4px' }}>{d.jp}</span>
                      </span>
                      <span style={{ color:d.color, fontSize:'13px' }}>{prof[k]}</span>
                    </div>
                  )
                })}
              </div>

              <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
                LVアップごとに{ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。
                どのステに当たっても戦闘力の上がり幅は同じです。
              </div>
            </div>

            {/* いまの職業のスキル */}
            {skillsOf(prof.class).length > 0 && (
              <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
                <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>⚔ {prof.class}のスキル</div>
                <div style={{ display:'grid', gap:'4px' }}>
                  {skillsOf(prof.class).map(s => {
                    const dmg = expectedDamage(s, prof, prof, damageOf)
                    const heal = expectedHeal(s, prof, healOf)
                    return (
                      <div key={s.name} style={{ background:'#000818', border:'1px solid #002244', padding:'7px 9px' }}>
                        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:'8px' }}>
                          <span style={{ color:KIND_COLOR[s.kind], fontSize:'12px' }}>
                            {s.name}
                            <span style={{ color:'#556677', fontSize:'9px', marginLeft:'5px' }}>{KIND_LABEL[s.kind]}</span>
                          </span>
                          <span style={{ color:'#446688', fontSize:'10px' }}>発動{s.proc}% ／ MP{s.mp}</span>
                        </div>
                        <div style={{ color:'#556677', fontSize:'9px', marginTop:'3px' }}>
                          {powerText(s)}
                          {dmg > 0 && <span style={{ color:'#88ddaa', marginLeft:'6px' }}>同格相手に期待{dmg}</span>}
                          {heal > 0 && <span style={{ color:'#44ff88', marginLeft:'6px' }}>期待{heal}{s.mpRegen ? 'MP' : '回復'}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ color:'#446688', fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
                  スキルは毎ターン発動率で抽選します。「期待」は自分と同じステータスの相手に対する1ターンの概算（命中・クリティカルは含めません）。
                </div>
              </div>
            )}

            {/* 転職（LV上限で周回する） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px', borderColor: canJobChange(prof.lv) ? '#aa4488' : '#0044aa' }}>
              <div style={{ color:'#ff88cc', fontSize:'12px', marginBottom:'8px' }}>🔄 転職</div>
              <div style={{ color:'#446688', fontSize:'10px', lineHeight:'1.9', marginBottom:'10px' }}>
                LV{MAX_LV}で転職できます。LV1に戻り、ステータスは初期値へリセットされたうえで
                <span style={{ color:'#ff88cc' }}> 転職回数×{JOB_CHANGE_POWER}</span>（＝{JOB_CHANGE_POWER / ROLLS_PER_LV}LV分）の戦闘力がランダムに振り分けられます。
                振り分けは毎回引き直しです。転職を重ねるほどLVアップに必要なEXPも重くなります。
              </div>
              {!canJobChange(prof.lv) && (
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>LV{MAX_LV}まであと{MAX_LV - prof.lv}</div>
              )}

              {/* 転職先の一覧。LV100未満でも条件の確認用に開ける */}
              <button onClick={() => { setShowJobList(v => !v); setConfirmJob(null) }} style={btn(canJobChange(prof.lv) ? '#ff88cc' : '#446688')}>
                {showJobList ? '▼ 職業一覧を閉じる' : `▶ 職業一覧（${classes.filter(c => canBecome(c, jobState)).length}職が選択可）`}
              </button>

              {showJobList && (
                <div style={{ marginTop:'10px' }}>
                  {TIER_ORDER.map(tier => {
                    const list = classes.filter(c => c.tier === tier)
                    if (list.length === 0) return null
                    return (
                      <div key={tier} style={{ marginBottom:'10px' }}>
                        <div style={{ color:TIER_COLOR[tier], fontSize:'10px', letterSpacing:'2px', marginBottom:'4px' }}>{TIER_LABEL[tier]}</div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'4px' }}>
                          {list.map(c => {
                            const ok = canBecome(c, jobState)
                            const miss = missingReqs(c, jobState)
                            const selectable = ok && canJobChange(prof.lv)
                            return (
                              <div key={c.id} style={{ background:'#000818', border:`1px solid ${ok ? TIER_COLOR[tier] : '#002244'}`, padding:'7px 9px' }}>
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
                                  <span style={{ color: ok ? TIER_COLOR[tier] : '#446688', fontSize:'12px' }}>
                                    {c.id}{prof.job_counts?.[c.id] > 0 && <span style={{ color:'#556677', fontSize:'9px', marginLeft:'5px' }}>×{prof.job_counts[c.id]}</span>}
                                    {c.req_proof && <span style={{ color: proofCount(jobState.proofs, c.req_proof) > 0 ? '#ffaa44' : '#664433', fontSize:'9px', marginLeft:'6px' }}>証{proofCount(jobState.proofs, c.req_proof)}個</span>}
                                  </span>
                                  {selectable && confirmJob !== c.id && (
                                    <button onClick={() => setConfirmJob(c.id)} disabled={busy} style={{ ...btn(TIER_COLOR[tier]), padding:'4px 8px', fontSize:'11px' }}>転職</button>
                                  )}
                                </div>
                                <div style={{ color: ok ? '#556677' : '#775544', fontSize:'9px', marginTop:'3px' }}>
                                  {ok ? reqText(c) : `未達：${miss.join(' ／ ')}`}
                                </div>
                                {confirmJob === c.id && (
                                  <div style={{ marginTop:'6px' }}>
                                    <div style={{ color:'#ffaa66', fontSize:'10px', marginBottom:'6px' }}>
                                      いま育てたステータスは失われます。{c.id}に転職しますか？（{prof.job_changes + 1}回目・戦闘力{(prof.job_changes + 1) * JOB_CHANGE_POWER}分）
                                    </div>
                                    <div style={{ display:'flex', gap:'6px' }}>
                                      <button onClick={() => changeJob(c.id)} disabled={busy} style={{ ...btn('#ff88cc'), padding:'4px 10px', fontSize:'11px' }}>{busy ? '転職中...' : 'はい'}</button>
                                      <button onClick={() => setConfirmJob(null)} disabled={busy} style={{ ...btn('#446688'), padding:'4px 10px', fontSize:'11px' }}>やめる</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ color:'#446688', fontSize:'9px', lineHeight:'1.8' }}>
                    ×N＝その職業で転職した回数。上位職の条件はこの回数を見ます。
                    証は転職のときに1個消費します（同じ職業に戻るにはもう1個要ります）。
                    職業による能力差はまだありません（スキルを実装するときに付けます）。
                  </div>
                </div>
              )}
            </div>

            {/* 動作確認用のEXP付与 */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'8px' }}>🧪 EXP付与 <span style={{ color:'#8877aa', fontSize:'9px' }}>[開発]</span></div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {[60, 600, 6000].map(a => (
                  <button key={a} onClick={() => gainExp(a)} disabled={busy || prof.lv >= MAX_LV} style={{ ...btn('#44ffaa'), opacity: (busy || prof.lv >= MAX_LV) ? 0.4 : 1 }}>
                    EXP +{a}
                  </button>
                ))}
                {/* 証の入手手段がまだ無いので、条件確認用にまとめて配る */}
                <button onClick={grantProofs} disabled={busy} style={btn('#ffaa44')}>証をすべて入手</button>
              </div>
              {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {error}</div>}
              {prof.lv >= MAX_LV && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'8px' }}>LV{MAX_LV}に到達しています。EXPは入りません（転職してください）。</div>}
            </div>

            {/* 上昇ログ */}
            {log.length > 0 && (
              <div style={{ ...box, padding:'14px' }}>
                <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'8px' }}>成長ログ</div>
                {log.map(l => (
                  <div key={l.id} style={{ borderBottom:'1px solid #002244', padding:'6px 0', fontSize:'11px', lineHeight:'1.7' }}>
                    {l.job ? (
                      <>
                        <span style={{ color:'#ff88cc' }}>🔄 転職{l.job}回目 → {l.className}</span>
                        <span style={{ color:'#446688', marginLeft:'8px', fontSize:'10px' }}>戦闘力{l.points}分を振り分け</span>
                        {l.usedProof && <span style={{ color:'#ffaa44', marginLeft:'6px', fontSize:'9px' }}>{l.usedProof}を1個消費</span>}
                      </>
                    ) : (
                      <>
                        <span style={{ color:'#446688' }}>EXP+{l.amount}</span>
                        <span style={{ color:'#ffcc00', marginLeft:'8px' }}>LV {l.lvFrom} → {l.lvTo}</span>
                        <span style={{ color:'#446688', marginLeft:'6px', fontSize:'10px' }}>（{l.ups}回）</span>
                      </>
                    )}
                    <div style={{ color:'#88ddaa', fontSize:'10px' }}>{l.gains}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
