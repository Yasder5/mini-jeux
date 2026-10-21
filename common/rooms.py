"""
Socle commun des jeux multijoueurs yasder5 (nomdecode, plus4) : parties avec code, joueurs sans compte
(pseudo + jeton), hôte, salon, temps réel par SSE, nettoyage des parties abandonnées. Stdlib uniquement.

Un jeu fournit une classe avec :
  NAME, MIN, MAX, DEFAULTS (réglages), settings(room, dict) -> dict validé,
  start(room) (prépare room.g), act(room, player, action, body), view(room, player) -> dict,
  left(room, player) (un joueur part en cours de partie), lobby(room, player, action, body) (actions de salon, optionnel).
Le jeu termine une manche avec room.finish(texte, gagnants).
"""
import hmac, json, os, re, secrets, threading, time, unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"          # sans I ni O
MAX_ROOMS = 300
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
         ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml"}
CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
COMMON = Path(__file__).resolve().parent / "public"


class GameError(Exception):
    pass


def norm(w):
    """Comparaison souple de mots (casse, accents, ligatures œ/æ, espaces, tirets)."""
    w = str(w).lower().replace("œ", "oe").replace("æ", "ae")
    w = unicodedata.normalize("NFD", w)
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


def name_key(n):
    """Clé d'unicité d'un pseudo : souple, sans être vide pour un pseudo en emoji."""
    return norm(n) or str(n).strip().lower()


def clean_name(v):
    v = re.sub(r"\s+", " ", str(v or "")).strip()
    if not 1 <= len(v) <= 16 or not v.isprintable():
        raise GameError("Pseudo de 1 à 16 caractères.")
    return v


class Player:
    def __init__(self, name):
        self.id, self.token, self.name = secrets.token_hex(4), secrets.token_urlsafe(18), name
        self.score, self.conns, self.data = 0, 0, {}     # data : champs propres au jeu (équipe, rôle…)
        self.off = time.time()                           # hors ligne depuis (transfert d'hôte)


class Room:
    def __init__(self, code, game):
        self.code, self.G, self.players, self.host = code, game, {}, None
        self.settings = dict(game.DEFAULTS)
        self.phase, self.round, self.g, self.result, self.events = "lobby", 0, None, None, []
        self.pings, self.ping_seq = [], 0                # réactions emoji éphémères
        self.locked = False                              # l'hôte peut fermer la partie aux nouveaux
        self.public = False                              # visible dans la liste de l'accueil (choix de l'hôte)
        self.cond, self.version, self.touched = threading.Condition(), 0, time.time()

    def log(self, text):
        self.events = (self.events + [text])[-10:]

    def bump(self):
        self.version += 1
        self.touched = time.time()
        self.cond.notify_all()

    def need_host(self, p):
        if p.id != self.host:
            raise GameError("Réservé à l'hôte de la partie.")

    def add(self, name):
        same = next((q for q in self.players.values() if name_key(q.name) == name_key(name)), None)
        if same and same.conns == 0:                      # même pseudo hors ligne : il reprend sa place (nouveau téléphone…)
            same.token = secrets.token_urlsafe(18)
            self.log("%s est de retour." % same.name)
            return same
        if same:
            raise GameError("Ce pseudo est déjà pris dans cette partie.")
        if self.locked:
            raise GameError("L'hôte a verrouillé cette partie.")
        if len(self.players) >= self.G.MAX:
            raise GameError("Partie pleine (%d joueurs max)." % self.G.MAX)
        p = Player(name)
        self.players[p.id] = p
        self.host = self.host or p.id
        self.log("%s a rejoint la partie." % name)
        if hasattr(self.G, "joined"):
            self.G.joined(self, p)
        return p

    def remove(self, p, kicked=False):
        if self.phase == "play":
            self.G.left(self, p)
        self.players.pop(p.id, None)
        self.log("%s %s." % (p.name, "a été exclu" if kicked else "a quitté la partie"))
        if self.host == p.id:
            nxt = sorted(self.players.values(), key=lambda q: -q.conns)
            self.host = nxt[0].id if nxt else None
            if nxt:
                self.log("%s devient l'hôte." % nxt[0].name)

    def start(self, p):
        self.need_host(p)
        if self.phase == "play":
            raise GameError("Une partie est déjà en cours.")
        if len(self.players) < self.G.MIN:
            raise GameError("Il faut au moins %d joueurs." % self.G.MIN)
        self.round += 1
        try:
            self.G.start(self)
        except GameError:
            self.round -= 1
            raise
        self.result = None
        self.phase = "play"

    def finish(self, text, winners, points=1):
        self.phase = "end"
        for q in winners:
            q.score += points if isinstance(points, int) else points.get(q.id, 0)
        self.result = {"text": text, "gagnants": [q.id for q in winners]}
        self.log(text)

    def view(self, me):
        players = [{"id": q.id, "name": q.name, "score": q.score, "online": q.conns > 0, "host": q.id == self.host,
                **{k: v for k, v in q.data.items() if not k.startswith("_")}}
                   for q in self.players.values()]
        v = {"code": self.code, "phase": self.phase, "round": self.round, "settings": self.settings, "players": players,
             "events": self.events, "result": self.result, "me": {"id": me.id, "host": me.id == self.host},
             "pings": [x for x in self.pings if time.time() - x["t"] < 8], "locked": self.locked, "public": self.public}
        if self.g is not None:
            v["game"] = self.G.view(self, me)
        return v


EMOTES = 6


def common_act(r, p, action, b):
    if action == "emote":
        e, now = b.get("e"), time.time()
        if not isinstance(e, int) or isinstance(e, bool) or not 0 <= e < EMOTES:
            raise GameError("Réaction inconnue.")
        if now - p.data.get("_emote", 0) < 1:
            raise GameError("Doucement !")
        p.data["_emote"] = now
        r.ping_seq += 1
        r.pings = [x for x in r.pings if now - x["t"] < 8][-9:] + [{"seq": r.ping_seq, "pid": p.id, "e": e, "t": now}]
    elif action == "lock":
        r.need_host(p)
        r.locked = not r.locked
        r.log("Partie %s par l'hôte." % ("verrouillée" if r.locked else "rouverte"))
    elif action == "public":
        r.need_host(p)
        r.public = not r.public
        r.log("Partie %s par l'hôte." % ("rendue publique" if r.public else "repassée en privé"))
    elif action == "settings":
        r.need_host(p)
        if r.phase == "play":
            raise GameError("Réglages modifiables entre deux parties seulement.")
        r.settings = r.G.settings(r, {**r.settings, **(b.get("settings") or {})})
    elif action == "start":
        r.start(p)
    elif action == "lobby":
        r.need_host(p)
        if r.phase == "play":
            raise GameError("Termine d'abord la partie.")
        r.phase, r.g, r.result = "lobby", None, None
    elif action == "stop":
        r.need_host(p)
        if r.phase != "play":
            raise GameError("Aucune partie en cours.")
        r.finish("L'hôte a arrêté la manche.", [], 0)
    elif action == "kick":
        r.need_host(p)
        t = r.players.get(b.get("target"))
        if not t or t is p:
            raise GameError("Joueur introuvable.")
        r.remove(t, kicked=True)
    elif action == "leave":
        r.remove(p)
    elif r.phase == "play":
        r.G.act(r, p, action, b)
    elif hasattr(r.G, "lobby"):
        r.G.lobby(r, p, action, b)
    else:
        raise GameError("Action inconnue.")


def public_list(rooms, cap):
    """Parties publiques qu'on peut rejoindre : ouvertes, pas pleines, avec quelqu'un en ligne. Les plus récentes d'abord."""
    ok = [r for r in rooms if r.public and not r.locked and len(r.players) < cap and any(q.conns for q in r.players.values())]
    ok.sort(key=lambda r: -r.touched)
    return [{"code": r.code, "host": r.players[r.host].name if r.host in r.players else "?", "n": len(r.players),
             "max": cap, "play": r.phase == "play"} for r in ok[:20]]


def serve(game, public, port=None):
    rooms, rooms_lock, creates, misses = {}, threading.Lock(), {}, {}

    def find(code, token):
        r = rooms.get(str(code or "").strip().upper())
        if not r:
            raise GameError("Partie introuvable : vérifie le code.")
        for p in r.players.values():
            if hmac.compare_digest(p.token, str(token or "")):
                return r, p
        raise GameError("Tu ne fais plus partie de cette partie.")

    def reaper():
        """Toutes les 15 s : l'hôte hors ligne depuis 45 s passe la main, les parties abandonnées sont supprimées."""
        while True:
            time.sleep(15)
            now = time.time()
            with rooms_lock:
                for code, r in list(rooms.items()):
                    if (not any(p.conns for p in r.players.values()) and now - r.touched > 1200) or now - r.touched > 21600:
                        del rooms[code]
                        continue
                    with r.cond:
                        h = r.players.get(r.host)
                        nxt = next((q for q in r.players.values() if q.conns), None)
                        if h and not h.conns and now - h.off > 45 and nxt:
                            r.host = nxt.id
                            r.log("%s était hors ligne : %s devient l'hôte." % (h.name, nxt.name))
                            r.bump()

    class Handler(BaseHTTPRequestHandler):
        server_version, sys_version, protocol_version = "y5", "", "HTTP/1.1"

        def log_message(self, *a):
            pass

        def head(self, code, ctype, length=None, extra=()):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            if length is not None:
                self.send_header("Content-Length", str(length))
            for k, v in (("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"),
                         ("X-Robots-Tag", "noindex, nofollow"), ("Content-Security-Policy", CSP), *extra):
                self.send_header(k, v)
            self.end_headers()

        def send(self, code, body, ctype="application/json; charset=utf-8", cache="no-store"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
            self.head(code, ctype, len(body), [("Cache-Control", cache)])
            self.wfile.write(body)

        def body(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = -1
            if not 0 <= n <= 4000:
                self.close_connection = True
                raise GameError("Requête invalide.")
            try:
                b = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                raise GameError("Requête invalide.")
            if not isinstance(b, dict):
                raise GameError("Requête invalide.")
            return b

        def do_HEAD(self):
            if self.path.startswith("/api/"):
                return self.head(405, "text/plain; charset=utf-8", 0)
            self.do_GET()

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/api/events":
                return self.events(parse_qs(u.query))
            if u.path == "/api/public":
                with rooms_lock:
                    return self.send(200, {"rooms": public_list(rooms.values(), game.MAX)})
            base, rel = (COMMON, u.path[8:]) if u.path.startswith("/common/") else (public, "index.html" if u.path == "/" else u.path.lstrip("/"))
            f = (base / rel).resolve()
            if base not in f.parents or not f.is_file():
                return self.send(404, b"Page introuvable", "text/plain; charset=utf-8")
            self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"),
                      "public, max-age=604800" if f.suffix == ".woff2" else "no-cache")

        def events(self, q):
            try:
                with rooms_lock:
                    r, p = find(q.get("code", [""])[0], q.get("token", [""])[0])
            except GameError as e:
                return self.send(404, {"error": str(e)})
            self.head(200, "text/event-stream; charset=utf-8", extra=[("Cache-Control", "no-store"), ("X-Accel-Buffering", "no")])
            self.close_connection = True
            with r.cond:
                p.conns += 1
                r.bump()
            seen = -1
            try:
                while True:
                    with r.cond:
                        if r.version == seen:
                            r.cond.wait(20)
                        if p.id not in r.players or rooms.get(r.code) is not r:
                            data = b"event: gone\ndata: {}\n\n"
                        elif r.version != seen:
                            seen = r.version
                            data = b"data: " + json.dumps(r.view(p), ensure_ascii=False).encode() + b"\n\n"
                        else:
                            data = b": ping\n\n"
                    self.wfile.write(data)
                    self.wfile.flush()
                    if data.startswith(b"event: gone"):
                        break
            except OSError:
                pass
            finally:
                with r.cond:
                    p.conns = max(0, p.conns - 1)
                    if not p.conns:
                        p.off = time.time()
                    r.bump()

        def do_POST(self):
            path = urlparse(self.path).path
            try:
                b = self.body()
                if path in ("/api/create", "/api/join"):
                    name = clean_name(b.get("name"))
                    with rooms_lock:
                        if path == "/api/create":
                            ip, now = self.headers.get("X-Real-IP") or self.client_address[0], time.time()
                            hits = [t for t in creates.get(ip, []) if now - t < 600]
                            if len(hits) >= 15:
                                raise GameError("Trop de parties créées, réessaie dans quelques minutes.")
                            creates[ip] = hits + [now]
                            if len(rooms) >= MAX_ROOMS:
                                raise GameError("Serveur plein, réessaie plus tard.")
                            code = next(c for c in ("".join(secrets.choice(CODE_CHARS) for _ in range(4)) for _ in range(500)) if c not in rooms)
                            r = rooms[code] = Room(code, game)
                        else:
                            # limite des essais de code ratés : on ne devine pas les parties des autres
                            ip, now = self.headers.get("X-Real-IP") or self.client_address[0], time.time()
                            fails = [t for t in misses.get(ip, []) if now - t < 600]
                            if len(fails) >= 20:
                                raise GameError("Trop de codes essayés, réessaie dans quelques minutes.")
                            r = rooms.get(str(b.get("code") or "").strip().upper())
                            if not r:
                                misses[ip] = fails + [now]
                    if not r:
                        raise GameError("Partie introuvable : vérifie le code.")
                    with r.cond:
                        p = r.add(name)
                        r.bump()
                    return self.send(200, {"code": r.code, "token": p.token})
                if path == "/api/act":
                    with rooms_lock:
                        r, p = find(b.get("code"), b.get("token"))
                    with r.cond:
                        common_act(r, p, str(b.get("action")), b)
                        r.bump()
                    return self.send(200, {"ok": True})
                self.send(404, {"error": "introuvable"})
            except GameError as e:
                self.send(400, {"error": str(e)})

    threading.Thread(target=reaper, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", port or int(os.environ.get("PORT", "8000"))), Handler)
    srv.daemon_threads = True
    srv.serve_forever()
