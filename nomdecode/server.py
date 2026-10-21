#!/usr/bin/env python3
"""nomdecode.yasder5.fr : jeu de mots d'équipe (type Codenames). Deux équipes, un maître-espion chacune, grille de 25 mots."""
import random, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "common"))
from rooms import GameError, norm, serve  # noqa: E402

WORDS = sorted({w.strip() for w in (ROOT / "mots.txt").read_text().splitlines() if w.strip() and not w.startswith("#")})
TEAMS = {"a": "Citron", "b": "Corail"}
OTHER = {"a": "b", "b": "a"}


class NomDeCode:
    NAME, MIN, MAX, DEFAULTS = "nomdecode", 4, 16, {"rotate": True}

    @staticmethod
    def settings(room, s):
        return {"rotate": bool(s.get("rotate"))}

    # ── salon : équipes et maîtres-espions ─────────────────────────────
    @staticmethod
    def joined(room, p):
        sizes = {t: sum(q.data.get("team") == t for q in room.players.values()) for t in TEAMS}
        p.data = {"team": min(TEAMS, key=lambda t: (sizes[t], random.random())), "spy": False}

    @staticmethod
    def lobby(room, p, action, b):
        if action == "team":
            t = b.get("team")
            if t not in TEAMS:
                raise GameError("Équipe inconnue.")
            spy = bool(b.get("spy"))
            if spy:
                for q in room.players.values():
                    if q.data.get("team") == t and q.data.get("spy") and q is not p:
                        room.log("%s devient maître-espion %s à la place de %s." % (p.name, TEAMS[t], q.name))
                    if q.data.get("team") == t:
                        q.data["spy"] = False
            p.data = {"team": t, "spy": spy}
        elif action == "shuffle":
            room.need_host(p)
            ps = list(room.players.values())
            random.shuffle(ps)
            for i, q in enumerate(ps):
                q.data = {"team": "ab"[i % 2], "spy": i < 2}
            room.log("Équipes mélangées.")
        else:
            raise GameError("Action inconnue.")

    # ── partie ─────────────────────────────────────────────────────────
    @staticmethod
    def start(room):
        teams = {t: [q for q in room.players.values() if q.data.get("team") == t] for t in TEAMS}
        if any(len(m) < 2 for m in teams.values()):
            raise GameError("Chaque équipe doit avoir au moins 2 joueurs.")
        for t, team in teams.items():
            spy = next((q for q in team if q.data["spy"]), None)
            if spy and room.settings.get("rotate") and room.round > 1:   # chacun son tour derrière la grille
                spy.data["spy"] = False
                team.sort(key=lambda q: q.name.lower())
                spy = team[(team.index(spy) + 1) % len(team)]
                spy.data["spy"] = True
            elif not spy:
                random.choice(team).data["spy"] = True
        for q in room.players.values():
            q.data["round"] = room.round
        first = random.choice("ab")
        colors = [first] * 9 + [OTHER[first]] * 8 + ["n"] * 7 + ["x"]
        random.shuffle(colors)
        room.g = {"words": random.sample(WORDS, 25), "colors": colors, "revealed": [None] * 25, "turn": first,
                  "clue": None, "left": 0, "guessed": 0, "marks": {}, "clues": [], "last": None}
        room.log("Manche %d : l'équipe %s commence (9 mots à trouver)." % (room.round, TEAMS[first]))

    @staticmethod
    def act(room, p, action, b):
        g, team, spy = room.g, p.data.get("team"), p.data.get("spy")
        if action == "respy":                                 # l'hôte remplace un maître-espion absent
            room.need_host(p)
            t = b.get("team")
            members = sorted((q for q in room.players.values() if q.data.get("team") == t), key=lambda q: (-q.conns, q.name.lower()))
            old = next((q for q in members if q.data.get("spy")), None)
            cand = [q for q in members if q is not old]
            if t not in TEAMS or not cand:
                raise GameError("Personne pour le remplacer.")
            new = cand[0]                                     # en ligne d'abord
            if old:
                old.data["spy"] = False
            new.data["spy"] = True
            room.log("%s devient maître-espion de l'équipe %s." % (new.name, TEAMS[t]))
            return
        if action == "skipturn":                              # l'hôte fait passer le tour (équipe absente)
            room.need_host(p)
            room.log("L'hôte fait passer le tour de l'équipe %s." % TEAMS[g["turn"]])
            return NomDeCode.next_turn(g)
        if team != g["turn"]:
            raise GameError("Ce n'est pas le tour de ton équipe.")
        if action == "clue":
            if not spy:
                raise GameError("Seul le maître-espion donne l'indice.")
            if g["clue"]:
                raise GameError("L'indice est déjà donné.")
            word = re.sub(r"\s+", " ", str(b.get("word") or "")).strip()
            n = b.get("n")
            if not 1 <= len(word) <= 24 or " " in word:
                raise GameError("Un seul mot, 24 caractères max.")
            if not isinstance(n, int) or isinstance(n, bool) or not -1 <= n <= 9:
                raise GameError("Nombre invalide.")
            w = norm(word)
            def clash(x):                                    # même mot, ou même début de 4 lettres et plus (piano / pianos)
                x = norm(x)
                return w == x or (min(len(w), len(x)) >= 4 and (w.startswith(x) or x.startswith(w)))
            if not w or any(g["revealed"][i] is None and clash(x) for i, x in enumerate(g["words"])):
                raise GameError("L'indice ne peut pas reprendre un mot de la grille.")
            g["clue"], g["guessed"] = {"word": word, "n": n, "by": p.id}, 0
            g["left"] = 25 if n <= 0 else n + 1                 # 0 ou ∞ : pas de limite, sinon n + 1 essais
            g["clues"].append({"team": team, "word": word, "n": n})
            room.log("%s (%s) : « %s » en %s." % (p.name, TEAMS[team], word, "∞" if n < 0 else n))
            return
        if spy:
            raise GameError("Le maître-espion ne touche pas aux cartes.")
        if not g["clue"]:
            raise GameError("Attends l'indice de ton maître-espion.")
        if action == "mark":
            i = NomDeCode.card(g, b)
            marks = g["marks"].setdefault(str(i), [])
            marks.remove(p.id) if p.id in marks else marks.append(p.id)
        elif action == "reveal":
            NomDeCode.reveal(room, p, NomDeCode.card(g, b))
        elif action == "pass":
            if not g["guessed"]:
                raise GameError("Tentez au moins un mot avant de passer.")
            room.log("%s passe la main." % TEAMS[team])
            NomDeCode.next_turn(g)
        else:
            raise GameError("Action inconnue.")

    @staticmethod
    def card(g, b):
        i = b.get("i")
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < 25 or g["revealed"][i] is not None:
            raise GameError("Carte invalide.")
        return i

    @staticmethod
    def reveal(room, p, i):
        g, team = room.g, p.data["team"]
        c = g["colors"][i]
        g["revealed"][i], g["guessed"], g["last"] = p.id, g["guessed"] + 1, i
        g["marks"].pop(str(i), None)
        names = {"a": "équipe Citron", "b": "équipe Corail", "n": "neutre", "x": "l'assassin"}
        room.log("%s retourne « %s » : %s." % (p.name, g["words"][i], names[c]))
        if c == "x":
            return NomDeCode.win(room, OTHER[team], "%s a trouvé l'assassin : l'équipe %s gagne !" % (p.name, TEAMS[OTHER[team]]))
        for t in TEAMS:
            if all(g["revealed"][k] is not None for k, col in enumerate(g["colors"]) if col == t):
                return NomDeCode.win(room, t, "L'équipe %s a trouvé tous ses agents !" % TEAMS[t])
        g["left"] -= 1
        if c != team or g["left"] <= 0:
            NomDeCode.next_turn(g)

    @staticmethod
    def next_turn(g):
        g["turn"], g["clue"], g["marks"], g["left"], g["guessed"] = OTHER[g["turn"]], None, {}, 0, 0

    @staticmethod
    def win(room, t, text):
        room.g["winner"] = t
        room.finish(text, [q for q in room.players.values() if q.data.get("team") == t and q.data.get("round") == room.round])

    @staticmethod
    def left(room, p):
        g, t = room.g, p.data.get("team")
        rest = [q for q in room.players.values() if q is not p and q.data.get("team") == t]
        if len(rest) < 2:                                     # un seul joueur ne peut pas être espion et agent à la fois
            return NomDeCode.win(room, OTHER[t], "L'équipe %s n'a plus assez de joueurs : l'équipe %s gagne." % (TEAMS[t], TEAMS[OTHER[t]]))
        if p.data.get("spy"):
            nxt = random.choice(rest)
            nxt.data["spy"] = True
            room.log("%s devient maître-espion de l'équipe %s." % (nxt.name, TEAMS[t]))
        for marks in g["marks"].values():
            if p.id in marks:
                marks.remove(p.id)

    @staticmethod
    def view(room, me):
        g = room.g
        see = me.data.get("spy") or room.phase == "end"
        cards = [{"w": w, "c": g["colors"][i] if see or g["revealed"][i] is not None else None,
                  "r": g["revealed"][i] is not None, "m": g["marks"].get(str(i), [])} for i, w in enumerate(g["words"])]
        left = {t: sum(1 for i, c in enumerate(g["colors"]) if c == t and g["revealed"][i] is None) for t in TEAMS}
        return {"cards": cards, "turn": g["turn"], "clue": g["clue"], "left": g["left"] if g["clue"] and g["clue"]["n"] > 0 else None,
                "guessed": g["guessed"], "remaining": left, "clues": g["clues"], "last": g["last"], "winner": g.get("winner")}


def selftest():
    from rooms import Room
    random.seed(1)
    r = Room("TEST", NomDeCode)
    ps = [r.add(n) for n in ("A", "B", "C", "D")]
    try:
        NomDeCode.lobby(r, ps[1], "shuffle", {}); raise SystemExit("mélange par un non-hôte accepté")
    except GameError:
        pass
    NomDeCode.lobby(r, ps[0], "shuffle", {})
    r.start(ps[0])
    g = r.g
    t = g["turn"]
    spy = next(q for q in ps if q.data["team"] == t and q.data["spy"])
    agent = next(q for q in ps if q.data["team"] == t and not q.data["spy"])
    foe = next(q for q in ps if q.data["team"] != t and not q.data["spy"])
    assert r.G.view(r, agent)["cards"][0]["c"] is None and r.G.view(r, spy)["cards"][0]["c"] is not None
    for bad in ({"word": g["words"][0], "n": 1}, {"word": g["words"][0] + "s", "n": 1}, {"word": "deux mots", "n": 1}, {"word": "ok", "n": 12}):
        try:
            NomDeCode.act(r, spy, "clue", bad); raise SystemExit("indice invalide accepté %r" % bad)
        except GameError:
            pass
    for bad in ((foe, "reveal"), (agent, "reveal")):        # mauvaise équipe, puis avant l'indice
        try:
            NomDeCode.act(r, bad[0], bad[1], {"i": 0}); raise SystemExit("action refusée attendue")
        except GameError:
            pass
    NomDeCode.act(r, spy, "clue", {"word": "zzzindice", "n": 2})
    try:
        NomDeCode.act(r, agent, "reveal", {"i": True}); raise SystemExit("carte booléenne acceptée")
    except GameError:
        pass
    mine = [i for i, c in enumerate(g["colors"]) if c == t]
    NomDeCode.act(r, agent, "mark", {"i": mine[0]})
    assert g["marks"][str(mine[0])] == [agent.id]
    NomDeCode.act(r, agent, "reveal", {"i": mine[0]})
    assert g["turn"] == t and g["left"] == 2
    neutral = g["colors"].index("n")
    NomDeCode.act(r, agent, "reveal", {"i": neutral})
    assert g["turn"] != t and g["clue"] is None
    t2 = g["turn"]
    spy2 = next(q for q in ps if q.data["team"] == t2 and q.data["spy"])
    agent2 = next(q for q in ps if q.data["team"] == t2 and not q.data["spy"])
    NomDeCode.act(r, spy2, "clue", {"word": "zzzautre", "n": 0})
    NomDeCode.act(r, agent2, "reveal", {"i": g["colors"].index("x")})
    assert r.phase == "end" and g["winner"] == t and agent.score == 1 and agent2.score == 0
    spies = {q.id for q in ps if q.data["spy"]}
    r.start(ps[0])                                            # rotation des espions à la manche suivante
    assert {q.id for q in ps if q.data["spy"]} != spies and sum(q.data["spy"] for q in ps) == 2
    r.remove(next(q for q in ps if q.data["team"] == r.g["turn"] and not q.data["spy"]))
    assert r.phase == "end"                                   # équipe réduite à un joueur : l'autre gagne
    print("selftest ok")


if __name__ == "__main__":
    assert len(WORDS) >= 300, len(WORDS)
    selftest()
    random.seed()
    serve(NomDeCode, ROOT / "public")
