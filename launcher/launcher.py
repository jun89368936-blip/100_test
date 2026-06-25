# -*- coding: utf-8 -*-
"""
실행파일 통합 런처
- tools.json 을 읽어 작업폴더의 모든 도구를 한 페이지에 카드로 표시
- exe / html / flask 세 가지 실행 타입을 지원
- 포트 8765 에서 동작. start.bat 더블클릭으로 기동.
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser

from flask import Flask, abort, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_FILE = os.path.join(BASE_DIR, "tools.json")
WORK_DIR = os.path.dirname(BASE_DIR)  # 작업폴더 (AI_Agent)
LAUNCHER_PORT = 8765

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

# 같은 flask 도구를 두 번 띄우지 않도록 기동한 프로세스를 기억
_started_flask = {}


def load_config():
    """tools.json 을 읽어 (큐레이션 목록, 무시할 경로 집합) 반환.
    list 형식(구버전)과 {tools, ignore} 객체 형식(신버전) 모두 지원."""
    with open(TOOLS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, set()
    tools = data.get("tools", [])
    ignore = {os.path.normcase(os.path.abspath(p)) for p in data.get("ignore", [])}
    return tools, ignore


def scan_extra_tools(curated, ignore):
    """작업폴더에서 큐레이션·무시 목록에 없는 .exe/.html 을 자동 발견."""
    known = {os.path.normcase(os.path.abspath(t.get("path", ""))) for t in curated}
    known |= ignore
    base_norm = os.path.normcase(os.path.abspath(BASE_DIR))
    found = []
    for root, dirs, files in os.walk(WORK_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        if os.path.normcase(os.path.abspath(root)) == base_norm:
            continue  # 런처 자신의 폴더는 제외
        for fn in files:
            ttype = SCAN_EXTS.get(os.path.splitext(fn)[1].lower())
            if not ttype:
                continue
            ap = os.path.abspath(os.path.join(root, fn))
            if os.path.normcase(ap) in known:
                continue
            rel = os.path.relpath(ap, WORK_DIR)
            found.append({
                "id": "auto_" + str(abs(hash(ap)))[:12],
                "name": os.path.splitext(fn)[0],
                "type": ttype,
                "path": ap,
                "cwd": os.path.dirname(ap) if ttype == "exe" else "",
                "desc": rel,
                "group": AUTO_GROUP,
            })
    found.sort(key=lambda t: t["desc"].lower())
    return found


def load_tools():
    """큐레이션된 도구 + 자동 감지된 도구를 합쳐 반환."""
    curated, ignore = load_config()
    return curated + scan_extra_tools(curated, ignore)


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
        [sys.executable, "-m", "flask", "--app", "app", "run", "--port", str(port)],
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
  <button class="quit-btn" id="quitBtn">⏻ 런처 종료</button>
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
        const r = await fetch('/launch?id=' + encodeURIComponent(btn.dataset.id));
        const d = await r.json();
        showToast(d.msg);
      }} catch (e) {{
        showToast('요청 실패: ' + e);
      }}
    }});
  }});
  document.getElementById('quitBtn').addEventListener('click', async () => {{
    if (!confirm('런처를 종료할까요?\\n(이미 실행한 프로그램·웹앱은 계속 켜져 있습니다)')) return;
    try {{ await fetch('/quit', {{method: 'POST'}}); }} catch (e) {{}}
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
