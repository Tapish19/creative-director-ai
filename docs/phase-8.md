# Phase 8: human approval

The authenticated campaign owner can approve a specific completed, reviewed version. AI scores never approve a creative. Approval records a decision inside the application; it does not publish an ad or send it to an advertising platform.

## Setup

Apply `supabase/migrations/202610270014_human_approval.sql` after migrations 001–013, then deploy/restart the updated web app. There are no additional environment variables, API providers or workers. Existing generation workers continue to produce reviewed versions.

## User flow

1. Open a version, watch its MP4 and inspect the saved audiovisual review.
2. Wait for any active generation in the campaign to finish. Approval is also available on an older reviewed version after newer work finishes or fails.
3. In **Your final decision**, acknowledge that you watched the version and read its feedback. Optionally add a decision note, up to 2,000 characters.
4. If the score is below the saved threshold, explicitly acknowledge that score before approving. This is a human override; it does not change the AI review, threshold or score.
5. Select **Approve version N**. The workspace shows the decision, timestamp, audit details and **Download approved MP4**.

Missing or failed reviews cannot be approved. Retrying the review or creating another version remains available through the existing workflow. While automatic revisions run, approval waits; once the cycle ends, any eligible earlier version can be chosen.

## Persistence and authorization

`generation_approvals` stores one permanent record per approved generation:

- Generation, video and review IDs.
- Private MP4 object path and reviewed source SHA-256.
- Authenticated approver and database timestamp.
- Score and threshold at approval, plus whether the human accepted a below-threshold result.
- Optional decision note.

The `approve_generation` RPC is executable only by authenticated users and checks ownership through `auth.uid()`. It takes the same owner/project locks as revision enqueue and completion. It verifies a terminal eligible generation, no active work in the campaign, successful video/review task, exact expected video/review IDs and consistent review evidence. It atomically saves the approval and updates generation/project status to `approved`.

The browser cannot supply the approver, timestamp, score or stored evidence. Direct client writes are denied. Workers can read approval records but cannot insert/update them or execute the approval RPC. A generation trigger prevents a direct status update from fabricating approval without the matching human record. Approved generation content, video metadata/path and review rows are protected against later mutation.

Repeated delivery for the same generation/video/review returns the existing decision without changing its note or timestamp. A stale request naming different media is rejected. Replaying an old approval after a new revision starts does not reset campaign progress.

## Versions and campaign status

An approved version remains approved if the user later regenerates, edits the script or regenerates a scene. The child starts unapproved and must complete its own render/review/approval. More than one historical version may have an approval; these are permanent version-level decisions, not a single campaign-wide publishing selection.

Campaign status becomes `approved` when a decision is saved with no work active. Starting another generation changes the campaign's current processing status while retaining earlier version approvals. Recent version history shows each approved version. The workspace queries active work independently of the 50-version history window.

## Verification and limits

PostgreSQL integration tests exercise the real migration/RPC with completed pipeline fixtures: owner isolation, below-threshold acknowledgment, exact media checks, processing gates, old-version approval, idempotent replay, protected artifacts, worker permissions and unapproved descendants. Server Action tests cover authentication, validation, safe errors and lost responses. Component tests cover required acknowledgment, processing states, audit details, escaped notes and the version-specific download.

The checkbox records the user's acknowledgment; it does not technically prove that they watched every frame. There is no revocation, approval-note editing, team delegation or external publishing in this phase. Storage retention must preserve approved objects and reused assets. Hosted Supabase authentication/storage and a real browser approval still require credentials and live acceptance testing; local SQL/component tests do not substitute for those checks.

Live acceptance: generate MyHotelLine, approve its reviewed MP4, reload and verify the timestamp/note and download. Confirm a second account cannot read or approve it. Create a child revision and verify that the earlier approval remains while the child needs its own decision. Test below-threshold acknowledgment after the automatic revision cycle stops.
