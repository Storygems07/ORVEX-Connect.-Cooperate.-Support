#!/usr/bin/env python3
"""
ORVEX — real-time community server.

Pure Python standard library: no pip install needed.
Run:   python server.py        then open http://localhost:8000

Features
  * Live chat spaces (rooms) using Server-Sent Events
  * Direct messages
  * Give-Back Board (needs / offers) that opens a private chat when someone responds
  * Interest-based matching (client side, using the shared user list)
  * Basic safety: rate limiting, length limits, message reporting, no personal data
Data is saved to data.json next to this file.
"""
import json
import os
import queue
import re
import secrets
import socket
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.environ.get("ORVEX_DATA", os.path.join(BASE, "data.json"))
PORT = int(os.environ.get("PORT", "8000"))

ROOMS = [
    {"id": "lounge",    "name": "Lounge",           "icon": "◎", "topic": "Say hi, meet people, start anything."},
    {"id": "study",     "name": "Study Help",       "icon": "✦", "topic": "Homework, exams, projects. Ask and help."},
    {"id": "talk",      "name": "Talk & Support",   "icon": "◐", "topic": "A kind place to talk about your day or something heavy."},
    {"id": "volunteer", "name": "Give Back",        "icon": "❖", "topic": "Plan volunteering, drives and ways to help."},
    {"id": "creative",  "name": "Create Together",  "icon": "☄", "topic": "Art, music, writing, design, ideas."},
    {"id": "gaming",    "name": "Game Night",       "icon": "⌘", "topic": "Find people to play with."},
    {"id": "tech",      "name": "Builders",         "icon": "⬡", "topic": "Code, hackathons, gadgets and AI."},
]
ROOM_IDS = {r["id"] for r in ROOMS}
INTERESTS = ["Study", "Wellness", "Volunteering", "Creative", "Gaming", "Tech", "Sports", "Music"]
CATS = INTERESTS + ["Other"]
COLORS = ["#4df3ff", "#8b5cf6", "#ff4ecd", "#ffd166", "#5eead4", "#fb7185", "#a3e635", "#60a5fa"]
RESERVED = {"orvex", "admin", "moderator", "system", "staff"}
NAME_RE = re.compile(r"^[\w .\-]{2,20}$", re.UNICODE)

lock = threading.RLock()
users = {}      # uid -> {id,name,color,interests,token,created}
tokens = {}     # token -> uid
messages = {r["id"]: [] for r in ROOMS}
dms = {}        # "dm:a:b" -> [messages]
board = []      # newest first
reports = []
clients = defaultdict(set)  # uid -> set(queue)
rate = defaultdict(lambda: deque(maxlen=30))
_dirty = False


class Err(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


# ---------------------------------------------------------------- helpers
def now():
    return int(time.time())


def mark():
    global _dirty
    _dirty = True


def clean(text, limit):
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(text or "")).strip()
    return text[:limit]


def pub(u):
    return {"id": u["id"], "name": u["name"], "color": u["color"],
            "interests": u["interests"], "online": bool(clients.get(u["id"]))}


def bpub(p):
    a = users.get(p["uid"], {"name": "Someone", "color": "#8d97b8"})
    return {"id": p["id"], "uid": p["uid"], "name": a["name"], "color": a["color"],
            "type": p["type"], "category": p["category"], "text": p["text"],
            "ts": p["ts"], "open": p["open"], "responders": len(p["responders"])}


def dm_key(a, b):
    return "dm:" + ":".join(sorted([a, b]))


def emit(event, data, uids=None):
    with lock:
        targets = list(clients.keys()) if uids is None else [x for x in uids if x in clients]
        for uid in targets:
            for q in list(clients[uid]):
                try:
                    q.put_nowait((event, data))
                except queue.Full:
                    pass


def add_message(room, u, text, system=False):
    m = {"id": secrets.token_hex(5), "room": room,
         "uid": "system" if system else u["id"],
         "name": "ORVEX" if system else u["name"],
         "color": "#4df3ff" if system else u["color"],
         "text": text, "ts": now(), "sys": system}
    with lock:
        if room.startswith("dm:"):
            lst = dms.setdefault(room, [])
            targets = room.split(":")[1:]
        else:
            lst = messages[room]
            targets = None
        lst.append(m)
        if len(lst) > 300:
            del lst[:-300]
        mark()
        emit("msg", m, targets)
    return m


def check_rate(u):
    with lock:
        q = rate[u["id"]]
        t = time.time()
        q.append(t)
        recent = [x for x in q if t - x < 8]
        if len(recent) > 7:
            raise Err(429, "Slow down a little — you're sending too fast.")


# ---------------------------------------------------------------- persistence
def save():
    global _dirty
    with lock:
        data = {"users": users, "messages": messages, "dms": dms, "board": board, "reports": reports}
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, DATA_FILE)
        _dirty = False


def load():
    if not os.path.exists(DATA_FILE):
        return
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return
    users.update(d.get("users", {}))
    for u in users.values():
        tokens[u["token"]] = u["id"]
    for k, v in d.get("messages", {}).items():
        if k in messages:
            messages[k] = v
    dms.update(d.get("dms", {}))
    board.extend(d.get("board", []))
    reports.extend(d.get("reports", []))


def saver():
    while True:
        time.sleep(3)
        if _dirty:
            try:
                save()
            except Exception as e:  # pragma: no cover
                print("save failed:", e)


def seed():
    welcome = {
        "lounge": "Welcome to ORVEX! Say hi — this is a space to connect, cooperate and support each other. Be kind.",
        "study": "Ask a question or offer help. Explaining something is the best way to learn it.",
        "talk": "This is a gentle space. Listen first, be kind. If someone seems in danger, tell a trusted adult or call your local emergency number.",
        "volunteer": "Plan something good together: cleanups, drives, tutoring, fundraisers.",
        "creative": "Share what you're making or find collaborators.",
        "gaming": "Find teammates and plan game nights.",
        "tech": "Talk code, hackathons, gadgets and AI.",
    }
    for rid, text in welcome.items():
        if not messages[rid]:
            add_message(rid, None, text, system=True)


# ---------------------------------------------------------------- API actions
def r_join(_u, d):
    token = d.get("token") or ""
    interests = [i for i in (d.get("interests") or []) if i in INTERESTS][:8]
    with lock:
        if token in tokens:
            u = users[tokens[token]]
            return {"token": token, "me": pub(u)}
        name = clean(d.get("name"), 20)
        if not NAME_RE.match(name):
            raise Err(400, "Pick a nickname of 2–20 letters or numbers.")
        if name.lower() in RESERVED:
            raise Err(400, "That name is reserved. Pick another.")
        if any(x["name"].lower() == name.lower() for x in users.values()):
            raise Err(409, "That name is taken — try another.")
        uid = secrets.token_hex(4)
        tok = secrets.token_urlsafe(18)
        u = {"id": uid, "name": name, "color": COLORS[len(users) % len(COLORS)],
             "interests": interests, "token": tok, "created": now()}
        users[uid] = u
        tokens[tok] = uid
        mark()
        emit("user", pub(u))
        return {"token": tok, "me": pub(u)}


def r_profile(u, d):
    interests = [i for i in (d.get("interests") or []) if i in INTERESTS][:8]
    with lock:
        u["interests"] = interests
        mark()
        emit("user", pub(u))
    return {"ok": True}


def r_send(u, d):
    text = clean(d.get("text"), 500)
    if not text:
        raise Err(400, "Write something first.")
    check_rate(u)
    to, room = d.get("to"), d.get("room")
    if to:
        other = users.get(to)
        if not other or other["id"] == u["id"]:
            raise Err(404, "That person was not found.")
        emit("user", pub(u), [other["id"]])
        emit("user", pub(other), [u["id"]])
        m = add_message(dm_key(u["id"], other["id"]), u, text)
    else:
        if room not in ROOM_IDS:
            raise Err(404, "Unknown space.")
        m = add_message(room, u, text)
    return {"ok": True, "room": m["room"]}


def r_board(u, d):
    typ = d.get("type")
    if typ not in ("need", "offer"):
        raise Err(400, "Choose need or offer.")
    cat = d.get("category") if d.get("category") in CATS else "Other"
    text = clean(d.get("text"), 240)
    if len(text) < 5:
        raise Err(400, "Write a little more so people know how to help.")
    check_rate(u)
    with lock:
        p = {"id": secrets.token_hex(5), "uid": u["id"], "type": typ, "category": cat,
             "text": text, "ts": now(), "open": True, "responders": []}
        board.insert(0, p)
        del board[200:]
        mark()
        emit("board", bpub(p))
    return {"ok": True}


def find_post(pid):
    return next((p for p in board if p["id"] == pid), None)


def r_respond(u, d):
    with lock:
        p = find_post(d.get("id"))
        if not p or not p["open"]:
            raise Err(404, "That post is no longer open.")
        if p["uid"] == u["id"]:
            raise Err(400, "That's your own post.")
        author = users[p["uid"]]
        key = dm_key(u["id"], author["id"])
        emit("user", pub(u), [author["id"]])
        emit("user", pub(author), [u["id"]])
        if u["id"] not in p["responders"]:
            p["responders"].append(u["id"])
            kind = "request" if p["type"] == "need" else "offer"
            tail = "I'd love to help." if p["type"] == "need" else "I'm interested!"
            add_message(key, u, f"Hi {author['name']}! I saw your {kind} on the Give-Back Board "
                                f"(“{p['text'][:80]}”). {tail}")
            emit("board", bpub(p))
        return {"room": key}


def r_close(u, d):
    with lock:
        p = find_post(d.get("id"))
        if not p or p["uid"] != u["id"]:
            raise Err(404, "Post not found.")
        p["open"] = False
        mark()
        emit("board", bpub(p))
    return {"ok": True}


def r_report(u, d):
    room, mid = d.get("room"), d.get("id")
    with lock:
        if room and room.startswith("dm:"):
            if u["id"] not in room.split(":")[1:]:
                raise Err(403, "Not allowed.")
            lst = dms.get(room, [])
        else:
            lst = messages.get(room, [])
        m = next((x for x in lst if x["id"] == mid), None)
        if not m:
            raise Err(404, "Message not found.")
        reports.append({"by": u["id"], "room": room, "msg": m, "ts": now()})
        mark()
    return {"ok": True}


def build_state(u):
    with lock:
        my_dms = {}
        for key, lst in dms.items():
            parts = key.split(":")[1:]
            if u["id"] in parts:
                other = parts[1] if parts[0] == u["id"] else parts[0]
                my_dms[other] = lst[-80:]
        return {
            "me": pub(u),
            "rooms": ROOMS,
            "interests": INTERESTS,
            "users": [pub(x) for x in list(users.values())[-500:]],
            "messages": {k: v[-80:] for k, v in messages.items()},
            "dms": my_dms,
            "board": [bpub(p) for p in board if p["open"]][:100],
        }


POST_ROUTES = {
    "/api/profile": r_profile, "/api/send": r_send, "/api/board": r_board,
    "/api/board/respond": r_respond, "/api/board/close": r_close, "/api/report": r_report,
}

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app": ("app.html", "text/html; charset=utf-8"),
    "/app.html": ("app.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/script.js": ("script.js", "application/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "ORVEX"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _user(self, qs):
        token = self.headers.get("X-Token") or (qs.get("token", [""])[0])
        with lock:
            return users.get(tokens.get(token))

    def do_GET(self):
        url = urlparse(self.path)
        qs = parse_qs(url.query)
        path = url.path
        try:
            if path in STATIC:
                fname, ctype = STATIC[path]
                fp = os.path.join(BASE, fname)
                if not os.path.exists(fp):
                    return self._send(404, {"error": "Not found"})
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), ctype)
            if path == "/api/health":
                return self._send(200, {"ok": True, "users": len(users)})
            if path == "/favicon.ico":
                return self._send(204, b"", "image/x-icon")
            if path == "/api/state":
                u = self._user(qs)
                if not u:
                    return self._send(401, {"error": "Please join first."})
                return self._send(200, build_state(u))
            if path == "/api/stream":
                u = self._user(qs)
                if not u:
                    return self._send(401, {"error": "Please join first."})
                return self._stream(u)
            return self._send(404, {"error": "Not found"})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _stream(self, u):
        q = queue.Queue(maxsize=500)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        with lock:
            was_offline = not clients.get(u["id"])
            clients[u["id"]].add(q)
            if was_offline:
                emit("user", pub(u))
        try:
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            while True:
                try:
                    ev, data = q.get(timeout=15)
                    chunk = f"event: {ev}\ndata: {json.dumps(data)}\n\n"
                except queue.Empty:
                    chunk = ": ping\n\n"
                self.wfile.write(chunk.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with lock:
                clients[u["id"]].discard(q)
                if not clients[u["id"]]:
                    clients.pop(u["id"], None)
                    emit("user", pub(u))

    def do_POST(self):
        url = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 20000:
                return self._send(413, {"error": "Too large."})
            raw = self.rfile.read(n) if n else b"{}"
            data = json.loads(raw or b"{}")
            if not isinstance(data, dict):
                raise ValueError
        except Exception:
            return self._send(400, {"error": "Bad request."})
        try:
            if url.path == "/api/join":
                return self._send(200, r_join(None, data))
            fn = POST_ROUTES.get(url.path)
            if not fn:
                return self._send(404, {"error": "Not found"})
            u = self._user({})
            if not u:
                return self._send(401, {"error": "Please join first."})
            return self._send(200, fn(u, data))
        except Err as e:
            return self._send(e.code, {"error": e.msg})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # pragma: no cover
            print("error:", e)
            return self._send(500, {"error": "Server error."})


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


def main():
    load()
    seed()
    threading.Thread(target=saver, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print(f"\n  ORVEX is running\n  This computer : http://localhost:{PORT}\n"
          f"  Same Wi-Fi    : http://{lan_ip()}:{PORT}\n  (Ctrl+C to stop)\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        save()


if __name__ == "__main__":
    main()
