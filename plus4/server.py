#!/usr/bin/env python3
"""plus4.yasder5.fr : jeu de cartes de défausse (type UNO). 108 cartes, 4 couleurs, +2, +4, inversion, passe, joker."""
import random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "common"))
from rooms import GameError, serve  # noqa: E402

COLORS = "abcd"                      # citron, corail, ciel, violet (couleurs définies côté client)
CARDS = []                           # index = identifiant de carte : (couleur, valeur)
for c in COLORS:
    CARDS.append((c, "0"))
    for v in [str(n) for n in range(1, 10)] + ["skip", "rev", "+2"]:
        CARDS += [(c, v), (c, v)]
CARDS += [("w", "wild")] * 4 + [("w", "+4")] * 4
assert len(CARDS) == 108


def value(i):
    v = CARDS[i][1]
    return int(v) if v.isdigit() else 50 if CARDS[i][0] == "w" else 20


class Plus4:
    NAME, MIN, MAX = "plus4", 2, 10
    DEFAULTS = {"stack": True, "until": False, "hand": 7, "zero": False, "seven": False, "jumpin": False, "challenge": False}
    RULES = ("stack", "until", "zero", "seven", "jumpin", "challenge")

    @staticmethod
    def settings(room, s):
        h = s.get("hand")
        if not isinstance(h, int) or isinstance(h, bool) or not 5 <= h <= 10:
            raise GameError("Main de départ : 5 à 10 cartes.")
        return {"hand": h, **{k: bool(s.get(k)) for k in Plus4.RULES}}

    @staticmethod
    def start(room):
        deck = list(range(108))
        random.shuffle(deck)
        order = list(room.players)
        random.shuffle(order)
        hands = {pid: [deck.pop() for _ in range(room.settings["hand"])] for pid in order}
        while CARDS[deck[-1]][1] not in "0123456789":   # première carte : un chiffre
            deck.insert(0, deck.pop())
        top = deck.pop()
        room.g = {"deck": deck, "discard": [top], "hands": hands, "order": order, "turn": 0, "dir": 1,
                  "color": CARDS[top][0], "pending": 0, "drawn": None, "called": [], "exposed": None,
                  "seq": 0, "evs": [], "winner": None, "challenge": None, "stack": room.settings["stack"]}
        room.log("Manche %d : %d joueurs, %s commence." % (room.round, len(order), room.players[order[0]].name))

    # ── outils ─────────────────────────────────────────────────────────
    @staticmethod
    def cur(g):
        return g["order"][g["turn"]]

    @staticmethod
    def advance(g, steps=1):
        g["turn"] = (g["turn"] + g["dir"] * steps) % len(g["order"])
        g["drawn"] = None

    @staticmethod
    def draw(g, pid, n):
        got = []
        for _ in range(n):
            if not g["deck"]:
                top = g["discard"].pop()
                g["deck"] = g["discard"]
                random.shuffle(g["deck"])
                g["discard"] = [top]
            if not g["deck"]:
                break                                         # toutes les cartes sont en main
            got.append(g["deck"].pop())
        g["hands"][pid] += got
        if len(g["hands"][pid]) > 1 and pid in g["called"]:
            g["called"].remove(pid)
        return got

    @staticmethod
    def playable(g, i):
        c, v = CARDS[i]
        tc, tv = CARDS[g["discard"][-1]]
        if g["pending"]:                                       # cumul en cours : seulement +2 sur +2, ou +4 (si le cumul est permis)
            return g["stack"] and (v == "+4" or (v == "+2" and tv == "+2"))
        return c == "w" or c == g["color"] or v == tv

    @staticmethod
    def event(g, **e):
        """Événements récents numérotés : le client les anime tous, même s'ils arrivent dans la même mise à jour."""
        g["seq"] += 1
        g["evs"] = (g["evs"] + [{"seq": g["seq"], **e}])[-8:]

    # ── actions ────────────────────────────────────────────────────────
    @staticmethod
    def act(room, p, action, b):
        g = room.g
        if action in ("une", "catch") and p.id not in g["order"]:
            raise GameError("Tu regardes cette manche, tu joueras à la suivante.")
        if action == "une":
            if len(g["hands"].get(p.id, [])) != 1:
                raise GameError("« Une ! » se dit quand il ne te reste qu'une carte.")
            if p.id not in g["called"]:
                g["called"].append(p.id)
                room.log("%s : « Une ! »" % p.name)
                Plus4.event(g, type="une", pid=p.id)
            if g["exposed"] == p.id:
                g["exposed"] = None
            return
        if action == "catch":
            t = b.get("target")
            if t != g["exposed"] or t == p.id:
                raise GameError("Trop tard !")
            g["exposed"] = None
            Plus4.draw(g, t, 2)
            room.log("%s coince %s : 2 cartes !" % (p.name, room.players[t].name))
            Plus4.event(g, type="draw", pid=t, n=2, by=p.id)
            return
        if action == "skip":
            room.need_host(p)
            cur = Plus4.cur(g)
            room.log("%s est passé (absent)." % room.players[cur].name)
            if g["drawn"] is not None:                         # il avait déjà pioché : on passe juste son tour
                Plus4.advance(g)
                return Plus4.event(g, type="pass", pid=cur)
            Plus4.take(room, g, cur, auto=True)
            return
        if action == "play" and Plus4.cur(g) != p.id and room.settings["jumpin"] and p.id in g["order"]:
            i = b.get("card")
            if (isinstance(i, int) and not isinstance(i, bool) and i in g["hands"][p.id] and CARDS[i] == CARDS[g["discard"][-1]]
                    and CARDS[i][0] != "w" and not g["pending"] and not g["challenge"]):
                if CARDS[i][1] == "7" and room.settings["seven"] and len(g["hands"][p.id]) > 1 and len(g["order"]) > 2 \
                        and b.get("target") not in [x for x in g["order"] if x != p.id]:
                    raise GameError("Choisis avec qui échanger ta main.")   # vérifié avant de prendre la main
                g["turn"], g["drawn"] = g["order"].index(p.id), None   # carte identique posée hors tour : la main passe à lui
                room.log("%s intercepte !" % p.name)
                Plus4.event(g, type="jump", pid=p.id)
        if Plus4.cur(g) != p.id:
            raise GameError("Ce n'est pas ton tour.")
        if action == "challenge":
            ch = g["challenge"]
            if not ch:
                raise GameError("Rien à contester.")
            g["challenge"], n, by = None, g["pending"], room.players.get(ch["by"])
            g["pending"] = 0
            if ch["guilty"]:                                    # il avait la couleur : c'est lui qui pioche
                Plus4.draw(g, ch["by"], 4)
                room.log("%s conteste : %s avait la couleur et pioche 4 !" % (p.name, by.name if by else "?"))
                Plus4.event(g, type="draw", pid=ch["by"], n=4, challenge=True)
            else:                                               # +4 légal : le contestataire prend 6 et passe
                Plus4.draw(g, p.id, n + 2)
                room.log("%s conteste à tort : %d cartes !" % (p.name, n + 2))
                Plus4.event(g, type="draw", pid=p.id, n=n + 2, challenge=True)
                Plus4.advance(g)
            return
        if g["exposed"] and g["exposed"] != p.id:
            g["exposed"] = None                              # le joueur suivant a joué : plus possible de coincer
        if action == "play":
            Plus4.play(room, g, p, b)
        elif action == "draw":
            if g["drawn"] is not None:
                raise GameError("Tu as déjà pioché : joue la carte ou passe.")
            Plus4.take(room, g, p.id)
        elif action == "pass":
            if g["drawn"] is None:
                raise GameError("Pioche d'abord.")
            room.log("%s passe." % p.name)
            Plus4.advance(g)
            Plus4.event(g, type="pass", pid=p.id)
        else:
            raise GameError("Action inconnue.")

    @staticmethod
    def take(room, g, pid, auto=False):
        """Pioche du joueur courant : la pénalité en attente, sinon une carte (ou jusqu'à une jouable)."""
        name = room.players[pid].name
        if g["pending"]:
            n, g["pending"], g["challenge"] = g["pending"], 0, None
            Plus4.draw(g, pid, n)
            room.log("%s pioche %d cartes." % (name, n))
            Plus4.event(g, type="draw", pid=pid, n=n)
            return Plus4.advance(g)
        got = []
        while True:
            new = Plus4.draw(g, pid, 1)
            got += new
            if not new or Plus4.playable(g, new[0]) or not room.settings["until"] or auto:
                break
        Plus4.event(g, type="draw", pid=pid, n=len(got))
        if got and Plus4.playable(g, got[-1]) and not auto:
            g["drawn"] = got[-1]                              # il peut jouer cette carte ou passer
        else:
            room.log("%s pioche et passe." % name)
            Plus4.advance(g)

    @staticmethod
    def play(room, g, p, b):
        i, hand = b.get("card"), g["hands"][p.id]
        if not isinstance(i, int) or isinstance(i, bool) or i not in hand:
            raise GameError("Carte introuvable.")
        if g["drawn"] is not None and i != g["drawn"]:
            raise GameError("Après la pioche, tu ne peux jouer que la carte piochée.")
        if not Plus4.playable(g, i):
            raise GameError("Cette carte ne peut pas être posée.")
        c, v = CARDS[i]
        if c == "w":
            if b.get("color") not in COLORS:
                raise GameError("Choisis une couleur.")
            c = b["color"]
        swap = None
        if v == "7" and room.settings["seven"] and len(hand) > 1:
            others = [x for x in g["order"] if x != p.id]
            swap = b.get("target") if len(others) > 1 else others[0]
            if swap not in others:
                raise GameError("Choisis avec qui échanger ta main.")
        guilty = any(CARDS[k][0] == g["color"] for k in hand if k != i)    # pour le défi du +4
        hand.remove(i)
        g["discard"].append(i)
        g["color"] = c
        if len(hand) == 1 and p.id not in g["called"]:
            g["exposed"] = p.id                               # oublié de dire « Une ! » : les autres peuvent le coincer
        if len(hand) != 1 and p.id in g["called"]:
            g["called"].remove(p.id)
        Plus4.event(g, type="play", pid=p.id, card=i)
        if not hand:
            pts = sum(value(k) for pid, h in g["hands"].items() for k in h)
            g["winner"] = p.id
            return room.finish("%s a posé sa dernière carte ! (+%d points)" % (p.name, pts), [p], {p.id: pts})
        n = len(g["order"])
        if swap:                                               # règle du 7 : échange de mains
            g["hands"][p.id], g["hands"][swap] = g["hands"][swap], g["hands"][p.id]
            room.log("%s échange sa main avec %s." % (p.name, room.players[swap].name))
            Plus4.event(g, type="swap", pid=p.id, target=swap)
            Plus4.reset_calls(g)
        if v == "0" and room.settings["zero"]:                 # règle du 0 : toutes les mains tournent
            o = g["order"]
            g["hands"] = {o[(k + g["dir"]) % n]: g["hands"][pid] for k, pid in enumerate(o)}
            room.log("Les mains tournent !")
            Plus4.event(g, type="rotate", dir=g["dir"])
            Plus4.reset_calls(g)
        if v == "rev":
            g["dir"] *= -1
            Plus4.advance(g, 2 if n == 2 else 1)              # à deux, l'inversion fait passer le tour
        elif v == "skip":
            Plus4.advance(g, 2)
        elif v in ("+2", "+4"):
            g["pending"] += int(v[1])
            Plus4.advance(g)
            if v == "+4" and room.settings["challenge"] and not room.settings["stack"]:
                g["challenge"] = {"by": p.id, "guilty": guilty}   # le suivant peut accepter ou contester
            elif not room.settings["stack"]:                  # sans cumul : le suivant pioche et passe tout de suite
                Plus4.take(room, g, Plus4.cur(g))
        else:
            Plus4.advance(g)

    @staticmethod
    def reset_calls(g):
        """Après un échange de mains, personne n'est puni : chacun redira « Une ! » si besoin."""
        g["called"] = [x for x in g["called"] if len(g["hands"].get(x, [])) == 1]
        g["exposed"] = None

    @staticmethod
    def left(room, p):
        g = room.g
        if p.id not in g["order"]:
            return
        if g["challenge"] and p.id in (g["challenge"]["by"], Plus4.cur(g)):
            g["challenge"] = None
        k, cur = g["order"].index(p.id), Plus4.cur(g)
        g["deck"][0:0] = g["hands"].pop(p.id)
        g["order"].pop(k)
        if g["exposed"] == p.id:
            g["exposed"] = None
        if len(g["order"]) < 2:
            if g["order"]:
                w = room.players[g["order"][0]]
                g["winner"] = w.id
                room.finish("%s gagne : plus d'adversaire." % w.name, [w], 0)
            return
        if cur == p.id:                                       # c'était son tour : au suivant dans le sens du jeu
            g["turn"], g["drawn"] = (k if g["dir"] > 0 else k - 1) % len(g["order"]), None
        else:
            g["turn"] = g["order"].index(cur)

    @staticmethod
    def view(room, me):
        g, end = room.g, room.phase == "end"
        hand = g["hands"].get(me.id, [])
        mine = Plus4.cur(g) == me.id and not end
        seats = [{"id": pid, "n": len(g["hands"][pid]), "called": pid in g["called"],
                  **({"cards": g["hands"][pid]} if end else {})} for pid in g["order"]]
        return {"cards": CARDS, "hand": hand, "seats": seats, "turn": Plus4.cur(g), "dir": g["dir"],
                "top": g["discard"][-1], "under": g["discard"][-4:-1], "color": g["color"], "pending": g["pending"],
                "deck": len(g["deck"]), "drawn": g["drawn"], "exposed": g["exposed"], "evs": g["evs"], "winner": g["winner"],
                "seat": me.id in g["order"], "values": {i: value(i) for k in (g["hands"].values() if end else []) for i in k},
                "challenge": bool(g["challenge"]) and mine,
                "playable": [i for i in hand if (mine and (g["drawn"] is None or i == g["drawn"]) and Plus4.playable(g, i))
                             or (not mine and not end and room.settings["jumpin"] and not g["pending"] and not g["challenge"]
                                 and CARDS[i] == CARDS[g["discard"][-1]] and CARDS[i][0] != "w")]}


def selftest():
    from rooms import Room
    random.seed(3)
    r = Room("TEST", Plus4)
    a, b, c = (r.add(n) for n in "ABC")
    for bad in ({"hand": 3}, {"hand": "7"}):
        try:
            Plus4.settings(r, {**r.settings, **bad}); raise SystemExit("réglage invalide accepté")
        except GameError:
            pass
    r.settings = Plus4.settings(r, {"stack": True, "until": False, "hand": 7})
    r.start(a)
    g = r.g
    assert sum(len(h) for h in g["hands"].values()) + len(g["deck"]) + len(g["discard"]) == 108
    P = r.players
    first = P[Plus4.cur(g)]
    other = next(q for q in (a, b, c) if q is not first)
    try:
        Plus4.act(r, other, "draw", {}); raise SystemExit("hors tour accepté")
    except GameError:
        pass
    # cumul : on force un +2 en main du joueur courant, le suivant doit piocher 2 (ou cumuler)
    plus2 = next(i for i, (col, v) in enumerate(CARDS) if v == "+2" and col == g["color"])
    for h in g["hands"].values():
        if plus2 in h:
            h.remove(plus2)
    if plus2 in g["deck"]:
        g["deck"].remove(plus2)
    g["hands"][first.id].append(plus2)
    Plus4.act(r, first, "play", {"card": plus2})
    nxt = P[Plus4.cur(g)]
    before = len(g["hands"][nxt.id])
    assert g["pending"] == 2
    Plus4.act(r, nxt, "draw", {})
    assert len(g["hands"][nxt.id]) == before + 2 and g["pending"] == 0 and Plus4.cur(g) != nxt.id
    # « Une ! » oublié : coincé par un autre
    cur = P[Plus4.cur(g)]
    g["hands"][cur.id] = g["hands"][cur.id][:2]
    playable = next((i for i in g["hands"][cur.id] if Plus4.playable(g, i)), None)
    if playable is None:
        playable = next(i for i, (col, v) in enumerate(CARDS) if col == g["color"] and v.isdigit() and i in g["deck"])
        g["deck"].remove(playable)
        g["hands"][cur.id][0] = playable
    Plus4.act(r, cur, "play", {"card": playable, "color": "a"})
    assert g["exposed"] == cur.id
    catcher = next(q for q in (a, b, c) if q is not cur)
    Plus4.act(r, catcher, "catch", {"target": cur.id})
    assert len(g["hands"][cur.id]) == 3 and g["exposed"] is None
    spect = r.add("Spectateur")
    try:
        Plus4.act(r, spect, "une", {}); raise SystemExit("un spectateur a dit Une !")
    except GameError:
        pass
    r.remove(spect)
    assert [e["type"] for e in g["evs"]][-2:] == ["play", "draw"]
    # victoire et points
    w = P[Plus4.cur(g)]
    last = next(i for i, (col, v) in enumerate(CARDS) if col == "w" and v == "wild")
    for h in g["hands"].values():
        if last in h:
            h.remove(last)
    if last in g["deck"]:
        g["deck"].remove(last)
    if last in g["discard"]:
        g["discard"].remove(last)
    g["hands"][w.id] = [last]
    Plus4.act(r, w, "play", {"card": last, "color": "b"})
    assert r.phase == "end" and w.score > 0
    # départ en cours de partie
    r.phase = "lobby"
    r.start(a)
    r.remove(P[r.g["order"][0]])
    assert len(r.g["order"]) == 2 and 0 <= r.g["turn"] < 2
    # ── règles en option ──
    def give(pid, col, val):
        k = next(i for i, cv in enumerate(CARDS) if cv == (col, val) and i not in g["hands"][pid] and i != g["discard"][-1])
        for h in g["hands"].values():
            if k in h:
                h.remove(k)
        for pile in (g["deck"], g["discard"][:-1]):
            if k in pile:
                pile.remove(k)
        if k in g["discard"]:
            g["discard"].remove(k)
        g["hands"][pid].append(k)
        return k
    r.phase = "end"
    r.settings = Plus4.settings(r, {"hand": 7, "stack": False, "until": False, "zero": True, "seven": True, "jumpin": True, "challenge": True})
    r.add("Dan")
    r.start(r.players[r.host])
    g, P = r.g, r.players
    cur = P[Plus4.cur(g)]
    try:
        Plus4.act(r, cur, "une", {}); raise SystemExit("« Une ! » à 7 cartes accepté")
    except GameError:
        pass
    # 7 : échange avec un joueur choisi
    seven = give(cur.id, g["color"], "7")
    other = next(x for x in g["order"] if x != cur.id)
    mine_before, theirs_before = set(g["hands"][cur.id]) - {seven}, set(g["hands"][other])
    try:
        Plus4.act(r, cur, "play", {"card": seven}); raise SystemExit("7 sans cible accepté")
    except GameError:
        pass
    Plus4.act(r, cur, "play", {"card": seven, "target": other})
    assert set(g["hands"][cur.id]) == theirs_before and set(g["hands"][other]) == mine_before
    # 0 : les mains tournent dans le sens du jeu
    cur = P[Plus4.cur(g)]
    zero = give(cur.id, g["color"], "0")
    before = {pid: set(h) for pid, h in g["hands"].items()}
    before[cur.id].discard(zero)
    o, d = list(g["order"]), g["dir"]
    Plus4.act(r, cur, "play", {"card": zero})
    assert all(set(g["hands"][o[(k + d) % len(o)]]) == before[pid] for k, pid in enumerate(o))
    # interception : carte identique hors tour
    first = next(i for i, cv in enumerate(CARDS) if cv == (g["color"], "5"))   # un 5 sur la défausse (il en existe deux)
    for h in g["hands"].values():
        if first in h:
            h.remove(first)
    if first in g["deck"]:
        g["deck"].remove(first)
    if first in g["discard"]:
        g["discard"].remove(first)
    g["discard"].append(first)
    outsider = next(x for x in g["order"] if x != Plus4.cur(g))
    twin = give(outsider, g["color"], "5")
    Plus4.act(r, P[outsider], "play", {"card": twin})
    assert g["discard"][-1] == twin and Plus4.cur(g) != outsider
    try:
        Plus4.act(r, P[Plus4.cur(g)], "play", {"card": True}); raise SystemExit("carte booléenne acceptée")
    except GameError:
        pass
    # défi du +4 : coupable (il avait la couleur), puis innocent
    for guilty in (True, False):
        cur = P[Plus4.cur(g)]
        g["hands"][cur.id] = [k for k in g["hands"][cur.id] if CARDS[k][0] != g["color"]]
        if guilty:
            give(cur.id, g["color"], "5")
        else:
            give(cur.id, next(c for c in COLORS if c != g["color"]), "5")
        plus4 = give(cur.id, "w", "+4")
        Plus4.act(r, cur, "play", {"card": plus4, "color": "b"})
        victim = P[Plus4.cur(g)]
        nv, nc = len(g["hands"][victim.id]), len(g["hands"][cur.id])
        assert g["challenge"] and g["pending"] == 4
        assert not any(Plus4.playable(g, k) for k in g["hands"][P[Plus4.cur(g)].id])    # sans cumul : rien ne se pose sur le +4
        Plus4.act(r, victim, "challenge", {})
        if guilty:
            assert len(g["hands"][cur.id]) == nc + 4 and Plus4.cur(g) == victim.id and len(g["hands"][victim.id]) == nv
            Plus4.act(r, victim, "draw", {})
            if g["drawn"] is not None:
                Plus4.act(r, victim, "pass", {})
        else:
            assert len(g["hands"][victim.id]) == nv + 6 and Plus4.cur(g) != victim.id
    print("selftest ok")


if __name__ == "__main__":
    selftest()
    random.seed()
    serve(Plus4, ROOT / "public")
