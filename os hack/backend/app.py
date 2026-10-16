"""Loopback-only dashboard API and fixed C demo runner (Python stdlib only)."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import subprocess
import threading
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = (ROOT / "frontend").resolve()
EXECUTABLE = ROOT / "cow_demo"
SOURCE = ROOT / "src" / "cow_demo.c"
COMPILER = Path("/usr/bin/gcc")
OUTPUT_LIMIT = 16_000
RUN_LOCK = threading.Lock()
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8"}


def parse_stats(output):
    records, current, process = [], None, None
    for line in output.splitlines():
        if line.startswith("[Observation:"):
            current = {"label": line.strip("[]"), "processes": {}}
            records.append(current)
            process = None
        elif current and (line.lstrip().startswith("parent (/proc/") or line.lstrip().startswith("child (/proc/")):
            process = line.strip().split(" ")[0]
            current["processes"][process] = {}
        elif current and re.match(r"\s+(Rss|Pss|Shared_Clean|Shared_Dirty|Private_Clean|Private_Dirty|Size):", line):
            key, value = line.strip().split(":", 1)
            if process:
                current["processes"][process][key] = value.strip()
    return records


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "COWDashboard/1.0"

    def log_message(self, fmt, *args):
        # Keep requests visible in the local terminal without logging payloads.
        super().log_message(fmt, *args)

    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/status":
            self._send(200, json.dumps({"ready": COMPILER.is_file() and SOURCE.is_file()}))
            return
        relative = "index.html" if path == "/" else path.lstrip("/")
        target = (FRONTEND / relative).resolve()
        if not target.is_relative_to(FRONTEND) or not target.is_file():
            self._send(404, "Not found", "text/plain; charset=utf-8")
            return
        try:
            self._send(200, target.read_bytes(), MIME.get(target.suffix, "application/octet-stream"))
        except OSError:
            self._send(500, "Could not read frontend asset", "text/plain; charset=utf-8")

    def do_POST(self):
        if urlsplit(self.path).path != "/api/run":
            self._send(404, json.dumps({"ok": False, "error": "Not found."}))
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if not 0 <= length <= 1024:
            self._send(400, json.dumps({"ok": False, "error": "Request body must be at most 1024 bytes."}))
            return
        try:
            data = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = None
        expected = {"pages", "initial_value", "child_value"}
        if not isinstance(data, dict) or set(data) != expected:
            self._send(400, json.dumps({"ok": False,
                "error": "Expected pages, initial_value, and child_value fields."}))
            return
        pages = data["pages"]
        if isinstance(pages, bool) or not isinstance(pages, int) or not 1 <= pages <= 4096:
            self._send(400, json.dumps({"ok": False, "error": "pages must be an integer from 1 to 4096."}))
            return
        initial_value, child_value = data["initial_value"], data["child_value"]
        if any(isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 255
               for value in (initial_value, child_value)):
            self._send(400, json.dumps({"ok": False, "error": "Memory values must be integers from 0 to 255."}))
            return
        if initial_value == child_value:
            self._send(400, json.dumps({"ok": False,
                "error": "The child write value must differ from the parent starting value."}))
            return
        if not RUN_LOCK.acquire(blocking=False):
            self._send(409, json.dumps({"ok": False, "error": "A demonstration is already running."}))
            return
        try:
            try:
                build = subprocess.run([str(COMPILER), "-Wall", "-Wextra", "-O0",
                                        str(SOURCE), "-o", str(EXECUTABLE)], cwd=ROOT,
                                       capture_output=True, text=True, timeout=20,
                                       check=False, env={"PATH": "/usr/bin:/bin", "LANG": "C"})
            except subprocess.TimeoutExpired as exc:
                detail = exc.stderr or ""
                if isinstance(detail, bytes):
                    detail = detail.decode("utf-8", "replace")
                self._send(504, json.dumps({"ok": False,
                    "error": "C compilation timed out after 20 seconds.",
                    "output": detail[-OUTPUT_LIMIT:]}))
                return
            except OSError as exc:
                self._send(503, json.dumps({"ok": False,
                    "error": f"Could not start the fixed Linux compiler: {exc.strerror or exc}."}))
                return
            if build.returncode:
                detail = (build.stdout + build.stderr)[-OUTPUT_LIMIT:]
                self._send(500, json.dumps({"ok": False,
                    "error": f"C compilation failed with status {build.returncode}.", "output": detail}))
                return
            try:
                result = subprocess.run([str(EXECUTABLE), str(pages),
                                         str(initial_value), str(child_value)], cwd=ROOT,
                                        capture_output=True, text=True, timeout=20,
                                        check=False, env={"PATH": "/usr/bin:/bin", "LANG": "C"})
            except subprocess.TimeoutExpired as exc:
                output = exc.stdout or ""
                if isinstance(output, bytes):
                    output = output.decode("utf-8", "replace")
                response = {"ok": False, "error": "Execution timed out after 20 seconds.",
                            "output": output[-OUTPUT_LIMIT:]}
                self._send(504, json.dumps(response))
                return
            output = (result.stdout + result.stderr)[-OUTPUT_LIMIT:]
            if result.returncode:
                self._send(500, json.dumps({"ok": False,
                    "error": f"cow_demo exited with status {result.returncode}.", "output": output}))
                return
            pids = re.search(r"Parent PID: (\d+).*?Child PID: (\d+)", output, re.S)
            parent_value = re.search(r"Parent value after child write: (\d+)", output)
            child_value = re.search(r"Child modified \d+ page location\(s\); value now: (\d+)", output)
            response = {"ok": True, "output": output,
                        "parent_pid": pids.group(1) if pids else None,
                        "child_pid": pids.group(2) if pids else None,
                        "parent_value": parent_value.group(1) if parent_value else None,
                        "child_value": child_value.group(1) if child_value else None,
                        "stats": parse_stats(output)}
            self._send(200, json.dumps(response))
        finally:
            RUN_LOCK.release()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5000), DashboardHandler)
    print("Copy-on-Write dashboard: http://127.0.0.1:5000", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
