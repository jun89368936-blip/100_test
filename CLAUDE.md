# AI_Agent 작업공간 — CLAUDE.md

## 프로젝트 개요

Claude Code 기반 AI 자동화 작업공간. GitHub 연동 및 oh-my-claudecode(OMC) 멀티에이전트 환경 구성.

---

## 작업 이력

### 1. GitHub 연동
- GitHub 계정: `jun89368936-blip`
- 현재 폴더(`C:\Users\장우준\Desktop\AI_Agent`)를 저장소 `100_test`에 연동
- `git init` → initial commit → `main` 브랜치로 push 완료
- 저장소 URL: https://github.com/jun89368936-blip/100_test

### 2. Claude Code CLI 설치
- 설치 명령: `npm install -g @anthropic-ai/claude-code`
- 설치 버전: `2.1.154`

### 3. oh-my-claudecode (OMC) 설치
- 패키지명: `oh-my-claude-sisyphus`
- 설치 명령: `npm install -g oh-my-claude-sisyphus`
- 설치 버전: `4.14.4`
- 초기 설정: `omc setup` 완료
  - 에이전트 19개 설치
  - 스킬 36개 설치
  - 훅 6개 구성

### 4. psmux 설치 (Windows tmux 대체)
- 설치 명령: `winget install psmux`
- 목적: OMC의 병렬 실행 기능(tmux 의존) Windows 지원

### 5. 글로벌 권한 설정
- 파일: `C:\Users\장우준\.claude\settings.json`
- 내용: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, GitHub MCP 전체 allow
- defaultMode: `acceptEdits`

---

## 설치된 주요 도구

| 도구 | 버전 | 용도 |
|------|------|------|
| Node.js | v24.15.0 | 런타임 |
| npm | v11.12.1 | 패키지 관리 |
| Claude Code CLI | v2.1.154 | AI 코딩 CLI |
| oh-my-claudecode | v4.14.4 | 멀티에이전트 오케스트레이션 |
| psmux | - | Windows tmux 지원 |

---

## OMC 주요 명령어

| 명령 | 용도 |
|------|------|
| `autopilot: [작업내용]` | 처음부터 끝까지 자율 실행 |
| `/ralph [작업내용]` | 완료될 때까지 반복 실행 |
| `/deep-interview [주제]` | 요구사항 인터뷰로 정리 |
| `/ultrawork [작업내용]` | 대규모 병렬 코드 변경 |
| `/ultraqa` | 테스트/빌드 통과까지 반복 |
| `/team [작업내용]` | 계획→실행→검증 파이프라인 |
| `omc doctor` | 설치 상태 진단 |
| `omc setup` | OMC 재설정 |

---

## 파일 구조

```
AI_Agent/
├── CLAUDE.md                        ← 이 파일
├── README.md
├── 01-claude-desktop-github.md      ← Claude Desktop + GitHub 설정 가이드
├── 02-vscode-claude-code.md         ← VSCode + Claude Code 설정 가이드
├── 03-oh-my-claudecode-설치.md      ← OMC 설치 가이드
├── 99-troubleshooting.md            ← 트러블슈팅
└── .claude/
    └── settings.local.json
```

---

## 다음 작업 (예정)

- [ ] OMC 기능 심화 활용 (알림 연동, 멀티 AI 등)
- [ ] 실제 프로젝트에 autopilot 적용
- [ ] 커스텀 스킬 `.omc/skills/` 구성
