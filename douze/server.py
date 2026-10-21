#!/usr/bin/env python3
"""douze.yasder5.fr : jeu de cartes à grille (12 cartes en 3 × 4). 150 cartes de -2 à 12, colonnes identiques défaussées,
le moins de points gagne, partie jusqu'à un score cible."""
import random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "common"))
from rooms import GameError, serve  # noqa: E402

DECK = [-2] * 5 + [-1] * 10 + [0] * 15 + [v for v in range(1, 13) for _ in range(10)]
assert len(DECK) == 150
TARGETS = (50, 100, 150)


def slot(b):
    i = b.get("i")
    if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < 12:
        raise GameError("Carte introuvable.")
    return i


class Douze:
    NAME, MIN, MAX = "douze", 2, 8
    DEFAULTS = {"target": 100, "double": True}

    @staticmethod
    def settings(room, s):
        if s.get("target") not in TARGETS or isinstance(s.get("target"), bool):
            raise GameError("Score cible : 50, 100 ou 150.")
        return {"target": s["target"], "double": bool(s.get("double"))}

    @staticmethod
    def start(room):
        target = room.settings["target"]
        if any(q.score >= target for q in room.players.values()):     # la partie précédente est finie : on repart de zéro
            for q in room.players.values():
                q.score = 0
            room.log("Nouvelle partie en %d points." % target)
        deck = list(DECK)
        random.shuffle(deck)
        order = list(room.players)
        random.shuffle(order)
        grids = {pid: [{"v": deck.pop(), "up": False} for _ in range(12)] for pid in order}
        room.g = {"deck": deck, "discard": [deck.pop()], "grids": grids, "order": order, "turn": 0, "setup": True,
                  "held": None, "src": None, "mustflip": False, "closer": None, "final": [], "seq": 0, "evs": [],
                  "pts": None, "doubled": False, "over": False, "winner": None}
        room.log("Manche %d : chacun retourne 2 cartes." % room.round)

    # ── outils ─────────────────────────────────────────────────────────
    @staticmethod
    def event(g, **e):
        g["seq"] += 1
        g["evs"] = (g["evs"] + [{"seq": g["seq"], **e}])[-10:]

    @staticmethod
    def cur(g):
        return None if g["setup"] else g["order"][g["turn"]]

    @staticmethod
    def up_count(grid):
        return sum(1 for s in grid if s and s["up"])

    @staticmethod
    def shown(grid):
        return sum(s["v"] for s in grid if s and s["up"])

    @staticmethod
    def pop(g):
        if not g["deck"]:                                     # pioche vide : on remélange la défausse sous la carte du dessus
            top = g["discard"].pop()
            g["deck"], g["discard"] = g["discard"], [top]
            random.shuffle(g["deck"])
        if not g["deck"]:
            raise GameError("Plus aucune carte à piocher.")
        return g["deck"].pop()

    @staticmethod
    def column(g, pid, i):
        """Trois cartes visibles identiques dans une colonne : la colonne part à la défausse."""
        grid, c = g["grids"][pid], i // 3
        col = grid[c * 3:c * 3 + 3]
        if all(s and s["up"] for s in col) and len({s["v"] for s in col}) == 1:
            v = col[0]["v"]
            for k in range(c * 3, c * 3 + 3):
                grid[k] = None
            g["discard"] += [v] * 3
            Douze.event(g, type="col", pid=pid, c=c, v=v)

    @staticmethod
    def begin(room, g):
        """Tout le monde a retourné 2 cartes : celui qui montre le plus de points commence."""
        g["setup"] = False
        sums = [Douze.shown(g["grids"][pid]) for pid in g["order"]]
        g["turn"] = sums.index(max(sums))
        first = g["order"][g["turn"]]
        room.log("%s commence (%d points visibles)." % (room.players[first].name, max(sums)))
        Douze.event(g, type="begin", pid=first)

    @staticmethod
    def end_turn(room, g, pid):
        g["held"], g["src"], g["mustflip"] = None, None, False
        grid = g["grids"][pid]
        if g["closer"] is None and all(s["up"] for s in grid if s):
            g["closer"] = pid
            g["final"] = [x for x in g["order"] if x != pid]
            room.log("%s a tout retourné : dernier tour !" % room.players[pid].name)
            Douze.event(g, type="closer", pid=pid)
        elif pid in g["final"]:
            g["final"].remove(pid)
        if g["closer"] is not None and not g["final"]:
            return Douze.score(room, g)
        g["turn"] = (g["turn"] + 1) % len(g["order"])

    @staticmethod
    def score(room, g):
        for grid in g["grids"].values():
            for s in grid:
                if s:
                    s["up"] = True
        pts = {pid: sum(s["v"] for s in g["grids"][pid] if s) for pid in g["order"]}
        c = g["closer"]
        if room.settings["double"] and c in pts and pts[c] > 0 and any(pts[o] <= pts[c] for o in pts if o != c):
            pts[c] *= 2                                       # celui qui a fini n'a pas fait strictement le moins : doublé
            g["doubled"] = True
        for pid, n in pts.items():
            room.players[pid].score += n
        g["pts"] = pts
        P, target = room.players, room.settings["target"]
        if any(q.score >= target for q in P.values()):
            g["over"] = True
            best = min(P[pid].score for pid in g["order"])
            win = [P[pid] for pid in g["order"] if P[pid].score == best]
            text = "%s %s la partie avec %d points !" % (" et ".join(q.name for q in win), "gagne" if len(win) == 1 else "gagnent", best)
        else:
            low = min(pts.values())
            win = [P[pid] for pid in g["order"] if pts[pid] == low]
            text = "%s %s la manche avec %d points." % (" et ".join(q.name for q in win), "remporte" if len(win) == 1 else "remportent", low)
        g["winner"] = win[0].id
        room.finish(text, win, 0)

    # ── actions ────────────────────────────────────────────────────────
    @staticmethod
    def act(room, p, action, b):
        g = room.g
        if action == "skip":
            return Douze.skip(room, g, p)
        if p.id not in g["order"]:
            raise GameError("Tu regardes cette manche, tu joueras à la suivante.")
        grid = g["grids"][p.id]
        if g["setup"]:
            if action != "flip":
                raise GameError("Retourne d'abord 2 cartes.")
            i = slot(b)
            if Douze.up_count(grid) >= 2:
                raise GameError("Tu as déjà retourné 2 cartes : attends les autres.")
            if grid[i]["up"]:
                raise GameError("Cette carte est déjà retournée.")
            grid[i]["up"] = True
            Douze.event(g, type="flip", pid=p.id, i=i, v=grid[i]["v"])
            if all(Douze.up_count(g["grids"][pid]) >= 2 for pid in g["order"]):
                Douze.begin(room, g)
            return
        if Douze.cur(g) != p.id:
            raise GameError("Ce n'est pas ton tour.")
        if action == "draw":
            if g["held"] is not None or g["mustflip"]:
                raise GameError("Tu as déjà pris une carte.")
            g["held"], g["src"] = Douze.pop(g), "deck"
            Douze.event(g, type="draw", pid=p.id)
        elif action == "take":
            if g["held"] is not None or g["mustflip"]:
                raise GameError("Tu as déjà pris une carte.")
            g["held"], g["src"] = g["discard"].pop(), "discard"
            Douze.event(g, type="take", pid=p.id)
        elif action == "swap":
            i = slot(b)
            if g["held"] is None:
                raise GameError("Pioche ou prends la défausse d'abord.")
            if grid[i] is None:
                raise GameError("Cette colonne est déjà partie.")
            old = grid[i]
            grid[i] = {"v": g["held"], "up": True}
            g["discard"].append(old["v"])
            Douze.event(g, type="swap", pid=p.id, i=i, v=g["held"], old=old["v"], src=g["src"])
            Douze.column(g, p.id, i)
            Douze.end_turn(room, g, p.id)
        elif action == "discard":
            if g["held"] is None or g["src"] != "deck":
                raise GameError("Seule une carte piochée peut être défaussée." if g["held"] is not None else "Pioche d'abord.")
            g["discard"].append(g["held"])
            Douze.event(g, type="discard", pid=p.id, v=g["held"])
            g["held"], g["src"] = None, None
            if any(s and not s["up"] for s in grid):
                g["mustflip"] = True
            else:
                Douze.end_turn(room, g, p.id)
        elif action == "flip":
            i = slot(b)
            if not g["mustflip"]:
                raise GameError("Pioche ou prends la défausse d'abord.")
            if grid[i] is None or grid[i]["up"]:
                raise GameError("Choisis une carte encore cachée.")
            grid[i]["up"] = True
            Douze.event(g, type="flip", pid=p.id, i=i, v=grid[i]["v"])
            Douze.column(g, p.id, i)
            Douze.end_turn(room, g, p.id)
        else:
            raise GameError("Action inconnue.")

    @staticmethod
    def skip(room, g, p):
        """L'hôte fait jouer un absent : il retourne au hasard (installation), ou pioche, défausse et retourne une carte."""
        room.need_host(p)
        P = room.players
        if g["setup"]:
            late = [pid for pid in g["order"] if Douze.up_count(g["grids"][pid]) < 2 and not P[pid].conns]
            if not late:
                raise GameError("Personne d'absent n'a de carte à retourner.")
            for pid in late:
                hidden = [k for k, s in enumerate(g["grids"][pid]) if not s["up"]]
                for k in random.sample(hidden, 2 - Douze.up_count(g["grids"][pid])):
                    g["grids"][pid][k]["up"] = True
                    Douze.event(g, type="flip", pid=pid, i=k, v=g["grids"][pid][k]["v"])
                room.log("%s est absent : cartes retournées au hasard." % P[pid].name)
            return Douze.begin(room, g)
        cur = Douze.cur(g)
        if P[cur].conns:
            raise GameError("%s est en ligne." % P[cur].name)
        if g["held"] is not None:
            g["discard"].append(g["held"])                    # carte prise remise sur la défausse
            g["held"], g["src"] = None, None
        elif not g["mustflip"]:
            g["discard"].append(Douze.pop(g))
        grid = g["grids"][cur]
        hidden = [k for k, s in enumerate(grid) if s and not s["up"]]
        room.log("%s est passé (absent)." % P[cur].name)
        if hidden:
            k = random.choice(hidden)
            grid[k]["up"] = True
            Douze.event(g, type="flip", pid=cur, i=k, v=grid[k]["v"])
            Douze.column(g, cur, k)
        Douze.end_turn(room, g, cur)

    @staticmethod
    def left(room, p):
        g = room.g
        if p.id not in g["order"]:
            return
        k, cur = g["order"].index(p.id), Douze.cur(g)
        g["order"].pop(k)
        g["grids"].pop(p.id)
        if p.id in g["final"]:
            g["final"].remove(p.id)
        if len(g["order"]) < 2:
            if g["order"]:
                w = room.players[g["order"][0]]
                g["winner"] = w.id
                room.finish("%s gagne : plus d'adversaire." % w.name, [w], 0)
            return
        if g["setup"]:
            if all(Douze.up_count(g["grids"][pid]) >= 2 for pid in g["order"]):
                Douze.begin(room, g)
            return
        if cur == p.id:                                       # c'était son tour : la carte prise revient sur la défausse
            if g["held"] is not None:
                g["discard"].append(g["held"])
            g["held"], g["src"], g["mustflip"] = None, None, False
            g["turn"] = k % len(g["order"])
        else:
            g["turn"] = g["order"].index(cur)
        if g["closer"] is not None and not g["final"]:
            Douze.score(room, g)

    @staticmethod
    def view(room, me):
        g, end = room.g, room.phase == "end"
        grids = {pid: [s and {"up": s["up"], **({"v": s["v"]} if s["up"] or end else {})} for s in grid]
                 for pid, grid in g["grids"].items()}
        return {"order": g["order"], "grids": grids, "setup": g["setup"], "turn": Douze.cur(g),
                "top": g["discard"][-1] if g["discard"] else None, "deck": len(g["deck"]), "held": g["held"], "src": g["src"],
                "mustflip": g["mustflip"], "closer": g["closer"], "final": g["final"], "evs": g["evs"], "pts": g["pts"],
                "doubled": g["doubled"], "over": g["over"], "winner": g["winner"], "seat": me.id in g["order"],
                "target": room.settings["target"]}


def selftest():
    from rooms import Room
    random.seed(5)
    r = Room("TEST", Douze)
    a, b, c = (r.add(n) for n in "ABC")
    for bad in ({"target": 70}, {"target": True}, {"target": "100"}):
        try:
            Douze.settings(r, {**r.settings, **bad}); raise SystemExit("réglage invalide accepté")
        except GameError:
            pass
    r.start(a)
    g, P = r.g, r.players
    total = lambda: len(g["deck"]) + len(g["discard"]) + sum(1 for gr in g["grids"].values() for s in gr if s) + (g["held"] is not None)
    assert total() == 150
    for bad in ({"i": True}, {"i": 12}, {"i": "1"}, {}):
        try:
            Douze.act(r, a, "flip", bad); raise SystemExit("index invalide accepté")
        except GameError:
            pass
    try:
        Douze.act(r, a, "draw", {}); raise SystemExit("pioche pendant l'installation acceptée")
    except GameError:
        pass
    for q in (a, b, c):
        Douze.act(r, q, "flip", {"i": 0})
        Douze.act(r, q, "flip", {"i": 4})
    assert not g["setup"]
    sums = {pid: Douze.shown(g["grids"][pid]) for pid in g["order"]}
    assert sums[Douze.cur(g)] == max(sums.values())
    spect = r.add("Spectateur")
    try:
        Douze.act(r, spect, "draw", {}); raise SystemExit("un spectateur a joué")
    except GameError:
        pass
    r.remove(spect)
    cur = P[Douze.cur(g)]
    other = next(q for q in (a, b, c) if q is not cur)
    try:
        Douze.act(r, other, "draw", {}); raise SystemExit("hors tour accepté")
    except GameError:
        pass
    # prendre la défausse : interdit de la redéfausser, échange obligatoire
    top = g["discard"][-1]
    Douze.act(r, cur, "take", {})
    try:
        Douze.act(r, cur, "discard", {}); raise SystemExit("défausse de la carte prise acceptée")
    except GameError:
        pass
    old = g["grids"][cur.id][1]["v"]
    Douze.act(r, cur, "swap", {"i": 1})
    assert g["grids"][cur.id][1] == {"v": top, "up": True} and g["discard"][-1] == old and Douze.cur(g) != cur.id
    assert total() == 150
    # piocher, défausser, retourner
    cur = P[Douze.cur(g)]
    Douze.act(r, cur, "draw", {})
    Douze.act(r, cur, "discard", {})
    assert g["mustflip"]
    try:
        Douze.act(r, cur, "flip", {"i": 0}); raise SystemExit("carte déjà visible retournée")
    except GameError:
        pass
    Douze.act(r, cur, "flip", {"i": 2})
    assert g["grids"][cur.id][2]["up"] and Douze.cur(g) != cur.id
    # colonne de trois identiques : défaussée
    cur = P[Douze.cur(g)]
    grid = g["grids"][cur.id]
    grid[3], grid[4] = {"v": 7, "up": True}, {"v": 7, "up": True}
    grid[5] = {"v": 1, "up": False}
    g["discard"].append(7)
    Douze.act(r, cur, "take", {})
    Douze.act(r, cur, "swap", {"i": 5})
    assert grid[3] is None and grid[4] is None and grid[5] is None
    assert [e["type"] for e in g["evs"]][-2:] == ["swap", "col"]
    # fin de manche : un joueur retourne tout, les autres jouent un dernier tour, puis décompte (doublé s'il n'a pas le moins)
    cur = P[Douze.cur(g)]
    g["grids"][cur.id] = [{"v": k % 4 + 1, "up": k < 11} for k in range(12)]     # 30 points, aucune colonne identique
    cur.score = 90
    for pid in g["order"]:
        if pid != cur.id:
            g["grids"][pid] = [{"v": 0, "up": False} for _ in range(12)]
    Douze.act(r, cur, "draw", {})
    Douze.act(r, cur, "discard", {})
    Douze.act(r, cur, "flip", {"i": 11})
    assert g["closer"] == cur.id and len(g["final"]) == 2 and r.phase == "play"
    for _ in range(2):
        q = P[Douze.cur(g)]
        Douze.act(r, q, "draw", {})
        Douze.act(r, q, "discard", {})
        Douze.act(r, q, "flip", {"i": 6})
    assert r.phase == "end" and g["doubled"] and g["pts"][cur.id] == 60
    assert P[cur.id].score == 150 and g["over"] and r.result["gagnants"] and cur.id not in r.result["gagnants"]
    # nouvelle manche : la partie était finie, les scores repartent de zéro
    r.start(a)
    g = r.g
    assert all(q.score == 0 for q in P.values())
    # départ pendant l'installation et pendant son tour
    Douze.act(r, a, "flip", {"i": 0}); Douze.act(r, a, "flip", {"i": 1})
    Douze.act(r, b, "flip", {"i": 0}); Douze.act(r, b, "flip", {"i": 1})
    r.remove(c)
    assert not g["setup"] and len(g["order"]) == 2
    cur = P[Douze.cur(g)]
    Douze.act(r, cur, "draw", {})
    held = g["held"]
    r.remove(cur)
    assert r.phase == "end" and g["winner"] != cur.id and held is not None
    # absent : l'hôte le fait jouer
    r = Room("TES2", Douze)
    a, b = r.add("A"), r.add("B")
    a.conns = 1
    r.start(a)
    g = r.g
    Douze.act(r, a, "flip", {"i": 0}); Douze.act(r, a, "flip", {"i": 1})
    Douze.skip(r, g, a)
    assert not g["setup"] and Douze.up_count(g["grids"][b.id]) == 2
    if Douze.cur(g) == a.id:
        Douze.act(r, a, "draw", {}); Douze.act(r, a, "discard", {}); Douze.act(r, a, "flip", {"i": 2})
    before = Douze.up_count(g["grids"][b.id])
    Douze.skip(r, g, a)
    assert Douze.cur(g) == a.id and Douze.up_count(g["grids"][b.id]) >= before
    try:
        Douze.skip(r, g, a); raise SystemExit("passer un joueur en ligne accepté")
    except GameError:
        pass
    v = Douze.view(r, a)
    assert all("v" not in s for s in v["grids"][b.id] if s and not s["up"])     # les cartes cachées ne fuient pas
    print("selftest ok")


if __name__ == "__main__":
    selftest()
    random.seed()
    serve(Douze, ROOT / "public")
