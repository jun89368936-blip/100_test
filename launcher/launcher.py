# -*- coding: utf-8 -*-
"""
실행파일 통합 런처
- tools.json 을 읽어 작업폴더의 모든 도구를 한 페이지에 카드로 표시
- exe / html / flask 세 가지 실행 타입을 지원
- 포트 8765 에서 동작. start.bat 더블클릭으로 기동.
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser

from flask import Flask, abort, jsonify, request

if getattr(sys, "frozen", False):
    # PyInstaller EXE 로 실행: __file__ 은 임시폴더라서 exe 위치를 기준으로 삼는다
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
    # --windowed EXE 는 stdout/stderr 가 None → werkzeug 로깅 오류 방지용 로그파일
    if sys.stderr is None or sys.stdout is None:
        try:
            _logf = open(os.path.join(BASE_DIR, "launcher.log"), "w", encoding="utf-8")
            sys.stdout = sys.stderr = _logf
        except Exception:
            import io as _io
            sys.stdout = sys.stderr = _io.StringIO()
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_FILE = os.path.join(BASE_DIR, "tools.json")
WORK_DIR = os.path.dirname(BASE_DIR)  # 작업폴더 (AI_Agent)
LAUNCHER_PORT = 8765


def _python_exe():
    """flask 자식 앱을 띄울 실제 파이썬 실행기.
    EXE(frozen)일 땐 sys.executable 이 런처 exe 라 -m flask 를 못 돌리므로
    PATH 에서 pythonw/python 을 찾는다."""
    if getattr(sys, "frozen", False):
        import shutil
        return shutil.which("pythonw") or shutil.which("python") or "python"
    return sys.executable

# 자동 스캔에서 통째로 건너뛸 폴더 이름 (venv·빌드·캐시·설치 폴더 등 쓰레기)
EXCLUDE_DIRS = {
    ".git", ".omc", ".claude", "venv", ".venv", "env", "build", "dist",
    "site-packages", "node_modules", "__pycache__", "templates", "static",
    "Scripts", "Lib", "Include", "QGIS", "qgis_water_icons",
}
# 자동 스캔 대상 확장자 → 타입
SCAN_EXTS = {".exe": "exe", ".html": "html"}
AUTO_GROUP = "기타 (자동 감지)"

app = Flask(__name__)

# 다른 웹사이트가 브라우저를 통해 런처를 조작하지 못하게 막는다.
# - Host 검사: DNS 리바인딩(외부 도메인을 127.0.0.1 로 돌려 접속) 차단
# - 변경/실행 요청은 사용자 정의 헤더 필수: 다른 출처에서 이 헤더를 붙이면
#   브라우저가 사전요청(preflight)을 보내는데 런처가 허용하지 않으므로 차단된다
ALLOWED_HOSTS = {f"127.0.0.1:{LAUNCHER_PORT}", f"localhost:{LAUNCHER_PORT}"}
CSRF_HEADER = "X-Launcher"
PROTECTED_PATHS = {"/launch", "/quit", "/api/tools/save", "/api/tools/delete"}


@app.before_request
def _guard_cross_site():
    if request.host not in ALLOWED_HOSTS:
        abort(403)
    if request.path in PROTECTED_PATHS and request.headers.get(CSRF_HEADER) != "1":
        abort(403)

# 같은 flask 도구를 두 번 띄우지 않도록 기동한 프로세스를 기억
_started_flask = {}


MANIFEST_NAME = "tool.json"        # 각 프로그램 폴더에 두면 자동 정식등록되는 매니페스트
VALID_TYPES = ("exe", "html", "flask")


def _norm(p):
    return os.path.normcase(os.path.abspath(p)) if p else ""


def _stable_id(prefix, key):
    return prefix + "_" + hashlib.md5(key.encode("utf-8")).hexdigest()[:8]


def load_config():
    """tools.json → (큐레이션 목록, 무시할 경로 목록). list/객체 형식 모두 지원."""
    with open(TOOLS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, []
    return data.get("tools", []), data.get("ignore", [])


def save_config(tools, ignore):
    """tools.json 을 {tools, ignore} 형식으로 안전하게 저장(런타임 부가필드 제거)."""
    out = [{k: v for k, v in t.items() if k not in ("source", "manifest")}
           for t in tools]
    data = {"tools": out, "ignore": list(ignore)}
    tmp = TOOLS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, TOOLS_FILE)


def _resolve_paths(entry, folder):
    """매니페스트의 상대 path/cwd 를 folder 기준 절대경로로 해석."""
    t = dict(entry)
    p = t.get("path", "")
    if p and not os.path.isabs(p):
        p = os.path.abspath(os.path.join(folder, p))
    t["path"] = p
    cwd = t.get("cwd", "")
    if cwd and not os.path.isabs(cwd):
        cwd = os.path.abspath(os.path.join(folder, cwd))
    elif not cwd:
        cwd = os.path.dirname(p) if (p and t.get("type") != "html") else ""
    t["cwd"] = cwd
    return t


def scan_manifests():
    """작업폴더 하위의 tool.json 매니페스트를 찾아 정식 도구로 자동 등록."""
    found = []
    for root, dirs, files in os.walk(WORK_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        if MANIFEST_NAME not in files:
            continue
        mpath = os.path.join(root, MANIFEST_NAME)
        try:
            with open(mpath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        if isinstance(data, list):
            entries = data
        elif isinstance(data, dict) and "tools" in data:
            entries = data["tools"]
        else:
            entries = [data]
        for e in entries:
            if not isinstance(e, dict) or not e.get("name") or e.get("type") not in VALID_TYPES:
                continue
            t = _resolve_paths(e, root)
            t.setdefault("group", "기타")
            t.setdefault("desc", "")
            t["id"] = e.get("id") or _stable_id("m", mpath + "|" + e["name"])
            t["source"] = "manifest"
            t["manifest"] = mpath
            found.append(t)
    return found


def scan_extra_tools(known):
    """작업폴더에서 known(정규화 절대경로 집합)에 없는 .exe/.html 자동 발견."""
    base_norm = _norm(BASE_DIR)
    found = []
    for root, dirs, files in os.walk(WORK_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        if _norm(root) == base_norm:
            continue  # 런처 자신의 폴더는 제외
        for fn in files:
            ttype = SCAN_EXTS.get(os.path.splitext(fn)[1].lower())
            if not ttype:
                continue
            ap = os.path.abspath(os.path.join(root, fn))
            if _norm(ap) in known:
                continue
            rel = os.path.relpath(ap, WORK_DIR)
            found.append({
                "id": _stable_id("auto", ap),
                "name": os.path.splitext(fn)[0],
                "type": ttype,
                "path": ap,
                "cwd": os.path.dirname(ap) if ttype == "exe" else "",
                "desc": rel,
                "group": AUTO_GROUP,
                "source": "auto",
            })
    found.sort(key=lambda t: t["desc"].lower())
    return found


def load_tools():
    """큐레이션 + 매니페스트 + 자동감지 도구를 합쳐 반환 (각 항목 source 태그 포함)."""
    curated, ignore = load_config()
    for t in curated:
        t["source"] = "curated"
    curated_paths = {_norm(t.get("path", "")) for t in curated if t.get("path")}
    manifests = [m for m in scan_manifests()
                 if _norm(m.get("path", "")) not in curated_paths]
    known = set(curated_paths)
    known |= {_norm(m.get("path", "")) for m in manifests if m.get("path")}
    known |= {_norm(p) for p in ignore}
    return curated + manifests + scan_extra_tools(known)


def port_is_open(port, host="127.0.0.1"):
    """해당 포트에서 무언가 응답하면(이미 실행 중이면) True."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((host, port)) == 0


def find_tool(tool_id):
    for t in load_tools():
        if t.get("id") == tool_id:
            return t
    return None


# ---------------------------------------------------------------- 실행 디스패치

def launch_exe(tool):
    path = tool["path"]
    cwd = tool.get("cwd") or os.path.dirname(path)
    subprocess.Popen([path], cwd=cwd, close_fds=True)
    return f"{tool['name']} 실행됨"


def launch_html(tool):
    # os.startfile 은 한글/공백 경로와 기본 브라우저를 네이티브로 처리
    os.startfile(tool["path"])
    return f"{tool['name']} 열림"


def launch_flask(tool):
    port = int(tool.get("port", 5001))
    url = f"http://127.0.0.1:{port}"
    cwd = tool["cwd"]

    if port_is_open(port):
        # 이미 실행 중 → 다시 띄우지 않고 브라우저만 연다 (idempotent)
        webbrowser.open(url)
        return f"{tool['name']} 이미 실행 중 — 브라우저 열림"

    # flask run 으로 명시적 포트 기동 (app.py 의 __main__ 기본 포트 5000 의존 안 함)
    env = dict(os.environ)
    env["FLASK_APP"] = "app"
    proc = subprocess.Popen(
        [_python_exe(), "-m", "flask", "--app", "app", "run", "--port", str(port)],
        cwd=cwd,
        env=env,
        close_fds=True,
    )
    _started_flask[tool["id"]] = proc

    # 포트가 준비될 때까지 폴링 (최대 ~10초)
    deadline = time.time() + 10
    while time.time() < deadline:
        if port_is_open(port):
            webbrowser.open(url)
            return f"{tool['name']} 기동됨 — 브라우저 열림"
        time.sleep(0.3)
    return f"{tool['name']} 기동 시도함 (응답 대기 시간 초과 — 잠시 후 {url} 확인)"


DISPATCH = {"exe": launch_exe, "html": launch_html, "flask": launch_flask}


# --------------------------------------------------------------------- 라우트

@app.route("/launch")
def launch():
    tool_id = request.args.get("id", "")
    tool = find_tool(tool_id)
    if not tool:
        return jsonify(ok=False, msg="도구를 찾을 수 없습니다"), 404

    ttype = tool.get("type")
    handler = DISPATCH.get(ttype)
    if not handler:
        return jsonify(ok=False, msg=f"알 수 없는 타입: {ttype}"), 400

    path = tool.get("path", "")
    if ttype in ("exe", "html") and not os.path.exists(path):
        return jsonify(ok=False, msg=f"파일이 없습니다: {path}"), 404

    try:
        msg = handler(tool)
        return jsonify(ok=True, msg=msg)
    except Exception as e:  # noqa: BLE001 - 사용자에게 원인을 그대로 보여준다
        return jsonify(ok=False, msg=f"실행 실패: {e}"), 500


@app.route("/api/tools")
def api_tools():
    return jsonify(ok=True, tools=load_tools())


@app.route("/api/tools/save", methods=["POST"])
def api_save():
    t = request.get_json(silent=True) or {}
    name = (t.get("name") or "").strip()
    ttype = t.get("type")
    path = (t.get("path") or "").strip()
    if not name or ttype not in VALID_TYPES:
        return jsonify(ok=False, msg="이름과 올바른 타입(exe/html/flask)이 필요합니다."), 400
    if not path:
        return jsonify(ok=False, msg="실행 경로(파일 또는 app.py)가 필요합니다."), 400
    entry = {
        "id": t.get("id") or _stable_id("c", _norm(path) or name),
        "name": name,
        "type": ttype,
        "path": path,
        "cwd": (t.get("cwd") or "").strip(),
        "desc": (t.get("desc") or "").strip(),
        "group": (t.get("group") or "기타").strip(),
    }
    if ttype == "flask":
        try:
            entry["port"] = int(t.get("port") or 0)
        except (ValueError, TypeError):
            return jsonify(ok=False, msg="포트는 숫자여야 합니다."), 400
        if not entry["port"]:
            return jsonify(ok=False, msg="웹앱(flask)은 포트 번호가 필요합니다."), 400
    if not entry["cwd"] and ttype != "html":
        entry["cwd"] = os.path.dirname(os.path.abspath(path))

    curated, ignore = load_config()
    replaced = False
    for i, c in enumerate(curated):
        if c.get("id") == entry["id"]:
            curated[i] = entry
            replaced = True
            break
    if not replaced:
        curated.append(entry)
    save_config(curated, ignore)
    return jsonify(ok=True, replaced=replaced, id=entry["id"])


@app.route("/api/tools/delete", methods=["POST"])
def api_delete():
    body = request.get_json(silent=True) or {}
    tid, src, path = body.get("id"), body.get("source"), body.get("path", "")
    curated, ignore = load_config()
    if src == "curated":
        curated = [c for c in curated if c.get("id") != tid]
        save_config(curated, ignore)
        return jsonify(ok=True)
    if src == "auto":
        if path and path not in ignore:
            ignore.append(path)
        save_config(curated, ignore)
        return jsonify(ok=True, hidden=True)
    if src == "manifest":
        return jsonify(ok=False, msg="이 도구는 해당 폴더의 tool.json 에서 관리합니다. 폴더의 tool.json 을 수정·삭제하세요."), 400
    return jsonify(ok=False, msg="알 수 없는 출처입니다."), 400


@app.route("/quit", methods=["POST"])
def quit_app():
    """콘솔이 없는 백그라운드 실행 시 런처를 종료하는 수단."""
    def _stop():
        time.sleep(0.3)
        os._exit(0)
    threading.Thread(target=_stop, daemon=True).start()
    return jsonify(ok=True)


@app.route("/")
def index():
    try:
        tools = load_tools()
    except Exception as e:  # noqa: BLE001
        return f"<h1>tools.json 을 읽을 수 없습니다</h1><pre>{e}</pre>", 500

    # 그룹 순서 유지 (등장 순서대로)
    groups = []
    by_group = {}
    for t in tools:
        g = t.get("group", "기타")
        if g not in by_group:
            by_group[g] = []
            groups.append(g)
        by_group[g].append(t)

    type_badge = {"exe": "프로그램", "html": "웹페이지", "flask": "웹앱"}

    sections = []
    for g in groups:
        cards = []
        for t in by_group[g]:
            missing = t.get("type") in ("exe", "html") and not os.path.exists(t.get("path", ""))
            badge = type_badge.get(t.get("type"), t.get("type", ""))
            warn = '<span class="missing">파일 없음</span>' if missing else ""
            cards.append(f"""
            <button class="card{' disabled' if missing else ''}"
                    data-id="{t['id']}" {'disabled' if missing else ''}>
              <div class="card-top">
                <span class="badge badge-{t.get('type')}">{badge}</span>
                {warn}
              </div>
              <div class="card-name">{t['name']}</div>
              <div class="card-desc">{t.get('desc', '')}</div>
            </button>""")
        sections.append(f"""
        <section>
          <h2>{g}</h2>
          <div class="grid">{''.join(cards)}</div>
        </section>""")

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>실행파일 통합 런처</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 32px;
    font-family: "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
    background: #f4f5f7; color: #1f2430;
  }}
  header {{ max-width: 1100px; margin: 0 auto 24px; display: flex;
            align-items: center; justify-content: space-between; gap: 16px; }}
  header h1 {{ margin: 0 0 4px; font-size: 26px; }}
  header p {{ margin: 0; color: #6b7280; font-size: 14px; }}
  .quit-btn {{ flex: none; font-family: inherit; font-size: 13px; cursor: pointer;
               border: 1px solid #e5b4b4; background: #fff; color: #c0392b;
               border-radius: 8px; padding: 8px 14px; transition: .12s; }}
  .quit-btn:hover {{ background: #fdecea; border-color: #d98a8a; }}
  main {{ max-width: 1100px; margin: 0 auto; }}
  section {{ margin-bottom: 28px; }}
  section h2 {{
    font-size: 15px; color: #374151; margin: 0 0 12px;
    border-left: 4px solid #3b82f6; padding-left: 10px;
  }}
  .grid {{
    display: grid; gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }}
  .card {{
    text-align: left; cursor: pointer; border: 1px solid #e5e7eb;
    background: #fff; border-radius: 12px; padding: 16px;
    transition: .15s; font-family: inherit;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
  }}
  .card:hover {{ border-color: #3b82f6; box-shadow: 0 4px 14px rgba(59,130,246,.18); transform: translateY(-2px); }}
  .card.disabled {{ cursor: not-allowed; opacity: .5; }}
  .card-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
  .badge {{ font-size: 11px; padding: 2px 8px; border-radius: 999px; color: #fff; }}
  .badge-exe {{ background: #6366f1; }}
  .badge-html {{ background: #10b981; }}
  .badge-flask {{ background: #f59e0b; }}
  .missing {{ font-size: 11px; color: #ef4444; }}
  .card-name {{ font-size: 16px; font-weight: 700; margin-bottom: 4px; }}
  .card-desc {{ font-size: 12px; color: #6b7280; }}
  #toast {{
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
    background: #1f2430; color: #fff; padding: 12px 20px; border-radius: 10px;
    font-size: 14px; opacity: 0; pointer-events: none; transition: opacity .25s;
  }}
  #toast.show {{ opacity: 1; }}
</style>
</head>
<body>
<header>
  <div>
    <h1>실행파일 통합 런처</h1>
    <p>카드를 클릭하면 해당 프로그램·도구가 실행됩니다.</p>
  </div>
  <div style="display:flex; gap:8px;">
    <a class="quit-btn" href="/manage" style="color:#2563eb; border-color:#bcd3f5;">⚙ 도구 관리</a>
    <button class="quit-btn" id="quitBtn">⏻ 런처 종료</button>
  </div>
</header>
<main>{''.join(sections)}</main>
<div id="toast"></div>
<script>
  const toast = document.getElementById('toast');
  function showToast(msg) {{
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
  }}
  document.querySelectorAll('.card:not(.disabled)').forEach(btn => {{
    btn.addEventListener('click', async () => {{
      showToast('실행 중...');
      try {{
        const r = await fetch('/launch?id=' + encodeURIComponent(btn.dataset.id),
                                {{headers: {{'X-Launcher': '1'}}}});
        const d = await r.json();
        showToast(d.msg);
      }} catch (e) {{
        showToast('요청 실패: ' + e);
      }}
    }});
  }});
  document.getElementById('quitBtn').addEventListener('click', async () => {{
    if (!confirm('런처를 종료할까요?\\n(이미 실행한 프로그램·웹앱은 계속 켜져 있습니다)')) return;
    try {{ await fetch('/quit', {{method: 'POST', headers: {{'X-Launcher': '1'}}}}); }} catch (e) {{}}
    document.body.innerHTML =
      '<div style="max-width:600px;margin:80px auto;text-align:center;'
      + 'font-family:Malgun Gothic,sans-serif;color:#444">'
      + '<h2>런처가 종료되었습니다</h2>'
      + '<p style="color:#888">이 탭은 닫으셔도 됩니다. 다시 쓰려면 바탕화면의 '
      + '<b>통합런처</b> 바로가기를 실행하세요.</p></div>';
  }});
</script>
</body>
</html>"""
    return html


@app.route("/manage")
def manage():
    return MANAGE_HTML


MANAGE_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>도구 관리 · 통합런처</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:#f4f5f7; color:#1f2430;
         font-family:"Malgun Gothic","맑은 고딕",system-ui,sans-serif; }
  .wrap { max-width:1100px; margin:0 auto; }
  header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
  header h1 { margin:0; font-size:24px; }
  a.btn, button { font:inherit; cursor:pointer; border:1px solid #cbd2dc; background:#fff;
                  border-radius:8px; padding:7px 12px; transition:.12s; text-decoration:none; color:#1f2430; }
  button:hover, a.btn:hover { border-color:#3b82f6; }
  button.primary { background:#3b82f6; color:#fff; border-color:#3b82f6; }
  button.danger { color:#c0392b; border-color:#e5b4b4; }
  .card { background:#fff; border:1px solid #e2e6ec; border-radius:12px; padding:18px 20px; margin-bottom:18px; }
  .card h2 { margin:0 0 12px; font-size:15px; border-left:4px solid #3b82f6; padding-left:10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { padding:7px 8px; border-bottom:1px solid #eef1f5; text-align:left; vertical-align:top; }
  th { background:#f6f8fb; color:#4b5563; font-size:12px; }
  .src { font-size:11px; padding:2px 7px; border-radius:999px; color:#fff; }
  .src-curated{background:#3b82f6;} .src-manifest{background:#16a34a;} .src-auto{background:#9ca3af;}
  .path { color:#8a93a2; font-size:11px; word-break:break-all; }
  label.fld { display:block; font-size:12px; color:#555; margin:8px 0 3px; }
  input,select,textarea { font:inherit; padding:7px 9px; border:1px solid #cbd2dc; border-radius:7px; width:100%; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .muted { color:#8a93a2; font-size:12px; }
  pre { background:#0f172a; color:#cfe3ff; padding:12px; border-radius:8px; font-size:12px; overflow:auto; }
  #msg { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#1f2430;
         color:#fff; padding:10px 18px; border-radius:9px; opacity:0; transition:.25s; pointer-events:none; }
  #msg.show { opacity:1; }
</style>
</head>
<body><div class="wrap">
<header>
  <h1>⚙ 도구 관리</h1>
  <a class="btn" href="/">← 런처로 돌아가기</a>
</header>

<div class="card">
  <h2>등록된 도구</h2>
  <table id="tbl"><thead><tr>
    <th>이름</th><th>그룹</th><th>타입</th><th>포트</th><th>경로</th><th>출처</th><th style="width:150px">동작</th>
  </tr></thead><tbody></tbody></table>
</div>

<div class="card">
  <h2 id="formTitle">새 도구 추가</h2>
  <input type="hidden" id="f_id">
  <div class="grid2">
    <div><label class="fld">이름 *</label><input id="f_name" placeholder="예: 내 자동화 도구"></div>
    <div><label class="fld">그룹</label><input id="f_group" placeholder="예: 프로그램 / 계산기·도구 / 웹앱"></div>
  </div>
  <div class="grid2">
    <div><label class="fld">타입 *</label>
      <select id="f_type" onchange="onType()">
        <option value="exe">exe (프로그램)</option>
        <option value="html">html (웹페이지)</option>
        <option value="flask">flask (웹앱)</option>
      </select></div>
    <div id="portBox" style="display:none"><label class="fld">포트 * (flask)</label><input id="f_port" type="number" placeholder="예: 5003"></div>
  </div>
  <label class="fld">실행 경로 * (exe/html 파일 또는 flask 의 app.py — 절대경로)</label>
  <input id="f_path" placeholder="C:\\Users\\...\\app.exe">
  <div class="grid2">
    <div><label class="fld">작업폴더 cwd (비우면 자동)</label><input id="f_cwd" placeholder="비워두면 파일 위치"></div>
    <div><label class="fld">설명</label><input id="f_desc" placeholder="카드에 표시될 설명"></div>
  </div>
  <div style="margin-top:12px; display:flex; gap:8px;">
    <button class="primary" onclick="save()">저장</button>
    <button onclick="resetForm()">새로 입력</button>
  </div>
</div>

<div class="card">
  <h2>폴더 자동등록(매니페스트) 안내</h2>
  <p class="muted">프로그램 폴더 안에 <b>tool.json</b> 파일을 두면 런처가 자동으로 정식 카드로 등록합니다. 경로는 그 폴더 기준 상대경로로 적어도 됩니다.</p>
  <pre>{
  "name": "내 자동화 도구",
  "type": "flask",
  "path": "app.py",
  "port": 5003,
  "group": "웹앱",
  "desc": "설명"
}</pre>
  <p class="muted">exe 예: <code>{"name":"...","type":"exe","path":"dist/myapp.exe","group":"프로그램"}</code> · 여러 개면 배열 <code>[ {...}, {...} ]</code> 로.</p>
</div>

</div><div id="msg"></div>
<script>
let tools = [];
const $ = s => document.getElementById(s);
function msg(t){ const m=$('msg'); m.textContent=t; m.classList.add('show'); clearTimeout(m._t); m._t=setTimeout(()=>m.classList.remove('show'),2600); }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function load(){
  const r = await fetch('/api/tools').then(x=>x.json());
  tools = r.tools || [];
  const tb = $('tbl').querySelector('tbody'); tb.innerHTML='';
  for(const t of tools){
    const tr=document.createElement('tr');
    let act='';
    if(t.source==='manifest') act='<span class="muted">폴더 tool.json</span>';
    else if(t.source==='auto') act=`<button onclick="promote('${t.id}')">정식등록</button> <button class="danger" onclick="del('${t.id}')">숨기기</button>`;
    else act=`<button onclick="edit('${t.id}')">수정</button> <button class="danger" onclick="del('${t.id}')">삭제</button>`;
    tr.innerHTML=`<td><b>${esc(t.name)}</b><div class="muted">${esc(t.desc||'')}</div></td>
      <td>${esc(t.group||'')}</td><td>${esc(t.type)}</td><td>${t.port||''}</td>
      <td class="path">${esc(t.path||'')}</td>
      <td><span class="src src-${t.source}">${t.source}</span></td><td>${act}</td>`;
    tb.appendChild(tr);
  }
}
function onType(){ $('portBox').style.display = $('f_type').value==='flask'?'block':'none'; }
function resetForm(){ $('f_id').value=''; $('f_name').value=''; $('f_group').value=''; $('f_type').value='exe';
  $('f_port').value=''; $('f_path').value=''; $('f_cwd').value=''; $('f_desc').value=''; onType(); $('formTitle').textContent='새 도구 추가'; }
function fill(t, title){ $('f_id').value=t.id||''; $('f_name').value=t.name||''; $('f_group').value=t.group||'';
  $('f_type').value=t.type||'exe'; $('f_port').value=t.port||''; $('f_path').value=t.path||''; $('f_cwd').value=t.cwd||'';
  $('f_desc').value=t.desc||''; onType(); $('formTitle').textContent=title; window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'}); }
function edit(id){ const t=tools.find(x=>x.id===id); if(t) fill(t,'도구 수정'); }
function promote(id){ const t=tools.find(x=>x.id===id); if(t){ const c={...t}; c.id=''; c.group=(c.group&&c.group!=='기타 (자동 감지)')?c.group:'프로그램'; c.desc=''; fill(c,'자동감지 → 정식등록'); } }

async function save(){
  const body={ id:$('f_id').value, name:$('f_name').value, group:$('f_group').value, type:$('f_type').value,
    port:$('f_port').value, path:$('f_path').value, cwd:$('f_cwd').value, desc:$('f_desc').value };
  if(!body.name){ msg('이름을 입력하세요'); return; }
  if(!body.path){ msg('실행 경로를 입력하세요'); return; }
  const r=await fetch('/api/tools/save',{method:'POST',headers:{'Content-Type':'application/json','X-Launcher':'1'},body:JSON.stringify(body)}).then(x=>x.json());
  if(!r.ok){ msg(r.msg||'저장 실패'); return; }
  msg(r.replaced?'수정됨':'추가됨'); resetForm(); load();
}
async function del(id){
  const t=tools.find(x=>x.id===id); if(!t) return;
  const word = t.source==='auto' ? '숨기' : '삭제하';
  if(!confirm(`[${t.name}] 을(를) ${word}시겠습니까?`)) return;
  const r=await fetch('/api/tools/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Launcher':'1'},
    body:JSON.stringify({id:t.id, source:t.source, path:t.path})}).then(x=>x.json());
  if(!r.ok){ msg(r.msg||'실패'); return; }
  msg('완료'); load();
}
load();
</script>
</body></html>"""


def open_browser_later():
    time.sleep(1.2)
    webbrowser.open(f"http://127.0.0.1:{LAUNCHER_PORT}")


if __name__ == "__main__":
    if port_is_open(LAUNCHER_PORT):
        # 이미 실행 중 → 새 서버를 띄우지 않고 브라우저만 연다 (중복 방지)
        webbrowser.open(f"http://127.0.0.1:{LAUNCHER_PORT}")
    else:
        if not os.getenv("LAUNCHER_NO_BROWSER"):
            threading.Thread(target=open_browser_later, daemon=True).start()
        app.run(host="127.0.0.1", port=LAUNCHER_PORT, debug=False)
