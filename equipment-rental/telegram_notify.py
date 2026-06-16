import os
import requests
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
# 쉼표로 구분해서 여러 명 지정 가능
# 예) TELEGRAM_CHAT_ID=111111,222222,333333
_raw = os.getenv("TELEGRAM_CHAT_ID", "")
CHAT_IDS = [cid.strip() for cid in _raw.split(",") if cid.strip()]


def send_message(text: str) -> None:
    if not BOT_TOKEN or not CHAT_IDS:
        return
    for chat_id in CHAT_IDS:
        try:
            requests.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": text},
                timeout=5,
            )
        except Exception:
            pass


def notify_rent(item_name: str, borrower: str, rented_at: str) -> None:
    send_message(
        f"📦 대여 알림\n"
        f"물품: {item_name}\n"
        f"대여자: {borrower}\n"
        f"시각: {rented_at}"
    )


def notify_return(item_name: str, borrower: str, returned_at: str) -> None:
    send_message(
        f"✅ 반납 알림\n"
        f"물품: {item_name}\n"
        f"반납자: {borrower}\n"
        f"시각: {returned_at}"
    )
