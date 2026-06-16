# 부서 공유 물품 대여 관리 시스템 — 개발 정리

## 프로젝트 개요

부서 내 공유 물품(드론 3개, 노트북 2개)의 대여·반납을 관리하는 웹 플랫폼.

- **배포 URL:** https://equipment-rental-ru95.onrender.com
- **GitHub:** https://github.com/jun89368936-blip/100_test (경로: `equipment-rental/`)
- **개발 기간:** 2026년 6월

---

## 기술 스택

| 구분 | 기술 |
|---|---|
| 백엔드 | Python 3, Flask |
| DB (로컬) | SQLite |
| DB (클라우드) | PostgreSQL (Render 무료) |
| 프론트엔드 | HTML, CSS (커스텀), FullCalendar.js v6 |
| 알림 | Telegram Bot API |
| 엑셀 출력 | openpyxl |
| QR코드 | qrcode[pil] |
| 배포 | Render.com (Free tier) |
| WSGI | gunicorn |

---

## 파일 구조

```
equipment-rental/
├── app.py                  ← Flask 메인 앱 (라우트 전체)
├── db.py                   ← DB 추상화 레이어 (SQLite/PostgreSQL 자동 전환)
├── telegram_notify.py      ← 텔레그램 알림 함수
├── seed.py                 ← 초기 데이터 (드론3, 노트북2)
├── requirements.txt        ← 패키지 목록
├── render.yaml             ← Render 배포 설정
├── .gitignore              ← .env, rental.db 제외
├── qr_code.png             ← 접속 QR코드 이미지
├── static/
│   └── style.css           ← 전체 UI 스타일
└── templates/
    ├── index.html          ← 대여 현황 (메인)
    ├── calendar.html       ← 달력 보기
    ├── history.html        ← 대여 이력 + 엑셀 다운로드
    ├── admin_login.html    ← 관리자 PIN 로그인
    ├── qr.html             ← QR코드 페이지
    └── admin/
        ├── dashboard.html  ← 관리자 대시보드
        ├── items.html      ← 물품 관리
        └── rentals.html    ← 대여 관리
```

---

## DB 구조

### items 테이블
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | 물품 ID |
| name | TEXT | 물품명 (드론 1호 등) |
| type | TEXT | 종류 (drone / laptop / camera / etc) |

### rentals 테이블
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | 대여 ID |
| item_id | INTEGER FK | 물품 ID |
| borrower_name | TEXT | 대여자 이름 |
| rented_at | TEXT | 대여일 (YYYY-MM-DD) |
| due_date | TEXT | 반납 예정일 (YYYY-MM-DD) |
| returned_at | TEXT | 실제 반납일시 (NULL이면 대여 중) |

---

## 주요 라우트

### 공개 (누구나 접속 가능)
| URL | 메서드 | 설명 |
|---|---|---|
| `/` | GET | 대여 현황 메인 |
| `/rent/<id>` | POST | 물품 대여 |
| `/return/<id>` | POST | 물품 반납 |
| `/calendar` | GET | 달력 보기 |
| `/api/events` | GET | 달력 이벤트 데이터 (JSON) |
| `/history` | GET | 대여 이력 |
| `/history/export` | GET | 대여 이력 엑셀 다운로드 |
| `/qr` | GET | QR코드 페이지 |

### 관리자 전용 (PIN 인증 필요)
| URL | 메서드 | 설명 |
|---|---|---|
| `/admin/login` | GET/POST | PIN 로그인 |
| `/admin` | GET | 관리자 대시보드 |
| `/admin/items` | GET | 물품 목록 |
| `/admin/items/add` | POST | 물품 추가 |
| `/admin/items/delete/<id>` | POST | 물품 삭제 |
| `/admin/rentals` | GET | 대여 이력 관리 |
| `/admin/rentals/add` | POST | 대여 직접 등록 |
| `/admin/rentals/return/<id>` | POST | 강제 반납 처리 |
| `/admin/rentals/delete/<id>` | POST | 대여 기록 삭제 |

---

## 환경 변수 (.env / Render Environment)

| 키 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 (Render 자동 주입) |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 알림 수신 채팅 ID |
| `ADMIN_PIN` | 관리자 PIN 번호 |

---

## 핵심 설계 결정

### 1. SQLite / PostgreSQL 이중 모드
`DATABASE_URL` 환경 변수 존재 여부로 자동 전환. 로컬은 SQLite, Render는 PostgreSQL.
`db.py`의 `_Connection` 래퍼가 placeholder(`?` vs `%s`) 차이를 자동 변환.

### 2. 날짜 범위 기반 중복 체크
기존 유니크 인덱스 방식 대신 날짜 겹침 쿼리로 중복 판단.
반납예정일 당일 시작하는 새 대여는 허용 (strict overlap 체크).

```sql
SELECT COUNT(*) FROM rentals
WHERE item_id = ?
  AND returned_at IS NULL
  AND rented_at < ?      -- 기존 시작 < 새 종료
  AND (due_date IS NULL OR due_date > ?)  -- 기존 종료 > 새 시작
```

### 3. 관리자 인증
세션 기반 PIN 인증. `@admin_required` 데코레이터로 보호.
관리자 전용 UI는 별도 사이드바(보라색)로 일반 화면과 시각적으로 구분.

---

## 커밋 이력

| 커밋 | 내용 |
|---|---|
| `d6317bd` | 초기 하수도 공사비 산정 시스템 (이전 프로젝트) |
| `6348aa8` | equipment-rental 앱 초기 구축 + PostgreSQL 지원 |
| `4cea9e7` | 관리자 모드 전용 대시보드/물품/대여 관리 추가 |
| `a07b747` | 대여 방식 변경: 대여일 + 반납일 직접 선택 |
| `aba08a1` | 대여 이력 엑셀 다운로드 기능 추가 |
| `abaaeb0` | 반납예정일 당일 새 대여 허용 (날짜 겹침 체크) |

---

## 로컬 실행 방법

```bash
cd equipment-rental
pip install -r requirements.txt
python seed.py      # 초기 데이터 (최초 1회)
python app.py       # 개발 서버 실행
# → http://localhost:5000 접속
```

## Render 배포 후 초기화

Render 대시보드 → Shell 탭:
```bash
python seed.py
```
