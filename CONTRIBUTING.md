# Contributing

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Ground rules

- **Privacy first.** No analytics, tracking, CDNs or third-party requests. The only network traffic is loading the app's own files.
- **Offline always.** Every feature must work with no network after the first visit.
- **Never lose data silently.** Writes run in one database transaction; schema changes ship as versioned migrations and must handle backups from every earlier version.

## Getting started

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run test:e2e
```

- Put formulas in `src/lib/calc` and cover them with unit tests.
- Put database access in `src/lib/db/repo.ts` (tests in `tests/unit/repo.test.ts` run against real PGlite).
- Keep screens usable one-handed at 360 px wide, with labelled fields and keyboard support.
- Use Prettier (`npm run format`) and keep commits focused.
- Add a line to `CHANGELOG.md` under _Unreleased_.

## Reporting bugs

Use the issue templates. Include your device, browser and app version (shown in Settings). Don't attach your backup file: it contains your data.
