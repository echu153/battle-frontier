import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { SPECIES, STARTERS, SKILLS, skillsForSpecies, MAX_SKILL_SLOTS, SHOP_ITEMS, PET_ITEMS, INV_MAX, petStats, speciesLabel, speciesEmoji, expForLevel, atkLabel, canEvolve, petMaxLevel, evolvedName, petImage, evolvedImage, assetSrc, getCharm, charmDisplayName, charmHpBonus, isRibbonType } from '../constants/pets'
import { validateName } from '../lib/nameFilter'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
// ペット画像はペットページでアップロードしたものだけを使う（avatars/<uid>/pets/ 配下）

export default function Pets() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [pets, setPets] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [uploaded, setUploaded] = useState([])
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [naming, setNaming] = useState(null) // 命名中のスターター種族 {id,label,...}
  const [nick, setNick] = useState('')
  const [, setItems] = useState({}) // 所持アイテム { key: qty }
  const [renaming, setRenaming] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [evolveConfirm, setEvolveConfirm] = useState(null) // 進化確認ポップアップ対象のペット
  const [evolveDone, setEvolveDone] = useState(null)       // 進化完了ポップアップ対象のペット
  const [showShop, setShowShop] = useState(false)          // ペット商店モーダル
  const [storage, setStorage] = useState({})               // 倉庫 { key: qty }
  const [showHelp, setShowHelp] = useState(false)          // ヘルプ（ペットシステム説明）
  const [buyQty, setBuyQty] = useState({})                 // 商店の購入個数 { key: n }
  const [charms, setCharms] = useState([])                 // 所持チャーム

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('id, is_admin, gold').eq('id', user.id).single()
    if (!p) { nav('/game'); return }
    setProfile(p)
    try { await supabase.rpc('pet_charm_init') } catch { /* チャーム未導入時は無視 */ }
    const { data: chs } = await supabase.from('player_charms').select('*').eq('owner_id', user.id)
    setCharms(chs || [])
    const { data: list } = await supabase.from('pets').select('*').eq('owner_id', user.id).order('created_at')
    setPets(list || [])
    // 初めてペット選択画面を開いたとき（まだ1体もいない）はヘルプを自動表示
    if ((list || []).length === 0 && !localStorage.getItem('bf_pet_help_seen')) {
      localStorage.setItem('bf_pet_help_seen', '1')
      setShowHelp(true)
    }
    if (list && list.length && !selectedId) setSelectedId(list.find((x) => x.is_active)?.id || list[0].id)
    const { data: files } = await supabase.storage.from('avatars').list(`${user.id}/pets/`)
    if (files) setUploaded(files.filter((f) => f.name !== '.emptyFolderPlaceholder').map((f) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/pets/${f.name}`))
    const { data: its } = await supabase.from('pet_items').select('item_key, qty').eq('owner_id', user.id)
    if (its) setItems(Object.fromEntries(its.map((r) => [r.item_key, r.qty])))
    const { data: sto } = await supabase.from('pet_storage').select('item_key, qty').eq('owner_id', user.id)
    setStorage(Object.fromEntries((sto || []).map((r) => [r.item_key, r.qty])))
  }

  const buyItem = async (key, qty = 1) => {
    setLoading(true)
    const { error } = await supabase.rpc('pet_shop_buy', { p_key: key, p_qty: qty })
    setLoading(false)
    if (error) {
      const m = String(error.message)
      flash(m.includes('gold') ? 'Goldが足りません' : m.includes('inventory') ? `アイテム袋がいっぱいです（だっしゅつの翼以外は合計${INV_MAX}個まで）` : '購入失敗: ' + m)
      return
    }
    flash(`${PET_ITEMS[key]?.name || 'アイテム'}を${qty}個 購入しました`)
    setBuyQty((b) => ({ ...b, [key]: 1 })) // 購入後は個数を1にリセット
    await fetchAll()
  }

  const doRename = async () => {
    const nameErr = validateName(renameInput, { maxLen: 12, label: 'ペット名' })
    if (nameErr) { flash(nameErr); return }
    setLoading(true)
    const { error } = await supabase.rpc('pet_use_rename', { p_pet_id: selectedId, p_name: renameInput })
    setLoading(false)
    if (error) { flash(String(error.message).includes('ticket') ? '変更券がありません' : '変更失敗: ' + error.message); return }
    setRenaming(false); setRenameInput('')
    flash('名前を変更しました')
    await fetchAll()
  }

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const pickStarter = async (sp, name) => {
    const finalName = (name || '').trim() || sp.label
    const nameErr = validateName(finalName, { maxLen: 12, label: 'ペット名' })
    if (nameErr) { flash(nameErr); return }
    setLoading(true)
    const { error } = await supabase.from('pets').insert({
      owner_id: profile.id, species: sp.id, name: finalName, level: 1, exp: 0, is_active: true,
    })
    setLoading(false)
    if (error) { flash('作成に失敗: ' + error.message); return }
    setNaming(null)
    flash(`${finalName} を仲間にした！`)
    await fetchAll()
  }

  const setActive = async (pet) => {
    setLoading(true)
    // 部分ユニーク制約のため、まず全部 false にしてから対象を true
    await supabase.from('pets').update({ is_active: false }).eq('owner_id', profile.id)
    await supabase.from('pets').update({ is_active: true }).eq('id', pet.id)
    setLoading(false)
    flash(`${pet.name} を選択した`)
    await fetchAll()
  }

  const equipCharm = async (charmId) => {
    if (!selectedId) return
    setLoading(true)
    const { error } = await supabase.rpc('pet_charm_equip', { p_pet_id: selectedId, p_charm_id: charmId })
    setLoading(false)
    if (error) { flash('装備に失敗: ' + error.message); return }
    flash('チャームを装備した')
    await fetchAll()
  }

  // リボン（チャームとは別枠）。null で外す
  const equipRibbon = async (ribbonId) => {
    if (!selectedId) return
    setLoading(true)
    const { error } = await supabase.rpc('pet_ribbon_equip', { p_pet_id: selectedId, p_ribbon_id: ribbonId })
    setLoading(false)
    if (error) { flash('装備に失敗: ' + error.message); return }
    flash(ribbonId ? 'リボンを装備した' : 'リボンを外した')
    await fetchAll()
  }

  const doEvolve = async (pet) => {
    setLoading(true)
    const { error } = await supabase.rpc('pet_evolve', { p_pet_id: pet.id })
    if (!error) {
      // 進化したら画像を進化後イラストに差し替える（カスタム画像も上書き。その後また変更可）
      const evoImg = evolvedImage(pet)
      if (evoImg) await supabase.from('pets').update({ image_url: evoImg }).eq('id', pet.id)
    }
    setLoading(false)
    setEvolveConfirm(null)
    if (error) { flash('進化に失敗: ' + error.message); return }
    setEvolveDone(pet)   // 同じポップアップで「○○に進化した！」を表示
    await fetchAll()
  }

  const setImage = async (url) => {
    if (!selectedId) return
    setLoading(true)
    await supabase.from('pets').update({ image_url: url }).eq('id', selectedId)
    setLoading(false)
    flash('画像を設定した')
    await fetchAll()
  }

  const toggleSlot = async (skillId) => {
    if (!selectedId) return
    if (SKILLS[skillId]?.fixed) return // たいあたりは固定装備（外せない）
    // 旧スキルや別種族の不正なIDを除去（たいあたりは常に保持）。これが残っていると枠が埋まって選べなくなる
    const validIds = new Set(skillsForSpecies(selected.species).map((s) => s.id))
    let slots = (Array.isArray(selected.skill_slots) ? selected.skill_slots : ['tackle']).filter((s) => s === 'tackle' || validIds.has(s))
    if (!slots.includes('tackle')) slots = ['tackle', ...slots]
    let next
    if (slots.includes(skillId)) {
      if (slots.length <= 1) { flash('スキルは最低1つ必要です'); return }
      next = slots.filter((s) => s !== skillId)
    } else {
      if (slots.length >= MAX_SKILL_SLOTS) { flash(`持っていけるスキルは最大${MAX_SKILL_SLOTS}つまで`); return }
      next = [...slots, skillId]
    }
    setLoading(true)
    await supabase.from('pets').update({ skill_slots: next }).eq('id', selectedId)
    setLoading(false)
    await fetchAll()
  }

  const uploadImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setLoading(true)
    const ext = file.name.split('.').pop()
    const path = `${profile.id}/pets/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (error) { flash('アップロード失敗'); setLoading(false); return }
    const url = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`
    await supabase.from('pets').update({ image_url: url }).eq('id', selectedId)
    setLoading(false)
    flash('画像をアップロードして設定した')
    await fetchAll()
  }

  if (!profile || pets === null) return <Center>読み込み中...</Center>

  // スターター未所持
  if (pets.length === 0) {
    // 命名ステップ
    if (naming) {
      const st = petStats({ species: naming.id, level: 1 })
      return (
        <Wrap nav={nav} msg={msg}>
          <h3 style={{ color: '#aa88ff', margin: '12px 0' }}>名前をつけよう</h3>
          <div style={{ border: '1px solid #335588', background: '#001026', padding: 16, textAlign: 'center' }}>
            {naming.image ? <img src={assetSrc(naming.image)} alt="" style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 6 }} /> : <div style={{ fontSize: 56 }}>{naming.emoji}</div>}
            <div style={{ color: '#6699cc', fontSize: 11, margin: '6px 0' }}>{naming.label}　HP{st.maxHp} / {atkLabel(naming)}{st.atk} / 防{st.def} / 特防{st.mdef}</div>
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={12} placeholder={naming.label}
              style={{ width: '70%', padding: 8, margin: '10px 0', background: '#000818', border: '1px solid #335588', color: '#cce6ff', fontFamily: 'monospace', textAlign: 'center', fontSize: 14 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6 }}>
              <Btn onClick={() => { setNaming(null); setNick('') }}>もどる</Btn>
              <Btn onClick={() => !loading && pickStarter(naming, nick)}>この名前で決定</Btn>
            </div>
          </div>
        </Wrap>
      )
    }
    return (
      <Wrap nav={nav} msg={msg}>
        <h3 style={{ color: '#aa88ff', margin: '12px 0' }}>最初のペットを選ぼう</h3>
        <div style={{ color: '#5588bb', fontSize: 12, marginBottom: 12 }}>1体だけ選べます。他の種族は今後「卵」で入手できます。</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {STARTERS.map((sp) => {
            const st = petStats({ species: sp.id, level: 1 })
            return (
              <div key={sp.id} style={{ border: '1px solid #335588', background: '#001026', padding: 10, textAlign: 'center' }}>
                {sp.image ? <img src={assetSrc(sp.image)} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 6 }} /> : <div style={{ fontSize: 40 }}>{sp.emoji}</div>}
                <div style={{ color: '#cce6ff', marginTop: 4 }}>{sp.label}</div>
                <div style={{ color: '#6699cc', fontSize: 11, margin: '6px 0' }}>HP{st.maxHp} / {atkLabel({ species: sp.id })}{st.atk} / 防{st.def} / 特防{st.mdef}</div>
                <Btn onClick={() => { setNaming(sp); setNick(sp.label) }}>選ぶ</Btn>
              </div>
            )
          })}
        </div>
      </Wrap>
    )
  }

  const selected = pets.find((p) => p.id === selectedId) || pets[0]
  const sst = petStats(selected)
  const need = expForLevel(selected.level)
  // 装備中スキル（旧ID等を除外した有効なものだけ。たいあたりは常に含む）
  const validSkillIds = new Set(skillsForSpecies(selected.species).map((s) => s.id))
  const curSlots = (Array.isArray(selected.skill_slots) ? selected.skill_slots : ['tackle']).filter((s) => s === 'tackle' || validSkillIds.has(s))
  if (!curSlots.includes('tackle')) curSlots.unshift('tackle')

  return (
    <Wrap nav={nav} msg={msg} onShop={() => setShowShop(true)} onStorage={() => nav('/pet-storage')} onHelp={() => setShowHelp(true)}>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {/* 所持一覧 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: 14 }}>
        {pets.map((p) => (
          <div key={p.id} onClick={() => setSelectedId(p.id)}
            style={{ border: `2px solid ${p.id === selected.id ? '#aa88ff' : '#224466'}`, background: p.is_active ? '#101a30' : '#000a18', padding: 6, textAlign: 'center', cursor: 'pointer', position: 'relative' }}>
            {p.is_active && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 9, color: '#44ff88' }}>選択中</span>}
            <Portrait pet={p} size={44} />
            <div style={{ color: '#cce6ff', fontSize: 11, marginTop: 2 }}>{p.name}</div>
            <div style={{ color: '#6699cc', fontSize: 10 }}>LV{p.level}</div>
          </div>
        ))}
      </div>

      {/* 選択中ペット詳細 */}
      <div style={{ border: '1px solid #335588', background: '#00102a', padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Portrait pet={selected} size={110} />
          <div style={{ flex: 1 }}>
            <div style={{ color: '#cce6ff', fontSize: 15 }}>{selected.name} <span style={{ color: selected.evolved ? '#ffcc66' : '#6699cc', fontSize: 11 }}>({speciesLabel(selected)})</span></div>
            <div style={{ color: '#88bbee', fontSize: 12, marginTop: 4 }}>LV{selected.level}{Number.isFinite(petMaxLevel(selected)) ? `/${petMaxLevel(selected)}` : ''}　HP{sst.maxHp} / {atkLabel(selected)}{sst.atk} / 防{sst.def} / 特防{sst.mdef}</div>
            <div style={{ color: '#6699cc', fontSize: 11, marginTop: 2 }}>EXP {selected.exp} / {need}</div>
            {selected.is_active && <div style={{ color: '#88ffaa', fontSize: 11, marginTop: 2 }}>★ 選択中：このペットのステータスがプレイヤーに100%反映中</div>}
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!selected.is_active && <Btn onClick={() => !loading && setActive(selected)}>このペットを選択する</Btn>}
          {canEvolve(selected) && <Btn onClick={() => !loading && setEvolveConfirm(selected)}>✨ 進化させる（→{evolvedName(selected)}）</Btn>}
          {(storage.rename || 0) > 0 && !renaming && <Btn onClick={() => { setRenaming(true); setRenameInput(selected.name) }}>🎫 ニックネーム変更券で改名（{storage.rename}枚）</Btn>}
        </div>
        {renaming && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} maxLength={12} placeholder={selected.name}
              style={{ padding: 6, background: '#000818', border: '1px solid #335588', color: '#cce6ff', fontFamily: 'monospace', fontSize: 13 }} />
            <Btn onClick={() => !loading && doRename()}>券を使って変更</Btn>
            <Btn onClick={() => { setRenaming(false); setRenameInput('') }}>やめる</Btn>
          </div>
        )}

        {/* スキル（ダンジョンに持っていくスキルを最大4つ選ぶ） */}
        <div style={{ marginTop: 12, borderTop: '1px solid #223a55', paddingTop: 10 }}>
          <div style={{ color: '#aa88ff', fontSize: 12, marginBottom: 6 }}>
            持っていくスキル（たいあたり固定＋{MAX_SKILL_SLOTS - 1}つ）　{curSlots.length}/{MAX_SKILL_SLOTS}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {skillsForSpecies(selected.species).map((sk) => {
              const id = sk.id
              const learned = sk.learnLv <= selected.level
              const carried = curSlots.includes(id) || sk.fixed
              const clickable = learned && !sk.fixed
              // 未習得スキルは内容を隠し、習得レベルだけ表示
              if (!learned) {
                return (
                  <div key={id} style={{ border: '1px solid #1c2c44', background: '#000810', padding: '6px 8px', opacity: 0.7 }}>
                    <div style={{ fontSize: 12, color: '#5e7fa0' }}>🔒 LV{sk.learnLv} で習得</div>
                  </div>
                )
              }
              return (
                <div key={id} onClick={() => clickable && !loading && toggleSlot(id)}
                  style={{ border: `1px solid ${carried ? '#aa88ff' : '#224466'}`, background: carried ? '#170f2a' : '#000a18', padding: '6px 8px', cursor: clickable ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#cce6ff' }}>
                    <span>{carried ? '✓ ' : ''}{sk.name} <span style={{ fontSize: 10, color: '#ffaa66' }}>{sk.cost > 0 ? `満腹${sk.cost}` : '消費なし'}</span></span>
                    <span style={{ fontSize: 10, color: carried ? '#aa88ff' : '#6699cc' }}>{sk.fixed ? '固定装備' : carried ? '装備中' : '装備する'}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#5e7fa0', marginTop: 2 }}>{sk.desc}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* チャーム（装備でステ反映。強化/継承はチャームページで） */}
        <div style={{ marginTop: 12, borderTop: '1px solid #223a55', paddingTop: 10 }}>
          <div style={{ color: '#aa88ff', fontSize: 12, marginBottom: 6 }}>🧿 チャーム</div>
          {(() => {
            const pures = charms.filter((c) => !isRibbonType(c.ctype))
            const equipped = pures.find((c) => c.id === selected.charm_id)
            const cdef = getCharm(equipped?.ctype)
            const grown = equipped && (equipped.hp || equipped.atk || equipped.spatk || equipped.def || equipped.spdef)
            return (
              <>
                <div style={{ color: '#cce6ff', fontSize: 12, marginBottom: 6 }}>
                  装備中：{cdef.emoji} {equipped ? charmDisplayName(equipped) : cdef.name}
                  {grown ? <span style={{ color: '#88ffaa', fontSize: 10 }}>　HP+{charmHpBonus(equipped)} 攻+{equipped.atk} 特攻+{equipped.spatk} 防+{equipped.def} 特防+{equipped.spdef}</span> : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {pures.map((c) => {
                    const d = getCharm(c.ctype); const on = c.id === selected.charm_id
                    return (
                      <button key={c.id} onClick={() => !loading && !on && equipCharm(c.id)}
                        style={{ background: on ? '#170f2a' : '#000a18', border: `1px solid ${on ? '#aa88ff' : '#224466'}`, color: '#cce6ff', padding: '5px 8px', cursor: on ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        {on ? '✓ ' : ''}{d.emoji} {charmDisplayName(c)}
                      </button>
                    )
                  })}
                </div>
                <div style={{ color: '#557799', fontSize: 10, marginTop: 6 }}>※強化・継承はチャームページで。素はダンジョンで拾える</div>
              </>
            )
          })()}
        </div>

        {/* リボン（チャームとは別枠の装備。d60の37F以降で拾える） */}
        <div style={{ marginTop: 12, borderTop: '1px solid #223a55', paddingTop: 10 }}>
          <div style={{ color: '#ff88bb', fontSize: 12, marginBottom: 6 }}>🎀 リボン</div>
          {(() => {
            const ribbons = charms.filter((c) => isRibbonType(c.ctype))
            const equipped = ribbons.find((c) => c.id === selected.ribbon_id)
            const grown = equipped && (equipped.hp || equipped.atk || equipped.spatk || equipped.def || equipped.spdef)
            if (ribbons.length === 0) return <div style={{ color: '#557799', fontSize: 10 }}>リボンを持っていません（五霊の大峡谷の37F以降で拾える）</div>
            return (
              <>
                <div style={{ color: '#cce6ff', fontSize: 12, marginBottom: 6 }}>
                  装備中：{equipped ? `${getCharm(equipped.ctype).emoji} ${charmDisplayName(equipped)}` : '（なし）'}
                  {grown ? <span style={{ color: '#88ffaa', fontSize: 10 }}>　HP+{charmHpBonus(equipped)} 攻+{equipped.atk} 特攻+{equipped.spatk} 防+{equipped.def} 特防+{equipped.spdef}</span> : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {equipped && (
                    <button onClick={() => !loading && equipRibbon(null)}
                      style={{ background: '#000a18', border: '1px solid #224466', color: '#88aacc', padding: '5px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>外す</button>
                  )}
                  {ribbons.map((c) => {
                    const d = getCharm(c.ctype); const on = c.id === selected.ribbon_id
                    return (
                      <button key={c.id} onClick={() => !loading && !on && equipRibbon(c.id)}
                        style={{ background: on ? '#2a0f1a' : '#000a18', border: `1px solid ${on ? '#ff88bb' : '#224466'}`, color: '#cce6ff', padding: '5px 8px', cursor: on ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        {on ? '✓ ' : ''}{d.emoji} {charmDisplayName(c)}
                      </button>
                    )
                  })}
                </div>
                <div style={{ color: '#557799', fontSize: 10, marginTop: 6 }}>※強化はチャームページの「凝縮された素」で。チャームと同時に装備できる</div>
              </>
            )
          })()}
        </div>
      </div>

      {/* 画像設定（デフォルト画像＋アップロード画像から選べる。進化後画像は進化後のみ） */}
      <div style={{ color: '#aa88ff', fontSize: 13, marginBottom: 6 }}>画像を設定（{selected.name}）</div>
      {(() => {
        const sp = SPECIES[selected.species] || {}
        const defaults = []
        if (sp.image) defaults.push({ path: sp.image, label: 'デフォルト' })
        if (selected.evolved && sp.evolve?.image) defaults.push({ path: sp.evolve.image, label: '進化後' })
        const opts = [
          ...defaults.map((d) => ({ ...d, src: assetSrc(d.path), isBase: d.path === sp.image })),
          ...uploaded.map((url) => ({ path: url, src: url, label: null, isBase: false })),
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 6, marginBottom: 8 }}>
            {opts.map((o) => {
              const active = selected.image_url === o.path || (o.isBase && !selected.image_url)
              return (
                <div key={o.src} onClick={() => !loading && setImage(o.path)} style={{ cursor: 'pointer', textAlign: 'center' }}>
                  <img src={o.src} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', border: `2px solid ${active ? '#aa88ff' : '#224466'}`, background: '#000818' }} />
                  {o.label && <div style={{ fontSize: 9, color: active ? '#cba6ff' : '#5e7fa0' }}>{o.label}</div>}
                </div>
              )
            })}
          </div>
        )
      })()}
      <div style={{ color: '#ff8888', fontSize: 10, marginBottom: 8, lineHeight: 1.5 }}>
        ⚠️ 著作権を侵害する画像（他者のイラスト・キャラクター・写真など）や、実在する人物の写真はアップロードしないでください。違反した画像は予告なく削除する場合があります。
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ color: '#88ccff', fontSize: 12, border: '1px solid #0088ff', padding: '6px 10px', cursor: 'pointer' }}>
          画像をアップロード<input type="file" accept="image/*" onChange={uploadImage} style={{ display: 'none' }} />
        </label>
        {selected.image_url && <Btn onClick={() => !loading && setImage(null)}>画像をはずす</Btn>}
      </div>

      {/* ダンジョンに潜る（大きめボタン） */}
      <button onClick={() => nav('/dungeon')}
        style={{ width: '100%', marginTop: 20, padding: '14px', background: '#001830', border: '1px solid #0088cc', color: '#00aaff', cursor: 'pointer', fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 }}>
        🕳 ダンジョンに潜る
      </button>

      {/* ペット商店モーダル（ヘッダーの🛒商店ボタンから開く・複数購入可） */}
      {showShop && (() => {
        const qtyOf = (k) => Math.max(1, buyQty[k] || 1)
        const setQ = (k, n) => setBuyQty((b) => ({ ...b, [k]: Math.max(1, Math.min(99, n)) }))
        return (
          <div onClick={() => !loading && setShowShop(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: '#00102a', border: '1px solid #ffcc44', padding: 16, maxWidth: 420, width: '100%', maxHeight: '85vh', overflowY: 'auto', fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ color: '#ffcc44', fontSize: 15 }}>🛒 ペット商店</div>
                <div style={{ color: '#ffd866', fontSize: 12 }}>所持G: {profile.gold?.toLocaleString?.() ?? profile.gold}</div>
              </div>
              <div style={{ color: '#5e7fa0', fontSize: 10, marginBottom: 8 }}>※購入したアイテムは「🏬倉庫」に入ります。倉庫から「持ち物」に移してダンジョンへ持っていけます（持ち物は基本{INV_MAX}個・ダンジョンを初めて踏破するごとに上限+10）</div>
              {msg && <div style={{ background: '#101a30', border: '1px solid #335588', color: '#aaddff', padding: 8, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{msg}</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {SHOP_ITEMS.map((it) => {
                  const q = qtyOf(it.key)
                  return (
                    <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #224466', background: '#000a18', padding: 8 }}>
                      <div style={{ fontSize: 24 }}>{it.emoji}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#cce6ff', fontSize: 13 }}>{it.name} <span style={{ color: '#6699cc', fontSize: 10 }}>倉庫{storage[it.key] || 0}</span></div>
                        <div style={{ color: '#5e7fa0', fontSize: 10 }}>{it.desc}</div>
                        <div style={{ color: '#ffd866', fontSize: 11, marginTop: 2 }}>{it.price.toLocaleString()}G / 個</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginBottom: 4 }}>
                          <button onClick={() => setQ(it.key, q - 1)} style={qtyBtn}>−</button>
                          <span style={{ color: '#cce6ff', fontSize: 13, minWidth: 22, textAlign: 'center' }}>{q}</span>
                          <button onClick={() => setQ(it.key, q + 1)} style={qtyBtn}>＋</button>
                        </div>
                        <Btn onClick={() => !loading && buyItem(it.key, q)}>{(it.price * q).toLocaleString()}G 購入</Btn>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ textAlign: 'center', marginTop: 12 }}><Btn onClick={() => setShowShop(false)}>とじる</Btn></div>
            </div>
          </div>
        )
      })()}

      {/* 進化ポップアップ（確認→完了を同じ画面で表示） */}
      {(evolveConfirm || evolveDone) && (() => {
        const target = evolveDone || evolveConfirm
        const done = !!evolveDone
        const closeDone = () => { if (!loading) setEvolveDone(null) }
        return (
          <div onClick={done ? closeDone : () => !loading && setEvolveConfirm(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: '#0a0820', border: '1px solid #aa88ff', padding: 22, maxWidth: 320, width: '100%', textAlign: 'center', fontFamily: 'monospace' }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>✨</div>
              {/* 確認中は進化前の画像、進化完了後は進化後イラスト。全身が見えるよう contain で表示 */}
              {(() => {
                const showPet = done ? { ...target, evolved: true, image_url: evolvedImage(target) } : target
                const src = petImage(showPet)
                return src
                  ? <img src={src} alt="" style={{ width: 120, height: 120, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
                  : <div style={{ fontSize: 64 }}>{speciesEmoji(showPet)}</div>
              })()}
              <div style={{ color: '#cce6ff', fontSize: 14, margin: '12px 0' }}>
                {done
                  ? <>{target.name} は<br /><span style={{ color: '#ffcc66', fontSize: 16 }}>{evolvedName(target)}</span><br />に進化した！</>
                  : <>{target.name} を<br /><span style={{ color: '#ffcc66', fontSize: 16 }}>{evolvedName(target)}</span><br />に進化させますか？</>}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
                {done
                  ? <Btn onClick={closeDone}>とじる</Btn>
                  : <>
                      <Btn onClick={() => !loading && setEvolveConfirm(null)}>やめる</Btn>
                      <Btn onClick={() => !loading && doEvolve(evolveConfirm)}>進化する</Btn>
                    </>}
              </div>
            </div>
          </div>
        )
      })()}
    </Wrap>
  )
}

function Portrait({ pet, size }) {
  const src = petImage(pet) // カスタム画像 or 種族デフォ（進化で切替）
  if (src) return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4 }} />
  return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.7 }}>{speciesEmoji(pet)}</div>
}

function Wrap({ children, nav, msg, onShop, onStorage, onHelp }) {
  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: 16 }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #003366', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ color: '#ffcc00', fontSize: 16, letterSpacing: 3 }}>BATTLE FRONTIER</div>
          <Btn onClick={() => nav('/game')}>← 街に戻る</Btn>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ color: '#aa88ff', letterSpacing: 2 }}>🐾 ペット {onHelp && <span onClick={onHelp} style={{ cursor: 'pointer', color: '#66ccff', fontSize: 12 }}>❓ヘルプ</span>}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {onShop && <Btn onClick={onShop}>🛒 商店</Btn>}
            {onStorage && <Btn onClick={onStorage}>🏬 倉庫</Btn>}
            <Btn onClick={() => nav('/charms')}>🧿 チャーム</Btn>
          </div>
        </div>
        {msg && <div style={{ background: '#101a30', border: '1px solid #335588', color: '#aaddff', padding: 8, fontSize: 12, marginBottom: 10 }}>{msg}</div>}
        {children}
      </div>
    </div>
  )
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
}
function Btn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '6px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{children}</button>
}
const qtyBtn = { background: '#001028', border: '1px solid #335588', color: '#88bbee', width: 22, height: 22, cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, lineHeight: '18px', padding: 0 }

// ペットシステムの説明ヘルプ
const HELP_SECTIONS = [
  { t: '🚩 進め方', b: [
    '最初にペットを1体選びます（ヴォル＝物理／アルル＝魔法／ドラム＝防御）。総合力はどれも互角、配分が違うだけ。',
    'ペットを「選択中」にして🕳ダンジョンへ潜り、敵を倒してレベルを上げ、アイテムやチャームを集めて強くしていきます。',
    'LV50で「進化」でき、上限が解放されてさらに成長します。',
  ] },
  { t: '⚡ スキルについて', b: [
    'スキルは体当たりで発動します。「たいあたり」は全種族固定（満腹消費なし）で、攻撃と特攻（チャーム込み）の高いほうを参照して攻撃します。',
    '種族ごとに LV3/8/20/50/80/120 でスキルを習得。ペット画面でダンジョンに持っていくスキルを最大4つ（たいあたり込み）選べます。',
    'スキルは満腹度を消費して発動（強いほど多い）。連打スキルは1発ずつヒットします。ダンジョン内では十字キー横で使うスキルを切り替えられます。',
  ] },
  { t: '📊 ステータスについて', b: [
    'ステは HP / 攻撃(または特攻) / 防御 / 特防。物理は相手の防御、特殊は特防で軽減されます。',
    '防御は割合で軽減する方式。能力差が大きくてもある程度のダメージは必ず通ります（ダメージは毎回少しランダムに揺れます）。',
    'レベルが上がると自動でステ成長。必要EXPは「Lv×10」。',
    '★ 選択中（出撃中）のペットのステータスは、主人公（プレイヤー）に100%反映されます。攻撃タイプに応じて 攻撃→攻撃 / 特攻→特攻 に加算され、HP・防御・特防もそのまま上乗せされます。',
  ] },
  { t: '🧿 チャームについて', b: [
    'ペットに1つ装備できる強化アイテム。最初は「はじまりのチャーム」を装備（効果なし）。',
    'ダンジョンで拾える「素」を使い、チャームページで強化。攻/特攻/防/特防/HPを合計150個ぶんまで伸ばせます（HPの素は1個=HP+5）。',
    '効果付きチャームもあり（解毒＝毒確率50%減 / 守り＝防御+10%）。選択中ペットのチャーム効果は主人公（プレイヤー）にも反映されます。',
    '「継承」で別のチャームへ能力を移せます（移すと元のチャームは消滅）。',
  ] },
  { t: '🛒 商店と倉庫について', b: [
    '⭐ まずはヘッダーの🛒商店で「木の実（HP回復）」と「おにぎり（満腹回復）」を買ってからダンジョンに臨むのがおすすめ！',
    'ほかに だっしゅつの翼・ニックネーム変更券 なども購入できます（個数指定でまとめ買い可）。',
    '購入したアイテムは🏬倉庫に入ります。倉庫ページで個数を指定して「持ち物」へ移してからダンジョンへ。',
    '持ち物（アイテム袋）は だっしゅつの翼以外 合計10個まで。ダンジョン中は20個まで持てます。倉庫は無制限。',
  ] },
  { t: '🕳 ダンジョンについて', b: [
    'ペットで潜るローグライク。部屋と通路を進み、▼の階段で次の階へ。最深部でクリア。移動・攻撃は斜めもOK（8方向）。',
    '✨や床のアイテムを拾うと持ち物へ。✨からは 素/強化石/宝石/装備/チャーム が出ます。',
    '戦利品は「持ち帰り式」＝生きて帰れば全部入手（素は倉庫へ）。やられるとランダムで半分失い、残りは持ち帰れます。だっしゅつの翼で安全に撤退も可能。',
    '満腹度は時間経過とスキルで減り、0になるとHPが削れます。10ターンごとにHPが少し自然回復。',
    '「捨てる」で持ち物を足元に置けます（足元が空いている時・1ターン消費）。',
  ] },
]
function HelpModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, fontFamily: 'monospace' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#00102a', border: '1px solid #aa88ff', padding: 16, maxWidth: 460, width: '100%', maxHeight: '88vh', overflowY: 'auto', textAlign: 'left' }}>
        <div style={{ color: '#aa88ff', fontSize: 16, letterSpacing: 1, marginBottom: 4 }}>📖 ペットシステムの遊び方</div>
        <div style={{ color: '#6699cc', fontSize: 11, marginBottom: 10 }}>あとからヘッダーの「❓ヘルプ」でいつでも開けます。</div>
        {HELP_SECTIONS.map((s) => (
          <div key={s.t} style={{ marginBottom: 12 }}>
            <div style={{ color: '#ffcc66', fontSize: 13, marginBottom: 4 }}>{s.t}</div>
            {s.b.map((line, i) => (
              <div key={i} style={{ color: '#cce6ff', fontSize: 11.5, lineHeight: 1.7, marginBottom: 2, paddingLeft: 10, textIndent: -10 }}>・{line}</div>
            ))}
          </div>
        ))}
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button onClick={onClose} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 }}>とじる</button>
        </div>
      </div>
    </div>
  )
}
