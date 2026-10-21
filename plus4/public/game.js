/* Plus4 : table persistante, main en éventail, cartes animées (pose, pioche, inversion, changement de couleur). */
(() => {
  const { h, put, safe, tag, P, events, burst } = Core
  const HEX = { a: '#d3fd50', b: '#ff6b5a', c: '#5ac8ff', d: '#b98bff' }, NAME = { a: 'citron', b: 'corail', c: 'ciel', d: 'violet' }
  const SYM = { skip: '⊘', rev: '⇄', '+2': '+2', wild: '', '+4': '+4' }
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  const label = (c) => (c[0] === 'w' ? (c[1] === '+4' ? 'Joker +4' : 'Joker') : (c[1] === 'skip' ? 'Passe' : c[1] === 'rev' ? 'Inversion' : c[1]) + ' ' + NAME[c[0]])

  const RULES = [
    ['stack', 'Cumul des +2 et +4', 'On répond à un +2 par un +2 ou un +4, le suivant prend tout.'],
    ['until', 'Piocher jusqu\'à pouvoir jouer', 'Sinon on pioche une seule carte.'],
    ['zero', 'Règle du 0', 'Poser un 0 fait tourner toutes les mains dans le sens du jeu.'],
    ['seven', 'Règle du 7', 'Poser un 7 : tu échanges ta main avec le joueur de ton choix.'],
    ['jumpin', 'Interception', 'Une carte identique à celle du dessus se pose même hors de ton tour.'],
    ['challenge', 'Défi du +4', 'Le +4 n\'est permis que sans la couleur demandée : on peut le contester.'],
  ]

  /* Une carte : face (couleur + valeur) ou dos */
  function cardEl(id, cards, extra = '') {
    if (id == null) return h('div.pc.pc--back' + extra, h('span.pc__logo', '✦'))
    const [c, v] = cards[id], s = SYM[v] ?? v
    return h('div.pc.pc--' + c + extra, { 'data-id': id, 'aria-label': label(cards[id]) },
      h('span.pc__corner', s || '✦'), c === 'w' ? h('span.pc__wheel', s && h('b', s)) : h('span.pc__mid', s), h('span.pc__corner.pc__corner--b', s || '✦'))
  }

  function lobby(S) {
    const s = S.settings, host = S.me.host, set = (patch) => safe('settings', { settings: { ...s, ...patch } })
    const seg = (key, opts) => h('div.seg', opts.map(([t, v]) => h('button', { type: 'button', 'aria-pressed': String(s[key] === v), disabled: !host && s[key] !== v, onclick: host ? () => set({ [key]: v }) : null }, t)))
    const n = S.players.length
    return {
      ok: n >= 2,
      hint: n >= 2 ? n + ' joueurs · ' + s.hand + ' cartes chacun' : 'Il faut au moins 2 joueurs.',
      settings: h('div.panel.settings',
        h('div.set', h('span.lbl.mono', 'Cartes au départ'), h('div.stepper',
          host && h('button.step', { type: 'button', 'aria-label': 'Moins', disabled: s.hand <= 5, onclick: () => set({ hand: s.hand - 1 }) }, '−'),
          h('b.mono', s.hand),
          host && h('button.step', { type: 'button', 'aria-label': 'Plus', disabled: s.hand >= 10, onclick: () => set({ hand: s.hand + 1 }) }, '+'))),
        h('p.kicker.rules-k', 'Règles'),
        RULES.map(([key, name, help]) => h('div.rule',
          h('div.rule__t', h('b', name), h('small.muted', help)),
          seg(key, [['Non', false], ['Oui', true]]))),
        s.challenge && s.stack && h('p.hint.mono.is-warn', 'Le défi du +4 ne marche que sans cumul.')),
    }
  }

  /* ── table ──────────────────────────────────────────────────────────── */
  let el = null, handEls = new Map(), seen = 0, freshFrom = null
  function build(root) {
    el = {}
    el.seats = h('div.seats')
    el.deck = h('button.deckpile', { type: 'button', 'aria-label': 'Piocher', onclick: () => safe('draw') }, cardEl(null, null, '.pc--deck2'), cardEl(null, null, '.pc--deck1'), cardEl(null, null), h('span.deckpile__n.mono'))
    el.pile = h('div.pile')
    el.ring = h('div.ring', h('span.ring__arrows', '↻'))
    el.info = h('div.tinfo')
    el.next = h('p.nextp')
    el.table = h('div.table', el.ring, h('div.table__mid', el.deck, el.pile), el.info)
    el.banner = h('div.banner')
    el.hand = h('div.hand')
    el.controls = h('div.controls')
    el.side = h('aside.side')
    el.dock = h('div.dock', el.banner, el.controls, el.hand)
    root.replaceChildren(h('div.p4', h('div.p4__main', el.seats, el.next, el.table, el.dock), el.side))
    handEls = new Map()
    seen = -1
  }

  function play(root, S, prev) {
    const g = S.game, me = S.me.id, myTurn = g.turn === me && S.phase === 'play'
    if (!el || !root.firstChild) build(root)
    FX.turn(myTurn)
    const oldRects = new Map([...handEls].map(([id, e]) => [id, e.getBoundingClientRect()]))
    const seatRects = new Map([...el.seats.children].map((e) => [e.dataset.id, e.getBoundingClientRect()]))
    const pileRect = el.pile.getBoundingClientRect(), deckRect = el.deck.getBoundingClientRect()

    // sièges des adversaires (ordre du jeu, en partant de moi)
    const order = g.seats.map((s) => s.id), k = order.indexOf(me)
    const others = (k < 0 ? order : [...order.slice(k + 1), ...order.slice(0, k)]).map((id) => g.seats.find((s) => s.id === id))
    put(el.seats, ...others.map((s) => {
      const p = P(s.id) || { name: '?' }
      return h('div.seat' + (g.turn === s.id ? '.is-turn' : '') + (g.exposed === s.id ? '.is-exposed' : ''), { 'data-id': s.id },
        h('div.seat__fan', Array.from({ length: Math.min(s.n, 9) }, (_, i) => h('i', { style: `--i:${i - (Math.min(s.n, 9) - 1) / 2}` }))),
        h('b.seat__name', FX.avatar(p.name, null, !p.online), p.name), h('span.seat__n.mono', s.n + ' carte' + (s.n > 1 ? 's' : '')),
        s.called && s.n <= 2 && tag('Une !', 'tag--ok'),
        g.exposed === s.id && h('button.btn.btn--sm.catch', { type: 'button', onclick: () => safe('catch', { target: s.id }) }, 'Coincer ' + p.name + ' !'))
    }))

    // centre : pioche, défausse, couleur, sens
    el.deck.querySelector('.deckpile__n').textContent = g.deck
    el.deck.disabled = !myTurn || g.drawn != null
    el.deck.classList.toggle('is-active', myTurn && g.drawn == null)
    const topChanged = !prev?.game || prev.game.top !== g.top
    if (topChanged) {
      const fresh = cardEl(g.top, g.cards, '.pile__top')
      el.pile.replaceChildren(...g.under.map((id, i) => cardEl(id, g.cards, '.pile__under')), fresh)
      el.pile.querySelectorAll('.pile__under').forEach((c, i) => { c.style.setProperty('--r', ((g.under[i] * 37) % 30 - 15) + 'deg') })
    }
    el.table.style.setProperty('--col', HEX[g.color])
    if (prev?.game && prev.game.color !== g.color && !calm) {
      const sw = h('i.sweep', { style: `--c:${HEX[g.color]}` })
      el.ring.append(sw)
      sw.animate([{ transform: 'rotate(0)', opacity: .9 }, { transform: 'rotate(360deg)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.3,.7,.3,1)' }).onfinish = () => sw.remove()
    }
    if (prev?.game && prev.game.dir !== g.dir && !calm) el.ring.querySelector('.ring__arrows').animate([{ transform: 'rotate(0)' }, { transform: `rotate(${g.dir > 0 ? 360 : -360}deg)` }], { duration: 800, easing: 'cubic-bezier(.3,1.3,.5,1)' })
    el.ring.querySelector('.ring__arrows').textContent = g.dir > 0 ? '↻' : '↺'
    const nextId = k < 0 ? null : order[(k + g.dir + order.length) % order.length]
    put(el.info,
      h('span.colorpill.mono', { style: `--c:${HEX[g.color]}` }, NAME[g.color]),
      g.pending ? h('span.pending.mono', '+' + g.pending + ' en attente') : null)
    put(el.next, nextId && nextId !== me && h('span.mono', 'Après toi ' + (g.dir > 0 ? '↻' : '↺') + ' ', h('b', P(nextId)?.name || '?')))
    if (g.pending && prev?.game?.pending !== g.pending) FX.shake(el.info.querySelector('.pending'), 5)

    // bandeau de tour
    const turnP = P(g.turn)
    const bannerKey = g.turn + ':' + g.pending + ':' + g.drawn + ':' + g.seat + ':' + S.phase
    if (el.banner.dataset.k !== bannerKey) {
      el.banner.dataset.k = bannerKey
      put(el.banner, h('span.banner__t' + (myTurn ? '.is-me' : ''), S.phase !== 'play' ? 'Dernière carte !' : !g.seat ? 'Tu regardes : tu joueras à la prochaine manche' : myTurn
        ? (g.challenge ? '+4 : tu pioches, ou tu contestes ?' : g.pending ? 'À toi : contre avec un +' + (g.cards[g.top][1] === '+2' ? '2 ou +4' : '4') + ', ou pioche ' + g.pending : g.drawn != null ? 'Joue la carte piochée ou passe' : 'À toi de jouer')
        : 'Au tour de ' + (turnP ? turnP.name : '…')))
    }

    // après un échange (7) ou une rotation (0), mes nouvelles cartes arrivent du siège de l'ancien propriétaire
    freshFrom = null
    for (const ev of (g.evs || []).filter((e) => e.seq > seen && prev)) {
      let giver = null
      if (ev.type === 'swap' && (ev.pid === me || ev.target === me)) giver = ev.pid === me ? ev.target : ev.pid
      if (ev.type === 'rotate' && order.includes(me)) giver = order[(order.indexOf(me) - ev.dir + order.length) % order.length]
      if (giver) freshFrom = seatRects.get(giver) || null
    }

    // ma main : éléments gardés par identifiant de carte, triés par couleur puis valeur
    const hand = [...g.hand].sort((x, y) => (g.cards[x][0] + g.cards[x][1]).localeCompare(g.cards[y][0] + g.cards[y][1]))
    const play = new Set(g.playable)
    for (const [id, e] of handEls) if (!hand.includes(id)) { handEls.delete(id); e.remove() }
    hand.forEach((id, i) => {
      let e = handEls.get(id)
      if (!e) {
        e = h('button.hc', { type: 'button', 'aria-label': label(g.cards[id]), onclick: () => choose(id, e) }, cardEl(id, g.cards))
        handEls.set(id, e)
        e.dataset.fresh = '1'
      }
      e.classList.toggle('is-ok', play.has(id))
      e.classList.toggle('is-dim', myTurn && !play.has(id))
      e.classList.toggle('is-jump', !myTurn && play.has(id))
      e.classList.toggle('is-drawn', g.drawn === id)
      e.setAttribute('aria-disabled', String(!play.has(id)))
      e.style.setProperty('--i', i - (hand.length - 1) / 2)
      el.hand.append(e)                                   // remet dans l'ordre
    })
    el.hand.style.setProperty('--n', hand.length)
    el.hand.style.setProperty('--k', Math.min(1, 8 / Math.max(1, hand.length)))
    el.hand.classList.toggle('is-turn', myTurn)

    // contrôles
    put(el.controls, 
      myTurn && g.drawn != null && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => safe('pass') }, 'Passer'),
      myTurn && g.drawn == null && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => safe('draw') }, g.pending ? 'Piocher ' + g.pending : 'Piocher'),
      g.challenge && h('button.btn.btn--sm.btn--defi', { type: 'button', onclick: () => safe('challenge') }, 'Contester le +4'),
      g.seat && g.hand.length === 1 && !g.seats.find((s) => s.id === me)?.called && h('button.btn.btn--une', { type: 'button', onclick: () => safe('une') }, 'Une !'),
      S.me.host && !myTurn && turnP && !turnP.online && h('button.link.mono', { type: 'button', onclick: () => confirm('Faire piocher et passer ' + (turnP ? turnP.name : 'ce joueur') + ' ?') && safe('skip') }, 'Passer le joueur absent'),
    )

    put(el.side,
      h('p.kicker', 'Scores'),
      h('ul.mini', [...S.players].sort((a, b) => b.score - a.score).map((p) => h('li' + (p.id === me ? '.is-me' : ''), h('span', FX.avatar(p.name), p.name), h('b.mono', p.score)))),
      events(),
      S.me.host && S.phase === 'play' && h('button.link.mono', { type: 'button', onclick: () => confirm('Arrêter la manche pour tout le monde ?') && safe('stop') }, 'Arrêter la manche'))

    // mobile : le siège du joueur actif reste visible dans la rangée qui défile
    const active = el.seats.querySelector('.seat.is-turn')
    if (active && (!prev || prev.game?.turn !== g.turn)) el.seats.scrollTo({ left: active.offsetLeft - (el.seats.clientWidth - active.offsetWidth) / 2, behavior: calm ? 'auto' : 'smooth' })

    animate(g, oldRects, seatRects, pileRect, deckRect, prev)
  }

  /* Animations FLIP : la main se réarrange, les cartes volent vers la défausse ou depuis la pioche */
  function animate(g, oldRects, seatRects, pileRect, deckRect, prev) {
    let n = 0
    for (const [id, e] of handEls) {
      const old = oldRects.get(id), now = e.getBoundingClientRect()
      if (e.dataset.fresh) {
        delete e.dataset.fresh
        if (calm) continue
        const src = freshFrom || deckRect, dx = src.left + src.width / 2 - now.left - now.width / 2, dy = src.top + src.height / 2 - now.top - now.height / 2
        const delay = 80 * n++, face = e.firstChild
        if (!freshFrom) {                                     // de la pioche : la carte part de dos et se retourne en vol
          face.classList.add('is-back')
          setTimeout(() => face.classList.remove('is-back'), delay + 300)
        }
        e.animate([
          { transform: `translate(${dx}px, ${dy}px) rotate(-14deg) scale(.7) scaleX(1)`, opacity: .3 },
          { transform: `translate(${dx * .45}px, ${dy * .45 - 50}px) rotate(-4deg) scale(1.05) scaleX(0.02)`, opacity: 1, offset: .46 },
          { transform: 'translateY(-14px) scale(1.04)', offset: .8 },
          { transform: 'none', opacity: 1 }],
          { duration: 680, delay, easing: 'cubic-bezier(.25,.9,.3,1)', fill: 'backwards' })
      } else if (old && !calm && (old.left !== now.left || old.top !== now.top)) {
        e.animate([{ transform: `translate(${old.left - now.left}px, ${old.top - now.top}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    // événements arrivés depuis la dernière mise à jour, joués à la suite (à la connexion : on ne rejoue rien)
    const evs = (g.evs || []).filter((e) => e.seq > seen)
    seen = Math.max(seen, ...(g.evs || []).map((e) => e.seq), 0)
    if (!prev) return
    evs.forEach((ev, i) => setTimeout(() => event(ev, g, oldRects, seatRects, deckRect, i === evs.length - 1), i * 380))
  }

  function event(ev, g, oldRects, seatRects, deckRect, isLast) {
    const me = Core.state().me.id
    if (ev.type === 'play') {
      FX.play('slap')
      setTimeout(() => {                                       // onde de choc à l'atterrissage
        if (calm) return
        const ring = h('i.ripple', { style: `--c:${HEX[g.cards[ev.card][0]] || HEX[g.color]}` })
        el.pile.append(ring)
        ring.animate([{ transform: 'scale(1)', opacity: .8 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => ring.remove()
      }, isLast ? 420 : 0)
      const top = el.pile.querySelector('.pile__top'), to = top && top.getBoundingClientRect()
      const from = ev.pid === me ? oldRects.get(ev.card) : seatRects.get(ev.pid)
      if (to && from && isLast && !calm) top.animate([{ transform: `translate(${from.left + from.width / 2 - to.left - to.width / 2}px, ${from.top + from.height / 2 - to.top - to.height / 2}px) rotate(-25deg) scale(${ev.pid === me ? 1 : .5})` }, { transform: 'rotate(4deg) scale(1.08)', offset: .8 }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1)' })
      const [c, v] = g.cards[ev.card]
      setTimeout(() => {
        const r = el.pile.getBoundingClientRect()
        if (v === '+4') { FX.flash(HEX[g.color], .4); FX.burst(r.left + r.width / 2, r.top + r.height / 2, HEX[g.color], 50); FX.shake(el.table, 10) }
        else if (v === '+2') { FX.burst(r.left + r.width / 2, r.top + r.height / 2, HEX[c], 22); FX.shake(el.table, 6) }
        else if (c === 'w') FX.burst(r.left + r.width / 2, r.top + r.height / 2, HEX[g.color], 30)
      }, 450)
    } else if (ev.type === 'draw') {
      FX.play(ev.n > 1 ? 'buzz' : 'draw')
      if (!calm) el.deck.querySelector('.pc:last-of-type').animate([{ transform: 'none' }, { transform: 'translate(4px,-12px) rotate(5deg)' }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.3,1.4,.5,1)' })
      if (ev.challenge) callout(ev.pid === me ? 'Raté !' : 'Démasqué !', (Core.P(ev.pid)?.name || '') + ' pioche ' + ev.n)
      if (ev.pid === me && ev.n > 1) { FX.vibrate([150, 60, 150]); FX.shake(el.hand, 8) }
      if (ev.by) Core.toast((Core.P(ev.by)?.name || '?') + ' a coincé ' + (Core.P(ev.pid)?.name || '?') + ' : 2 cartes !')
      const seat = ev.pid !== me && el.seats.querySelector(`[data-id="${ev.pid}"]`)
      if (seat && !calm) {
        const s = seat.getBoundingClientRect()
        for (let i = 0; i < Math.min(ev.n || 1, 6); i++) {
          const fly = cardEl(null, null, '.pc--fly')
          document.body.append(fly)
          Object.assign(fly.style, { left: deckRect.left + 'px', top: deckRect.top + 'px', width: deckRect.width + 'px', height: deckRect.height + 'px' })
          fly.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${s.left + s.width / 2 - deckRect.left - deckRect.width / 2}px, ${s.top - deckRect.top}px) scale(.35) rotate(20deg)`, opacity: .2 }],
            { duration: 600, delay: i * 110, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'backwards' }).onfinish = () => fly.remove()
        }
        seat.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 400, delay: 450 })
      }
    } else if (ev.type === 'pass') FX.play('tick')
    else if (ev.type === 'swap') { FX.play('flip'); callout('Échange !', (Core.P(ev.pid)?.name || '?') + ' ⇄ ' + (Core.P(ev.target)?.name || '?')) }
    else if (ev.type === 'rotate') { FX.play('flip'); callout('Tout tourne !', 'Chacun passe sa main ' + (ev.dir > 0 ? '↻' : '↺'), true) }
    else if (ev.type === 'jump') { FX.play('slap'); callout('Interception !', Core.P(ev.pid)?.name || '') }
    else if (ev.type === 'une') {
      FX.play('good')
      const p = Core.P(ev.pid)
      const pop = h('div.unepop', h('b', 'Une !'), h('small.mono', p ? p.name : ''))
      document.body.append(pop)
      pop.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: .35 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 }, { transform: 'translate(-50%,-60%) scale(1)', opacity: 0 }],
        { duration: 1400, easing: 'ease-out' }).onfinish = () => pop.remove()
    }
  }

  function callout(big, small, spin) {
    const pop = h('div.unepop.unepop--alt', h('b', big), h('small.mono', small))
    document.body.append(pop)
    pop.animate(calm ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: `translate(-50%,-50%) scale(.3) rotate(${spin ? -90 : 0}deg)`, opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.08) rotate(0)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 }, { transform: 'translate(-50%,-62%) scale(.96)', opacity: 0 }],
      { duration: 1500, easing: 'ease-out' }).onfinish = () => pop.remove()
  }

  /* Fenêtre de choix (couleur du joker, joueur pour le 7) */
  function picker(title, options, done) {
    const dlg = h('dialog.colorpick',
      h('p.kicker', title),
      h('div.colorpick__grid', options.map(([label, value, color]) => h('button', { type: 'button', style: color ? `--c:${color}` : '', class: color ? '' : 'is-player', onclick: () => { dlg.close(); dlg.remove(); done(value) } }, label))),
      h('button.link.mono', { type: 'button', onclick: () => { dlg.close(); dlg.remove() } }, 'Annuler'))
    dlg.addEventListener('close', () => dlg.remove())
    document.body.append(dlg)
    dlg.showModal()
  }

  /* Jouer une carte (joker : choix de la couleur) */
  function choose(id, node) {
    const S = Core.state(), g = S.game, card = g.cards[id]
    if (!g.playable.includes(id)) {
      FX.shake(node, 6)
      const [tc, tv] = g.cards[g.top]
      return Core.toast(g.turn !== S.me.id ? 'Ce n\'est pas ton tour.' : g.pending ? 'Contre avec un +' + (tv === '+2' ? '2 ou un +4' : '4') + ', sinon pioche.' : g.drawn != null ? 'Après la pioche : seulement la carte piochée.' : 'Il faut du ' + NAME[g.color] + (tv.length < 2 ? ' ou un ' + tv : ' ou une carte ' + (SYM[tv] || tv)) + '.')
    }
    const seven = card[1] === '7' && S.settings.seven && g.hand.length > 1
    const others = g.seats.filter((x) => x.id !== S.me.id)
    const send = (extra) => safe('play', { card: id, ...extra })
    if (seven && others.length > 1) return picker('Échanger ta main avec…', others.map((x) => [(P(x.id)?.name || '?') + ' · ' + x.n + ' carte' + (x.n > 1 ? 's' : ''), x.id]), (target) => send({ target }))
    if (card[0] !== 'w') return send({})
    picker('Choisis la couleur', Object.keys(HEX).map((c) => [NAME[c], c, HEX[c]]), (color) => send({ color }))
  }

  function end(S) {
    el = null
    const g = S.game
    if (!g) return null
    return h('div.hands', g.seats.map((s) => {
      const p = P(s.id) || { name: '?' }
      return h('div.hands__row' + (g.winner === s.id ? '.is-win' : ''), h('b', p.name), h('div.hands__cards', (s.cards || []).map((id, i) => cardEl(id, g.cards, '.pc--sm'))), h('span.mono.muted', g.winner === s.id ? '+' + Object.values(g.values || {}).reduce((a, b) => a + b, 0) + ' pts' : (g.winner ? 'donne ' : '') + (s.cards || []).reduce((a, id) => a + (g.values?.[id] || 0), 0) + ' pts'))
    }))
  }

  /* Raccourcis clavier (ordinateur) : D piocher, P passer, U « Une ! », 1 à 9 n-ième carte jouable */
  addEventListener('keydown', (e) => {
    const S = Core.state()
    if (!S || S.phase !== 'play' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return
    const k = e.key.toLowerCase(), g = S.game
    if (k === 'd' && g.turn === S.me.id && g.drawn == null) safe('draw')
    else if (k === 'p' && g.turn === S.me.id && g.drawn != null) safe('pass')
    else if (k === 'u' && g.seat && g.hand.length === 1) safe('une')
    else if (/^[1-9]$/.test(k)) { const ok = [...el.hand.querySelectorAll('.hc.is-ok')][+k - 1]; if (ok) ok.click() }
  })

  Core.boot({
    id: 'plus4', max: 10, kicker: 'Jeu de cartes entre potes',
    title: ['Pose tout,', 'plus vite.'],
    lead: 'Même couleur ou même valeur, des +2, des +4, des inversions. Le premier qui vide sa main gagne la manche. N\'oublie pas de dire « Une ! ». Pas de compte : un pseudo et un code suffisent.',
    foot: '2 à 10 joueurs · 108 cartes · cumul des +2 en option',
    howto: ['Pose une carte de la même couleur ou de la même valeur que celle du dessus.', 'Les +2, +4, passes et inversions gênent les autres. Sinon, pioche.', 'À une carte, touche « Une ! » avant d\'être coincé. Le premier qui vide sa main gagne.'],
    lobby, play, end,
  })
})()
