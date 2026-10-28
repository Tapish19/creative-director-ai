# Implementation plan

Creative Director AI converts an authenticated campaign brief into a versioned, reviewed MP4. Each phase requires lint, TypeScript checks and relevant tests. External credentials are now deferred at the user's request: development continues with proper integrations and controlled test fixtures, while live verification remains explicitly pending.

## Repository inspection

The supplied directory was `C:\Users\Abhishek`, outside a Git repository. The nearby `output/creative-engine-preview` is a separate buildless UI prototype with simulated generation. The Python project `gen-ai-assignment` is unrelated. This application lives in a new repository at `C:\Users\Abhishek\creative-director-ai`.

## Phase gates

| Phase | Deliverable                                                                                             | State                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1     | Dashboard, campaign CRUD, Supabase Auth, migrations, ownership rules and provider contracts             | Implemented; local PostgreSQL policy/CRUD tests pass; hosted auth and CRUD pending                       |
| 2     | Gemini planner/writer, validated JSON, durable queue, persisted agent attempts, storyboard/results page | Implemented; local checks and integration tests; live Gemini/Supabase verification pending               |
| 3     | Cloudflare image provider and per-scene retries                                                         | Implemented; private previews, independent retries and local checks; live provider/storage pending       |
| 4     | ElevenLabs when configured, real local TTS otherwise                                                    | Implemented; actual Windows synthesis verified; cloud voice/storage acceptance pending                   |
| 5     | FFmpeg rendering with images, motion, captions, transitions and speech                                  | Implemented; native 15/30-second MP4 tests pass; hosted playback pending                                 |
| 6     | Reviewer and configurable quality scoring                                                               | Implemented; audiovisual input, persisted scores/gate/retries; live Gemini review pending                |
| 7     | Feedback revisions, script editing, scene regeneration, maximum 2 automatic revisions                   | Implemented; immutable revisions, media reuse, script/scene editing and bounded automatic loop           |
| 8     | Authenticated approval of an exact completed generation                                                 | Implemented; owner approval, exact-media audit, low-score acknowledgment and immutable approved versions |
| 9     | Complete regression suite, polish, screenshots and deployment                                           | Foundation tests/docs exist; native video validation implemented; live validation and deployment pending |

## Runtime architecture

- Next.js handles pages, authentication, input validation and a short enqueue transaction.
- Supabase PostgreSQL stores snapshots, versions, attempts, scenes and durable jobs.
- A separate Node worker calls providers and persists progress. Its claim token fences all mutations.
- The text worker already supports leases, bounded retries, delayed availability and crash recovery. The renderer extends the same leased queue foundation.
- A separate image worker generates and normalizes scene images, uploads to private Supabase Storage, and commits paths under a lease. Authenticated previews use short-lived signed URLs.
- A voice worker synthesizes narration, validates measured WAV frames and saves private audio. It uses ElevenLabs when configured, otherwise Windows speech/eSpeak NG. Image completion queues voice; successful narration queues rendering.
- A render worker downloads committed media, animates and captions it with FFmpeg, validates the MP4 and publishes a private MP4 and queues review. See [Phase 5](phase-5.md).
- A reviewer evaluates the completed audiovisual creative, validates scores and feedback, and persists an immutable threshold decision. See [Phase 6](phase-6.md).
- Revision RPCs create immutable child versions and share unchanged media. The reviewer atomically schedules up to two feedback-driven automatic revisions; targeted edits stay under human control. See [Phase 7](phase-7.md).
- No runtime mock provider or synthetic quality score is used.

## Phase 2 checks

Validate provider failures (429, 5xx, auth rejection, timeout, malformed JSON, invalid schema and blocked output); validate ownership, idempotency, recovery, retry caps and atomic writes in PostgreSQL; run production browser smoke tests. Real account login and an actual Gemini-generated MyHotelLine storyboard remain the live acceptance gate.

The database tests exposed recursive draft UPDATE/DELETE policies from the initial migration. Migration `202610260004_draft_policy_fix.sql` repairs them without weakening ownership or lineage protection.

## Credentials and deployment

The web app needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The worker separately needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY`; `GEMINI_MODEL` has a configurable default. Credentials will be added later. Local TTS is an explicitly requested real provider option, not a simulated fallback.

The image worker uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Start it with `npm run worker:images`. Migration 006 queues scene jobs atomically when script generation finishes. See [Phase 3](phase-3.md) for recovery, privacy, limitations and live acceptance checks.

The final deployment needs a Node/container worker with FFmpeg. The available Sites runtime is Cloudflare Workers and cannot run a native FFmpeg subprocess. Keep the requested Next.js application and deploy the renderer on a container-capable host. Hosting credentials and the deployment target remain to be resolved.
