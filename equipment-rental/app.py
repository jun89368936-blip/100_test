from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, session
from datetime import datetime, date
from db import init_db, get_db, INTEGRITY_ERROR
from telegram_notify import notify_rent, notify_return
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)
app.secret_key = "rental-secret-key-change-in-prod"
ADMIN_PIN = os.getenv("ADMIN_PIN", "1234")


def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return redirect(url_for("admin_login"))
        return f(*args, **kwargs)
    return decorated

ITEM_COLORS = ["#3788d8", "#e67e22", "#27ae60", "#8e44ad", "#c0392b"]


@app.before_request
def startup():
    init_db()


@app.route("/")
def index():
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
    """).fetchall()
    conn.close()
    return render_template("index.html", items=items, today=date.today().isoformat())


@app.route("/calendar")
def calendar_view():
    conn = get_db()
    items = conn.execute("SELECT * FROM items ORDER BY id").fetchall()
    conn.close()
    return render_template("calendar.html", items=items, colors=ITEM_COLORS)


@app.route("/api/events")
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
def rent(item_id):
    borrower_name = request.form.get("borrower_name", "").strip()
    due_date = request.form.get("due_date", "").strip()
    if not borrower_name:
        flash("이름을 입력해주세요.")
        return redirect(url_for("index"))

    conn = get_db()
    try:
        rented_at = datetime.now().isoformat(timespec="seconds")
        conn.execute(
            "INSERT INTO rentals (item_id, borrower_name, rented_at, due_date) VALUES (?, ?, ?, ?)",
            (item_id, borrower_name, rented_at, due_date or None),
        )
        conn.commit()
        item = conn.execute("SELECT name FROM items WHERE id = ?", (item_id,)).fetchone()
        flash("대여가 완료되었습니다.")
        notify_rent(item["name"], borrower_name, rented_at)
    except INTEGRITY_ERROR:
        flash("이미 대여 중인 물품입니다.")
    finally:
        conn.close()

    return redirect(url_for("index"))


@app.route("/return/<int:item_id>", methods=["POST"])
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
            return redirect(url_for("manage"))
        flash("PIN이 올바르지 않습니다.")
    return render_template("admin_login.html")


@app.route("/admin/logout")
def admin_logout():
    session.pop("is_admin", None)
    return redirect(url_for("index"))


@app.route("/manage")
@admin_required
def manage():
    conn = get_db()
    items = conn.execute("""
        SELECT i.*,
               (SELECT COUNT(*) FROM rentals r WHERE r.item_id = i.id AND r.returned_at IS NULL) AS is_rented
        FROM items i ORDER BY i.id
    """).fetchall()
    conn.close()
    return render_template("manage.html", items=items)


@app.route("/manage/add", methods=["POST"])
@admin_required
def add_item():
    name = request.form.get("name", "").strip()
    item_type = request.form.get("type", "").strip()
    if not name or not item_type:
        flash("물품명과 종류를 모두 입력해주세요.")
        return redirect(url_for("manage"))
    conn = get_db()
    conn.execute("INSERT INTO items (name, type) VALUES (?, ?)", (name, item_type))
    conn.commit()
    conn.close()
    flash(f"'{name}' 물품이 추가되었습니다.")
    return redirect(url_for("manage"))


@app.route("/manage/delete/<int:item_id>", methods=["POST"])
@admin_required
def delete_item(item_id):
    conn = get_db()
    is_rented = conn.execute(
        "SELECT COUNT(*) FROM rentals WHERE item_id = ? AND returned_at IS NULL", (item_id,)
    ).fetchone()[0]
    if is_rented:
        flash("현재 대여 중인 물품은 삭제할 수 없습니다.")
        conn.close()
        return redirect(url_for("manage"))
    item = conn.execute("SELECT name FROM items WHERE id = ?", (item_id,)).fetchone()
    conn.execute("DELETE FROM rentals WHERE item_id = ?", (item_id,))
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    flash(f"'{item['name']}' 물품이 삭제되었습니다.")
    return redirect(url_for("manage"))


@app.route("/history")
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
