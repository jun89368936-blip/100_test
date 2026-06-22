"""사용설명서.md → 사용설명서.pdf 변환 스크립트"""
import re
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── 한글 폰트 등록 ──────────────────────────────────────────────
FONT_PATHS = [
    r"C:\Windows\Fonts\malgun.ttf",
    r"C:\Windows\Fonts\malgunbd.ttf",
]
pdfmetrics.registerFont(TTFont("Malgun", FONT_PATHS[0]))
if os.path.exists(FONT_PATHS[1]):
    pdfmetrics.registerFont(TTFont("MalgunBold", FONT_PATHS[1]))
else:
    pdfmetrics.registerFont(TTFont("MalgunBold", FONT_PATHS[0]))

FONT       = "Malgun"
FONT_BOLD  = "MalgunBold"

# ── 스타일 정의 ──────────────────────────────────────────────────
W, H = A4
MARGIN = 2.2 * cm

def make_styles():
    s = getSampleStyleSheet()
    base = dict(fontName=FONT, fontSize=10, leading=16, spaceAfter=4)

    styles = {
        "h1": ParagraphStyle("h1", fontName=FONT_BOLD, fontSize=18,
                             leading=26, spaceAfter=10, spaceBefore=18,
                             textColor=colors.HexColor("#1E293B")),
        "h2": ParagraphStyle("h2", fontName=FONT_BOLD, fontSize=14,
                             leading=20, spaceAfter=6, spaceBefore=14,
                             textColor=colors.HexColor("#1E293B"),
                             borderPadding=(0,0,4,0)),
        "h3": ParagraphStyle("h3", fontName=FONT_BOLD, fontSize=12,
                             leading=18, spaceAfter=4, spaceBefore=10,
                             textColor=colors.HexColor("#3B4A6B")),
        "h4": ParagraphStyle("h4", fontName=FONT_BOLD, fontSize=11,
                             leading=16, spaceAfter=3, spaceBefore=8,
                             textColor=colors.HexColor("#475569")),
        "body": ParagraphStyle("body", **base),
        "bullet": ParagraphStyle("bullet", fontName=FONT, fontSize=10,
                                 leading=16, spaceAfter=2, leftIndent=14,
                                 bulletIndent=4),
        "num":   ParagraphStyle("num", fontName=FONT, fontSize=10,
                                leading=16, spaceAfter=2, leftIndent=14,
                                bulletIndent=4),
        "code":  ParagraphStyle("code", fontName=FONT, fontSize=9,
                                leading=13, spaceAfter=4, leftIndent=12,
                                backColor=colors.HexColor("#F1F5F9"),
                                textColor=colors.HexColor("#334155")),
        "quote": ParagraphStyle("quote", fontName=FONT, fontSize=9.5,
                                leading=14, spaceAfter=4, leftIndent=14,
                                textColor=colors.HexColor("#64748B"),
                                borderColor=colors.HexColor("#94A3B8"),
                                borderWidth=0, borderPadding=0),
        "toc":   ParagraphStyle("toc", fontName=FONT, fontSize=10,
                                leading=18, leftIndent=14),
    }
    return styles

def escape(text):
    """ReportLab XML 이스케이프"""
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))

def inline_fmt(text, bold_font=FONT_BOLD):
    """**bold**, `code` 인라인 마크업 변환"""
    text = escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", rf'<b>\1</b>', text)
    text = re.sub(r"`(.+?)`",
                  r'<font name="Malgun" color="#0F4C81" backColor="#E8F0FE">\1</font>',
                  text)
    return text

def parse_md(md_text):
    """마크다운 → (type, content) 토큰 목록"""
    lines = md_text.split("\n")
    tokens = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # 코드블록
        if line.strip().startswith("```"):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            tokens.append(("code", "\n".join(code_lines)))
            i += 1
            continue

        # 헤더
        m = re.match(r"^(#{1,4})\s+(.+)", line)
        if m:
            level = len(m.group(1))
            tokens.append((f"h{level}", m.group(2)))
            i += 1
            continue

        # 구분선
        if re.match(r"^---+$", line.strip()):
            tokens.append(("hr", ""))
            i += 1
            continue

        # 인용 (> ...)
        if line.startswith("> "):
            tokens.append(("quote", line[2:]))
            i += 1
            continue

        # 테이블
        if "|" in line and i + 1 < len(lines) and re.match(r"^\|[-| :]+\|", lines[i+1].strip()):
            table_lines = []
            while i < len(lines) and "|" in lines[i]:
                table_lines.append(lines[i])
                i += 1
            tokens.append(("table", table_lines))
            continue

        # 불릿
        m = re.match(r"^[-*]\s+(.+)", line)
        if m:
            tokens.append(("bullet", m.group(1)))
            i += 1
            continue

        # 번호 목록
        m = re.match(r"^\d+\.\s+(.+)", line)
        if m:
            tokens.append(("num", m.group(1)))
            i += 1
            continue

        # 빈 줄
        if not line.strip():
            tokens.append(("blank", ""))
            i += 1
            continue

        # 일반 텍스트
        tokens.append(("body", line))
        i += 1

    return tokens

def build_table(lines, styles):
    """마크다운 표 → ReportLab Table"""
    rows = []
    for line in lines:
        if re.match(r"^\|[-| :]+\|$", line.strip()):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)

    if not rows:
        return None

    col_count = len(rows[0])
    avail_w = W - 2 * MARGIN
    col_w = avail_w / col_count

    table_data = []
    for ri, row in enumerate(rows):
        cell_para = []
        for ci, cell in enumerate(row):
            st = styles["body"] if ri > 0 else ParagraphStyle(
                "th", fontName=FONT_BOLD, fontSize=10, leading=14,
                textColor=colors.white)
            cell_para.append(Paragraph(inline_fmt(cell), st))
        table_data.append(cell_para)

    t = Table(table_data, colWidths=[col_w] * col_count, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("ALIGN",      (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME",   (0, 0), (-1, -1), FONT),
        ("FONTSIZE",   (0, 0), (-1, -1), 9.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.HexColor("#F8FAFC"), colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
    ]))
    return t

def md_to_flowables(md_text, styles):
    tokens = parse_md(md_text)
    story = []
    prev_blank = False

    for ttype, content in tokens:

        if ttype == "blank":
            if not prev_blank:
                story.append(Spacer(1, 4))
            prev_blank = True
            continue
        prev_blank = False

        if ttype == "h1":
            story.append(Spacer(1, 6))
            story.append(Paragraph(escape(content), styles["h1"]))
            story.append(HRFlowable(width="100%", thickness=2,
                                    color=colors.HexColor("#1E293B"),
                                    spaceAfter=6))

        elif ttype == "h2":
            story.append(Spacer(1, 4))
            story.append(Paragraph(escape(content), styles["h2"]))
            story.append(HRFlowable(width="100%", thickness=0.8,
                                    color=colors.HexColor("#94A3B8"),
                                    spaceAfter=4))

        elif ttype == "h3":
            story.append(Paragraph(escape(content), styles["h3"]))

        elif ttype == "h4":
            story.append(Paragraph(escape(content), styles["h4"]))

        elif ttype == "hr":
            story.append(Spacer(1, 6))
            story.append(HRFlowable(width="100%", thickness=0.5,
                                    color=colors.HexColor("#CBD5E1")))
            story.append(Spacer(1, 6))

        elif ttype == "body":
            # 목차 링크 행은 스킵
            if content.startswith("1.") or re.match(r"^\d+\.", content):
                story.append(Paragraph(inline_fmt(content), styles["num"]))
            else:
                story.append(Paragraph(inline_fmt(content), styles["body"]))

        elif ttype == "bullet":
            story.append(Paragraph(
                f'<bullet>&bull;</bullet>{inline_fmt(content)}',
                styles["bullet"]))

        elif ttype == "num":
            story.append(Paragraph(inline_fmt(content), styles["body"]))

        elif ttype == "code":
            lines = content.split("\n") or [""]
            for cl in lines:
                story.append(Paragraph(
                    f'<font name="Malgun">{escape(cl) or " "}</font>',
                    styles["code"]))

        elif ttype == "quote":
            story.append(Paragraph(
                f'<font color="#64748B">▏ {inline_fmt(content)}</font>',
                styles["quote"]))

        elif ttype == "table":
            tbl = build_table(content, styles)
            if tbl:
                story.append(Spacer(1, 6))
                story.append(tbl)
                story.append(Spacer(1, 6))

    return story

def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor("#94A3B8"))
    canvas.drawCentredString(W / 2, 1.2 * cm,
                             f"— {doc.page} —")
    canvas.restoreState()

def convert(md_path, pdf_path):
    with open(md_path, encoding="utf-8") as f:
        md_text = f.read()

    styles = make_styles()

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="부서 공유 물품 대여 시스템 — 사용설명서",
        author="물산업부문",
    )

    story = md_to_flowables(md_text, styles)
    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"PDF 생성 완료: {pdf_path}")

if __name__ == "__main__":
    base = os.path.dirname(__file__)
    convert(
        os.path.join(base, "사용설명서.md"),
        os.path.join(base, "사용설명서.pdf"),
    )
