# -*- coding: utf-8 -*-
"""일괄 파일명 변경기 — tkinter GUI

폴더 안 여러 파일의 이름 앞/뒤에 문구나 순번을 한 번에 추가한다.
미리보기로 확인 후 실행하며, 충돌/금지문자/경로길이 검사와 되돌리기를 지원한다.
"""
from __future__ import annotations

import os
import sys
import json
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

import renamer_core as rc


def resource_path(name: str) -> str:
    """번들(frozen) 실행 시 리소스 경로를 해석한다. 개발 시엔 스크립트 폴더."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def settings_path() -> str:
    """설정 파일 경로(%APPDATA%\\일괄파일명변경기\\settings.json)."""
    root = os.environ.get("APPDATA") or os.path.expanduser("~")
    folder = os.path.join(root, "일괄파일명변경기")
    return os.path.join(folder, "settings.json")

# 드래그&드롭은 선택 기능. 없으면 폴더/파일 선택만으로 동작.
try:
    from tkinterdnd2 import TkinterDnD, DND_FILES
    HAS_DND = True
except ImportError:
    HAS_DND = False

_BaseTk = TkinterDnD.Tk if HAS_DND else tk.Tk

STATUS_LABEL = {
    rc.OK: "확인",
    rc.UNCHANGED: "변경없음",
    rc.COLLISION: "이름 충돌",
    rc.ILLEGAL: "사용불가 문자",
    rc.TOO_LONG: "경로 너무 김",
}
SORT_LABEL = {
    "이름순": rc.SORT_NAME,
    "자연정렬": rc.SORT_NAME_NATURAL,
    "수정일순": rc.SORT_MTIME,
    "크기순": rc.SORT_SIZE,
    "추가순": rc.SORT_AS_LISTED,
}


class App(_BaseTk):
    def __init__(self):
        super().__init__()
        self.title("일괄 파일명 변경기")
        self.geometry("900x600")
        self.minsize(760, 480)

        self.files: list[str] = []          # 추가 순서 유지(절대경로)
        self.included: dict[str, bool] = {}  # 경로 -> 포함 여부
        self.last_mapping: list[tuple[str, str]] = []  # 직전 실행 (old, new)
        self._refresh_job = None

        self._build_widgets()
        self._set_icon()
        self._load_settings()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        if HAS_DND:
            self.drop_target_register(DND_FILES)
            self.dnd_bind("<<Drop>>", self._on_drop)

    def _set_icon(self):
        ico = resource_path("icon.ico")
        if os.path.exists(ico):
            try:
                self.iconbitmap(ico)
            except tk.TclError:
                pass

    # ── 위젯 구성 ───────────────────────────────────────────────
    def _build_widgets(self):
        # 상단: 파일 불러오기
        top = ttk.Frame(self, padding=(10, 8))
        top.pack(fill="x")
        ttk.Button(top, text="폴더 선택", command=self._pick_folder).pack(side="left")
        ttk.Button(top, text="파일 추가", command=self._pick_files).pack(side="left", padx=(6, 0))
        ttk.Button(top, text="목록 비우기", command=self._clear).pack(side="left", padx=(6, 0))
        hint = "여기로 파일을 끌어다 놓으세요" if HAS_DND else "드래그&드롭 미사용(폴더/파일 선택 이용)"
        ttk.Label(top, text=hint, foreground="#888").pack(side="right")

        # 규칙 패널
        rule = ttk.LabelFrame(self, text="변경 규칙", padding=(10, 6))
        rule.pack(fill="x", padx=10, pady=(0, 6))

        ttk.Label(rule, text="앞에 추가:").grid(row=0, column=0, sticky="e", padx=(0, 4), pady=3)
        self.var_prefix = tk.StringVar()
        ttk.Entry(rule, textvariable=self.var_prefix, width=22).grid(row=0, column=1, sticky="w", pady=3)

        ttk.Label(rule, text="뒤에 추가:").grid(row=0, column=2, sticky="e", padx=(14, 4), pady=3)
        self.var_suffix = tk.StringVar()
        ttk.Entry(rule, textvariable=self.var_suffix, width=22).grid(row=0, column=3, sticky="w", pady=3)

        ttk.Label(rule, text="정렬:").grid(row=0, column=4, sticky="e", padx=(14, 4), pady=3)
        self.var_sort = tk.StringVar(value="이름순")
        cb = ttk.Combobox(rule, textvariable=self.var_sort, values=list(SORT_LABEL),
                          width=8, state="readonly")
        cb.grid(row=0, column=5, sticky="w", pady=3)
        cb.bind("<<ComboboxSelected>>", lambda e: self._schedule_refresh())

        # 순번 매기기
        self.var_num = tk.BooleanVar(value=False)
        ttk.Checkbutton(rule, text="순번 매기기", variable=self.var_num,
                        command=self._schedule_refresh).grid(row=1, column=0, sticky="w", pady=3)

        self.var_numpos = tk.StringVar(value="앞")
        ttk.Combobox(rule, textvariable=self.var_numpos, values=["앞", "뒤"], width=4,
                     state="readonly").grid(row=1, column=1, sticky="w", pady=3)

        ttk.Label(rule, text="시작").grid(row=1, column=2, sticky="e", pady=3)
        self.var_start = tk.IntVar(value=1)
        ttk.Spinbox(rule, from_=0, to=999999, textvariable=self.var_start, width=6,
                    command=self._schedule_refresh).grid(row=1, column=3, sticky="w", pady=3)

        ttk.Label(rule, text="간격").grid(row=1, column=4, sticky="e", pady=3)
        self.var_step = tk.IntVar(value=1)
        ttk.Spinbox(rule, from_=1, to=1000, textvariable=self.var_step, width=5,
                    command=self._schedule_refresh).grid(row=1, column=5, sticky="w", pady=3)

        ttk.Label(rule, text="자릿수").grid(row=2, column=2, sticky="e", pady=3)
        self.var_pad = tk.IntVar(value=3)
        ttk.Spinbox(rule, from_=1, to=10, textvariable=self.var_pad, width=5,
                    command=self._schedule_refresh).grid(row=2, column=3, sticky="w", pady=3)

        ttk.Label(rule, text="구분자").grid(row=2, column=4, sticky="e", pady=3)
        self.var_sep = tk.StringVar(value="_")
        ttk.Entry(rule, textvariable=self.var_sep, width=6).grid(row=2, column=5, sticky="w", pady=3)

        ttk.Separator(rule, orient="horizontal").grid(row=3, column=0, columnspan=6,
                                                      sticky="ew", pady=(6, 4))

        # 찾기·바꾸기
        ttk.Label(rule, text="찾기:").grid(row=4, column=0, sticky="e", padx=(0, 4), pady=3)
        self.var_find = tk.StringVar()
        ttk.Entry(rule, textvariable=self.var_find, width=22).grid(row=4, column=1, sticky="w", pady=3)
        ttk.Label(rule, text="바꾸기:").grid(row=4, column=2, sticky="e", padx=(14, 4), pady=3)
        self.var_replace = tk.StringVar()
        ttk.Entry(rule, textvariable=self.var_replace, width=22).grid(row=4, column=3, sticky="w", pady=3)

        # 글자 삭제 + 역순
        ttk.Label(rule, text="앞 글자삭제").grid(row=5, column=0, sticky="e", pady=3)
        self.var_rmfront = tk.IntVar(value=0)
        ttk.Spinbox(rule, from_=0, to=100, textvariable=self.var_rmfront, width=5,
                    command=self._schedule_refresh).grid(row=5, column=1, sticky="w", pady=3)
        ttk.Label(rule, text="뒤 글자삭제").grid(row=5, column=2, sticky="e", pady=3)
        self.var_rmback = tk.IntVar(value=0)
        ttk.Spinbox(rule, from_=0, to=100, textvariable=self.var_rmback, width=5,
                    command=self._schedule_refresh).grid(row=5, column=3, sticky="w", pady=3)
        self.var_reverse = tk.BooleanVar(value=False)
        ttk.Checkbutton(rule, text="역순 정렬", variable=self.var_reverse,
                        command=self._schedule_refresh).grid(row=5, column=4, columnspan=2,
                                                             sticky="w", pady=3)

        # 입력 변경 시 미리보기 갱신(디바운스)
        for v in (self.var_prefix, self.var_suffix, self.var_start, self.var_step,
                  self.var_pad, self.var_sep, self.var_numpos,
                  self.var_find, self.var_replace, self.var_rmfront, self.var_rmback):
            v.trace_add("write", lambda *a: self._schedule_refresh())

        # 미리보기 표
        mid = ttk.Frame(self, padding=(10, 0))
        mid.pack(fill="both", expand=True)
        cols = ("inc", "old", "new", "status")
        self.tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="none")
        self.tree.heading("inc", text="포함")
        self.tree.heading("old", text="현재 이름")
        self.tree.heading("new", text="변경 후 이름")
        self.tree.heading("status", text="상태")
        self.tree.column("inc", width=44, anchor="center", stretch=False)
        self.tree.column("old", width=330, anchor="w")
        self.tree.column("new", width=330, anchor="w")
        self.tree.column("status", width=110, anchor="center", stretch=False)
        self.tree.tag_configure("block", foreground="#c0392b")
        self.tree.tag_configure("unchanged", foreground="#999")
        self.tree.tag_configure("excluded", foreground="#bbb")
        vsb = ttk.Scrollbar(mid, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self.tree.bind("<Button-1>", self._on_tree_click)

        # 하단: 실행 / 되돌리기 / 상태
        bottom = ttk.Frame(self, padding=(10, 8))
        bottom.pack(fill="x")
        self.btn_apply = ttk.Button(bottom, text="변경 실행", command=self._apply)
        self.btn_apply.pack(side="left")
        self.btn_undo = ttk.Button(bottom, text="실행 취소", command=self._undo, state="disabled")
        self.btn_undo.pack(side="left", padx=(6, 0))
        self.var_status = tk.StringVar(value="파일을 추가하세요.")
        ttk.Label(bottom, textvariable=self.var_status).pack(side="right")

    # ── 규칙 수집 ───────────────────────────────────────────────
    def _rule(self) -> rc.Rule:
        num = rc.Numbering(
            enabled=self.var_num.get(),
            position="prefix" if self.var_numpos.get() == "앞" else "suffix",
            start=_safe_int(self.var_start, 1),
            step=max(1, _safe_int(self.var_step, 1)),
            padding=max(1, _safe_int(self.var_pad, 1)),
            separator=self.var_sep.get(),
        )
        return rc.Rule(
            prefix=self.var_prefix.get(),
            suffix=self.var_suffix.get(),
            find=self.var_find.get(),
            replace=self.var_replace.get(),
            remove_front=max(0, _safe_int(self.var_rmfront, 0)),
            remove_back=max(0, _safe_int(self.var_rmback, 0)),
            numbering=num,
        )

    # ── 파일 추가 ───────────────────────────────────────────────
    def _add_paths(self, paths):
        added = 0
        for p in paths:
            ap = os.path.abspath(p)
            if os.path.isfile(ap) and ap not in self.included:
                self.files.append(ap)
                self.included[ap] = True
                added += 1
        if added:
            self._refresh()

    def _pick_folder(self):
        d = filedialog.askdirectory(title="폴더 선택")
        if d:
            try:
                entries = [os.path.join(d, e) for e in os.listdir(d)]
            except OSError as e:
                messagebox.showerror("오류", f"폴더를 읽을 수 없습니다.\n{e}")
                return
            self._add_paths([e for e in entries if os.path.isfile(e)])

    def _pick_files(self):
        fs = filedialog.askopenfilenames(title="파일 선택")
        if fs:
            self._add_paths(fs)

    def _on_drop(self, event):
        # tk.splitlist 는 tkinterdnd2 의 {경로 포함 공백} 형식을 올바르게 분해해
        # 여러 파일을 모두 반환한다(첫 파일만 쓰지 않는다).
        try:
            paths = self.tk.splitlist(event.data)
        except Exception:
            paths = [event.data]
        self._add_paths(paths)

    def _clear(self):
        self.files.clear()
        self.included.clear()
        self.last_mapping.clear()
        self.btn_undo.config(state="disabled")
        self._refresh()

    # ── 미리보기 ────────────────────────────────────────────────
    def _schedule_refresh(self, *_):
        if self._refresh_job is not None:
            self.after_cancel(self._refresh_job)
        self._refresh_job = self.after(150, self._refresh)

    def _refresh(self):
        self._refresh_job = None
        self.tree.delete(*self.tree.get_children())
        included = [f for f in self.files if self.included.get(f, True)]
        rows = rc.compute_new_names(included, self._rule(), SORT_LABEL[self.var_sort.get()],
                                    reverse=self.var_reverse.get())

        block = False
        for old, new, st in rows:
            tag = ""
            if st in (rc.COLLISION, rc.ILLEGAL, rc.TOO_LONG):
                tag, block = "block", True
            elif st == rc.UNCHANGED:
                tag = "unchanged"
            self.tree.insert("", "end", iid=old,
                             values=("☑", os.path.basename(old), new, STATUS_LABEL[st]),
                             tags=(tag,) if tag else ())
        # 제외된 파일
        for f in self.files:
            if not self.included.get(f, True):
                self.tree.insert("", "end", iid=f,
                                 values=("☐", os.path.basename(f), "", "제외"),
                                 tags=("excluded",))

        n = len(included)
        if not self.files:
            self.var_status.set("파일을 추가하세요.")
        elif block:
            self.var_status.set(f"{n}개 선택 — 충돌/오류 항목이 있어 실행할 수 없습니다.")
        else:
            self.var_status.set(f"{n}개 선택 — 실행 준비됨.")
        self.btn_apply.config(state=("disabled" if (block or n == 0) else "normal"))

    def _on_tree_click(self, event):
        if self.tree.identify("region", event.x, event.y) != "cell":
            return
        if self.tree.identify_column(event.x) != "#1":   # '포함' 열만 토글
            return
        iid = self.tree.identify_row(event.y)
        if iid in self.included:
            self.included[iid] = not self.included[iid]
            self._refresh()

    # ── 실행 / 되돌리기 ─────────────────────────────────────────
    def _apply(self):
        included = [f for f in self.files if self.included.get(f, True)]
        rows = rc.compute_new_names(included, self._rule(), SORT_LABEL[self.var_sort.get()],
                                    reverse=self.var_reverse.get())
        if rc.has_blocking(rows):
            messagebox.showwarning("실행 불가", "충돌/사용불가 문자/경로길이 문제가 있는 항목이 있습니다.")
            return
        mapping = [(old, os.path.join(os.path.dirname(old), new))
                   for old, new, st in rows if st == rc.OK]
        if not mapping:
            messagebox.showinfo("알림", "변경할 파일이 없습니다.")
            return
        if not messagebox.askyesno("확인", f"{len(mapping)}개 파일의 이름을 변경합니다.\n계속할까요?"):
            return
        try:
            rc.apply_renames(mapping)
        except Exception as e:
            messagebox.showerror("실행 실패", f"변경 중 오류가 발생해 모두 되돌렸습니다.\n{e}")
            return

        # 내부 목록을 새 경로로 갱신
        self._remap_files(mapping)
        self.last_mapping = mapping
        self.btn_undo.config(state="normal")
        self._refresh()
        self.var_status.set(f"{len(mapping)}개 변경 완료.")

    def _undo(self):
        if not self.last_mapping:
            return
        ok, msg = rc.validate_undo(self.last_mapping)
        if not ok:
            messagebox.showwarning("되돌리기 불가", msg)
            return
        reverse = [(new, old) for old, new in self.last_mapping]
        try:
            rc.apply_renames(reverse)
        except Exception as e:
            messagebox.showerror("되돌리기 실패", f"되돌리는 중 오류가 발생했습니다.\n{e}")
            return
        self._remap_files(reverse)
        self.last_mapping = []
        self.btn_undo.config(state="disabled")
        self._refresh()
        self.var_status.set("직전 변경을 되돌렸습니다.")

    def _remap_files(self, mapping):
        """mapping(src→dst) 적용 후 내부 파일 목록의 경로를 갱신."""
        repl = {src: dst for src, dst in mapping}
        new_files = []
        for f in self.files:
            nf = repl.get(f, f)
            new_files.append(nf)
            if nf != f:
                self.included[nf] = self.included.pop(f, True)
        self.files = new_files

    # ── 설정 저장/불러오기 ──────────────────────────────────────
    def _collect_settings(self) -> dict:
        return {
            "prefix": self.var_prefix.get(),
            "suffix": self.var_suffix.get(),
            "find": self.var_find.get(),
            "replace": self.var_replace.get(),
            "remove_front": _safe_int(self.var_rmfront, 0),
            "remove_back": _safe_int(self.var_rmback, 0),
            "num_enabled": self.var_num.get(),
            "num_pos": self.var_numpos.get(),
            "start": _safe_int(self.var_start, 1),
            "step": _safe_int(self.var_step, 1),
            "pad": _safe_int(self.var_pad, 1),
            "sep": self.var_sep.get(),
            "sort": self.var_sort.get(),
            "reverse": self.var_reverse.get(),
        }

    def _apply_settings(self, d: dict):
        def setv(var, key, cast=None):
            if key in d:
                try:
                    var.set(cast(d[key]) if cast else d[key])
                except Exception:
                    pass
        setv(self.var_prefix, "prefix", str)
        setv(self.var_suffix, "suffix", str)
        setv(self.var_find, "find", str)
        setv(self.var_replace, "replace", str)
        setv(self.var_rmfront, "remove_front", int)
        setv(self.var_rmback, "remove_back", int)
        setv(self.var_num, "num_enabled", bool)
        setv(self.var_start, "start", int)
        setv(self.var_step, "step", int)
        setv(self.var_pad, "pad", int)
        setv(self.var_sep, "sep", str)
        setv(self.var_reverse, "reverse", bool)
        if d.get("num_pos") in ("앞", "뒤"):
            self.var_numpos.set(d["num_pos"])
        if d.get("sort") in SORT_LABEL:
            self.var_sort.set(d["sort"])

    def _load_settings(self):
        try:
            with open(settings_path(), encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                self._apply_settings(d)
        except (OSError, json.JSONDecodeError, ValueError):
            pass

    def _save_settings(self):
        p = settings_path()
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(self._collect_settings(), f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    def _on_close(self):
        self._save_settings()
        self.destroy()


def _safe_int(var: tk.Variable, default: int) -> int:
    try:
        return int(var.get())
    except (tk.TclError, ValueError):
        return default


if __name__ == "__main__":
    App().mainloop()
