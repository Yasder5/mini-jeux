/* Effets partagés des jeux yasder5 : sons WebAudio (aucun fichier), vibration, signal « À toi », écran allumé,
   compte à rebours, particules, confettis, flash, couleur par joueur, bouton muet.
   Copie identique dans ~/undercover/public/fx.js (Undercover n'utilise pas le socle commun). */
window.FX = (() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
  const set = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
  let ctx = null, muted = get('y5_mute') === '1'

  // le navigateur n'autorise le son qu'après un geste de l'utilisateur
  const unlock = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch {} } else if (ctx.state === 'suspended') ctx.resume() }
  addEventListener('pointerdown', unlock, { passive: true })
  addEventListener('keydown', unlock)

  function tone(f, t0, dur, { type = 'sine', vol = .18, to = null } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + t0
    o.type = type; o.frequency.setValueAtTime(f, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur)
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + .02)
  }
  function noise(t0, dur, { vol = .12, freq = 1800 } = {}) {
    const len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + t0
    f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol
    s.buffer = b; s.connect(f).connect(g).connect(ctx.destination); s.start(t)
  }
  const SOUNDS = {
    tick: () => tone(1320, 0, .05, { type: 'triangle', vol: .07 }),
    turn: () => { tone(659, 0, .14, { type: 'triangle' }); tone(988, .12, .22, { type: 'triangle' }) },
    good: () => { tone(784, 0, .1, { type: 'triangle' }); tone(1175, .08, .18, { type: 'triangle' }) },
    flip: () => noise(0, .16, { vol: .16, freq: 2400 }),
    slap: () => { noise(0, .09, { vol: .25, freq: 900 }); tone(140, 0, .12, { vol: .2, to: 70 }) },
    draw: () => noise(0, .2, { vol: .1, freq: 3200 }),
    buzz: () => tone(110, 0, .35, { type: 'square', vol: .09, to: 80 }),
    boom: () => { tone(160, 0, .9, { vol: .35, to: 35 }); noise(0, .5, { vol: .2, freq: 400 }) },
    pop: () => tone(880, 0, .07, { type: 'sine', vol: .1, to: 1400 }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .1, .35, { type: 'triangle', vol: .16 })),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * .16, .4, { type: 'triangle', vol: .13 })),
    count: () => tone(587, 0, .12, { type: 'triangle', vol: .14 }),
    go: () => tone(1175, 0, .3, { type: 'triangle', vol: .16 }),
  }
  function play(name) {
    if (muted || !ctx || !SOUNDS[name]) return
    if (ctx.state === 'suspended') ctx.resume()
    try { SOUNDS[name]() } catch {}
  }
  const vibrate = (p) => { if (!muted && navigator.vibrate) try { navigator.vibrate(p) } catch {} }

  /* Bouton muet à mettre dans l'en-tête */
  function muteButton() {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'link mono mute'
    const sync = () => { b.textContent = muted ? 'Son coupé' : 'Son'; b.setAttribute('aria-pressed', String(!muted)) }
    b.addEventListener('click', () => { muted = !muted; set('y5_mute', muted ? '1' : '0'); sync(); unlock(); play('tick') })
    sync()
    return b
  }

  /* Signal « À toi » : son + vibration au passage à vrai, titre d'onglet tant que c'est vrai */
  const baseTitle = document.title
  let mine = false
  function turn(isMine, label = 'À toi') {
    if (isMine && !mine) { play('turn'); vibrate([60, 40, 60]) }
    mine = isMine
    document.title = isMine ? '(' + label + ') ' + baseTitle : baseTitle
  }

  /* Écran allumé pendant une partie (sinon le téléphone se verrouille et la connexion coupe) */
  let lock = null, wantLock = false
  async function wake(on) {
    wantLock = on
    try {
      if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null }) }
      if (!on && lock) { await lock.release(); lock = null }
    } catch { lock = null }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantLock) wake(true) })

  function el(cls, txt, style) { const e = document.createElement('div'); e.className = cls; if (txt != null) e.textContent = txt; if (style) e.style.cssText = style; return e }

  /* Compte à rebours 3-2-1 plein écran au lancement */
  function countdown(word = 'C\'est parti !') {
    if (calm) return
    const o = el('fx-count'), n = el('fx-count__n')
    o.append(n); document.body.append(o)
    const steps = ['3', '2', '1', word]
    steps.forEach((s, i) => setTimeout(() => {
      n.textContent = s; n.classList.toggle('is-go', i === 3)
      n.animate([{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: .3 }, { transform: 'scale(.9)', opacity: i === 3 ? 0 : .9 }], { duration: 700, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' })
      play(i === 3 ? 'go' : 'count')
    }, i * 650))
    setTimeout(() => o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => o.remove(), steps.length * 650)
  }

  /* Gerbe de particules autour d'un point */
  function burst(x, y, color = '#d3fd50', n = 26) {
    if (calm) return
    for (let i = 0; i < n; i++) {
      const s = el('fx-spark', null, `left:${x}px;top:${y}px;background:${color}`)
      document.body.append(s)
      const a = Math.random() * 6.283, d = 40 + Math.random() * 120
      s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2)`, opacity: 0 }],
        { duration: 600 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => s.remove()
    }
  }

  /* Confettis qui tombent du haut de l'écran */
  function confetti(colors = ['#d3fd50', '#f5f5f0', '#ff6b5a', '#5ac8ff', '#b98bff'], n = 90) {
    if (calm) return
    for (let i = 0; i < n; i++) {
      const c = el('fx-confetti', null, `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 10}px`)
      document.body.append(c)
      const drift = (Math.random() - .5) * 240, rot = (Math.random() - .5) * 1440
      c.animate([{ transform: 'translate(0,-20px) rotate(0)', opacity: 1 }, { transform: `translate(${drift}px, 105vh) rotate(${rot}deg)`, opacity: .9 }],
        { duration: 2200 + Math.random() * 1800, delay: Math.random() * 600, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'backwards' }).onfinish = () => c.remove()
    }
  }

  /* Flash plein écran d'une couleur (impact d'un +4, assassin…) */
  function flash(color = '#d3fd50', strength = .35) {
    if (calm) return
    const f = el('fx-flash', null, `background:${color}`)
    document.body.append(f)
    f.animate([{ opacity: strength }, { opacity: 0 }], { duration: 450, easing: 'ease-out' }).onfinish = () => f.remove()
  }

  function shake(node, px = 8) {
    if (calm || !node) return
    node.animate([{ transform: 'none' }, { transform: `translateX(-${px}px)` }, { transform: `translateX(${px}px)` }, { transform: `translateX(-${px / 2}px)` }, { transform: 'none' }], { duration: 380 })
  }

  /* Couleur stable par pseudo (palette lisible sur fond noir) */
  const PAL = ['#d3fd50', '#ff6b5a', '#5ac8ff', '#b98bff', '#ffc857', '#4ce0b3', '#ff8fd1', '#f5f5f0']
  function color(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return PAL[h % PAL.length] }
  /* off = joueur hors ligne : avatar grisé, avec le texte pour les lecteurs d'écran */
  function avatar(name, col, off) {
    const a = el('fx-av' + (off ? ' fx-av--off' : ''), [...String(name)][0]?.toUpperCase() || '?', `--av:${col || color(name)}`)
    if (!off) { a.setAttribute('aria-hidden', 'true'); return a }
    a.title = 'Hors ligne'
    a.append(el('fx-sr', ' (hors ligne)'))
    return a
  }
  /* Réactions masquées sur téléphone dans le salon et à la fin (le bouton y cache des réglages) */
  const quiet = (on) => document.body.classList.toggle('fx-quiet', on)

  /* Réactions : bulle qui monte depuis le bas de l'écran */
  const EMOTES = ['😂', '😱', '🤔', '👏', '😡', '🔥']
  function bubble(emoji, name) {
    const b = el('fx-bubble', null, `left:${10 + Math.random() * 70}vw`)
    const e = el('fx-bubble__e', emoji), n = el('fx-bubble__n mono', name, `color:${color(name)}`)
    b.append(e, n); document.body.append(b)
    play('pop')
    b.animate(calm ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translateY(0) scale(.4)', opacity: 0 }, { transform: 'translateY(-60px) scale(1.15)', opacity: 1, offset: .15 }, { transform: 'translateY(-260px) scale(1)', opacity: 0 }],
      { duration: 2600, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => b.remove()
  }
  /* Barre de réactions (send(i) envoie l'émote i) ; repliée par défaut sur mobile */
  function emoteBar(send) {
    const bar = el('fx-emotes'), toggle = document.createElement('button'), list = el('fx-emotes__list')
    toggle.type = 'button'; toggle.className = 'fx-emotes__t'; toggle.textContent = '☺'; toggle.setAttribute('aria-label', 'Réactions')
    toggle.addEventListener('click', () => bar.classList.toggle('is-open'))
    let last = 0
    EMOTES.forEach((e, i) => {
      const b = document.createElement('button')
      b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', 'Réaction ' + e)
      b.addEventListener('click', () => { if (Date.now() - last < 1000) return; last = Date.now(); send(i) })
      list.append(b)
    })
    bar.append(list, toggle)
    return bar
  }

  return { play, vibrate, muteButton, turn, wake, countdown, burst, confetti, flash, shake, color, avatar, quiet, bubble, emoteBar, EMOTES, calm }
})()
