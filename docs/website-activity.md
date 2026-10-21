# Website activity

First-party analytics for hareb.digital and issahareb.me. Private dashboard: Kennzahlen → Website-Aktivität. TaxiBB remains a separate provider, refreshed every 15 seconds.

## Release

Deploy migration 0010 and API/UI before enabling the website clients. Set HAREB_ACTIVITY_WRITE_TOKEN and PORTFOLIO_ACTIVITY_WRITE_TOKEN on this API; set the matching ACTIVITY_WRITE_TOKEN on each website. Never expose either token through NEXT_PUBLIC variables. All reads and SSE require the existing LUKAS bearer authentication. Each write token is restricted to its website. Website proxies allow same-origin HTTPS only, cap requests at 48 KB and rate-limit in memory.

## Measurement definitions

- Explicit analytics consent version 4; no visit storage or events beforehand. Withdrawal stops listeners and clears queued events and sessionStorage. DNT/GPC disable telemetry.
- Random per-tab session ID, expires after 30 minutes of inactivity. No cross-domain identity or association with inquiry contents.
- Active time: visible, focused tab with interaction in last 30 seconds, sampled every second; delta capped at 2 seconds. Cumulative page totals prevent repeated heartbeats from double-counting time.
- Engagement batches roughly every 5 seconds. Authenticated SSE invalidates dashboard after committed writes; 15-second fallback polling and reconnect. SSE is process-local; polling handles future multi-replica deployments.
- Scroll depth measures visible bottom edge, in 5% steps; scroll stop after 900ms without scrolling, including section and pixel scrollY. Stops are not exits. Exit is inferred from last observed position after 30 minutes without any new event.
- Clicks: source-position ID, repeated-element ordinal, section, sanitized destination without query or fragment, normalized viewport X/document Y. mailto/tel destinations retain only their protocol.
- Forms: start, changed field identifier, native validation failure, attempt, server-confirmed success/error. Never field values. Started and unsuccessful forms become abandoned only after 30 minutes; late success removes abandonment.
- Video play/pause/end with playback time. No session replay, mouse recording, typed contents, chats or full referrer URLs.
- Events use UUID idempotency keys; backend schema strips unknown data keys. 90-day retention is enforced at most hourly on ingestion. Traffic without consent, blockers and browser shutdown loss mean totals are not all visitors or all inquiries.

## Verification performed

Both Next production builds, API/UI builds and TypeScript checks. Existing Lukas UI suite: 127 tests. PGlite exercised the generated migration and every aggregate SQL query, invalid tokens, site isolation, idempotency, cumulative active time, abandonment/last field, late success and SSE. Chromium mobile fixtures exercised consent, default-off storage/network, scroll/click/form events, exclusion of private field values/chat, withdrawal and DNT.

## Publication checkpoint, 2026-10-21

- Backend main contains implementation commit 8eb5bfc470171db05f2c75789013f9935cdc1101.
- Website changes are safely published on codex/website-activity-20261021 in both repositories: Harebdigital 5a453024c9bc1f0a607db49317535d5a47828ca4, Portfolio_v2 5dca95f31228101d68fc0a967a0d48529f22e081.
- Harebdigital production follows visual-hero-proof, NOT main. Its release commit is based on the current production revision 05682077d376556e9e42a1c2dd1cb5a203e77095; publish by fast-forwarding that branch after backend success. Preserve the unrelated staged Railway branch-change patch.
- Portfolio production follows main at 736fe72c0bd4d9c7ad81c5aaa5155a24c26209bf. Fast-forward only after backend success.
- All four new server-side write-token variables were set and read back by name on the three existing services. Do not regenerate or expose them.
- Railway rejected backend deployment with: Deploys have been paused temporarily. The latest observed live backend is still deployment 095d7f0b-e3b1-4360-9f02-76a32b604581, commit 76b8f75982ab52c3e5e00a08a84caf635ee2c4b1. Website production branches were deliberately not advanced.
- Local Chromium UI tests passed at 390px and 1440px, all five tabs and website switching, with no page overflow. Test numbers were fixtures, not live visitor data.

Once Railway deployments are available, deploy existing backend main and observe SUCCESS; then advance the two production website branches using expected-head leases and observe SUCCESS. Finally verify actual consented website requests return 202, private analytics reject unauthenticated reads, and a fresh event updates the private dashboard. Production activation and end-to-end verification are NOT yet complete.
