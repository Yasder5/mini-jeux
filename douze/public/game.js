/* Douze : ma grille de 12 cartes, pioche et défausse, mini-grilles des autres, cartes animées (retournement, échange, colonne). */
(() => {
  const { h, put, tag, P, events } = Core
  const calm = FX.calm
  const tone = (v) => (v < 0 ? 'n' : v === 0 ? 'z' : v <= 4 ? 'l' : v <= 8 ? 'm' : 'h')
  const HEX = { n: '#b98bff', z: '#5ac8ff', l: '#d3fd50', m: '#ffc857', h: '#ff6b5a' }
  const num = (v) => (v < 0 ? '−' + -v : String(v))
  const signed = (v) => (v > 0 ? '+' + v : num(v))
  const ups = (grid) => grid.filter((s) => s && s.up).length
  const shown = (grid) => grid.reduce((a, s) => a + (s && s.up ? s.v : 0), 0)
  const plural = (n, w) => n + ' ' + w + (Math.abs(n) > 1 ? 's' : '')

  /* Une carte : face (couleur selon la valeur, chiffre toujours écrit), dos, ou place vide d'une colonne défaussée */
  function cardEl(s, extra = '') {
    if (!s) return h('div.sc.sc--gone' + extra)
    if (!s.up) return h('div.sc.sc--back' + extra, h('span.sc__logo', '✦'))
    const t = num(s.v)
    return h('div.sc.sc--' + tone(s.v) + extra, h('span.sc__c', t), h('span.sc__mid', t))     // pas de coin retourné : un 6 à l'envers se lit 9
  }
  const cardName = (s, i) => (!s ? 'Place vide' : s.up ? 'Carte ' + num(s.v) : 'Carte cachée') + ', colonne ' + (Math.floor(i / 3) + 1) + ', ligne ' + (i % 3 + 1)
  const slotKey = (s) => (!s ? 'x' : s.up ? 'u' + s.v : 'h')

  /* Mini-grille d'un adversaire (et des mains de fin) */
  const mini = (pid, grid) => h('div.mg', { 'aria-label': ups(grid) + ' cartes visibles sur ' + grid.filter(Boolean).length },
    grid.map((s, i) => h('i.m' + (!s ? '.m--gone' : !s.up ? '.m--back' : '.m--' + tone(s.v)), { 'data-k': pid + ':' + i }, s && s.up ? num(s.v) : '')))

  function lobby(S) {
    const s = S.settings, host = S.me.host, set = (patch) => Core.safe('settings', { settings: { ...s, ...patch } })
    const seg = (key, opts) => h('div.seg', opts.map(([t, v]) => h('button', { type: 'button', 'aria-pressed': String(s[key] === v), disabled: !host && s[key] !== v, onclick: host ? () => set({ [key]: v }) : null }, t)))
    const n = S.players.length, going = S.players.some((p) => p.score) && !S.players.some((p) => p.score >= s.target)
    return {
      ok: n >= 2,
      hint: n < 2 ? 'Il faut au moins 2 joueurs.' : going ? 'Partie en cours : la prochaine manche garde les scores.' : n + ' joueurs · partie en ' + s.target + ' points',
      settings: h('div.panel.settings',
        h('div.set', h('span.lbl.mono', 'Partie en'), seg('target', [['50 pts', 50], ['100 pts', 100], ['150 pts', 150]])),
        h('div.rule',
          h('div.rule__t', h('b', 'Doubler celui qui finit'), h('small.muted', 'S\'il n\'a pas strictement le moins de points de la manche.')),
          seg('double', [['Non', false], ['Oui', true]]))),
    }
  }

  /* ── table ──────────────────────────────────────────────────────────── */
  let el = null, seen = -1, busy = false
  function build(root) {
    el = {}
    el.seats = h('div.seats')
    el.deck = h('button.pile', { type: 'button', 'aria-label': 'Piocher', onclick: tapDeck }, cardEl({ up: false }, '.sc--d2'), cardEl({ up: false }, '.sc--d1'), cardEl({ up: false }), h('span.pile__n.mono'))
    el.disc = h('button.pile', { type: 'button', onclick: tapDisc })
    el.discL = h('span.pile__l.mono', 'Défausse')
    el.held = h('div.pile.pile--held')
    el.heldL = h('span.pile__l.mono')
    el.piles = h('div.piles', h('div.piles__p', el.deck, h('span.pile__l.mono', 'Pioche')), h('div.piles__p', el.disc, el.discL), h('div.piles__p', el.held, el.heldL))
    el.grid = h('div.grid')
    el.cells = Array.from({ length: 12 }, (_, i) => { const b = h('button.cell', { type: 'button', onclick: () => tapCell(i) }); el.grid.append(b); return b })
    el.banner = h('div.banner')
    el.sum = h('p.mysum.mono')
    el.controls = h('div.controls')
    el.side = h('aside.side')
    root.replaceChildren(h('div.dz', h('div.dz__main', el.seats, el.banner, h('div.board', el.piles, h('div.mine', el.grid, el.sum)), el.controls), el.side))
    seen = -1
  }

  function say(S) {
    const g = S.game, me = S.me.id, mine = g.turn === me
    if (S.phase !== 'play') return 'On retourne tout !'
    if (!g.seat) return 'Tu regardes : tu joueras à la prochaine manche'
    if (g.setup) { const n = ups(g.grids[me]); return n < 2 ? 'Retourne ' + plural(2 - n, 'carte') : 'Les autres retournent leurs cartes…' }
    const last = g.closer && g.closer !== me ? 'Dernier tour · ' : ''
    if (!mine) return last + 'Au tour de ' + (P(g.turn)?.name || '…')
    if (g.mustflip) return last + 'Retourne une carte cachée'
    if (g.held != null) return last + (g.src === 'deck' ? 'Échange-la ou défausse-la' : 'Échange-la avec une de tes cartes')
    return last + 'À toi : pioche ou prends le ' + num(g.top)
  }

  /* Ce que fait un appui sur ma carte i (null = rien) */
  function cellAction(S, i) {
    const g = S.game, me = S.me.id, s = g.grids[me]?.[i]
    if (S.phase !== 'play' || !g.seat || !s) return null
    if (g.setup) return ups(g.grids[me]) < 2 && !s.up ? 'flip' : null
    if (g.turn !== me) return null
    if (g.mustflip) return s.up ? null : 'flip'
    return g.held != null ? 'swap' : null
  }

  function play(root, S, prev) {
    const g = S.game, me = S.me.id, myTurn = g.turn === me && S.phase === 'play'
    if (!el || !root.firstChild) build(root)
    const needFlip = g.setup && g.seat && ups(g.grids[me]) < 2
    FX.turn(myTurn || needFlip, needFlip ? 'Retourne 2 cartes' : 'À toi')

    // positions avant mise à jour : les cartes partent de là
    const rects = new Map([...root.querySelectorAll('[data-k]')].map((e) => [e.dataset.k, e.getBoundingClientRect()]))
    const R = { deck: el.deck.getBoundingClientRect(), disc: el.disc.getBoundingClientRect(), held: el.held.firstChild?.getBoundingClientRect() }
    const pg = prev?.game

    // adversaires, dans l'ordre du jeu en partant de moi
    const k = g.order.indexOf(me), others = k < 0 ? g.order : [...g.order.slice(k + 1), ...g.order.slice(0, k)]
    put(el.seats, ...others.map((pid) => {
      const p = P(pid) || { name: '?' }, grid = g.grids[pid]
      return h('div.seat' + (g.turn === pid ? '.is-turn' : '') + (g.closer === pid ? '.is-closer' : ''), { 'data-id': pid },
        h('b.seat__name', FX.avatar(p.name, null, !p.online), p.name),
        mini(pid, grid),
        h('span.seat__n.mono', g.setup && ups(grid) < 2 ? 'retourne…' : signed(shown(grid)) + ' visibles'),
        g.closer === pid && tag('a fini', 'tag--ok'))
    }))

    // pioche, défausse, carte prise
    el.deck.querySelector('.pile__n').textContent = g.deck
    const canDraw = myTurn && !g.setup && g.held == null && !g.mustflip
    el.deck.classList.toggle('is-active', canDraw)
    const canDisc = myTurn && !g.setup && ((g.held == null && !g.mustflip && g.top != null) || (g.held != null && g.src === 'deck'))
    el.disc.classList.toggle('is-active', canDisc)
    el.disc.setAttribute('aria-label', g.held != null && g.src === 'deck' && myTurn ? 'Défausser la carte piochée' : 'Prendre la défausse' + (g.top != null ? ' : ' + num(g.top) : ''))
    if (!pg || pg.top !== g.top || el.disc.dataset.k !== String(g.top)) { el.disc.replaceChildren(g.top == null ? cardEl(null) : cardEl({ up: true, v: g.top })); el.disc.dataset.k = String(g.top) }
    el.discL.textContent = myTurn && g.held != null && g.src === 'deck' ? 'Défausser ici' : 'Défausse'
    el.discL.classList.toggle('is-hot', myTurn && g.held != null && g.src === 'deck')
    const heldKey = g.held == null ? '' : g.turn + ':' + g.held
    if (el.held.dataset.k !== heldKey) { el.held.replaceChildren(g.held == null ? cardEl(null) : cardEl({ up: true, v: g.held }, '.is-held')); el.held.dataset.k = heldKey }
    el.heldL.textContent = g.held == null ? 'En main' : myTurn ? 'Ta carte' : (P(g.turn)?.name || '?')

    // bandeau
    const text = say(S)
    if (el.banner.dataset.k !== text) { el.banner.dataset.k = text; put(el.banner, h('span.banner__t' + (myTurn || needFlip ? '.is-me' : ''), text)) }

    // ma grille : 12 boutons fixes, le contenu change seulement si la carte change
    const mineGrid = g.grids[me] || Array(12).fill({ up: false })
    el.grid.classList.toggle('is-off', !g.seat)
    el.cells.forEach((b, i) => {
      const s = mineGrid[i], key = slotKey(s)
      if (b.dataset.s !== key) { b.replaceChildren(cardEl(s)); b.dataset.s = key }
      b.dataset.k = me + ':' + i
      const a = cellAction(S, i)
      b.classList.toggle('is-ok', !!a)
      b.classList.toggle('is-swap', a === 'swap')
      b.setAttribute('aria-label', cardName(s, i) + (a === 'swap' ? ' : échanger' : a === 'flip' ? ' : retourner' : ''))
    })
    el.grid.classList.toggle('is-turn', myTurn || needFlip)
    put(el.sum, g.seat && 'Visible : ', g.seat && h('b', signed(shown(mineGrid))), g.seat && ' · ', g.seat && plural(12 - ups(mineGrid) - mineGrid.filter((s) => !s).length, 'cachée'))

    // contrôles (les piles se touchent aussi directement)
    const cur = P(g.turn), late = g.setup ? g.order.filter((pid) => ups(g.grids[pid]) < 2 && !P(pid)?.online) : []
    put(el.controls,
      canDraw && h('button.btn.btn--sm', { type: 'button', onclick: tapDeck }, 'Piocher'),
      canDraw && g.top != null && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: tapDisc }, 'Prendre le ' + num(g.top)),
      myTurn && g.held != null && g.src === 'deck' && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: tapDisc }, 'Défausser le ' + num(g.held)),
      S.me.host && S.phase === 'play' && ((!g.setup && cur && !cur.online && g.turn !== me) || late.length) &&
        h('button.link.mono', { type: 'button', onclick: () => confirm(g.setup ? 'Retourner au hasard les cartes des absents ?' : 'Faire jouer ' + cur.name + ' au hasard ?') && Core.safe('skip') }, 'Passer le joueur absent'))

    put(el.side,
      h('p.kicker', 'Scores · partie en ' + g.target),
      h('ul.scores', [...S.players].sort((a, b) => a.score - b.score).map((p) => h('li' + (p.id === me ? '.is-me' : ''), h('span', FX.avatar(p.name), p.name), h('b.mono', p.score)))),
      events(),
      S.me.host && S.phase === 'play' && h('button.link.mono.stop', { type: 'button', onclick: () => confirm('Arrêter la manche pour tout le monde ?') && Core.safe('stop') }, 'Arrêter la manche'))

    const active = el.seats.querySelector('.seat.is-turn')     // mobile : le siège actif reste visible, au début de la rangée à mon tour
    if (pg?.turn !== g.turn) el.seats.scrollTo({ left: active ? active.offsetLeft - (el.seats.clientWidth - active.offsetWidth) / 2 : 0, behavior: calm ? 'auto' : 'smooth' })

    animate(S, prev, rects, R)
  }

  /* ── animations ─────────────────────────────────────────────────────── */
  const node = (key) => el.grid.querySelector(`[data-k="${key}"] .sc`) || el.seats.querySelector(`[data-k="${key}"]`)
  function fly(n, from, delay = 0) {
    if (!n || !from || calm) return
    const to = n.getBoundingClientRect()
    if (!to.width) return
    n.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`, transformOrigin: '0 0', zIndex: 20 },
      { transform: 'none', transformOrigin: '0 0', zIndex: 20 }], { duration: 480, delay, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' })
  }
  const flipIn = (n, delay = 0) => n && !calm && n.animate([{ transform: 'rotateY(90deg) scale(1.08)' }, { transform: 'none' }], { duration: 340, delay, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'backwards' })

  function animate(S, prev, rects, R) {
    const g = S.game, me = S.me.id, evs = (g.evs || []).filter((e) => e.seq > seen)
    seen = Math.max(seen, ...(g.evs || []).map((e) => e.seq), 0)
    if (!prev?.game) return                                 // à la connexion : on ne rejoue rien
    const moved = new Set(evs.filter((e) => e.type === 'swap').map((e) => e.pid + ':' + e.i))
    // cartes passées de cachées à visibles (retournement, ou décompte final en vague)
    let wave = 0
    for (const pid of g.order) (g.grids[pid] || []).forEach((s, i) => {
      const was = prev.game.grids?.[pid]?.[i], key = pid + ':' + i
      if (s && s.up && was && !was.up && !moved.has(key)) flipIn(node(key), S.phase === 'play' ? 0 : 60 * wave++)
    })
    if (S.phase !== 'play' && wave) FX.play('flip')
    evs.forEach((ev, n) => setTimeout(() => event(ev, g, me, rects, R), n * 320))
  }

  function event(ev, g, me, rects, R) {
    const key = ev.pid + ':' + ev.i
    if (ev.type === 'flip') FX.play('flip')
    else if (ev.type === 'draw' || ev.type === 'take') { FX.play('draw'); fly(el.held.firstChild, ev.type === 'draw' ? R.deck : R.disc) }
    else if (ev.type === 'swap') {
      FX.play('slap')
      fly(node(key), R.held || (ev.src === 'deck' ? R.deck : R.disc))
      fly(el.disc.firstChild, rects.get(key), 120)
    } else if (ev.type === 'discard') { FX.play('tick'); fly(el.disc.firstChild, R.held || R.deck) }
    else if (ev.type === 'col') {
      FX.play('good')
      const col = HEX[tone(ev.v)]
      for (let r = 0; r < 3; r++) {
        const b = rects.get(ev.pid + ':' + (ev.c * 3 + r))
        if (b) setTimeout(() => FX.burst(b.left + b.width / 2, b.top + b.height / 2, col, ev.pid === me ? 26 : 10), r * 90)
      }
      if (ev.pid === me) { callout('Colonne !', 'Trois ' + num(ev.v) + ' défaussés'); FX.vibrate(80) }
      else FX.shake(el.seats.querySelector(`[data-id="${ev.pid}"]`), 5)
    } else if (ev.type === 'closer') {
      FX.play('turn')
      callout('Dernier tour !', ev.pid === me ? 'Les autres jouent une dernière fois' : (P(ev.pid)?.name || '?') + ' a tout retourné')
    } else if (ev.type === 'begin') Core.toast(ev.pid === me ? 'Tu montres le plus de points : tu commences.' : (P(ev.pid)?.name || '?') + ' commence.')
  }

  function callout(big, small) {
    const pop = h('div.pop', h('b', big), h('small.mono', small))
    document.body.append(pop)
    pop.animate(calm ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.08)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 }, { transform: 'translate(-50%,-62%) scale(.96)', opacity: 0 }],
      { duration: 1500, easing: 'ease-out' }).onfinish = () => pop.remove()
  }

  /* ── appuis (un seul envoi à la fois : pas de double action sur un double appui) ── */
  function send(action, extra) {
    if (busy) return
    busy = true
    Core.act(action, extra).catch(() => {}).finally(() => { busy = false })
  }
  function refuse(n, msg) { FX.shake(n, 6); Core.toast(msg) }
  function why(S) {
    const g = S.game
    if (!g.seat) return 'Tu joueras à la prochaine manche.'
    if (g.setup) return ups(g.grids[S.me.id]) < 2 ? 'Retourne d\'abord 2 de tes cartes.' : 'Attends que les autres retournent leurs cartes.'
    if (g.turn !== S.me.id) return 'Ce n\'est pas ton tour.'
    if (g.mustflip) return 'Retourne une de tes cartes cachées.'
    return null
  }
  function tapDeck() {
    const S = Core.state(), g = S?.game
    if (!g || S.phase !== 'play') return
    const no = why(S) || (g.held != null && 'Tu as déjà une carte : échange-la' + (g.src === 'deck' ? ' ou défausse-la.' : '.'))
    no ? refuse(el.deck, no) : send('draw')
  }
  function tapDisc() {
    const S = Core.state(), g = S?.game
    if (!g || S.phase !== 'play') return
    const no = why(S) || (g.held != null && g.src !== 'deck' && 'Tu as pris la défausse : échange-la avec une de tes cartes.')
    if (no) return refuse(el.disc, no)
    send(g.held != null ? 'discard' : 'take')
  }
  function tapCell(i) {
    const S = Core.state(), g = S?.game
    if (!g || S.phase !== 'play') return
    const a = cellAction(S, i)
    if (a) return send(a, { i })
    const s = g.grids[S.me.id]?.[i]
    refuse(el.cells[i], why(S) || (!s ? 'Cette colonne est partie.' : g.mustflip || g.setup ? 'Choisis une carte encore cachée.' : 'Pioche ou prends la défausse d\'abord.'))
  }

  /* ── fin de manche : grilles retournées, points de la manche, total ── */
  function end(S) {
    el = null
    const g = S.game
    if (!g || !g.pts) return null
    const win = S.result?.gagnants || []
    const rows = [...g.order].sort((a, b) => (P(a)?.score ?? 0) - (P(b)?.score ?? 0))
    return h('div.recap',
      h('p.kicker', g.over ? 'Partie terminée : ' + g.target + ' points atteints' : 'Partie en ' + g.target + ' points'),
      rows.map((pid) => {
        const p = P(pid) || { name: '?', score: 0 }
        return h('div.recap__row' + (win.includes(pid) ? '.is-win' : '') + (pid === S.me.id ? '.is-me' : ''),
          h('b.recap__name', FX.avatar(p.name), p.name),
          mini('end-' + pid, g.grids[pid]),
          h('span.recap__pts.mono', signed(g.pts[pid]), pid === g.closer && tag(g.doubled ? 'a fini · ×2' : 'a fini', g.doubled ? '' : 'tag--ok')),
          h('b.recap__tot.mono', { title: 'Total' }, p.score))
      }))
  }

  /* Raccourcis clavier (ordinateur) : D piocher, P prendre la défausse, X défausser */
  addEventListener('keydown', (e) => {
    const S = Core.state()
    if (!S || S.phase !== 'play' || !el || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return
    const k = e.key.toLowerCase(), g = S.game
    if (k === 'd') tapDeck()
    else if (k === 'p' && g.held == null) tapDisc()
    else if (k === 'x' && g.held != null) tapDisc()
  })

  Core.boot({
    id: 'douze', max: 8, kicker: 'Jeu de cartes entre potes',
    title: ['Le moins', 'de points.'],
    lead: 'Douze cartes cachées devant toi. Pioche, échange, retourne, et aligne trois cartes identiques en colonne pour les faire disparaître. Le plus petit score gagne. Pas de compte : un pseudo et un code suffisent.',
    foot: '2 à 8 joueurs · 150 cartes de −2 à 12 · partie en 100 points',
    howto: ['Au début, retourne 2 de tes 12 cartes. Moins tu as de points, mieux c\'est.', 'À ton tour : prends la défausse ou pioche, puis échange avec une de tes cartes. Ou défausse la carte piochée et retourne une carte cachée.', 'Trois cartes identiques dans une colonne disparaissent. Quand quelqu\'un a tout retourné, les autres jouent un dernier tour.'],
    rank: false,
    again: (S) => (S.game?.over ? 'Nouvelle partie' : 'Manche suivante'),
    lobby, play, end,
  })
})()
