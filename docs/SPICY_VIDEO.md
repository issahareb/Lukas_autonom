# SpicyAPI video through LUKAS

The private chat can create Wan 3.0 image-to-video jobs and query their status.
This first integration supports `alibaba/wan-3.0/image-to-video` only. It does
not add a new studio interface, upload images, or integrate the entire model catalogue.

1. Create a SpicyAPI account and provision an API key in the provider console.
2. Store `SPICY_API_KEY` as a secret on the API server. Never put it in the chat,
   tool arguments, frontend variables, source control, or this document.
3. Deploy this change through the normal release process.
4. Supply an image HTTPS URL reachable by the provider. Local attachments and
   private URLs need a separate upload/export flow before they can be used.
5. Ask LUKAS, for example: “Erstelle mit SpicyAPI aus https://example.com/start.png
   einen fünf Sekunden langen Clip in 720p. Die Kamera fährt langsam zurück.”
   Generation uses the existing R2 approval gate; status reads are R0.

## Job handling

`spicy_video_erstellen` returns a `task_id`, the original `idempotency_key`, and
an acceptance status. Acceptance is **not** completion. Keep the same request
parameters and idempotency key if creation times out or returns an unclear response.
Once the task ID is known, use `spicy_video_status` instead of creating another job.
The original request and task ID are returned to the existing tool/conversation
history; there is no separate durable job registry or automatic background polling.

Only a `succeeded` job with actual asset URLs yields video links. These links may
expire. Download and long-term storage are not automated by this change.
Unknown states and failures do not silently become new paid generations.
Duration is explicitly bounded to 2–30 seconds; automatic duration is omitted to
avoid reserving the provider's maximum duration. Resolution and length affect cost.
Provider cost fields are passed through; no unverified local price calculator is used.

## Verification

Run `node scripts/check-spicy-video.mjs` from `artifacts/api-server`.
The check uses mocked HTTP responses and never spends provider credits.
A paid end-to-end test remains pending until credentials, a usable input image,
and an authorized test generation are available.

API contract checked 2026-11-11:
https://spicyapi.ai/models/wan-3-0/image-to-video/api
