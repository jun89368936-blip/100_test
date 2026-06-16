"""
물산업부문 명단 CSV에서 부서원 계정 일괄 생성

사용법:
  python seed_users.py [CSV경로]

- username  : 메일 주소의 @ 앞 부분 (소문자)
- 초기 비밀번호: 사번 (직원이 첫 로그인 후 관리자에게 변경 요청)
- display_name: 성명

이미 존재하는 username은 건너뜁니다.
"""

import csv
import io
import os
import sys

from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv()

from db import get_db, init_db  # noqa: E402

CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "명단_utf8.csv"
)

init_db()
conn = get_db()

with open(CSV_PATH, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    added = skipped = 0
    for row in reader:
        sabun = row.get("사번", "").strip()
        name = row.get("성명", "").strip()
        email = row.get("메일주소", "").strip().lower()
        if not sabun or not name or not email:
            continue

        username = email.split("@")[0]
        pw_hash = generate_password_hash(sabun)  # 초기 비밀번호 = 사번

        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            skipped += 1
            continue

        conn.execute(
            "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
            (username, pw_hash, name),
        )
        added += 1

conn.commit()
conn.close()
print(f"완료: {added}명 추가, {skipped}명 건너뜀")
print("초기 비밀번호 = 각자 사번")
