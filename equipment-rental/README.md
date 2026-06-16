# 부서 공유 물품 대여/반납 시스템

## 설치 및 실행

```bash
# 1. 패키지 설치
pip install flask python-dotenv requests

# 2. 초기 데이터 등록 (최초 1회)
python seed.py

# 3. 서버 실행
python app.py
```

브라우저에서 `http://127.0.0.1:5000` 접속

## 텔레그램 알림 설정

`.env` 파일에 봇 토큰과 채팅 ID 설정:
```
TELEGRAM_BOT_TOKEN=여기에_봇_토큰
TELEGRAM_CHAT_ID=여기에_채팅_ID
```

## 파일 구조

```
equipment-rental/
├── app.py               # Flask 서버
├── db.py                # DB 초기화/연결
├── seed.py              # 초기 물품 5개 등록
├── telegram_notify.py   # 텔레그램 알림
├── rental.db            # SQLite DB (자동 생성)
├── .env                 # 텔레그램 설정
├── requirements.txt
├── templates/
│   ├── index.html       # 물품 목록
│   └── history.html     # 대여 이력
└── static/
    └── style.css
```

## 물품 목록

- 드론 1호 / 드론 2호 / 드론 3호
- 노트북 1호 / 노트북 2호
