# -*- coding: utf-8 -*-
"""아이콘 생성기 — icon.ico 를 만든다. (한 번 실행해 두면 됨)

실행: python make_icon.py
"""
from PIL import Image, ImageDraw

SIZE = 256
BG = (54, 110, 150)        # 차분한 청색
BG2 = (44, 92, 128)        # 살짝 진한 음영
PAPER = (248, 250, 252)
LINE = (140, 160, 178)
ARROW = (240, 176, 64)     # 따뜻한 강조색(주황)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def render(size: int) -> Image.Image:
    s = SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 배경 라운드 사각형 (간단한 상하 음영)
    rounded(d, (8, 8, s - 8, s - 8), 48, BG2)
    rounded(d, (8, 8, s - 8, s - 16), 48, BG)

    # 문서(종이) 모양
    px0, py0, px1, py1 = 64, 50, 192, 206
    rounded(d, (px0, py0, px1, py1), 14, PAPER)
    # 문서 텍스트 줄
    for i, y in enumerate(range(80, 150, 22)):
        w = 96 if i % 2 == 0 else 70
        d.rounded_rectangle((px0 + 18, y, px0 + 18 + w, y + 9), radius=4, fill=LINE)

    # 이름 변경을 뜻하는 곡선 화살표
    d.arc((96, 150, 196, 226), start=20, end=300, fill=ARROW, width=14)
    # 화살촉
    d.polygon([(186, 150), (210, 168), (176, 178)], fill=ARROW)

    if size != s:
        img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    sizes = [16, 24, 32, 48, 64, 128, 256]
    base = render(SIZE)
    imgs = [base.resize((n, n), Image.LANCZOS) for n in sizes]
    imgs[0].save("icon.ico", format="ICO",
                 sizes=[(n, n) for n in sizes], append_images=imgs[1:])
    base.save("icon.png")  # 미리보기용
    print("icon.ico / icon.png 생성 완료")


if __name__ == "__main__":
    main()
