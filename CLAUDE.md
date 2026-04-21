# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

AFM 2기 평일반 과정 제출 저장소. 주차별(Week-1 ~ Week-5) 폴더에 개별 프로젝트들이 들어있다.

## Tech Stack

- **Frontend**: React 18 (CDN, `<script>` 태그) + Tailwind CSS (CDN) — 빌드 도구 없이 단일 `index.html`로 구성
- **Backend**: Node.js `http` 모듈 또는 Express.js — 단일 `server.js`로 구성
- **Database**: PostgreSQL (Supabase) with `pg` 드라이버
- **Auth**: JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)
- **Deployment**: Vercel (일부 프로젝트)

## Project Pattern

대부분의 프로젝트는 2~3개 파일로 구성된 미니멀 구조:
- `server.js` — API 서버 (인증, CRUD, 정적 파일 서빙)
- `index.html` — React SPA (CDN 기반, Babel 트랜스파일)
- `package.json` — 의존성 관리

## Running Projects

```bash
# 프로젝트 디렉토리로 이동 후
npm install
node server.js
```

각 프로젝트는 고유 포트를 사용한다 (예: todo_app_01은 3003).

## Agent Specializations

- `single-server-specialist` — server.js 작성/수정/디버그 전용
- `single-react-dev` — CDN 기반 React 단일 index.html 개발 전용
- `vercel-deploy-optimizer` — Vercel 배포 설정 전용

## Key Conventions

- 한국어 UI, 한국어 주석/로그 사용
- React/Tailwind는 항상 CDN으로 로드 (빌드 시스템 없음)
- 서버는 `index.html`을 직접 서빙 (`/` 경로)
- API 경로는 `/api/` 접두사 사용
