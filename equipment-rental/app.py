from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, session
from datetime import datetime, date
from db import init_db, get_db, INTEGRITY_ERROR
from telegram_notify import notify_rent, notify_return
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import os
import threading
import time
import requests as _requests

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "rental-secret-key-change-in-prod")


def _keep_alive():
    """Render 무료 플랜 cold start 방지: 4분마다 자기 자신에게 핑"""
    time.sleep(60)  # 앱 완전 기동 대기
    base = os.getenv("RENDER_EXTERNAL_URL", "")
    if not base:
        return  # 로컬에서는 실행 안 함
    while True:
        try:
            _requests.get(f"{base}/health", timeout=10)
        except Exception:
            pass
        time.sleep(240)  # 4분 간격


threading.Thread(target=_keep_alive, daemon=True).start()
ADMIN_PIN = os.getenv("ADMIN_PIN", "1234")


def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return redirect(url_for("admin_login"))
        return f(*args, **kwargs)
    return decorated

ITEM_COLORS = ["#3788d8", "#e67e22", "#27ae60", "#8e44ad", "#c0392b"]


@app.template_filter("fmt_date")
def fmt_date(value):
    if not value:
        return "—"
    try:
        from datetime import datetime as dt
        d = dt.fromisoformat(str(value)[:10])
        return f"{d.year % 100:02d}년 {d.month:02d}월 {d.day:02d}일"
    except Exception:
        return value


@app.route("/health")
def health():
    return "ok", 200


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user_id"):
        return redirect(url_for("index"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        conn.close()
        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["display_name"] = user["display_name"]
            return redirect(url_for("index"))
        flash("아이디 또는 비밀번호가 올바르지 않습니다.", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.pop("user_id", None)
    session.pop("display_name", None)
    return redirect(url_for("login"))


@app.before_request
def startup():
    init_db()


@app.route("/")
@login_required
def index():
    today = date.today().isoformat()
    conn = get_db()
    items = conn.execute("""
        SELECT i.*,
               r.borrower_name AS current_borrower,
               r.rented_at     AS current_rented_at,
               r.due_date      AS current_due_date
        FROM items i
        LEFT JOIN rentals r
               ON r.item_id = i.id
              AND r.returned_at IS NULL
              AND r.rented_at <= ?
              AND (r.due_date IS NULL OR r.due_date > ?)
    """, (today, today)).fetchall()
    conn.close()
    return render_template("index.html", items=items, today=today)


@app.route("/calendar")
@login_required
def calendar_view():
    conn = get_db()
    items = conn.execute("SELECT * FROM items ORDER BY id").fetchall()
    conn.close()
    return render_template("calendar.html", items=items, colors=ITEM_COLORS)


@app.route("/api/events")
@login_required
def api_events():
    conn = get_db()
    rows = conn.execute("""
        SELECT r.id, r.item_id, r.borrower_name, r.rented_at, r.returned_at, r.due_date,
               i.name AS item_name
        FROM rentals r
        JOIN items i ON i.id = r.item_id
        ORDER BY r.id DESC
    """).fetchall()
    conn.close()

    events = []
    for idx, r in enumerate(rows):
        start = r["rented_at"][:10] if r["rented_at"] else None
        end = None
        if r["returned_at"]:
            end = r["returned_at"][:10]
        elif r["due_date"]:
            end = r["due_date"]
        if not end:
            end = date.today().isoformat()

        color = ITEM_COLORS[(r["item_id"] - 1) % len(ITEM_COLORS)]
        status = "반납완료" if r["returned_at"] else "대여중"
        events.append({
            "id": r["id"],
            "title": f"{r['item_name']} ({r['borrower_name']})",
            "start": start,
            "end": end,
            "color": color,
            "extendedProps": {"status": status, "borrower": r["borrower_name"]},
        })

    return jsonify(events)


@app.route("/rent/<int:item_id>", methods=["POST"])
@login_required
def rent(item_id):
    borrower_name = session.get("display_name", "")
    rented_at = request.form.get("rented_at", "").strip()
    due_date = request.form.get("due_date", "").strip()
    if not borrower_name:
        flash("로그인이 필요합니다.", "error")
        return redirect(url_for("login"))
    if not rented_at:
        flash("대여일을 선택해주세요.", "error")
        return redirect(url_for("index"))
    if not due_date:
        flash("반납일을 선택해주세요.", "error")
        return redirect(url_for("index"))

    conn = get_db()
    # 날짜 범위 겹침 체크 (반납예정일 당일은 새 대여 허용)
    conflict = conn.execute("""
        SELECT COUNT(*) FROM rentals
        WHERE item_id = ?
          AND returned_at IS NULL
          AND rented_at < ?
          AND (due_date IS NULL OR due_date > ?)
    """, (item_id, due_date, rented_at)).fetchone()[0]
    if conflict:
        flash("해당 기간에 이미 대여 중인 물품입니다.", "error")
        conn.close()
        return redirect(url_for("index"))
    try:
        conn.execute(
            "INSERT INTO rentals (item_id, borrower_name, rented_at, due_date) VALUES (?, ?, ?, ?)",
            (item_id, borrower_name, rented_at, due_date),
        )
        conn.commit()
        item = conn.execute("SELECT name FROM items WHERE id = ?", (item_id,)).fetchone()
        flash("대여가 완료되었습니다.", "success")
        notify_rent(item["name"], borrower_name, rented_at)
    except Exception:
        flash("대여 처리 중 오류가 발생했습니다.", "error")
    finally:
        conn.close()

    return redirect(url_for("index"))


@app.route("/return/<int:item_id>", methods=["POST"])
@login_required
def return_item(item_id):
    conn = get_db()
    returned_at = datetime.now().isoformat(timespec="seconds")
    rental = conn.execute(
        "SELECT r.borrower_name, i.name FROM rentals r JOIN items i ON i.id = r.item_id "
        "WHERE r.item_id = ? AND r.returned_at IS NULL",
        (item_id,),
    ).fetchone()
    conn.execute(
        "UPDATE rentals SET returned_at = ? WHERE item_id = ? AND returned_at IS NULL",
        (returned_at, item_id),
    )
    conn.commit()
    conn.close()
    flash("반납이 완료되었습니다.")
    if rental:
        notify_return(rental["name"], rental["borrower_name"], returned_at)
    return redirect(url_for("index"))


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        pin = request.form.get("pin", "").strip()
        if pin == ADMIN_PIN:
            session["is_admin"] = True
            return redirect(url_for("admin_dashboard"))
        flash("PIN이 올바르지 않습니다.")
    return render_template("admin_login.html")


@app.route("/admin/logout")
def admin_logout():
    session.pop("is_admin", None)
    return redirect(url_for("index"))


@app.route("/admin")
@admin_required
def admin_dashboard():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    rented = conn.execute(
        "SELECT COUNT(*) FROM rentals WHERE returned_at IS NULL"
    ).fetchone()[0]
    total_rentals = conn.execute("SELECT COUNT(*) FROM rentals").fetchone()[0]
    active_rentals = conn.execute("""
        SELECT r.id AS rental_id, r.borrower_name, r.rented_at, r.due_date, i.name AS item_name
        FROM rentals r JOIN items i ON i.id = r.item_id
        WHERE r.returned_at IS NULL
        ORDER BY r.rented_at DESC
    """).fetchall()
    conn.close()
    stats = {"total": total, "rented": rented, "available": total - rented, "total_rentals": total_rentals}
    return render_template("admin/dashboard.html", stats=stats, active_rentals=active_rentals,
                           today=date.today().isoformat())


@app.route("/admin/items")
@admin_required
def admin_items():
    conn = get_db()
    today = date.today().isoformat()
    items = conn.execute("""
        SELECT i.*,
               (SELECT COUNT(*) FROM rentals r
                WHERE r.item_id = i.id AND r.returned_at IS NULL
                  AND r.rented_at <= ? AND (r.due_date IS NULL OR r.due_date > ?)) AS is_rented
        FROM items i ORDER BY i.id
    """, (today, today)).fetchall()
    conn.close()
    return render_template("admin/items.html", items=items)


@app.route("/admin/items/add", methods=["POST"])
@admin_required
def admin_add_item():
    name = request.form.get("name", "").strip()
    item_type = request.form.get("type", "").strip()
    if not name or not item_type:
        flash("물품명과 종류를 모두 입력해주세요.", "error")
        return redirect(url_for("admin_items"))
    conn = get_db()
    conn.execute("INSERT INTO items (name, type) VALUES (?, ?)", (name, item_type))
    conn.commit()
    conn.close()
    flash(f"'{name}' 물품이 추가되었습니다.", "success")
    return redirect(url_for("admin_items"))


@app.route("/admin/items/delete/<int:item_id>", methods=["POST"])
@admin_required
def admin_delete_item(item_id):
    conn = get_db()
    is_rented = conn.execute(
        "SELECT COUNT(*) FROM rentals WHERE item_id = ? AND returned_at IS NULL", (item_id,)
    ).fetchone()[0]
    if is_rented:
        flash("현재 대여 중인 물품은 삭제할 수 없습니다.", "error")
        conn.close()
        return redirect(url_for("admin_items"))
    item = conn.execute("SELECT name FROM items WHERE id = ?", (item_id,)).fetchone()
    conn.execute("DELETE FROM rentals WHERE item_id = ?", (item_id,))
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    flash(f"'{item['name']}' 물품이 삭제되었습니다.", "success")
    return redirect(url_for("admin_items"))


@app.route("/admin/rentals")
@admin_required
def admin_rentals():
    conn = get_db()
    rows = conn.execute("""
        SELECT r.id, i.name AS item_name, i.type AS item_type,
               r.borrower_name, r.rented_at, r.returned_at, r.due_date
        FROM rentals r JOIN items i ON i.id = r.item_id
        ORDER BY r.id DESC
    """).fetchall()
    available_items = conn.execute("""
        SELECT i.id, i.name FROM items i
        WHERE NOT EXISTS (
            SELECT 1 FROM rentals r WHERE r.item_id = i.id AND r.returned_at IS NULL
        )
        ORDER BY i.id
    """).fetchall()
    conn.close()
    return render_template("admin/rentals.html", rows=rows, available_items=available_items)


@app.route("/admin/rentals/add", methods=["POST"])
@admin_required
def admin_add_rental():
    item_id = request.form.get("item_id", "").strip()
    borrower_name = request.form.get("borrower_name", "").strip()
    rented_at = request.form.get("rented_at", "").strip() or date.today().isoformat()
    due_date = request.form.get("due_date", "").strip()
    if not item_id or not borrower_name:
        flash("물품과 대여자 이름을 입력해주세요.", "error")
        return redirect(url_for("admin_rentals"))
    conn = get_db()
    conflict = conn.execute("""
        SELECT COUNT(*) FROM rentals
        WHERE item_id = ?
          AND returned_at IS NULL
          AND rented_at < ?
          AND (due_date IS NULL OR due_date > ?)
    """, (item_id, due_date or "9999-12-31", rented_at)).fetchone()[0]
    if conflict:
        flash("해당 기간에 이미 대여 중인 물품입니다.", "error")
        conn.close()
        return redirect(url_for("admin_rentals"))
    try:
        conn.execute(
            "INSERT INTO rentals (item_id, borrower_name, rented_at, due_date) VALUES (?, ?, ?, ?)",
            (item_id, borrower_name, rented_at, due_date or None),
        )
        conn.commit()
        item = conn.execute("SELECT name FROM items WHERE id = ?", (item_id,)).fetchone()
        flash(f"'{item['name']}' 대여가 등록되었습니다.", "success")
        notify_rent(item["name"], borrower_name, rented_at)
    except Exception:
        flash("대여 처리 중 오류가 발생했습니다.", "error")
    finally:
        conn.close()
    return redirect(url_for("admin_rentals"))


@app.route("/admin/rentals/return/<int:rental_id>", methods=["POST"])
@admin_required
def admin_return_rental(rental_id):
    conn = get_db()
    returned_at = datetime.now().isoformat(timespec="seconds")
    rental = conn.execute(
        "SELECT r.borrower_name, i.name FROM rentals r JOIN items i ON i.id = r.item_id WHERE r.id = ?",
        (rental_id,),
    ).fetchone()
    conn.execute(
        "UPDATE rentals SET returned_at = ? WHERE id = ? AND returned_at IS NULL",
        (returned_at, rental_id),
    )
    conn.commit()
    conn.close()
    if rental:
        flash(f"'{rental['name']}' 반납 처리가 완료되었습니다.", "success")
        notify_return(rental["name"], rental["borrower_name"], returned_at)
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/rentals/delete/<int:rental_id>", methods=["POST"])
@admin_required
def admin_delete_rental(rental_id):
    conn = get_db()
    conn.execute("DELETE FROM rentals WHERE id = ?", (rental_id,))
    conn.commit()
    conn.close()
    flash("대여 기록이 삭제되었습니다.", "success")
    return redirect(url_for("admin_rentals"))


@app.route("/admin/rentals/delete-selected", methods=["POST"])
@admin_required
def admin_delete_selected():
    ids = request.form.getlist("selected_ids")
    if not ids:
        flash("선택된 항목이 없습니다.", "error")
        return redirect(url_for("admin_rentals"))
    conn = get_db()
    for rid in ids:
        conn.execute("DELETE FROM rentals WHERE id = ?", (rid,))
    conn.commit()
    conn.close()
    flash(f"{len(ids)}건의 기록이 삭제되었습니다.", "success")
    return redirect(url_for("admin_rentals"))


@app.route("/admin/rentals/delete-all", methods=["POST"])
@admin_required
def admin_delete_all_rentals():
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM rentals").fetchone()[0]
    conn.execute("DELETE FROM rentals")
    conn.commit()
    conn.close()
    flash(f"전체 {count}건의 대여 기록이 삭제되었습니다.", "success")
    return redirect(url_for("admin_rentals"))


@app.route("/admin/users")
@admin_required
def admin_users():
    conn = get_db()
    users = conn.execute("SELECT id, username, display_name FROM users ORDER BY id").fetchall()
    conn.close()
    return render_template("admin/users.html", users=users)


@app.route("/admin/users/add", methods=["POST"])
@admin_required
def admin_add_user():
    username = request.form.get("username", "").strip()
    display_name = request.form.get("display_name", "").strip()
    password = request.form.get("password", "").strip()
    if not username or not display_name or not password:
        flash("모든 항목을 입력해주세요.", "error")
        return redirect(url_for("admin_users"))
    pw_hash = generate_password_hash(password)
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
            (username, pw_hash, display_name),
        )
        conn.commit()
        flash(f"'{display_name}' 계정이 추가되었습니다.", "success")
    except INTEGRITY_ERROR:
        flash(f"이미 존재하는 아이디입니다: {username}", "error")
    finally:
        conn.close()
    return redirect(url_for("admin_users"))


@app.route("/admin/users/delete/<int:user_id>", methods=["POST"])
@admin_required
def admin_delete_user(user_id):
    conn = get_db()
    user = conn.execute("SELECT display_name FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    if user:
        flash(f"'{user['display_name']}' 계정이 삭제되었습니다.", "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/reset-password/<int:user_id>", methods=["POST"])
@admin_required
def admin_reset_password(user_id):
    new_password = request.form.get("new_password", "").strip()
    if not new_password:
        flash("새 비밀번호를 입력해주세요.", "error")
        return redirect(url_for("admin_users"))
    pw_hash = generate_password_hash(new_password)
    conn = get_db()
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pw_hash, user_id))
    conn.commit()
    conn.close()
    flash("비밀번호가 변경되었습니다.", "success")
    return redirect(url_for("admin_users"))


# 기존 /manage 경로 하위 호환 유지
@app.route("/manage")
@admin_required
def manage():
    return redirect(url_for("admin_items"))


@app.route("/history")
@login_required
def history():
    conn = get_db()
    rows = conn.execute("""
        SELECT r.id,
               i.name          AS item_name,
               i.type          AS item_type,
               r.borrower_name,
               r.rented_at,
               r.returned_at,
               r.due_date
        FROM rentals r
        JOIN items i ON i.id = r.item_id
        ORDER BY r.id DESC
    """).fetchall()
    conn.close()
    return render_template("history.html", rows=rows)


@app.route("/history/export")
@login_required
def history_export():
    import io
    from flask import send_file
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    conn = get_db()
    rows = conn.execute("""
        SELECT r.id, i.name AS item_name, i.type AS item_type,
               r.borrower_name, r.rented_at, r.due_date, r.returned_at
        FROM rentals r JOIN items i ON i.id = r.item_id
        ORDER BY r.id DESC
    """).fetchall()
    conn.close()

    TYPE_LABELS = {"drone": "드론", "laptop": "노트북", "camera": "카메라", "etc": "기타"}

    def fmt(val):
        if not val:
            return "—"
        try:
            from datetime import datetime as dt
            d = dt.fromisoformat(str(val)[:10])
            return f"{d.year % 100:02d}년 {d.month:02d}월 {d.day:02d}일"
        except Exception:
            return val

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "대여 이력"

    # 헤더 스타일
    header_fill = PatternFill("solid", fgColor="1E293B")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    center = Alignment(horizontal="center", vertical="center")
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["No.", "물품명", "종류", "대여자", "대여일", "반납 예정일", "상태"]
    col_widths = [6, 16, 10, 12, 16, 16, 10]

    # 타이틀 행
    ws.merge_cells("A1:G1")
    title_cell = ws["A1"]
    title_cell.value = "부서 공유 물품 대여 이력"
    title_cell.font = Font(bold=True, size=14, color="1E293B")
    title_cell.alignment = center
    ws.row_dimensions[1].height = 32

    # 헤더 행
    for col, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=2, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = border
        ws.column_dimensions[get_column_letter(col)].width = w
    ws.row_dimensions[2].height = 22

    # 데이터 행
    alt_fill = PatternFill("solid", fgColor="F8FAFC")
    for idx, r in enumerate(rows, 1):
        row_num = idx + 2
        status = "반납완료" if r["returned_at"] else "대여 중"
        values = [
            idx,
            r["item_name"],
            TYPE_LABELS.get(r["item_type"], "기타"),
            r["borrower_name"],
            fmt(r["rented_at"]),
            fmt(r["due_date"]),
            status,
        ]
        fill = alt_fill if idx % 2 == 0 else None
        status_color = "27AE60" if r["returned_at"] else "E67E22"

        for col, val in enumerate(values, 1):
            cell = ws.cell(row=row_num, column=col, value=val)
            cell.alignment = center
            cell.border = border
            if fill:
                cell.fill = fill
            if col == 7:  # 상태 컬럼 색상
                cell.font = Font(bold=True, color=status_color)
        ws.row_dimensions[row_num].height = 20

    # 출력일 표기
    from datetime import date
    ws.cell(row=len(rows) + 4, column=1,
            value=f"출력일: {date.today().strftime('%Y년 %m월 %d일')}").font = Font(color="94A3B8", size=9)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"대여이력_{date.today().strftime('%Y%m%d')}.xlsx"
    return send_file(buf, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     as_attachment=True, download_name=filename)


@app.route("/qr")
def qr_page():
    base_url = request.host_url.rstrip("/")
    return render_template("qr.html", base_url=base_url)


@app.route("/qr/image")
def qr_image():
    import io, qrcode
    from flask import send_file
    base_url = request.host_url.rstrip("/")
    img = qrcode.make(base_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


if __name__ == "__main__":
    app.run(debug=True)
