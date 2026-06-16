import os
import requests
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


def send_message(text: str) -> None:
    if not BOT_TOKEN or not CHAT_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": CHAT_ID, "text": text},
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
