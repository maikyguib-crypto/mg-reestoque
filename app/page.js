'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  Search, Plus, Package, History, LayoutDashboard,
  CheckCircle2, Clock3, Trash2, Recycle, X, Menu
} from 'lucide-react'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const db = createClient(supabaseUrl, supabaseKey)

const STATUS = {
  pending: { label: 'Aguardando liberação', className: 'pending' },
  available: { label: 'Disponível', className: 'available' },
  used: { label: 'Utilizado', className: 'used' },
  discarded: { label: 'Descartado', className: 'discarded' }
}

const emptyForm = {
  original_request: '',
  formula: '',
  pharmaceutical_form: '',
  original_quantity: '',
  unit: 'cápsulas',
  expiration_date: '',
  location: '',
  notes: ''
}

export default function Home() {
  const [tab, setTab] = useState('dashboard')
  const [items, setItems] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [useItem, setUseItem] = useState(null)
  const [useQty, setUseQty] = useState('')
  const [newRequest, setNewRequest] = useState('')
  const [useNotes, setUseNotes] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)

    const [{ data: stock, error: stockError }, { data: movs, error: movError }] =
      await Promise.all([
        db.from('return_stock').select('*').order('registered_at', { ascending: false }),
        db.from('stock_movements').select('*').order('created_at', { ascending: false })
      ])

    if (stockError) setMsg(stockError.message)
    if (movError) setMsg(movError.message)

    setItems(stock || [])
    setMovements(movs || [])
    setLoading(false)
  }

  const stats = useMemo(() => {
    const pending = items.filter(i => i.status === 'pending').length
    const available = items.filter(i => i.status === 'available').length
    const used = items.filter(i => i.status === 'used').length
    const discarded = items.filter(i => i.status === 'discarded').length

    const reusedQuantity = movements
      .filter(m => m.movement_type === 'use')
      .reduce((sum, m) => sum + Number(m.quantity || 0), 0)

    return { pending, available, used, discarded, reusedQuantity }
  }, [items, movements])

  const filtered = useMemo(() => {
    const q = normalize(search)

    if (!q) return items

    const terms = q.split(' ').filter(Boolean)

    return items.filter(item => {
      const haystack = normalize([
        item.code,
        item.original_request,
        item.formula,
        item.pharmaceutical_form,
        item.location,
        item.notes
      ].filter(Boolean).join(' '))

      return terms.every(term => haystack.includes(term))
    })
  }, [items, search])

  async function createStock(e) {
    e.preventDefault()
    setMsg('')

    if (!form.formula.trim()) {
      setMsg('Informe a composição da fórmula.')
      return
    }

    const qty = Number(form.original_quantity)

    if (!qty || qty <= 0) {
      setMsg('Informe uma quantidade válida.')
      return
    }

    const payload = {
      original_request: form.original_request.trim() || null,
      formula: form.formula.trim(),
      pharmaceutical_form: form.pharmaceutical_form.trim() || null,
      original_quantity: qty,
      available_quantity: qty,
      unit: form.unit.trim() || 'un',
      expiration_date: form.expiration_date || null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      status: 'pending'
    }

    const { data, error } = await db
      .from('return_stock')
      .insert(payload)
      .select()
      .single()

    if (error) {
      setMsg(error.message)
      return
    }

    await db.from('stock_movements').insert({
      return_stock_id: data.id,
      movement_type: 'entry',
      quantity: qty,
      notes: 'Entrada no volta estoque'
    })

    setForm(emptyForm)
    setMsg('Volta estoque cadastrado com sucesso.')
    await loadAll()
    setTab('estoque')
  }

  async function releaseStock(item) {
    if (!confirm(`Liberar ${item.code || 'este item'} para reaproveitamento?`)) return

    const { error } = await db
      .from('return_stock')
      .update({
        status: 'available',
        released_at: new Date().toISOString()
      })
      .eq('id', item.id)

    if (error) {
      setMsg(error.message)
      return
    }

    await db.from('stock_movements').insert({
      return_stock_id: item.id,
      movement_type: 'release',
      quantity: item.available_quantity,
      notes: 'Liberado para reaproveitamento'
    })

    setMsg('Estoque liberado.')
    await loadAll()
  }

  async function discardStock(item) {
    if (!confirm(`Descartar ${item.code || 'este item'} do estoque disponível?`)) return

    const { error } = await db
      .from('return_stock')
      .update({ status: 'discarded' })
      .eq('id', item.id)

    if (error) {
      setMsg(error.message)
      return
    }

    await db.from('stock_movements').insert({
      return_stock_id: item.id,
      movement_type: 'discard',
      quantity: item.available_quantity,
      notes: 'Item descartado'
    })

    setMsg('Item marcado como descartado.')
    await loadAll()
  }

  async function confirmUse(e) {
    e.preventDefault()

    if (!useItem) return

    const qty = Number(useQty)

    if (!qty || qty <= 0) {
      setMsg('Informe a quantidade utilizada.')
      return
    }

    if (qty > Number(useItem.available_quantity)) {
      setMsg('A quantidade é maior que o saldo disponível.')
      return
    }

    if (!newRequest.trim()) {
      setMsg('Informe a nova requisição.')
      return
    }

    const { error } = await db.rpc('use_return_stock', {
      p_stock_id: useItem.id,
      p_quantity: qty,
      p_new_request: newRequest.trim(),
      p_notes: useNotes.trim() || null
    })

    if (error) {
      setMsg(error.message)
      return
    }

    setUseItem(null)
    setUseQty('')
    setNewRequest('')
    setUseNotes('')
    setMsg('Volta estoque utilizado e saldo atualizado.')
    await loadAll()
  }

  function openUse(item) {
    setMsg('')
    setUseItem(item)
    setUseQty('')
    setNewRequest('')
    setUseNotes('')
  }

  function go(next) {
    setTab(next)
    setMenuOpen(false)
    setMsg('')
  }

  const availableSearch = filtered.filter(i => i.status === 'available')

  return (
    <>
      <style jsx global>{`
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: #07100d;
          color: #eef7f2;
          font-family: Arial, Helvetica, sans-serif;
        }
        button, input, textarea, select { font: inherit; }
        button { cursor: pointer; }
        .app { min-height: 100vh; }
        .header {
          height: 68px;
          border-bottom: 1px solid #1b3028;
          background: #0a1511;
          display: flex;
          align-items: center;
          padding: 0 24px;
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 11px;
          font-weight: 800;
          font-size: 20px;
        }
        .brandIcon {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          background: #16a36a;
          color: white;
          border-radius: 11px;
        }
        .layout { display: flex; min-height: calc(100vh - 68px); }
        .sidebar {
          width: 225px;
          padding: 20px 12px;
          border-right: 1px solid #1b3028;
          background: #09130f;
        }
        .nav {
          width: 100%;
          border: 0;
          color: #aebdb6;
          background: transparent;
          padding: 12px 13px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          gap: 11px;
          margin-bottom: 5px;
          text-align: left;
        }
        .nav:hover, .nav.active {
          background: #11251d;
          color: #6ee7ad;
        }
        .content {
          flex: 1;
          max-width: 1400px;
          padding: 34px;
          margin: 0 auto;
          width: 100%;
        }
        .eyebrow {
          color: #43d38c;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 1.4px;
        }
        h1 { margin: 7px 0 7px; font-size: 30px; }
        .muted { color: #91a39a; }
        .cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin: 25px 0;
        }
        .card, .panel {
          background: #0d1b16;
          border: 1px solid #1b3329;
          border-radius: 15px;
        }
        .card { padding: 20px; }
        .cardValue {
          font-size: 30px;
          font-weight: 800;
          margin-top: 12px;
        }
        .cardLabel { color: #96aaa0; font-size: 13px; }
        .panel { padding: 22px; margin-top: 18px; }
        .searchBox {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #08130f;
          border: 1px solid #27523f;
          padding: 0 16px;
          border-radius: 13px;
        }
        .searchBox input {
          width: 100%;
          border: 0;
          outline: 0;
          color: white;
          background: transparent;
          padding: 17px 0;
          font-size: 16px;
        }
        .grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }
        label {
          display: block;
          color: #a8bab1;
          font-size: 13px;
          margin-bottom: 7px;
        }
        input, textarea, select {
          width: 100%;
          color: #edf7f2;
          background: #08130f;
          border: 1px solid #294439;
          border-radius: 9px;
          padding: 12px;
          outline: none;
        }
        textarea { min-height: 100px; resize: vertical; }
        input:focus, textarea:focus, select:focus {
          border-color: #31b879;
        }
        .field { margin-bottom: 15px; }
        .btn {
          border: 0;
          border-radius: 9px;
          padding: 11px 15px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .primary { background: #19a96c; color: white; }
        .secondary {
          background: #16271f;
          color: #dce9e2;
          border: 1px solid #294439;
        }
        .danger {
          background: #35191b;
          color: #ffb4b8;
          border: 1px solid #5b282c;
        }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .item {
          border: 1px solid #1d382d;
          background: #0a1712;
          padding: 17px;
          border-radius: 12px;
          margin-top: 11px;
        }
        .itemTop {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          align-items: flex-start;
        }
        .formula { font-weight: 800; font-size: 16px; }
        .code { color: #50d895; font-weight: 800; font-size: 13px; }
        .meta {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
          color: #91a69b;
          font-size: 13px;
          margin: 10px 0;
        }
        .badge {
          padding: 6px 9px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .available { background: #103e2c; color: #70e8ad; }
        .pending { background: #443612; color: #f7d56c; }
        .used { background: #1d2b36; color: #a9c9df; }
        .discarded { background: #3a1d20; color: #ffafb5; }
        .message {
          padding: 12px 15px;
          border: 1px solid #28543f;
          background: #0d2a1e;
          border-radius: 10px;
          margin: 14px 0;
          color: #a4efc9;
        }
        .empty {
          text-align: center;
          padding: 40px 15px;
          color: #82978c;
        }
        .quickSearch {
          padding: 27px;
          border: 1px solid #24583f;
          background: linear-gradient(135deg,#0e251b,#0c1914);
          border-radius: 16px;
          margin-top: 25px;
        }
        .modalBg {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,.72);
          display: grid;
          place-items: center;
          z-index: 50;
          padding: 20px;
        }
        .modal {
          width: min(520px, 100%);
          background: #0d1b16;
          border: 1px solid #315343;
          border-radius: 16px;
          padding: 22px;
        }
        .modalTop {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 18px;
        }
        .iconBtn {
          border: 0;
          color: white;
          background: transparent;
        }
        .mobileMenu { display: none; margin-left: auto; }
        .movement {
          padding: 13px 0;
          border-bottom: 1px solid #1b3028;
        }
        .movement:last-child { border: 0; }
        .movementTitle { font-weight: 700; }
        .small { font-size: 12px; color: #84988e; margin-top: 5px; }

        @media(max-width: 900px) {
          .cards { grid-template-columns: 1fr 1fr; }
          .sidebar { width: 190px; }
          .content { padding: 25px 18px; }
        }
        @media(max-width: 680px) {
          .header { padding: 0 16px; }
          .mobileMenu { display: block; }
          .sidebar {
            display: none;
            position: fixed;
            top: 68px;
            bottom: 0;
            left: 0;
            width: 250px;
            z-index: 30;
          }
          .sidebar.open { display: block; }
          .cards { grid-template-columns: 1fr 1fr; }
          .grid2 { grid-template-columns: 1fr; }
          .content { padding: 22px 14px; }
          .itemTop { flex-direction: column; }
          h1 { font-size: 26px; }
        }
      `}</style>

      <div className="app">
        <header className="header">
          <div className="brand">
            <div className="brandIcon"><Recycle size={22}/></div>
            MG Reestoque
          </div>

          <button
            className="iconBtn mobileMenu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu/>
          </button>
        </header>

        <div className="layout">
          <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
            <Nav icon={<LayoutDashboard size={18}/>} text="Dashboard" active={tab === 'dashboard'} onClick={() => go('dashboard')}/>
            <Nav icon={<Search size={18}/>} text="Buscar fórmula" active={tab === 'buscar'} onClick={() => go('buscar')}/>
            <Nav icon={<Plus size={18}/>} text="Cadastrar retorno" active={tab === 'cadastrar'} onClick={() => go('cadastrar')}/>
            <Nav icon={<Package size={18}/>} text="Estoque" active={tab === 'estoque'} onClick={() => go('estoque')}/>
            <Nav icon={<History size={18}/>} text="Histórico" active={tab === 'historico'} onClick={() => go('historico')}/>
          </aside>

          <main className="content">
            {msg && <div className="message">{msg}</div>}

            {tab === 'dashboard' && (
              <>
                <div className="eyebrow">VISÃO GERAL</div>
                <h1>Dashboard</h1>
                <div className="muted">Controle dos produtos que retornaram ao estoque.</div>

                <div className="cards">
                  <Stat label="Disponíveis" value={stats.available}/>
                  <Stat label="Aguardando liberação" value={stats.pending}/>
                  <Stat label="Reaproveitados" value={stats.used}/>
                  <Stat label="Descartados" value={stats.discarded}/>
                </div>

                <div className="quickSearch">
                  <div className="eyebrow">PESAGEM</div>
                  <h2>Tem essa fórmula no volta estoque?</h2>
                  <p className="muted">
                    Pesquise a composição antes de iniciar uma nova pesagem.
                  </p>

                  <div className="searchBox">
                    <Search size={22}/>
                    <input
                      placeholder="Digite a fórmula, composição ou requisição..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') setTab('buscar')
                      }}
                    />
                  </div>

                  <div style={{marginTop: 12}}>
                    <button className="btn primary" onClick={() => setTab('buscar')}>
                      <Search size={17}/> Pesquisar volta estoque
                    </button>
                  </div>
                </div>

                <div className="panel">
                  <h3>Reaproveitamento registrado</h3>
                  <div className="cardValue">{formatNumber(stats.reusedQuantity)}</div>
                  <div className="muted">Quantidade total reaproveitada registrada no sistema.</div>
                </div>
              </>
            )}

            {tab === 'buscar' && (
              <>
                <div className="eyebrow">PESAGEM</div>
                <h1>Buscar fórmula</h1>
                <p className="muted">
                  Pesquise antes de pesar uma nova requisição.
                </p>

                <div className="searchBox">
                  <Search size={22}/>
                  <input
                    autoFocus
                    placeholder="Ex.: metformina 500, fórmula, requisição ou VE-000001..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                {!search.trim() ? (
                  <div className="empty">Digite parte da composição para pesquisar.</div>
                ) : availableSearch.length ? (
                  <div className="panel">
                    <div className="eyebrow">ENCONTRADO NO VOLTA ESTOQUE</div>

                    {availableSearch.map(item => (
                      <StockItem
                        key={item.id}
                        item={item}
                        onUse={() => openUse(item)}
                        onRelease={() => releaseStock(item)}
                        onDiscard={() => discardStock(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="panel empty">
                    <Search size={35}/>
                    <h3>Nenhum volta estoque disponível encontrado</h3>
                    <div>A pesagem pode seguir o processo normal após a conferência.</div>
                  </div>
                )}
              </>
            )}

            {tab === 'cadastrar' && (
              <>
                <div className="eyebrow">NOVA ENTRADA</div>
                <h1>Cadastrar volta estoque</h1>
                <p className="muted">
                  A composição é livre. Cadastre exatamente as informações do produto retornado.
                </p>

                <form className="panel" onSubmit={createStock}>
                  <div className="grid2">
                    <Field label="Requisição original">
                      <input
                        value={form.original_request}
                        onChange={e => setForm({...form, original_request:e.target.value})}
                        placeholder="Ex.: 458721"
                      />
                    </Field>

                    <Field label="Forma farmacêutica">
                      <input
                        value={form.pharmaceutical_form}
                        onChange={e => setForm({...form, pharmaceutical_form:e.target.value})}
                        placeholder="Ex.: Cápsulas"
                      />
                    </Field>
                  </div>

                  <Field label="Composição / fórmula *">
                    <textarea
                      required
                      value={form.formula}
                      onChange={e => setForm({...form, formula:e.target.value})}
                      placeholder="Digite a composição completa exatamente como identificada..."
                    />
                  </Field>

                  <div className="grid2">
                    <Field label="Quantidade *">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={form.original_quantity}
                        onChange={e => setForm({...form, original_quantity:e.target.value})}
                        placeholder="Ex.: 90"
                      />
                    </Field>

                    <Field label="Unidade">
                      <select
                        value={form.unit}
                        onChange={e => setForm({...form, unit:e.target.value})}
                      >
                        <option>cápsulas</option>
                        <option>g</option>
                        <option>mL</option>
                        <option>unidades</option>
                        <option>potes</option>
                      </select>
                    </Field>

                    <Field label="Validade">
                      <input
                        type="date"
                        value={form.expiration_date}
                        onChange={e => setForm({...form, expiration_date:e.target.value})}
                      />
                    </Field>

                    <Field label="Localização">
                      <input
                        value={form.location}
                        onChange={e => setForm({...form, location:e.target.value})}
                        placeholder="Ex.: Estante A / Caixa 2"
                      />
                    </Field>
                  </div>

                  <Field label="Observações">
                    <textarea
                      value={form.notes}
                      onChange={e => setForm({...form, notes:e.target.value})}
                      placeholder="Informações adicionais..."
                    />
                  </Field>

                  <button className="btn primary" type="submit">
                    <Plus size={18}/> Cadastrar volta estoque
                  </button>
                </form>
              </>
            )}

            {tab === 'estoque' && (
              <>
                <div className="eyebrow">CONTROLE</div>
                <h1>Estoque</h1>

                <div className="searchBox">
                  <Search size={20}/>
                  <input
                    placeholder="Pesquisar no estoque..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                <div className="panel">
                  {loading ? (
                    <div className="empty">Carregando...</div>
                  ) : filtered.length ? (
                    filtered.map(item => (
                      <StockItem
                        key={item.id}
                        item={item}
                        admin
                        onUse={() => openUse(item)}
                        onRelease={() => releaseStock(item)}
                        onDiscard={() => discardStock(item)}
                      />
                    ))
                  ) : (
                    <div className="empty">Nenhum item encontrado.</div>
                  )}
                </div>
              </>
            )}

            {tab === 'historico' && (
              <>
                <div className="eyebrow">RASTREABILIDADE</div>
                <h1>Histórico</h1>
                <p className="muted">Movimentações registradas no MG Reestoque.</p>

                <div className="panel">
                  {movements.length ? movements.map(m => {
                    const stock = items.find(i => i.id === m.return_stock_id)

                    return (
                      <div className="movement" key={m.id}>
                        <div className="movementTitle">
                          {movementName(m.movement_type)} — {stock?.code || `#${m.return_stock_id}`}
                        </div>

                        <div className="small">
                          {stock?.formula || 'Fórmula'} • Quantidade: {formatNumber(m.quantity)}
                          {m.new_request ? ` • Nova requisição: ${m.new_request}` : ''}
                        </div>

                        {m.notes && <div className="small">{m.notes}</div>}

                        <div className="small">
                          {formatDateTime(m.created_at)}
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="empty">Ainda não existem movimentações.</div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {useItem && (
        <div className="modalBg">
          <form className="modal" onSubmit={confirmUse}>
            <div className="modalTop">
              <div>
                <div className="eyebrow">REAPROVEITAR</div>
                <h2 style={{margin:'5px 0'}}>{useItem.code}</h2>
              </div>

              <button
                type="button"
                className="iconBtn"
                onClick={() => setUseItem(null)}
              >
                <X/>
              </button>
            </div>

            <div className="formula">{useItem.formula}</div>

            <p className="muted">
              Saldo disponível: <b>{formatNumber(useItem.available_quantity)} {useItem.unit}</b>
            </p>

            <Field label="Nova requisição *">
              <input
                autoFocus
                value={newRequest}
                onChange={e => setNewRequest(e.target.value)}
                placeholder="Número da nova requisição"
              />
            </Field>

            <Field label={`Quantidade utilizada (${useItem.unit}) *`}>
              <input
                type="number"
                step="any"
                min="0"
                max={useItem.available_quantity}
                value={useQty}
                onChange={e => setUseQty(e.target.value)}
              />
            </Field>

            <Field label="Observação">
              <textarea
                value={useNotes}
                onChange={e => setUseNotes(e.target.value)}
                placeholder="Opcional"
              />
            </Field>

            <div className="actions">
              <button type="submit" className="btn primary">
                <Recycle size={17}/> Confirmar utilização
              </button>

              <button
                type="button"
                className="btn secondary"
                onClick={() => setUseItem(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function Nav({icon, text, active, onClick}) {
  return (
    <button className={`nav ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}{text}
    </button>
  )
}

function Stat({label, value}) {
  return (
    <div className="card">
      <div className="cardLabel">{label}</div>
      <div className="cardValue">{formatNumber(value)}</div>
    </div>
  )
}

function Field({label, children}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

function StockItem({item, onUse, onRelease, onDiscard}) {
  const status = STATUS[item.status] || STATUS.pending

  return (
    <div className="item">
      <div className="itemTop">
        <div>
          <div className="code">{item.code || `VE-${item.id}`}</div>
          <div className="formula">{item.formula}</div>
        </div>

        <span className={`badge ${status.className}`}>
          {status.label}
        </span>
      </div>

      <div className="meta">
        {item.original_request && <span>Req. original: <b>{item.original_request}</b></span>}
        <span>Disponível: <b>{formatNumber(item.available_quantity)} {item.unit}</b></span>
        {item.expiration_date && <span>Validade: <b>{formatDate(item.expiration_date)}</b></span>}
        {item.location && <span>Local: <b>{item.location}</b></span>}
      </div>

      {item.pharmaceutical_form && (
        <div className="small">Forma: {item.pharmaceutical_form}</div>
      )}

      {item.notes && <div className="small">Obs.: {item.notes}</div>}

      <div className="actions" style={{marginTop:12}}>
        {item.status === 'pending' && (
          <button className="btn primary" onClick={onRelease}>
            <CheckCircle2 size={16}/> Liberar
          </button>
        )}

        {item.status === 'available' && (
          <button className="btn primary" onClick={onUse}>
            <Recycle size={16}/> Usar este estoque
          </button>
        )}

        {(item.status === 'pending' || item.status === 'available') && (
          <button className="btn danger" onClick={onDiscard}>
            <Trash2 size={16}/> Descartar
          </button>
        )}
      </div>
    </div>
  )
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[,+/()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR')
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR')
}

function movementName(type) {
  return {
    entry: 'Entrada',
    release: 'Liberação',
    use: 'Reaproveitamento',
    adjustment: 'Ajuste',
    discard: 'Descarte'
  }[type] || type
}
