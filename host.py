"""LAN table for Contigo Cards.

Run this on one computer. Both players open the printed address, choose
Play, then Same network, and sit down. Leave this window open.

    python host.py
"""

import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
HOST = "0.0.0.0"

ACTIONS = {
    "confirmMulligan": 0,
    "toggleMulligan": 1,
    "playCard": 1,
    "attack": 1,
    "activate": 2,
    "endTurn": 0,
    "answer": 1,
    "concede": 0,
}


class Table:
    def __init__(self):
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.seats = [None, None]
        self.status = "empty"
        self.revision = 0
        self.views = {0: None, 1: None}
        self.views_json = ""
        self.queue = []
        self.jobs = {}
        self.next_id = 1
        self.generation = 1
        self.dead = {}
        self.share = []
        self.worker_id = ""
        self.worker_ping = 0
        self.worker_seen = False


table = Table()
browser = None
browser_dir = None


def local_ips():
    found = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("127.") or ip in found:
                continue
            found.append(ip)
    except OSError:
        pass
    return found


def clean_name(value):
    text = str(value or "").strip()
    return text[:18]


def clean_deck(value):
    if not isinstance(value, list) or not 20 <= len(value) <= 40:
        return None
    deck = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int):
            return None
        if item < 1 or item > 30:
            return None
        deck.append(item)
    return deck


def seat_for(token):
    if not token:
        return None
    for index, seat in enumerate(table.seats):
        if seat and seat["token"] == token:
            return index
    return None


def send_json(handler, code, payload):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def is_local(handler):
    return handler.client_address[0] in ("127.0.0.1", "::1")


def queue_job(op, seat, name, args):
    job = {
        "id": table.next_id,
        "op": op,
        "gen": table.generation,
        "seat": seat,
        "name": name,
        "args": args,
        "event": threading.Event(),
        "response": None,
    }
    table.next_id += 1
    table.jobs[job["id"]] = job
    table.queue.append(job)
    table.wake.set()
    return job


def fail_waiting(reason):
    for job in table.queue:
        job["response"] = {"ok": False, "error": reason, "closed": True}
        job["event"].set()
    table.queue = []


def remember_dead(token, reason):
    if not token:
        return
    table.dead[token] = reason
    if len(table.dead) > 24:
        oldest = next(iter(table.dead))
        table.dead.pop(oldest, None)


def close_table(reason, stop_engine):
    for seat in table.seats:
        if seat:
            remember_dead(seat["token"], reason)
    table.seats = [None, None]
    table.views = {0: None, 1: None}
    table.views_json = ""
    table.status = "empty"
    table.revision += 1
    table.generation += 1
    fail_waiting(reason)
    if stop_engine:
        queue_job("stop", None, "", [])


def store_views(views):
    if not isinstance(views, dict) or "0" not in views or "1" not in views:
        return
    raw = json.dumps(views, sort_keys=True, separators=(",", ":"))
    if raw == table.views_json:
        return
    table.views_json = raw
    table.views[0] = views.get("0")
    table.views[1] = views.get("1")
    table.revision += 1
    phase = (table.views[0] or {}).get("phase")
    if phase == "over":
        table.status = "over"
    elif phase:
        table.status = "playing"


def apply_worker_result(result):
    if not isinstance(result, dict):
        return
    if result.get("gen") != table.generation:
        return
    store_views(result.get("views"))
    job = table.jobs.get(result.get("job"))
    if not job or job.get("gen") != table.generation:
        return
    seat = job.get("seat")
    view = None
    if isinstance(result.get("views"), dict) and seat in (0, 1):
        view = result["views"].get(str(seat))
    if result.get("ok") is False and job.get("op") == "start":
        close_table(result.get("error") or "Could not start the match", False)
        job["response"] = {"ok": False, "error": result.get("error") or "Could not start the match", "closed": True}
        job["event"].set()
        return
    job["response"] = {
        "ok": bool(result.get("ok")),
        "error": result.get("error") or "",
        "view": view,
        "revision": table.revision,
    }
    job["event"].set()


def take_job():
    with table.lock:
        if table.queue:
            return table.queue.pop(0)
        table.wake.clear()
    table.wake.wait(8)
    with table.lock:
        if table.queue:
            return table.queue.pop(0)
    return None


def public_table(token):
    you = seat_for(token)
    return {
        "ok": True,
        "status": table.status,
        "seats": [seat["name"] if seat else None for seat in table.seats],
        "you": you,
        "share": table.share,
    }


def valid_args(name, args):
    if name not in ACTIONS or len(args) != ACTIONS[name]:
        return False
    if name in ("toggleMulligan", "playCard", "attack"):
        return isinstance(args[0], str) and 0 < len(args[0]) <= 40
    if name == "activate":
        return all(isinstance(item, str) and 0 < len(item) <= 40 for item in args)
    if name == "answer":
        payload = args[0]
        if not isinstance(payload, dict):
            return False
        if "key" in payload and not isinstance(payload.get("key"), str):
            return False
        if "cancel" in payload and not isinstance(payload.get("cancel"), bool):
            return False
        target = payload.get("target")
        if target is None:
            return True
        if not isinstance(target, dict):
            return False
        if target.get("type") == "hero":
            return target.get("player") in (0, 1)
        if target.get("type") == "minion":
            return isinstance(target.get("uid"), str) and 0 < len(target["uid"]) <= 40
        return False
    return True


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        err = sys.exception()
        if isinstance(err, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/table":
                self.read_table(parse_qs(parsed.query))
                return
            if parsed.path == "/api/state":
                self.read_state(parse_qs(parsed.query))
                return
            self.read_file(parsed.path)
        except Exception as err:
            sys.stderr.write("GET failed: %s\n" % err)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or length > 200000:
                send_json(self, 413, {"ok": False, "error": "That request is too large"})
                return
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                send_json(self, 400, {"ok": False, "error": "Bad JSON"})
                return
            if not isinstance(body, dict):
                send_json(self, 400, {"ok": False, "error": "Bad JSON"})
                return
            parsed = urlparse(self.path)
            if parsed.path == "/api/sit":
                self.post_sit(body)
            elif parsed.path == "/api/act":
                self.post_act(body)
            elif parsed.path == "/api/leave":
                self.post_leave(body)
            elif parsed.path == "/api/worker":
                self.post_worker(body)
            else:
                send_json(self, 404, {"ok": False, "error": "Not found"})
        except Exception as err:
            sys.stderr.write("POST failed: %s\n" % err)

    def read_table(self, query):
        token = (query.get("token") or [""])[0]
        with table.lock:
            send_json(self, 200, public_table(token))

    def read_state(self, query):
        token = (query.get("token") or [""])[0]
        with table.lock:
            if token in table.dead:
                send_json(self, 200, {"ok": False, "closed": True, "error": table.dead[token]})
                return
            seat = seat_for(token)
            if seat is None:
                send_json(self, 200, {"ok": False, "error": "You are not at this table"})
                return
            send_json(self, 200, {
                "ok": True,
                "status": table.status,
                "seat": seat,
                "revision": table.revision,
                "view": table.views[seat],
                "share": table.share,
            })

    def post_sit(self, body):
        name = clean_name(body.get("name")) or "Player"
        deck = clean_deck(body.get("deck"))
        if deck is None:
            send_json(self, 200, {"ok": False, "error": "Pick a deck of 20 to 40 cards"})
            return
        with table.lock:
            if table.status in ("playing", "over") or (table.seats[0] and table.seats[1]):
                send_json(self, 200, {"ok": False, "error": "A match is already on this table"})
                return
            seat = 0 if table.seats[0] is None else 1
            token = secrets.token_urlsafe(18)
            table.seats[seat] = {"token": token, "name": name, "deck": deck}
            if table.seats[0] and table.seats[1]:
                table.status = "playing"
                queue_job("start", None, "", [])
                table.queue[-1]["names"] = [table.seats[0]["name"], table.seats[1]["name"]]
                table.queue[-1]["decks"] = [table.seats[0]["deck"], table.seats[1]["deck"]]
            else:
                table.status = "waiting"
            payload = {"ok": True, "token": token, "seat": seat, "status": table.status, "share": table.share}
        send_json(self, 200, payload)

    def post_leave(self, body):
        token = str(body.get("token") or "")
        with table.lock:
            seat = seat_for(token)
            if seat is None:
                if token in table.dead:
                    send_json(self, 200, {"ok": True, "closed": True, "error": table.dead[token]})
                else:
                    send_json(self, 200, {"ok": True})
                return
            if table.status == "waiting":
                remember_dead(token, "You left the table.")
                table.seats[seat] = None
                table.status = "empty"
                send_json(self, 200, {"ok": True, "closed": True})
                return
            reason = "The table was cleared." if table.status == "over" else table.seats[seat]["name"] + " left the table."
            close_table(reason, True)
        send_json(self, 200, {"ok": True, "closed": True, "error": reason})

    def post_act(self, body):
        token = str(body.get("token") or "")
        name = body.get("name")
        args = body.get("args") if isinstance(body.get("args"), list) else []
        with table.lock:
            if token in table.dead:
                send_json(self, 200, {"ok": False, "closed": True, "error": table.dead[token]})
                return
            seat = seat_for(token)
            if seat is None:
                send_json(self, 200, {"ok": False, "error": "You are not at this table"})
                return
            if not valid_args(name, args):
                send_json(self, 200, {"ok": False, "error": "That action is not allowed"})
                return
            if table.status not in ("playing", "over"):
                send_json(self, 200, {"ok": False, "error": "The match has not started"})
                return
            job = queue_job("act", seat, name, args)
            event = job["event"]
        if not event.wait(8):
            send_json(self, 200, {"ok": False, "error": "The table did not answer"})
            return
        send_json(self, 200, job["response"] or {"ok": False, "error": "The table did not answer"})

    def post_worker(self, body):
        if not is_local(self):
            send_json(self, 403, {"op": "busy"})
            return
        wid = str(body.get("wid") or "")
        with table.lock:
            now = time.time()
            if table.worker_id and table.worker_id != wid and now - table.worker_ping < 5:
                send_json(self, 200, {"op": "busy"})
                return
            table.worker_id = wid
            table.worker_ping = now
            table.worker_seen = True
            apply_worker_result(body.get("result"))
        job = take_job()
        if not job:
            send_json(self, 200, {"op": "ping"})
            return
        payload = {"op": job["op"], "id": job["id"], "gen": job["gen"], "seat": job["seat"], "name": job["name"], "args": job["args"]}
        if job["op"] == "start":
            payload["names"] = job.get("names")
            payload["decks"] = job.get("decks")
        send_json(self, 200, payload)

    def read_file(self, path):
        if path == "/":
            path = "/index.html"
        rel = unquote(path).lstrip("/")
        if not rel or ".." in rel.replace("\\", "/").split("/"):
            self.send_error(404)
            return
        full = os.path.abspath(os.path.join(ROOT, rel))
        root = os.path.abspath(ROOT)
        if os.path.normcase(full) != os.path.normcase(root) and not os.path.normcase(full).startswith(os.path.normcase(root) + os.sep):
            self.send_error(404)
            return
        ext = os.path.splitext(full)[1].lower()
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
        }
        if ext not in types or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as handle:
            data = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", types[ext])
        self.send_header("Content-Length", str(len(data)))
        if ext != ".jpg" and ext != ".jpeg":
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def find_browser():
    candidates = [
        os.environ.get("CONTIGO_BROWSER", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return ""


def start_browser(port):
    global browser, browser_dir
    path = find_browser()
    if not path:
        print("Chrome or Edge was not found, so LAN play cannot deal cards.")
        print("Install one of them, or set CONTIGO_BROWSER to the browser exe.")
        return
    browser_dir = tempfile.mkdtemp(prefix="contigo-lan-")
    browser = subprocess.Popen(
        [
            path,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--disable-extensions",
            "--user-data-dir=" + browser_dir,
            "http://127.0.0.1:%d/lan-worker.html" % port,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def stop_browser():
    global browser
    if browser and browser.poll() is None:
        browser.terminate()
        try:
            browser.wait(timeout=3)
        except subprocess.TimeoutExpired:
            browser.kill()
    browser = None


def choose_port():
    for port in range(8080, 8090):
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.bind((HOST, port))
            probe.close()
            return port
        except OSError:
            probe.close()
    return None


def main():
    port = choose_port()
    if port is None:
        print("Ports 8080-8089 are already in use.")
        return 1
    ips = local_ips()
    table.share = ["http://%s:%d" % (ip, port) for ip in ips]
    server = Server((HOST, port), Handler)
    thread = threading.Thread(target=server.serve_forever, name="contigo-http", daemon=True)
    thread.start()
    ready = time.time() + 5
    while time.time() < ready:
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/lan-worker.html" % port, timeout=1).read()
            break
        except Exception:
            time.sleep(0.1)
    start_browser(port)
    print("")
    print("Contigo LAN table")
    print("  This computer:  http://127.0.0.1:%d" % port)
    if table.share:
        for link in table.share:
            print("  Other players:  " + link)
    else:
        print("  Other players:  use this computer's IPv4 address from ipconfig, port %d" % port)
    print("")
    print("Leave this window open. Both players open Play, choose Same network, and sit down.")
    print("If Windows Firewall asks, allow Python on private networks.")
    print("Press Ctrl+C to stop.")
    print("")
    deadline = time.time() + 8
    while time.time() < deadline and not table.worker_seen:
        time.sleep(0.2)
    if not table.worker_seen:
        print("The match engine has not checked in yet. If sitting down fails, close this and start it again.")
    try:
        while True:
            time.sleep(0.5)
            if browser and browser.poll() is not None:
                print("The match engine stopped. Starting it again.")
                start_browser(port)
    except KeyboardInterrupt:
        print("\nStopping the table.")
    finally:
        server.shutdown()
        stop_browser()
    return 0


if __name__ == "__main__":
    sys.exit(main())
