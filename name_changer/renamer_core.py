# -*- coding: utf-8 -*-
"""일괄 파일명 변경기 — 이름 변경 엔진 (renamer_core)

tkinter 의존 없는 순수 표준 라이브러리 모듈. 모든 파일 변경(실행/되돌리기)은
이 모듈의 가드된 2단계 함수를 통해서만 수행된다. UI(main.py)와 분리되어
단위 테스트가 가능하다.
"""
from __future__ import annotations

import os
import re
import uuid
import unicodedata
from dataclasses import dataclass, field
from typing import Callable, Iterable

# ── 상수 ────────────────────────────────────────────────────────────
MAX_PATH = 260
ILLEGAL_CHARS = set('\\/:*?"<>|')
_RESERVED_STEMS = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)

# 상태 값
OK = "ok"
UNCHANGED = "unchanged"
COLLISION = "collision"
ILLEGAL = "illegal-name"
TOO_LONG = "too-long"

# 정렬 방식
SORT_NAME = "name"
SORT_NAME_NATURAL = "name-natural"   # 숫자 인식 정렬 (2 < 10)
SORT_MTIME = "mtime"
SORT_SIZE = "size"
SORT_AS_LISTED = "as-listed"


# ── 규칙 정의 ───────────────────────────────────────────────────────
@dataclass
class Numbering:
    enabled: bool = False
    position: str = "prefix"   # "prefix" | "suffix"
    start: int = 1
    step: int = 1
    padding: int = 1           # 0 채움 자릿수 (예: 3 → 001)
    separator: str = "_"


@dataclass
class Rule:
    prefix: str = ""
    suffix: str = ""
    find: str = ""              # 찾을 문자열(stem 대상)
    replace: str = ""          # 바꿀 문자열
    remove_front: int = 0      # 앞에서 삭제할 글자 수
    remove_back: int = 0       # 뒤에서 삭제할 글자 수
    numbering: Numbering = field(default_factory=Numbering)


# ── 유틸 ────────────────────────────────────────────────────────────
def _norm(name: str) -> str:
    """대소문자(NTFS)·유니코드 정규화(NFC/NFD)를 통일해 비교용 키 생성."""
    return unicodedata.normalize("NFC", name).casefold()


def split_stem_ext(filename: str) -> tuple[str, str]:
    """파일명을 (이름, 확장자) 로 분리. 확장자는 점(.) 포함.

    숨김 파일('.gitignore' 등)은 확장자 없는 이름으로 취급한다.
    """
    base = os.path.basename(filename)
    root, ext = os.path.splitext(base)
    if root == "" and ext:          # ".gitignore" → ('.gitignore', '')
        return ext, ""
    return root, ext


def make_new_name(stem: str, ext: str, rule: Rule, seq_index: int) -> str:
    """규칙과 순번 인덱스(0부터)로 새 파일명을 만든다. 확장자는 보존.

    적용 순서: 찾기·바꾸기 → 앞 글자 삭제 → 뒤 글자 삭제 → 순번/접두·접미.
    """
    new_stem = stem

    # 1) 찾기·바꾸기
    if rule.find:
        new_stem = new_stem.replace(rule.find, rule.replace)
    # 2) 앞에서 N글자 삭제
    if rule.remove_front > 0:
        new_stem = new_stem[rule.remove_front:]
    # 3) 뒤에서 N글자 삭제
    if rule.remove_back > 0:
        new_stem = new_stem[:-rule.remove_back] if rule.remove_back < len(new_stem) else ""

    # 4) 순번 + 접두/접미
    num = ""
    sep = ""
    if rule.numbering.enabled:
        n = rule.numbering.start + seq_index * rule.numbering.step
        num = str(n).zfill(rule.numbering.padding)
        sep = rule.numbering.separator

    if rule.numbering.enabled:
        if rule.numbering.position == "prefix":
            new_stem = f"{num}{sep}{new_stem}"
        else:  # suffix
            new_stem = f"{new_stem}{sep}{num}"

    new_stem = f"{rule.prefix}{new_stem}{rule.suffix}"
    return f"{new_stem}{ext}"


def _stem_is_illegal(new_filename: str) -> bool:
    # new_filename 은 순수 파일명 문자열. 경로 함수(basename)를 거치면 ':' 등이
    # 드라이브로 오해되어 변형되므로 splitext 만 직접 사용한다.
    if any(c in ILLEGAL_CHARS for c in new_filename):
        return True
    root, _ext = os.path.splitext(new_filename)
    if root.upper() in _RESERVED_STEMS:
        return True
    if root.strip() == "":          # 빈 이름 방지
        return True
    return False


def _check_pairs(pairs: list[tuple[str, str]]) -> dict[str, str]:
    """(old_abs, new_name) 목록의 각 항목 상태를 계산.

    new_name 은 경로가 아닌 '파일명 문자열'이어야 한다(예: 'x:y.txt').
    경로로 결합하면 Windows 가 ':' 등을 드라이브로 오해해 이름이 변형되므로,
    이름 검증은 원본 문자열에 대해 직접 수행한다.
    충돌 검사는 디렉터리별(per-directory)로 수행한다. 반환: old_abs -> status.
    """
    result: dict[str, str] = {}
    # 디렉터리별 그룹
    by_dir: dict[str, list[tuple[str, str]]] = {}
    for old, new in pairs:
        by_dir.setdefault(os.path.dirname(old), []).append((old, new))

    for d, group in by_dir.items():
        batch_old_norms = {_norm(os.path.basename(o)) for o, _ in group}
        # 디스크에 이미 있으나 이번 배치에서 변경되지 않는(이름이 비는 게 아닌) 파일
        existing_blocking: set[str] = set()
        try:
            for entry in os.listdir(d):
                en = _norm(entry)
                if en not in batch_old_norms:
                    existing_blocking.add(en)
        except OSError:
            pass
        # 배치 내 목표 이름 빈도
        target_counts: dict[str, int] = {}
        for _o, n in group:
            target_counts[_norm(n)] = target_counts.get(_norm(n), 0) + 1

        for old, new_base in group:
            old_base = os.path.basename(old)
            nn = _norm(new_base)

            if new_base == old_base:
                result[old] = UNCHANGED
                continue
            if _stem_is_illegal(new_base):
                result[old] = ILLEGAL
                continue
            if len(d) + 1 + len(new_base) > MAX_PATH:
                result[old] = TOO_LONG
                continue
            if target_counts.get(nn, 0) > 1:
                result[old] = COLLISION
                continue
            if nn in existing_blocking:
                result[old] = COLLISION
                continue
            result[old] = OK
    return result


# ── 미리보기 계산 ───────────────────────────────────────────────────
def _natural_key(name: str):
    """자연 정렬 키: 연속 숫자는 정수로 비교('img2' < 'img10')."""
    parts = re.split(r"(\d+)", _norm(name))
    return [int(p) if p.isdigit() else p for p in parts]


def compute_new_names(
    files: Iterable[str],
    rule: Rule,
    sort_order: str = SORT_AS_LISTED,
    reverse: bool = False,
) -> list[tuple[str, str, str]]:
    """파일 목록에 규칙을 적용해 [(원본경로, 새파일명, 상태)] 반환.

    files: 절대경로 목록.  순번은 정렬 순서대로 0,1,2... 부여.
    reverse: 정렬을 내림차순으로(추가순에는 역순 적용).
    상태: ok / unchanged / collision / illegal-name / too-long
    """
    files = list(files)

    def _stat(p: str, fn) -> float:
        try:
            return fn(p)
        except OSError:
            return 0.0

    if sort_order == SORT_NAME:
        ordered = sorted(files, key=lambda p: _norm(os.path.basename(p)))
    elif sort_order == SORT_NAME_NATURAL:
        ordered = sorted(files, key=lambda p: _natural_key(os.path.basename(p)))
    elif sort_order == SORT_MTIME:
        ordered = sorted(files, key=lambda p: _stat(p, os.path.getmtime))
    elif sort_order == SORT_SIZE:
        ordered = sorted(files, key=lambda p: _stat(p, os.path.getsize))
    else:  # as-listed
        ordered = list(files)

    if reverse:
        ordered = list(reversed(ordered))

    pairs: list[tuple[str, str]] = []
    new_name_by_old: dict[str, str] = {}
    degenerate: set[str] = set()   # 확장자만 남고 이름이 비어버린 경우
    for i, path in enumerate(ordered):
        stem, ext = split_stem_ext(path)
        new_name = make_new_name(stem, ext, rule, i)
        # 원본 확장자를 제거한 '이름 부분'이 비면(예: 'ab.txt'→'.txt') 잘못된 결과
        if ext and new_name.endswith(ext):
            name_part = new_name[: -len(ext)]
        else:
            name_part = new_name
        if name_part == "":
            degenerate.add(path)
        pairs.append((path, new_name))
        new_name_by_old[path] = new_name

    statuses = _check_pairs(pairs)
    for p in degenerate:
        statuses[p] = ILLEGAL

    # 원래 입력 순서가 아닌 정렬 순서대로 결과 반환 (미리보기 표와 일치)
    return [(p, new_name_by_old[p], statuses[p]) for p in ordered]


def has_blocking(rows: list[tuple[str, str, str]]) -> bool:
    """차단 상태(collision/illegal/too-long)가 하나라도 있으면 True."""
    return any(st in (COLLISION, ILLEGAL, TOO_LONG) for _, _, st in rows)


# ── 실제 변경 (2단계, 전부-아니면-전무) ─────────────────────────────
def _unique_temp(directory: str, stem: str) -> str:
    for _ in range(20):
        cand = os.path.join(directory, f"{stem}.{uuid.uuid4().hex}.tmp")
        try:
            if not os.path.exists(cand):
                return cand
        except OSError:
            continue
    raise RuntimeError(f"임시 파일 이름을 만들 수 없습니다: {directory}")


def apply_renames(
    mapping: list[tuple[str, str]],
    rename_fn: Callable[[str, str], None] = os.rename,
) -> None:
    """(원본경로, 대상경로) 목록을 2단계로 변경한다.

    1단계: 모두 임의 임시이름으로 → 2단계: 임시이름을 최종이름으로.
    배치 내 교환(a↔b)이나 대소문자 변경을 안전하게 처리한다.
    전부-아니면-전무: 도중 실패 시 완료분을 모두 되돌리고 예외를 다시 던진다.

    rename_fn 은 테스트에서 실패를 주입하기 위해 교체 가능하다.
    """
    journal: list[tuple[str, str]] = []   # 수행한 (src, dst)
    temps: list[tuple[str, str]] = []     # (temp, final)
    try:
        for old, new in mapping:
            d = os.path.dirname(old)
            stem = os.path.basename(old)
            temp = _unique_temp(d, stem)
            rename_fn(old, temp)
            journal.append((old, temp))
            temps.append((temp, new))
        for temp, new in temps:
            rename_fn(temp, new)
            journal.append((temp, new))
    except Exception as orig:
        # 역순으로 롤백. 롤백 자체가 실패하면 파일이 .tmp 상태로 남을 수 있으므로
        # 조용히 삼키지 않고 어떤 파일이 복구되지 못했는지 알린다.
        stranded: list[str] = []
        for src, dst in reversed(journal):
            try:
                rename_fn(dst, src)
            except Exception:
                stranded.append(dst)
        if stranded:
            raise RuntimeError(
                "변경 중 오류가 발생했고 일부 파일을 원래대로 되돌리지 못했습니다. "
                "다음 파일을 직접 확인하세요:\n" + "\n".join(stranded)
            ) from orig
        raise


# ── 되돌리기 검증 ───────────────────────────────────────────────────
def validate_undo(forward_mapping: list[tuple[str, str]]) -> tuple[bool, str]:
    """직전 실행 매핑(old,new)을 되돌리기 전 안전 검증.

    되돌리기는 new→old 방향. 각 new 가 존재하고, old 목표가 충돌하지 않아야
    한다. 하나라도 문제면 (False, 메시지) 반환 → 호출측은 변경하지 않는다.
    """
    # 되돌리기는 new(현재 디스크) → old 방향. _check_pairs 는 (현재경로, 목표파일명).
    reverse = [(new, os.path.basename(old)) for old, new in forward_mapping]
    for new, _old in reverse:
        if not os.path.exists(new):
            return False, f"되돌릴 파일을 찾을 수 없습니다: {os.path.basename(new)}"
    statuses = _check_pairs(reverse)
    for new, old_name in reverse:
        st = statuses.get(new)
        if st in (COLLISION, ILLEGAL, TOO_LONG):
            return False, f"되돌리기 충돌: {old_name} ({st})"
    return True, ""
