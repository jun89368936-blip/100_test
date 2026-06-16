from db import init_db, get_db

SEED_ITEMS = [
    ("드론 1호", "drone"),
    ("드론 2호", "drone"),
    ("드론 3호", "drone"),
    ("노트북 1호", "laptop"),
    ("노트북 2호", "laptop"),
]


def seed():
    init_db()
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    if count == 0:
        for name, item_type in SEED_ITEMS:
            conn.execute("INSERT INTO items (name, type) VALUES (?, ?)", (name, item_type))
        conn.commit()
        print(f"Inserted {len(SEED_ITEMS)} items.")
    else:
        print(f"Items already exist ({count} rows). Skipping seed.")
    conn.close()


if __name__ == "__main__":
    seed()
