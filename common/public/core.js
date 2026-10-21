/* Socle client des jeux yasder5 : pseudo local, création / connexion par code, salon, fin de manche, SSE, orbe.
   Le jeu appelle Core.boot({ id, title, lead, foot, rules, lobby, play, end }). Aucun innerHTML de données. */
window.Core = (() => {
  const $ = (s) => document.querySelector(s)
  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) } catch {} },
  }
  let G, S = null, prev = null, session = null, es = null, playRoot = null, screen = '', pingSeen = -1, emotes = null, hold = null
  const FINAL_HOLD = 1800                                 // le coup final reste à l'écran avant la fin de manche

  /* h('div#id.cls', {attrs, onclick}, enfants...) : chaînes = texte */
  function h(sel, attrs, ...kids) {
    const [head, ...cls] = sel.split('.'), [tag, id] = head.split('#'), e = document.createElement(tag || 'div')
    if (id) e.id = id
    if (cls.length) e.className = cls.join(' ')
    if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
      else if (k === 'style') e.style.cssText = v
      else e.setAttribute(k, v === true ? '' : v)
    }
    for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k))
    return e
  }

  /* replaceChildren sans les valeurs vides des conditions (false, null, 0, '') */
  const put = (node, ...kids) => node.replaceChildren(...kids.flat(9).filter((k) => k != null && k !== false && k !== 0 && k !== ''))

  let toastT
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('is-on'), 3200) }

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({ error: 'Réponse invalide du serveur.' }))
    if (!r.ok) throw new Error(d.error || 'Erreur.')
    return d
  }
  const act = (action, extra = {}) => post('/api/act', { code: session.code, token: session.token, action, ...extra }).catch((e) => { toast(e.message); throw e })
  const safe = (action, extra) => act(action, extra).catch(() => {})

  function connect() {
    if (es) es.close()
    es = new EventSource('/api/events?code=' + encodeURIComponent(session.code) + '&token=' + encodeURIComponent(session.token))
    es.onopen = () => net(true)
    es.onmessage = (m) => { net(true); prev = S; S = JSON.parse(m.data); render(); effects() }
    es.addEventListener('gone', () => { toast('Tu ne fais plus partie de cette partie.'); quit() })
    es.onerror = async () => {
      net(false)
      const r = await fetch('/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session?.code, token: session?.token, action: 'ping' }) }).catch(() => null)
      if (r && r.status === 400) { const d = await r.json().catch(() => ({})); if (/introuvable|plus partie/.test(d.error || '')) { toast(d.error); quit() } }
    }
  }
  function net(ok) { $('#net')?.classList.toggle('is-on', !ok && !!session) }
  function quit() { net(true); clearTimeout(hold); hold = null; if (es) es.close(); es = null; S = prev = null; session = null; pingSeen = -1; FX.turn(false); FX.wake(false); FX.quiet(true); if (emotes) emotes.remove(), emotes = null; store.set(G.id + '_session', null); history.replaceState(null, '', './'); render() }
  function enter(d) { session = d; store.set(G.id + '_session', d); history.replaceState(null, '', '?r=' + d.code); connect() }

  const me = () => S.me
  const P = (id) => S.players.find((p) => p.id === id)
  const tag = (t, cls = '') => h('span.tag' + (cls ? '.' + cls : ''), t)

  function render() {
    $('#topcode').textContent = S ? 'Partie ' + S.code : ''
    const next = !session ? 'home' : !S ? 'wait' : S.phase
    const app = $('#app')
    if (next === 'play') {
      // écran de jeu persistant : le jeu met à jour ses éléments et anime les changements
      if (screen !== 'play' || !playRoot || (prev && prev.round !== S.round)) { playRoot = h('section.screen.play'); app.replaceChildren(playRoot, leaveBtn()); prev = null }
      screen = 'play'
      return G.play(playRoot, S, prev)
    }
    if (next === 'end' && screen === 'play' && playRoot && S.game) {
      if (!hold) {
        G.play(playRoot, S, prev)
        hold = setTimeout(() => { hold = null; screen = 'final'; render() }, FX.calm ? 0 : FINAL_HOLD)
      }
      return
    }
    playRoot = null
    const keep = document.activeElement && document.activeElement.id
    app.replaceChildren(next === 'home' ? home() : next === 'wait' ? h('p.muted.mono.center', 'Connexion à la partie…') : next === 'lobby' ? lobby() : end())
    if (screen === next) app.firstChild.classList.add('no-anim')            // pas de réapparition à chaque mise à jour
    screen = next
    if (next === 'home') pubs()
    if (keep && document.getElementById(keep)) document.getElementById(keep).focus()
  }

  function home() {
    const code = (new URLSearchParams(location.search).get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
    const name = h('input#name', { maxlength: 16, autocomplete: 'nickname', placeholder: 'Ton pseudo', value: store.get('y5_name') || '', 'aria-label': 'Pseudo' })
    const codeIn = h('input#code.mono.code-in', { maxlength: 4, placeholder: 'CODE', value: code, autocapitalize: 'characters', 'aria-label': 'Code de la partie', oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '') } })
    const go = (path) => async (e) => {
      e.preventDefault()
      const n = name.value.trim()
      if (!n) { name.focus(); return toast('Choisis un pseudo.') }
      store.set('y5_name', n)
      try { enter(await post(path, { name: n, code: codeIn.value })) } catch (err) { toast(err.message) }
    }
    return h('section.home',
      h('p.kicker', G.kicker),
      h('h1', G.title[0], h('br'), h('mark', G.title[1])),
      h('p.lead', G.lead),
      h('form.panel', { onsubmit: go(code ? '/api/join' : '/api/create') },
        h('label.lbl.mono', { for: 'name' }, 'Pseudo'), name,
        h('label.lbl.mono', { for: 'code' }, 'Rejoindre avec un code'),
        h('div.join', codeIn, h('button.btn.btn--ghost', { type: 'button', onclick: go('/api/join') }, 'Rejoindre')),
        h('div.or.mono', 'ou'),
        h('button.btn.btn--wide', { type: 'button', onclick: go('/api/create') }, 'Créer une partie'),
        h('p.consent', 'En jouant, tu acceptes les ', h('a', { href: 'https://yasder5.fr/cgu.html' }, 'conditions d\'utilisation'), '. Rien n\'est gardé après la partie : ', h('a', { href: 'https://yasder5.fr/confidentialite.html' }, 'confidentialité'), '.')),
      h('section.pubs', { 'aria-labelledby': 'pubs-t' }, h('p#pubs-t.kicker', 'Parties publiques'), h('ul#pubs.pubs__l', { 'aria-live': 'polite' })),
      h('p.muted.small.mono', G.foot))
  }

  /* Liste des parties publiques de l'accueil, rafraîchie tant que l'accueil est affiché */
  let pubT
  async function pubs() {
    clearTimeout(pubT)
    if (screen !== 'home') return
    const ul = $('#pubs')
    const d = await fetch('/api/public').then((r) => r.json()).catch(() => null)
    if (ul && d && screen === 'home') {
      put(ul, d.rooms.length ? d.rooms.map((r) => h('li', h('button.pub', { type: 'button', onclick: () => joinPub(r.code) },
        h('b.mono', r.code), h('span', 'Partie de ', r.host), h('small.mono', r.n + '/' + r.max + (r.play ? ' · en cours' : ' · au salon')), h('span.pub__go.mono', 'Rejoindre'))))
        : h('li.muted.small', 'Aucune partie publique pour l\'instant. Crée la tienne et rends-la publique depuis le salon.'))
    }
    pubT = setTimeout(pubs, document.hidden ? 20000 : 5000)
  }
  function joinPub(code) {
    const c = $('#code'), n = $('#name')
    c.value = code
    if (!n.value.trim()) { n.focus(); return toast('Choisis un pseudo, puis rejoins la partie ' + code + '.') }
    $('.join .btn').click()
  }

  function share() {
    const url = location.origin + '/?r=' + S.code
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: document.title, text: 'Rejoins ma partie, code ' + S.code, url }).catch(() => {})
    else navigator.clipboard.writeText(url).then(() => toast('Lien copié.'), () => toast(url))
  }

  function playerRow(p, ...extra) {
    return h('li.pl' + (p.id === me().id ? '.is-me' : ''),
      FX.avatar(p.name, G.color && G.color(p), !p.online), h('span.pl__name', p.name), p.host && tag('hôte'), p.id === me().id && tag('toi', 'tag--me'),
      extra, h('span.pl__score.mono', p.score + ' pt' + (p.score > 1 ? 's' : '')),
      me().host && p.id !== me().id && h('button.x', { type: 'button', title: 'Exclure ' + p.name, 'aria-label': 'Exclure ' + p.name, onclick: () => confirm('Exclure ' + p.name + ' ?') && safe('kick', { target: p.id }) }, '×'))
  }

  const events = () => S.events.length ? h('ul.events.mono', [...S.events].reverse().map((e) => h('li', e))) : null
  const leaveBtn = () => h('button.link.mono.leave', { type: 'button', onclick: () => confirm('Quitter la partie ?') && act('leave').catch(() => {}).finally(quit) }, 'Quitter la partie')

  function lobby() {
    const host = me().host, panel = G.lobby(S, host)
    return h('section.screen',
      h('div.codebox',
        h('p.kicker', 'Code de la partie'),
        h('button.code-big.mono', { type: 'button', onclick: share, title: 'Copier le lien d\'invitation' }, S.code),
        h('div.codebox__btns',
          h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: share }, 'Inviter (copier le lien)'),
          host ? h('button.btn.btn--ghost.btn--sm', { type: 'button', 'aria-pressed': String(!!S.locked), onclick: () => safe('lock') }, S.locked ? 'Rouvrir la partie' : 'Verrouiller la partie')
            : S.locked && tag('partie verrouillée'),
          host ? h('button.btn.btn--ghost.btn--sm', { type: 'button', 'aria-pressed': String(!!S.public), title: 'Une partie publique apparaît sur l\'accueil du jeu : n\'importe qui peut la rejoindre.', onclick: () => safe('public') }, S.public ? 'Publique (affichée à l\'accueil)' : 'Rendre publique')
            : S.public && tag('partie publique'))),
      G.howto && h('div.howto', h('p.kicker', 'Comment jouer'), h('ul', G.howto.map((t) => h('li', t))), h('button.link.mono', { type: 'button', onclick: () => $('#rules').showModal() }, 'Toutes les règles')),
      panel.full || h('div.cols',
        h('div', h('h2.h', 'Joueurs ', h('span.muted.mono', S.players.length + '/' + G.max)), h('ul.players', S.players.map((p) => playerRow(p))), events()),
        h('div', h('h2.h', 'Réglages', !host && h('span.muted.mono', ' · choisis par l\'hôte')), panel.settings)),
      panel.full && events(),
      host ? h('button.btn.btn--wide.btn--start', { type: 'button', disabled: !panel.ok, onclick: () => safe('start') }, S.round ? 'Nouvelle manche' : 'Lancer la partie') : h('p.wait.mono', 'En attente de l\'hôte…'),
      panel.hint && h('p.hint.mono.center-t' + (panel.ok ? '' : '.is-warn'), panel.hint),
      leaveBtn())
  }

  function end() {
    const r = S.result || {}, won = (r.gagnants || []).includes(me().id), stopped = !(r.gagnants || []).length
    const ranked = [...S.players].sort((a, b) => b.score - a.score)
    const btns = me().host
      ? h('div.endbtns', h('button.btn.btn--wide', { type: 'button', onclick: () => safe('start') }, G.again ? G.again(S) : 'Rejouer'), h('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => safe('lobby') }, 'Retour au salon'))
      : h('p.wait.mono', 'L\'hôte peut relancer une manche.')
    return h('section.screen.end',
      h('div.result' + (won ? '.is-won' : ''),
        h('p.kicker', won ? 'Victoire' : stopped ? 'Manche arrêtée' : 'Fin de la manche'),
        h('h1', r.text || 'Manche terminée.')),
      G.end ? G.end(S) : null,
      h('div.cols',
        G.rank === false ? h('div', h('h2.h', 'Joueurs'), h('ul.players', S.players.map((p) => playerRow(p)))) : h('div', h('h2.h', 'Classement'),
          h('ol.rank', ranked.map((p) => h('li' + (p.id === me().id ? '.is-me' : ''), h('span', p.name), (r.gagnants || []).includes(p.id) && tag('gagne', 'tag--ok'), h('b.mono', p.score))))),
        h('div', events(), btns)),
      others(),
      leaveBtn())
  }

  /* Lien vers les autres jeux (le pseudo y5_name est partagé entre eux) */
  const GAMES = [['undercover', 'Undercover', 'imposteur'], ['nomdecode', 'Nom de code', 'équipes et mots'], ['plus4', 'Plus4', 'cartes'], ['douze', 'Douze', 'cartes et colonnes']]
  const others = () => h('nav.others', h('p.kicker', 'Autre jeu ?'), h('div.others__l', GAMES.filter(([id]) => id !== G.id).map(([id, n, t]) => h('a.others__a', { href: 'https://' + id + '.yasder5.fr/' }, h('b', n), h('small.mono', t))), h('a.others__a', { href: 'https://yasder5.fr/hub' }, h('b', 'Tous les jeux'), h('small.mono', 'le hub'))))

  /* Effets liés aux changements d'état : compte à rebours, écran allumé, fin de manche, réactions */
  function effects() {
    if (!S) return
    const was = prev && prev.phase
    if (S.phase === 'play' && was && was !== 'play') FX.countdown()
    FX.wake(S.phase === 'play')
    FX.quiet(S.phase !== 'play')
    if (S.phase !== 'play') FX.turn(false)
    if (S.phase === 'end' && was === 'play') {
      const won = (S.result?.gagnants || []).includes(S.me.id)
      setTimeout(() => { FX.play(won ? 'win' : 'lose'); if (won) FX.confetti() }, FX.calm ? 0 : FINAL_HOLD + 200)
    }
    if (!emotes) { emotes = FX.emoteBar((e) => safe('emote', { e })); document.body.append(emotes) }
    const fresh = (S.pings || []).filter((x) => x.seq > pingSeen)
    if (pingSeen >= 0) fresh.forEach((x, i) => setTimeout(() => FX.bubble(FX.EMOTES[x.e], P(x.pid)?.name || '?'), i * 150))
    pingSeen = Math.max(pingSeen, ...(S.pings || []).map((x) => x.seq), 0)
  }

  function orb() {
    const cv = $('#orb'), ctx = cv.getContext('2d'), N = 480, pts = [], calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.39996323; pts.push([Math.cos(th) * r, y, Math.sin(th) * r, i % 9 === 0]) }
    let W, H
    const size = () => { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio }
    size(); addEventListener('resize', size)
    const t0 = performance.now()
    let last = 0
    const f = (now) => {
      if (screen === 'play' && now - last < 66 && !calm) return requestAnimationFrame(f)
      last = now
      const t = calm ? 2 : (now - t0) / 1000, a = t * .1, b = Math.sin(t * .15) * .3, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b)
      const playing = screen === 'play', wide = W > H, R = Math.min(W, H) * (wide ? .42 : .45), cx = W * (wide ? .78 : .7), cy = H * (wide ? .55 : .2)
      ctx.clearRect(0, 0, W, H)
      for (const [x, y, z, hot] of pts) {
        const x1 = x * ca - z * sa, z1 = x * sa + z * ca, y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb, d = (z2 + 1.4) / 2.4, k = playing ? .45 : 1
        ctx.fillStyle = hot ? `rgba(211,253,80,${(.15 + d * .55) * k})` : `rgba(243,243,238,${(.04 + d * .3) * k})`
        ctx.beginPath(); ctx.arc(cx + x1 * R, cy + y1 * R, (hot ? 2.2 : 1.4) * devicePixelRatio * (.6 + d * .7), 0, 6.283); ctx.fill()
      }
      if (calm) return
      if (document.hidden) document.addEventListener('visibilitychange', () => requestAnimationFrame(f), { once: true })
      else requestAnimationFrame(f)
    }
    requestAnimationFrame(f)
  }


  function boot(game) {
    G = game
    session = store.get(G.id + '_session')
    $('#rules-btn').addEventListener('click', () => $('#rules').showModal())
    $('#rules-btn').before(FX.muteButton())
    if (session) connect()
    render()
    orb()
  }

  return { boot, h, put, act, safe, toast, tag, me: () => me(), P, playerRow, events, burst: FX.burst, state: () => S }
})()
