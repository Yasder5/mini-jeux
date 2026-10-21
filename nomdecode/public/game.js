/* Nom de code : salon par équipes, grille persistante (cartes qui se retournent), indices. */
(() => {
  const { h, put, safe, tag, P, events } = Core
  const TEAM = { a: 'Citron', b: 'Corail' }, HEX = { a: '#d3fd50', b: '#ff6b5a', n: '#cfc8b4', x: '#ff3b2f' }
  const team = (t) => Core.state().players.filter((p) => p.team === t)

  function lobby(S, host) {
    const me = P(S.me.id), rot = S.settings.rotate
    const col = (t) => h('div.teamcol.team-' + t,
      h('div.teamcol__head', h('h2.h', TEAM[t]), h('span.mono.muted', team(t).length + ' joueur' + (team(t).length > 1 ? 's' : ''))),
      h('ul.players', team(t).sort((a, b) => b.spy - a.spy).map((p) => Core.playerRow(p, p.spy && tag('maître-espion', 'tag--spy')))),
      h('div.teamcol__btns',
        me.team !== t && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => safe('team', { team: t, spy: false }) }, 'Rejoindre ' + TEAM[t]),
        !(me.team === t && me.spy) && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => safe('team', { team: t, spy: true }) }, 'Être maître-espion'),
        me.team === t && me.spy && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => safe('team', { team: t, spy: false }) }, 'Redevenir agent')))
    const ok = team('a').length >= 2 && team('b').length >= 2
    return {
      ok,
      hint: ok ? 'Sans maître-espion choisi, un joueur est tiré au sort dans l\'équipe.' : 'Il faut au moins 2 joueurs par équipe (4 au total).',
      full: h('div',
        h('div.teams', col('a'), h('div.vs.mono', 'contre'), col('b')),
        h('div.lobbyopts',
          h('span.lbl.mono', 'Maître-espion qui tourne à chaque manche'),
          h('div.seg', [['Non', false], ['Oui', true]].map(([t, v]) => h('button', { type: 'button', 'aria-pressed': String(rot === v), disabled: !host && rot !== v, onclick: host ? () => safe('settings', { settings: { rotate: v } }) : null }, t))),
          host && h('button.link.mono', { type: 'button', onclick: () => safe('shuffle') }, 'Mélanger les équipes'))),
    }
  }

  /* ── partie : éléments créés une fois puis mis à jour ─────────────── */
  let el = null, dealUntil = 0, armed = null, hostOpen = false
  const flipAt = new Map()
  function build(root, S) {
    el = { cards: [] }
    el.score = h('div.score', h('span.score__a.team-a', h('b.mono'), h('small.mono', 'Citron')), h('div.turn'), h('span.score__b.team-b', h('b.mono'), h('small.mono', 'Corail')))
    el.role = h('p.myrole.mono')
    el.clue = h('div.clue')
    el.board = h('div.board')
    S.game.cards.forEach((c, i) => {
      const card = h('button.card', { type: 'button', style: `--d:${(i % 5) * 45 + Math.floor(i / 5) * 70}ms` },
        h('span.card__in', h('span.card__front', h('span.card__sym'), h('span.card__w'), h('span.card__marks')), h('span.card__back', h('span.card__sym'), h('span.card__w'))))
      card.addEventListener('click', () => click(i))
      el.cards.push(card)
      el.board.append(card)
    })
    el.confirm = h('div.confirm')
    el.side = h('aside.side')
    root.replaceChildren(h('div.game', h('div.main', el.score, el.role, el.clue, el.board, el.confirm, el.actions = h('div.actions')), el.side))
    armed = null
  }

  /* Toucher = proposer (ou retirer sa proposition). Retourner passe par le bouton de confirmation :
     pas de carte retournée par erreur sur un double appui. */
  function click(i) {
    const S = Core.state(), g = S.game, me = P(S.me.id), c = g.cards[i]
    if (S.phase !== 'play' || c.r || me.spy || me.team !== g.turn || !g.clue) return
    armed = c.m.includes(S.me.id) ? (armed === i ? null : armed) : i
    FX.play('tick')
    safe('mark', { i })
  }

  /* Indice écrit lettre par lettre */
  function typewrite(node, word) {
    if (FX.calm) { node.textContent = word; return }
    node.textContent = ''
    ;[...word].forEach((ch, k) => setTimeout(() => { node.textContent += ch; FX.play('tick') }, 140 + k * 70))
  }

  function play(root, S, prev) {
    const g = S.game, me = P(S.me.id), mine = me && me.team === g.turn, first = !el || !root.firstChild
    if (first) { build(root, S); dealUntil = Date.now() + 1800 }
    root.classList.toggle('is-spy', !!me?.spy)
    FX.turn(!!me && mine && (me.spy ? !g.clue : !!g.clue), me?.spy ? 'Ton indice' : 'À vous')
    // score : le compteur « tombe » quand une équipe trouve un mot
    for (const t of ['a', 'b']) {
      const b = el.score.querySelector('.score__' + t + ' b'), before = prev?.game?.remaining[t]
      b.textContent = g.remaining[t]
      if (before != null && before > g.remaining[t] && !FX.calm) b.animate([{ transform: 'translateY(-18px) scale(1.4)', opacity: .3 }, { transform: 'translateY(4px) scale(.95)', offset: .7 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.3)' })
    }
    const turn = el.score.querySelector('.turn')
    if (!prev || prev.game?.turn !== g.turn) {
      put(turn, h('span.turn__t.team-' + g.turn, h('small.mono', mine ? 'À vous' : 'Au tour de'), h('b', 'Équipe ' + TEAM[g.turn])))
      root.dataset.turn = g.turn
    }
    // rappel de mon rôle
    const roleKey = me ? me.team + me.spy : ''
    if (el.role.dataset.k !== roleKey) {
      el.role.dataset.k = roleKey
      el.role.className = 'myrole mono' + (me?.team ? ' team-' + me.team : '')
      el.role.textContent = me?.team ? 'Toi : ' + (me.spy ? 'maître-espion ' : 'agent ') + TEAM[me.team] : 'Tu regardes cette manche'
    }
    // indice
    const clueKey = g.clue ? g.clue.word + g.clue.n + g.turn : 'none' + g.turn + (me?.spy && mine)
    if (el.clue.dataset.k !== clueKey) {
      el.clue.dataset.k = clueKey
      if (g.clue) {
        const w = h('b')
        put(el.clue, h('div.clue__show.team-' + g.turn, h('small.mono', 'Indice de ' + (P(g.clue.by)?.name || 'l\'espion')), w, h('span.clue__n.mono', g.clue.n < 0 ? '∞' : g.clue.n)))
        prev ? typewrite(w, g.clue.word) : (w.textContent = g.clue.word)
      } else if (me?.spy && mine) put(el.clue, clueForm())
      else put(el.clue, h('p.clue__wait.mono', 'Le maître-espion ' + TEAM[g.turn] + ' cherche un indice…'))
    }
    // cartes
    const now = Date.now()
    g.cards.forEach((c, i) => {
      const card = el.cards[i], was = prev?.game?.cards[i]
      for (const w of card.querySelectorAll('.card__w')) { w.textContent = c.w; w.classList.toggle('is-long', c.w.length > 8); w.classList.toggle('is-xlong', c.w.length > 10); w.style.setProperty('--len', Math.max(5, c.w.length)) }
      if (was && !was.r && c.r) {
        flipAt.set(i, now)
        const by = prev.game.turn, kind = c.c === by ? 'good' : c.c === 'x' ? 'boom' : c.c === 'n' ? 'flip' : 'buzz'
        setTimeout(() => {
          FX.play(kind)
          const b = card.getBoundingClientRect()
          FX.burst(b.left + b.width / 2, b.top + b.height / 2, HEX[c.c], c.c === 'x' ? 70 : 22)
          if (c.c === 'x') { FX.flash('#ff3b2f', .45); FX.shake(root, 12); FX.vibrate([120, 60, 220]) }
        }, 520)
      }
      const flipping = now - (flipAt.get(i) || 0) < 1100
      card.className = 'card' + (c.c ? ' col-' + c.c : '') + (c.r ? ' is-rev' : '') + (flipping ? ' is-flipping' : '') + (c.m.length ? ' is-marked' : '') + (c.m.includes(S.me.id) ? ' is-mine' : '') + (now < dealUntil ? ' is-deal' : '')
      card.disabled = c.r || !mine || me.spy || !g.clue
      card.querySelector('.card__marks').replaceChildren(...c.m.map((id) => { const n = P(id)?.name || '?'; return h('i.mono', { title: n }, [...n].slice(0, 3).join('')) }))
      card.setAttribute('aria-label', c.w + (c.r ? ', retournée' : c.m.includes(S.me.id) ? ', proposée par toi' : ''))
    })
    // confirmation de retournement
    if (armed != null && (g.cards[armed]?.r || !g.cards[armed]?.m.includes(S.me.id) || !mine || !g.clue)) armed = null
    if (armed == null) { const k = g.cards.findIndex((c) => !c.r && c.m.includes(S.me.id)); armed = k < 0 ? null : k }
    put(el.confirm, armed != null && mine && !me.spy && g.clue && h('div.confirm__box',
      h('span', 'Retourner ', h('b', g.cards[armed].w), ' ?'),
      h('button.btn.btn--sm', { type: 'button', onclick: (e) => { e.currentTarget.disabled = true; safe('reveal', { i: armed }) } }, 'Retourner'),
      h('button.link.mono', { type: 'button', onclick: () => safe('mark', { i: armed }) }, 'Annuler')))
    // actions
    put(el.actions,
      mine && !me.spy && g.clue && h('p.hint.mono', (g.left != null ? g.left + ' essai' + (g.left > 1 ? 's' : '') + ' restant' + (g.left > 1 ? 's' : '') + ' · ' : '') + 'touche un mot pour le proposer à ton équipe'),
      mine && !me.spy && g.clue && g.guessed > 0 && h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => safe('pass') }, 'Finir notre tour'),
      me?.spy && h('p.hint.mono', 'Tu es maître-espion : tu vois les couleurs. Pas un mot à ton équipe !'),
      S.me.host && h('details.hosttools', { open: hostOpen, ontoggle: (e) => { hostOpen = e.currentTarget.open } },
        h('summary.lbl.mono', 'Outils de l\'hôte'),
        ['a', 'b'].map((t) => h('button.link.mono', { type: 'button', onclick: () => confirm('Donner le rôle de maître-espion ' + TEAM[t] + ' à un autre joueur ?') && safe('respy', { team: t }) }, 'Changer l\'espion ' + TEAM[t])),
        h('button.link.mono', { type: 'button', onclick: () => confirm('Faire passer le tour de l\'équipe ' + TEAM[g.turn] + ' ?') && safe('skipturn') }, 'Passer le tour'),
        h('button.link.mono', { type: 'button', onclick: () => confirm('Arrêter la manche pour tout le monde ?') && safe('stop') }, 'Arrêter la manche')))
    // côté : équipes et historique
    put(el.side,
      ...['a', 'b'].map((t) => h('div.sideteam.team-' + t, h('p.kicker', TEAM[t]), h('ul.mini', team(t).map((p) => h('li' + (p.id === S.me.id ? '.is-me' : ''), FX.avatar(p.name, HEX[p.team], !p.online), p.name, p.spy && tag('espion', 'tag--spy')))))),
      g.clues.length > 0 && h('div', h('p.kicker', 'Indices'), h('ul.cluelog.mono', [...g.clues].reverse().map((c) => h('li.team-' + c.team, h('b', c.word), ' ' + (c.n < 0 ? '∞' : c.n))))),
      events())
  }

  function clueForm() {
    let n = 1
    const word = h('input#clueword', { maxlength: 24, placeholder: 'Ton indice (un mot)', autocomplete: 'off', 'aria-label': 'Indice' })
    const nums = h('div.nums', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1].map((v) => h('button.num.mono', { type: 'button', 'aria-pressed': String(v === n), onclick: (e) => { n = v; FX.play('tick'); nums.querySelectorAll('.num').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))) } }, v < 0 ? '∞' : v)))
    return h('form.clueform', { onsubmit: (e) => { e.preventDefault(); safe('clue', { word: word.value.trim(), n }) } },
      h('p.kicker', 'À toi, maître-espion'), h('div.send', word, h('button.btn', 'Donner')), nums)
  }

  /* Fin : la grille entière se retourne en vague depuis la dernière carte jouée */
  function end(S) {
    el = null
    flipAt.clear()
    const g = S.game
    if (!g) return null
    const L = g.last ?? 12, lr = Math.floor(L / 5), lc = L % 5
    const tally = (t) => g.cards.filter((c) => c.c === t && c.r).length + '/' + g.cards.filter((c) => c.c === t).length
    return [h('div.tally', ['a', 'b'].map((t) => h('span.tally__t.team-' + t, h('b.mono', tally(t)), h('small.mono', TEAM[t])))), h('div.board.board--end', g.cards.map((c, i) => h('div.card.is-rev.col-' + c.c + (c.r ? '' : '.is-unfound'), { style: `--d:${(Math.abs(Math.floor(i / 5) - lr) + Math.abs(i % 5 - lc)) * 70}ms` },
      h('span.card__in', h('span.card__back', h('span.card__sym'), h('span.card__w' + (c.w.length > 8 ? '.is-long' : '') + (c.w.length > 10 ? '.is-xlong' : ''), { style: '--len:' + Math.max(5, c.w.length) }, c.w))))))]
  }

  Core.boot({
    id: 'nomdecode', max: 16, kicker: 'Jeu d\'équipe et de mots',
    title: ['Un mot,', 'un nombre.'],
    lead: 'Deux équipes, deux maîtres-espions, 25 mots. Faites deviner vos agents avec un seul indice, sans tomber sur l\'assassin. Pas de compte : un pseudo et un code suffisent.',
    foot: '4 à 16 joueurs · 2 équipes · plus de 450 mots',
    howto: ['Chaque équipe a un maître-espion : lui seul voit à qui sont les 25 mots.', 'Il donne un indice d\'un mot et un nombre de cartes à trouver.', 'Ses agents touchent les mots. Le premier à trouver tous les siens gagne, l\'assassin fait perdre.'],
    rank: false,                                           // jeu d'équipe : le résultat se lit sur la grille
    lobby, play, end,
    color: (p) => HEX[p.team],                             // avatars à la couleur de l'équipe
  })
})()
