# -*- coding: utf-8 -*-
"""renamer_core 단위 테스트 — 데이터 손실 경로 집중 검증.

실행: python -m pytest test_renamer_core.py -v
또는: python test_renamer_core.py   (pytest 없이도 동작)
"""
from __future__ import annotations

import os
import unicodedata

import renamer_core as rc


# ── 헬퍼 ────────────────────────────────────────────────────────────
def _touch(path: str, content: str = "x") -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _make(tmp_path, names):
    paths = []
    for n in names:
        p = os.path.join(str(tmp_path), n)
        _touch(p)
        paths.append(p)
    return paths


# ── 이름 생성 ───────────────────────────────────────────────────────
def test_prefix_preserves_extension(tmp_path):
    files = _make(tmp_path, ["a.txt", "b.txt"])
    rule = rc.Rule(prefix="도면_")
    rows = rc.compute_new_names(files, rule, rc.SORT_NAME)
    news = {os.path.basename(o): nn for o, nn, _ in rows}
    assert news["a.txt"] == "도면_a.txt"
    assert news["b.txt"] == "도면_b.txt"
    assert all(st == rc.OK for _, _, st in rows)


def test_numbering_padding_and_order(tmp_path):
    files = _make(tmp_path, ["b.txt", "a.txt", "c.txt"])
    rule = rc.Rule(numbering=rc.Numbering(enabled=True, position="prefix",
                                          start=1, step=1, padding=3, separator="_"))
    rows = rc.compute_new_names(files, rule, rc.SORT_NAME)  # a,b,c 순
    new_names = [nn for _, nn, _ in rows]
    assert new_names == ["001_a.txt", "002_b.txt", "003_c.txt"]


def test_suffix_before_extension(tmp_path):
    files = _make(tmp_path, ["report.pdf"])
    rule = rc.Rule(suffix="_최종")
    rows = rc.compute_new_names(files, rule)
    assert rows[0][1] == "report_최종.pdf"


# ── Phase 2: 찾기바꾸기 / 글자삭제 / 정렬 ────────────────────────────
def test_find_replace(tmp_path):
    files = _make(tmp_path, ["IMG_0001.jpg", "IMG_0002.jpg"])
    rule = rc.Rule(find="IMG_", replace="사진_")
    rows = rc.compute_new_names(files, rule, rc.SORT_NAME)
    news = sorted(nn for _, nn, _ in rows)
    assert news == ["사진_0001.jpg", "사진_0002.jpg"]


def test_find_replace_removes_substring(tmp_path):
    files = _make(tmp_path, ["draft_report.pdf"])
    rule = rc.Rule(find="draft_", replace="")
    rows = rc.compute_new_names(files, rule)
    assert rows[0][1] == "report.pdf"


def test_remove_front_and_back(tmp_path):
    files = _make(tmp_path, ["12_report_v3.txt"])
    rule = rc.Rule(remove_front=3, remove_back=3)  # '12_' 앞, '_v3' 뒤
    rows = rc.compute_new_names(files, rule)
    assert rows[0][1] == "report.txt"


def test_remove_all_chars_is_illegal(tmp_path):
    files = _make(tmp_path, ["ab.txt"])
    rule = rc.Rule(remove_back=10)  # stem 보다 많이 삭제 → 빈 이름
    rows = rc.compute_new_names(files, rule)
    assert rows[0][2] == rc.ILLEGAL


def test_operation_order(tmp_path):
    # 찾기바꾸기 → 앞삭제 → 순번/접두 순서
    files = _make(tmp_path, ["xx_name.txt"])
    rule = rc.Rule(find="name", replace="이름", remove_front=3, prefix="A_")
    rows = rc.compute_new_names(files, rule)
    # xx_name → xx_이름 → (앞3삭제) 이름 → (접두) A_이름
    assert rows[0][1] == "A_이름.txt"


def test_operation_order_with_back_delete(tmp_path):
    # 찾기바꾸기가 뒤삭제보다 먼저 적용됨을 검증(길이를 바꾸는 치환으로 순서 구분).
    # find 먼저: 'abcdef' → 'abcd'(ef 삭제) → 뒤1삭제 → 'abc'
    # (만약 뒤삭제 먼저였다면 'abcde' → find 'ef' 없음 → 'abcde' 로 달랐을 것)
    files = _make(tmp_path, ["abcdef.txt"])
    rule = rc.Rule(find="ef", replace="", remove_back=1)
    rows = rc.compute_new_names(files, rule)
    assert rows[0][1] == "abc.txt"


def test_size_sort(tmp_path):
    small = os.path.join(str(tmp_path), "small.bin")
    big = os.path.join(str(tmp_path), "big.bin")
    _touch(small, "x")            # 1바이트
    _touch(big, "x" * 500)        # 500바이트
    rule = rc.Rule(numbering=rc.Numbering(enabled=True, padding=2, separator="_"))
    rows = rc.compute_new_names([big, small], rule, rc.SORT_SIZE)  # 작은 것 먼저
    order = [os.path.basename(o) for o, _, _ in rows]
    assert order == ["small.bin", "big.bin"]
    assert rows[0][1].startswith("01_")  # 가장 작은 파일이 01


def test_natural_sort(tmp_path):
    files = _make(tmp_path, ["img10.png", "img2.png", "img1.png"])
    rule = rc.Rule(numbering=rc.Numbering(enabled=True, padding=2, separator="_"))
    rows = rc.compute_new_names(files, rule, rc.SORT_NAME_NATURAL)
    order = [os.path.basename(o) for o, _, _ in rows]
    assert order == ["img1.png", "img2.png", "img10.png"]  # 2 < 10


def test_plain_name_sort_differs_from_natural(tmp_path):
    files = _make(tmp_path, ["img10.png", "img2.png"])
    rows = rc.compute_new_names(files, rc.Rule(), rc.SORT_NAME)
    order = [os.path.basename(o) for o, _, _ in rows]
    assert order == ["img10.png", "img2.png"]  # 문자열 정렬: '1' < '2'


def test_reverse_sort(tmp_path):
    files = _make(tmp_path, ["a.txt", "b.txt", "c.txt"])
    rows = rc.compute_new_names(files, rc.Rule(), rc.SORT_NAME, reverse=True)
    order = [os.path.basename(o) for o, _, _ in rows]
    assert order == ["c.txt", "b.txt", "a.txt"]


# ── 충돌 / 검증 ─────────────────────────────────────────────────────
def test_collision_detected(tmp_path):
    # a.txt, b.txt 둘 다 접두어 없이 같은 이름이 되도록 → 강제 충돌
    files = _make(tmp_path, ["a.txt", "b.txt"])
    # prefix 로 둘 다 같은 결과를 만들 수는 없으니, 기존 파일과의 충돌로 검증
    _touch(os.path.join(str(tmp_path), "도면_a.txt"))  # 미리 존재
    rule = rc.Rule(prefix="도면_")
    rows = rc.compute_new_names(files, rule)
    by = {os.path.basename(o): st for o, _, st in rows}
    assert by["a.txt"] == rc.COLLISION   # 기존 도면_a.txt 와 충돌
    assert by["b.txt"] == rc.OK


def test_intra_batch_collision(tmp_path):
    # 두 원본이 같은 새 이름이 되는 경우(Phase 2 의 찾기-바꾸기 등에서 발생 가능).
    # Phase 1 규칙으로는 자연 발생하지 않으므로 충돌 검사 메커니즘을 직접 검증한다.
    fa = os.path.join(str(tmp_path), "a.txt")
    fb = os.path.join(str(tmp_path), "b.txt")
    _touch(fa)
    _touch(fb)
    statuses = rc._check_pairs([(fa, "same.txt"), (fb, "same.txt")])
    assert statuses[fa] == rc.COLLISION
    assert statuses[fb] == rc.COLLISION


def test_illegal_name(tmp_path):
    files = _make(tmp_path, ["a.txt"])
    rule = rc.Rule(prefix="x:y")  # ':' 금지문자
    rows = rc.compute_new_names(files, rule)
    assert rows[0][2] == rc.ILLEGAL


def test_too_long(tmp_path):
    files = _make(tmp_path, ["a.txt"])
    rule = rc.Rule(prefix="z" * 300)
    rows = rc.compute_new_names(files, rule)
    assert rows[0][2] == rc.TOO_LONG


def test_nfc_nfd_collision(tmp_path):
    # 한글 '가' 의 NFC vs NFD 표현은 시각적으로 동일하지만 바이트가 다름.
    # 디스크에 NFC 이름 파일이 있을 때, NFD 이름으로 바꾸려 하면 충돌로 잡아야 한다.
    nfc = unicodedata.normalize("NFC", "가나.txt")
    nfd = unicodedata.normalize("NFD", "가나.txt")
    assert nfc != nfd  # 바이트 표현이 다름을 전제
    src = os.path.join(str(tmp_path), "src.txt")
    _touch(src)
    _touch(os.path.join(str(tmp_path), nfc))  # 기존 NFC 파일
    # src.txt → (NFD 이름) 으로 바꾸면 기존 NFC 파일과 충돌해야 함
    statuses = rc._check_pairs([(src, nfd)])
    assert statuses[src] == rc.COLLISION


# ── 실제 변경 (2단계) ───────────────────────────────────────────────
def test_apply_simple(tmp_path):
    files = _make(tmp_path, ["a.txt"])
    mapping = [(files[0], os.path.join(str(tmp_path), "도면_a.txt"))]
    rc.apply_renames(mapping)
    assert not os.path.exists(files[0])
    assert os.path.exists(os.path.join(str(tmp_path), "도면_a.txt"))


def test_apply_swap(tmp_path):
    fa = os.path.join(str(tmp_path), "a.txt")
    fb = os.path.join(str(tmp_path), "b.txt")
    _touch(fa, "AAA")
    _touch(fb, "BBB")
    mapping = [(fa, fb), (fb, fa)]   # a↔b 교환
    rc.apply_renames(mapping)
    with open(fa, encoding="utf-8") as f:
        assert f.read() == "BBB"
    with open(fb, encoding="utf-8") as f:
        assert f.read() == "AAA"


def test_apply_case_only(tmp_path):
    src = os.path.join(str(tmp_path), "Photo.JPG")
    _touch(src, "img")
    dst = os.path.join(str(tmp_path), "photo.JPG")
    rc.apply_renames([(src, dst)])
    # 대소문자만 다른 변경도 2단계로 성공
    assert os.path.exists(dst)
    with open(dst, encoding="utf-8") as f:
        assert f.read() == "img"


def test_partial_failure_rollback(tmp_path):
    fa = os.path.join(str(tmp_path), "a.txt")
    fb = os.path.join(str(tmp_path), "b.txt")
    _touch(fa, "AAA")
    _touch(fb, "BBB")
    mapping = [(fa, os.path.join(str(tmp_path), "x.txt")),
               (fb, os.path.join(str(tmp_path), "y.txt"))]

    calls = {"n": 0}
    real = os.rename

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 3:   # 2단계 첫 최종 이름 변경에서 실패 주입
            raise PermissionError("simulated lock")
        real(src, dst)

    try:
        rc.apply_renames(mapping, rename_fn=flaky)
        assert False, "예외가 발생했어야 함"
    except PermissionError:
        pass

    # 롤백되어 원본이 그대로 남아야 함
    assert os.path.exists(fa) and os.path.exists(fb)
    with open(fa, encoding="utf-8") as f:
        assert f.read() == "AAA"
    with open(fb, encoding="utf-8") as f:
        assert f.read() == "BBB"
    assert not os.path.exists(os.path.join(str(tmp_path), "x.txt"))
    assert not os.path.exists(os.path.join(str(tmp_path), "y.txt"))


def test_rollback_failure_reports_stranded(tmp_path):
    # 2단계 변경 중 실패 + 롤백 자체도 실패 → 조용히 넘어가지 않고 RuntimeError 로
    # 어떤 파일이 복구되지 못했는지 알려야 한다.
    fa = os.path.join(str(tmp_path), "a.txt")
    fb = os.path.join(str(tmp_path), "b.txt")
    _touch(fa, "AAA")
    _touch(fb, "BBB")
    mapping = [(fa, os.path.join(str(tmp_path), "x.txt")),
               (fb, os.path.join(str(tmp_path), "y.txt"))]
    real = os.rename
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        # 4번째 호출(2단계 두 번째 최종변경)에서 실패, 이후 모든 롤백도 실패
        if calls["n"] >= 4:
            raise PermissionError("simulated")
        real(src, dst)

    try:
        rc.apply_renames(mapping, rename_fn=flaky)
        assert False, "RuntimeError 가 발생했어야 함"
    except RuntimeError as e:
        assert "되돌리지 못했습니다" in str(e)
    except PermissionError:
        assert False, "롤백 실패는 RuntimeError 로 보고되어야 함"


def test_validate_undo_external_collision(tmp_path):
    fa = os.path.join(str(tmp_path), "a.txt")
    _touch(fa)
    new = os.path.join(str(tmp_path), "도면_a.txt")
    rc.apply_renames([(fa, new)])
    forward = [(fa, new)]
    # 외부에서 원래 이름과 충돌하는 파일을 다시 생성
    _touch(fa)
    ok, msg = rc.validate_undo(forward)
    assert ok is False
    assert msg


def test_validate_undo_ok(tmp_path):
    fa = os.path.join(str(tmp_path), "a.txt")
    _touch(fa)
    new = os.path.join(str(tmp_path), "도면_a.txt")
    rc.apply_renames([(fa, new)])
    ok, msg = rc.validate_undo([(fa, new)])
    assert ok is True, msg


# ── pytest 없이도 실행 가능하게 ─────────────────────────────────────
if __name__ == "__main__":
    import tempfile
    import traceback
    from pathlib import Path

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        with tempfile.TemporaryDirectory() as d:
            try:
                t(Path(d))
                print(f"PASS {t.__name__}")
                passed += 1
            except Exception:
                print(f"FAIL {t.__name__}")
                traceback.print_exc()
                failed += 1
    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)
