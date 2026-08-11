// ============================================================
// 拠点（Basecamp）  ※is_admin限定で先行公開
//   ・仲間を施設の枠に配置する → 時間経過で資材が貯まる → 回収する → 拠点LVを上げる
//   ・蓄積はサーバー側の pending / accrued_from が権威（ハートビートなし＝画面を閉じても進む）
//   ・レート・保管上限・強化コストは【クライアントで再計算しない】。
//     base_get() の返り値をそのまま表示するだけにして、SQLとJSで式がズレる事故を作らない。
//   ・状態取得/操作はすべて SECURITY DEFINER の RPC 経由（base_get / base_init /
//     base_assign / base_collect / base_upgrade）。
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { MATERIALS, APTITUDES, FACILITIES, SPECIES } from '../lib/basecamp'
import { reportDevAccess } from '../lib/devAccess'

// 端末風UIの色。拠点は街メニューのボタン色(#8fcf6f)に合わせた緑系でまとめる
const CL = {
  bg:     '#050e06',
  panel:  '#04160a',
  line:   '#1e5a2a',
  accent: '#8fcf6f',
  text:   '#a8d898',
  dim:    '#5f8a5a',
  faint:  '#3d5c3c',
  gold:   '#ffcc44',
  bad:    '#ff5555',
  ok:     '#66ff99',
  info:   '#66ccff',
}

// RPCが返す reason を日本語に変換する。想定外の値でも黙らないようフォールバックを出す。
// ★キーは supabase_kyoten_20260728.sql が実際に返す文字列と一字一句そろえること
//   （ズレると内部コードがそのままプレイヤーに出る）。
const REASON_TEXT = {
  not_authenticated:   'ログインし直してください',
  profile_not_found:   'キャラクターが見つかりません',
  not_admin:           '拠点は現在【開発限定】です',
  not_initialized:     '拠点がまだ作られていません',
  not_your_worker:     'それはあなたの仲間ではありません',
  invalid_facility:    'その施設には配置できません',
  facility_locked:     'その施設はまだ解放されていません',
  invalid_slot:        'その施設にその枠はありません',
  no_aptitude:         'この仲間はその作業ができません',
  slot_taken:          'その枠は既に埋まっています',
  worker_cap:          '配置できる仲間の上限です',
  max_lv:              '拠点は既に最大LVです',
  not_enough_material: '資材が足りません',
  not_enough_gold:     'Goldが足りません',
  not_enough:          '資材かGoldが足りません',
}
const reasonText = (r) => REASON_TEXT[r] || (r ? `失敗しました（${r}）` : '失敗しました')

const num = (v) => Number(v || 0).toLocaleString()
// レートは 30 / 26.4 のように小数1桁まで（サーバーの値をそのまま丸めるだけ）
const fmtRate = (v) => {
  const n = Number(v || 0)
  return (Math.round(n * 10) / 10).toString()
}
const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function Basecamp() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [picker, setPicker] = useState(null) // 配置先を選んでいる枠 {facility, slot, apt}
  const initedRef = useRef(false)            // base_init は1回だけ（失敗時の無限ループ防止）
  const busyRef = useRef(false)              // 定期リロードが操作中の結果を上書きしないように

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      await load()
      setLoading(false)
    })()
    // pending はサーバーが now() から計算するので、開きっぱなしでも増えるよう定期的に取り直す
    // （base_get は書き込みなしのSTABLEなので副作用はない）
    const id = setInterval(() => {
      if (!busyRef.current && !document.hidden) load(true)
    }, 60000)
    return () => clearInterval(id)
  }, [])

  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v) }
  const flash = (t, c = CL.ok) => { setMsg({ t, c }); setTimeout(() => setMsg(null), 3200) }

  const load = async (silent = false) => {
    const { data: res, error } = await supabase.rpc('base_get')
    if (error || !res?.ok) {
      // 開発限定の画面に非管理者が到達したら管理者へ通知（既存の開発アクセス検知と同じ）
      if (res?.reason === 'not_admin') reportDevAccess('basecamp', '拠点[開発]')
      if (!silent) setMsg({ t: `読み込み失敗: ${error?.message || reasonText(res?.reason)}`, c: CL.bad })
      return
    }
    // base_get は読み取り専用なので、拠点の実体（base_camp行・施設行・スライム1体）は作られない。
    // initialized:false のときだけクライアントから base_init() を呼んで作る（冪等）。
    if (res.initialized === false && !initedRef.current) {
      initedRef.current = true
      const { data: ini, error: e2 } = await supabase.rpc('base_init')
      if (e2 || !ini?.ok) {
        setMsg({ t: `拠点の作成に失敗しました: ${e2?.message || reasonText(ini?.reason)}`, c: CL.bad })
        setData(res)
        return
      }
      const { data: res2 } = await supabase.rpc('base_get')
      if (res2?.ok) { setData(res2); return }
    }
    setData(res)
  }

  // 配置／解除。facility に null を渡すと待機に戻す
  const doAssign = async (workerId, facility, slot) => {
    setBusyBoth(true)
    const { data: res, error } = await supabase.rpc('base_assign', {
      p_worker_id: workerId,
      p_facility: facility,
      p_slot: facility ? slot : null,
    })
    setBusyBoth(false)
    if (error || !res?.ok) { flash(`配置できません: ${error?.message || reasonText(res?.reason)}`, CL.bad); return }
    // 仲間を外すと保管上限が下がるので、超えたぶんはサーバーがその場で資材に回収する。
    // 黙って資材が増えると不審なので、何が入ったかを必ず伝える。
    const c = res.collected || {}
    const auto = Object.keys(MATERIALS)
      .filter(k => Number(c[k] || 0) > 0)
      .map(k => `${MATERIALS[k].emoji}${MATERIALS[k].name} +${num(c[k])}`)
    flash(
      (facility ? '👷 仲間を配置しました' : '🛖 仲間を待機に戻しました')
      + (auto.length ? `　📦 未回収ぶんを回収: ${auto.join('　')}` : ''),
    )
    await load()
  }

  const doCollect = async () => {
    setBusyBoth(true)
    const { data: res, error } = await supabase.rpc('base_collect')
    setBusyBoth(false)
    if (error || !res?.ok) { flash(`回収できません: ${error?.message || reasonText(res?.reason)}`, CL.bad); return }
    const g = res.gained || {}
    const got = Object.keys(MATERIALS)
      .filter(k => Number(g[k] || 0) > 0)
      .map(k => `${MATERIALS[k].emoji}${MATERIALS[k].name} +${num(g[k])}`)
    if (got.length) flash(`📦 ${got.join('　')} を回収しました！`)
    else flash('回収できる資材はありませんでした', CL.dim)
    await load()
  }

  const doUpgrade = async () => {
    setBusyBoth(true)
    const { data: res, error } = await supabase.rpc('base_upgrade')
    setBusyBoth(false)
    if (error || !res?.ok) { flash(`強化できません: ${error?.message || reasonText(res?.reason)}`, CL.bad); return }
    const joinName = res.joined ? (SPECIES[res.joined]?.name || res.joined) : null
    flash(`🏗 拠点が LV${res.lv} になりました！${joinName ? `　＋${joinName} が仲間に加わりました！` : ''}`)
    await load()
  }

  if (loading) {
    return <div style={{ color: CL.accent, textAlign: 'center', marginTop: '40vh', fontFamily: 'monospace' }}>読み込み中...</div>
  }

  const box = { border: `1px solid ${CL.line}`, background: CL.panel, padding: '12px', marginBottom: '10px', borderRadius: '2px' }
  const backBtn = (
    <button onClick={() => nav('/game')}
      style={{ background: 'none', border: '1px solid #0088ff', color: '#0088ff', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>
      ← 街に戻る
    </button>
  )

  // 読み込みに失敗した（RPC未適用・非管理者など）
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: CL.bg, padding: '16px', fontFamily: 'monospace' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${CL.line}`, paddingBottom: '8px', marginBottom: '12px' }}>
            <div style={{ color: CL.accent, fontSize: '15px', letterSpacing: '3px' }}>🏕 拠点</div>
            {backBtn}
          </div>
          {msg && <div style={{ color: msg.c, fontSize: '12px', border: `1px solid ${msg.c}55`, background: '#0a1206', padding: '8px 12px', marginBottom: '10px' }}>{msg.t}</div>}
          <div style={{ ...box, textAlign: 'center', padding: '32px 16px' }}>
            <div style={{ fontSize: '30px', marginBottom: '10px' }}>🔒</div>
            <div style={{ color: CL.text, fontSize: '13px', marginBottom: '10px' }}>拠点の情報を取得できませんでした</div>
            <button onClick={() => load()} style={{ padding: '8px 16px', background: '#0a2a10', border: `1px solid ${CL.accent}`, color: CL.accent, cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}>
              再読み込み
            </button>
          </div>
        </div>
      </div>
    )
  }

  const lv = data.lv || 1
  const maxLv = data.max_lv || 5
  const workerCap = data.worker_cap || 0
  const materials = data.materials || {}
  const workers = data.workers || []
  const facList = data.facilities || []
  const facMap = {}
  for (const f of facList) facMap[f.key] = f
  const next = data.next_cost || null
  const placed = workers.filter(w => w.facility).length
  const totalPending = facList.reduce((s, f) => s + Number(f.pending || 0), 0)

  const workerById = (id) => workers.find(w => w.id === id) || null
  // 枠が要求する作業（薬草畑の「採集役／水やり役」の言い分けもこれで作る）
  const aptOf = (facKey, slot) => facMap[facKey]?.slots?.find(s => s.slot === slot)?.apt || null
  const placementText = (w) => {
    if (!w.facility) return '待機中'
    const fname = FACILITIES[w.facility]?.name || w.facility
    const a = aptOf(w.facility, w.slot)
    return a ? `${fname}（${APTITUDES[a]?.name || a}）` : fname
  }
  // 適性は★の数で出す（0は表示しない）
  const aptBadges = (apt) => Object.keys(APTITUDES)
    .filter(k => Number(apt?.[k] || 0) > 0)
    .map(k => ({ key: k, lvl: Number(apt[k]), ...APTITUDES[k] }))

  // 強化に必要な資材の不足チェック（表示のためだけ。可否の正はサーバー側 base_upgrade）
  const lackList = next
    ? Object.keys(MATERIALS).filter(k => Number(next[k] || 0) > Number(materials[k] || 0))
    : []
  const lackGold = next ? Number(next.gold || 0) > Number(data.gold || 0) : false
  const canUpgrade = !!next && lackList.length === 0 && !lackGold

  return (
    <div style={{ minHeight: '100vh', background: CL.bg, padding: '16px', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        {/* ヘッダ */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${CL.line}`, paddingBottom: '8px', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 30, paddingTop: '8px', background: CL.bg }}>
          <div style={{ color: CL.accent, fontSize: '15px', letterSpacing: '3px' }}>🏕 拠点</div>
          {backBtn}
        </div>

        {msg && (
          <div style={{ color: msg.c, fontSize: '12px', border: `1px solid ${msg.c}55`, background: '#0a1206', padding: '8px 12px', marginBottom: '10px', lineHeight: '1.7' }}>{msg.t}</div>
        )}

        {/* ── 拠点LV ───────────────────────────── */}
        <div style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            <div style={{ color: CL.accent, fontSize: '14px' }}>
              拠点 LV{lv} <span style={{ color: CL.faint, fontSize: '10px' }}>/ 最大 LV{maxLv}</span>
            </div>
            <div style={{ color: CL.dim, fontSize: '11px' }}>
              配置 <b style={{ color: CL.text }}>{placed}</b> / {workerCap} 体
              <span style={{ color: CL.faint }}>　｜　</span>
              <span style={{ color: CL.gold }}>{num(data.gold)}G</span>
            </div>
          </div>

          {/* 所持資材（必要量つき・不足は赤） */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '6px' }}>
            {Object.keys(MATERIALS).map(k => {
              const m = MATERIALS[k]
              const have = Number(materials[k] || 0)
              const need = next ? Number(next[k] || 0) : 0
              const lack = need > have
              return (
                <div key={k} style={{ border: `1px solid ${lack ? '#663333' : '#183c1c'}`, background: '#020c04', padding: '6px 8px' }}>
                  <div style={{ color: CL.dim, fontSize: '10px' }}>{m.emoji} {m.name}</div>
                  <div style={{ fontSize: '13px', color: CL.text }}>
                    {num(have)}
                    {need > 0 && <span style={{ fontSize: '10px', color: lack ? CL.bad : CL.faint }}> / {num(need)}</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 強化 */}
          {next ? (
            <div style={{ marginTop: '10px' }}>
              <div style={{ color: CL.dim, fontSize: '11px', marginBottom: '6px', lineHeight: '1.8' }}>
                LV{next.lv} への強化に必要:
                {Object.keys(MATERIALS).filter(k => Number(next[k] || 0) > 0).map(k => (
                  <span key={k} style={{ color: Number(next[k]) > Number(materials[k] || 0) ? CL.bad : CL.text }}>
                    　{MATERIALS[k].name} {num(next[k])}
                  </span>
                ))}
                <span style={{ color: lackGold ? CL.bad : CL.gold }}>　{num(next.gold)}G</span>
              </div>
              {!canUpgrade && (
                <div style={{ color: CL.bad, fontSize: '10px', marginBottom: '6px' }}>
                  ※ 不足: {[...lackList.map(k => `${MATERIALS[k].name} ${num(Number(next[k]) - Number(materials[k] || 0))}`), ...(lackGold ? [`${num(Number(next.gold) - Number(data.gold || 0))}G`] : [])].join(' / ')}
                </div>
              )}
              <button onClick={doUpgrade} disabled={busy || !canUpgrade}
                style={{
                  padding: '8px 16px', fontFamily: 'monospace', fontSize: '12px',
                  background: canUpgrade ? '#0a2a10' : '#08120a',
                  border: `1px solid ${canUpgrade ? CL.accent : '#22401f'}`,
                  color: canUpgrade ? CL.accent : CL.faint,
                  cursor: (busy || !canUpgrade) ? 'not-allowed' : 'pointer',
                }}>
                🏗 拠点を強化する
              </button>
            </div>
          ) : (
            <div style={{ color: CL.gold, fontSize: '11px', marginTop: '10px' }}>🎉 拠点は最大LVです</div>
          )}
        </div>

        {/* ── 施設 ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px' }}>
          {Object.keys(FACILITIES).map(key => {
            const meta = FACILITIES[key]
            const f = facMap[key]
            if (!f) return null

            // 未解放（解放LVもサーバーの値をそのまま出す＝JS側に同じ表を持たない）
            if (!f.unlocked) {
              return (
                <div key={key} style={{ ...box, opacity: 0.7, marginBottom: 0 }}>
                  <div style={{ color: CL.faint, fontSize: '12px' }}>🔒 {meta.name}（未解放）</div>
                  {f.unlock_lv && (
                    <div style={{ color: CL.faint, fontSize: '10px', marginTop: '4px' }}>拠点LV{f.unlock_lv}で解放</div>
                  )}
                </div>
              )
            }

            // 倉庫は産出がなく枠もない
            if (!f.material) {
              return (
                <div key={key} style={{ ...box, marginBottom: 0 }}>
                  <div style={{ color: CL.accent, fontSize: '13px', marginBottom: '6px' }}>{meta.emoji} {meta.name}</div>
                  <div style={{ color: CL.text, fontSize: '12px' }}>保管上限 +50%</div>
                  <div style={{ color: CL.faint, fontSize: '10px', marginTop: '4px' }}>
                    全施設の保管上限が ×{data.storage_mult ?? 1} になっています
                  </div>
                </div>
              )
            }

            const mat = MATERIALS[f.material] || { name: f.material, emoji: '' }
            const pending = Number(f.pending || 0)
            const cap = Number(f.cap || 0)
            const rate = Number(f.rate || 0)
            const pct = cap > 0 ? Math.min(100, (pending / cap) * 100) : 0
            const full = cap > 0 && pending >= cap
            return (
              <div key={key} style={{ ...box, marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                  <div style={{ color: CL.accent, fontSize: '13px' }}>{meta.emoji} {meta.name}</div>
                  <div style={{ color: rate > 0 ? CL.text : CL.faint, fontSize: '11px' }}>
                    {mat.emoji}{mat.name} 毎時 {fmtRate(rate)}
                  </div>
                </div>

                {/* 貯まっている量／上限（上限は産出があるときだけ。「528 / 0」と出さない） */}
                <div style={{ color: full ? CL.gold : CL.dim, fontSize: '11px', marginBottom: '4px' }}>
                  {num(pending)}{cap > 0 ? ` / ${num(cap)}` : '（未回収）'}{full && ' （満杯）'}
                </div>
                <div style={{ height: '8px', background: '#02160a', border: `1px solid ${CL.line}`, marginBottom: '8px' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: full ? CL.gold : CL.accent }} />
                </div>

                {rate <= 0 && (
                  <div style={{ color: '#cc9944', fontSize: '10px', marginBottom: '8px' }}>
                    ※ 仲間を配置すると産出が始まります
                  </div>
                )}

                {/* 配置枠 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(f.slots || []).map(s => {
                    const a = APTITUDES[s.apt] || { name: s.apt, emoji: '' }
                    const w = s.worker_id ? workerById(s.worker_id) : null
                    if (!w) {
                      return (
                        <button key={s.slot} disabled={busy}
                          onClick={() => setPicker({ facility: key, facName: meta.name, slot: s.slot, apt: s.apt })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
                            padding: '8px', background: '#020c04', border: `1px dashed ${CL.line}`, color: CL.dim,
                            cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '11px',
                          }}>
                          <span style={{ fontSize: '16px' }}>{a.emoji}</span>
                          <span>＋ {a.name}の担当を選ぶ</span>
                        </button>
                      )
                    }
                    const sp = SPECIES[w.species] || { name: w.species, image: null }
                    return (
                      <div key={s.slot} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: '#020c04', border: `1px solid ${CL.line}` }}>
                        {sp.image && <img src={sp.image} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain', imageRendering: 'pixelated' }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: CL.text, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {w.nickname || sp.name}
                          </div>
                          <div style={{ color: CL.faint, fontSize: '10px' }}>
                            {a.emoji}{a.name} {'★'.repeat(Number(w.apt?.[s.apt] || 0))}
                          </div>
                        </div>
                        <button onClick={() => doAssign(w.id, null, null)} disabled={busy}
                          style={{ padding: '4px 8px', background: 'none', border: '1px solid #66444a', color: '#cc8899', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '10px' }}>
                          外す
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── 回収 ───────────────────────────── */}
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <button onClick={doCollect} disabled={busy || totalPending <= 0}
            style={{
              padding: '10px 24px', fontFamily: 'monospace', fontSize: '13px',
              background: totalPending > 0 ? '#0a2a10' : '#08120a',
              border: `1px solid ${totalPending > 0 ? CL.accent : '#22401f'}`,
              color: totalPending > 0 ? CL.accent : CL.faint,
              cursor: (busy || totalPending <= 0) ? 'not-allowed' : 'pointer',
            }}>
            📦 すべて回収{totalPending > 0 ? `（${num(totalPending)}）` : ''}
          </button>
        </div>

        {/* ── 仲間一覧 ───────────────────────── */}
        <div style={box}>
          <div style={{ color: CL.accent, fontSize: '13px', marginBottom: '8px' }}>
            🧑‍🌾 拠点の仲間 <span style={{ color: CL.faint, fontSize: '10px' }}>（{workers.length}体・配置 {placed}/{workerCap}）</span>
          </div>
          {workers.length === 0 ? (
            <div style={{ color: CL.faint, fontSize: '11px' }}>まだ仲間がいません</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
              {workers.map(w => {
                const sp = SPECIES[w.species] || { name: w.species, image: null }
                return (
                  <div key={w.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', border: `1px solid ${w.facility ? CL.line : '#1a2c1a'}`, background: '#020c04', padding: '8px' }}>
                    {sp.image && <img src={sp.image} alt="" style={{ width: '40px', height: '40px', objectFit: 'contain', imageRendering: 'pixelated' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: CL.text, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.nickname || sp.name}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '3px 0' }}>
                        {aptBadges(w.apt).map(b => (
                          <span key={b.key} style={{ fontSize: '9px', color: CL.dim, border: `1px solid ${CL.line}`, padding: '1px 4px' }}>
                            {b.emoji}{b.name}{'★'.repeat(b.lvl)}
                          </span>
                        ))}
                      </div>
                      <div style={{ color: w.facility ? CL.ok : CL.faint, fontSize: '10px' }}>{placementText(w)}</div>
                    </div>
                    {w.facility && (
                      <button onClick={() => doAssign(w.id, null, null)} disabled={busy}
                        style={{ padding: '4px 8px', background: 'none', border: '1px solid #66444a', color: '#cc8899', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '10px' }}>
                        外す
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ color: CL.faint, fontSize: '10px', lineHeight: '1.8', marginBottom: '24px' }}>
          ※ 資材は画面を閉じていても貯まります（施設ごとの保管上限まで）。<br />
          ※ 配置を変えると、その時点までの産出は先に確定してから新しいレートに切り替わります。<br />
          {data.server_now && <>※ 最終更新 {fmtTime(data.server_now)}</>}
        </div>
      </div>

      {/* ── 配置する仲間を選ぶ ───────────────── */}
      {picker && (() => {
        const a = APTITUDES[picker.apt] || { name: picker.apt, emoji: '' }
        // 適性のある仲間を上に、その中でも適性が高い順に並べる
        const sorted = [...workers].sort((x, y) => Number(y.apt?.[picker.apt] || 0) - Number(x.apt?.[picker.apt] || 0))
        return (
          <div onClick={() => setPicker(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ border: `1px solid ${CL.accent}`, background: '#04160a', padding: '14px', maxWidth: '420px', width: '100%', maxHeight: '78vh', overflowY: 'auto', fontFamily: 'monospace' }}>
              <div style={{ color: CL.accent, fontSize: '13px', marginBottom: '4px' }}>
                {a.emoji} {picker.facName} の{a.name}担当
              </div>
              <div style={{ color: CL.faint, fontSize: '10px', marginBottom: '10px' }}>
                適性の高い仲間ほどよく働きます（配置上限 {workerCap}体・現在 {placed}体）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sorted.map(w => {
                  const sp = SPECIES[w.species] || { name: w.species, image: null }
                  const lvl = Number(w.apt?.[picker.apt] || 0)
                  const ok = lvl > 0
                  return (
                    <button key={w.id} disabled={busy || !ok}
                      onClick={async () => { setPicker(null); await doAssign(w.id, picker.facility, picker.slot) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left', padding: '8px',
                        background: ok ? '#020c04' : '#0a0a0a', border: `1px solid ${ok ? CL.line : '#2a2a2a'}`,
                        color: ok ? CL.text : '#555555', cursor: (busy || !ok) ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace', fontSize: '11px', opacity: ok ? 1 : 0.6,
                      }}>
                      {sp.image && <img src={sp.image} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain', imageRendering: 'pixelated' }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div>{w.nickname || sp.name} {ok && <span style={{ color: CL.accent }}>{'★'.repeat(lvl)}</span>}</div>
                        <div style={{ color: ok ? CL.faint : '#555555', fontSize: '10px' }}>
                          {ok ? placementText(w) : `${a.name}はできません`}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              <button onClick={() => setPicker(null)}
                style={{ width: '100%', marginTop: '10px', padding: '8px', background: '#0a140a', border: '1px solid #33553a', color: CL.dim, cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>
                閉じる
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
