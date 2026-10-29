# GitHub and Vercel deployment

- Public repository: https://github.com/Tapish19/creative-director-ai
- Production web app: https://creative-director-ai-ochre.vercel.app
- Vercel project: `creative-director-ai`, team `tapish19s-projects`.
- Production branch: `main`, connected through Vercel's GitHub integration.
- Build: `npm ci`, then `npm run build`, using the Next.js framework preset.

The web deployment is connected to the dedicated Supabase project `iyqoxosvhpljpvgxfyqg` in Mumbai. All 14 migrations are applied, including the private asset bucket. Authentication redirects to the production site and permits the localhost callback for development. Gemini and Cloudflare credentials are configured locally and have passed read-only API checks. Public email delivery still needs custom SMTP, and the AI production pipeline still needs hosted workers and live acceptance.

## Remaining setup

1. Configure custom SMTP in Supabase Auth for public registration. Supabase's default sender is restricted to project team addresses.
2. Host the five long-running Node workers separately, with their server-side credentials. The [Always Free VM guide](worker-hosting.md) includes a Docker Compose deployment with FFmpeg and eSpeak NG.
3. Run an authenticated MyHotelLine campaign through generation, review, approval and download. Verify ownership isolation with a second account before presenting it as a working end-to-end demo.

`SUPABASE_SERVICE_ROLE_KEY`, Cloudflare and ElevenLabs keys belong only to the corresponding worker environments. Gemini also belongs to the text/review worker environments; the user requested a protected copy in Vercel, but the web app never reads it. `.env.local`, `.env.worker`, local media, FFmpeg binaries, build output and Vercel link metadata are excluded from Git; `.vercelignore` also excludes them from CLI uploads.

GitHub Actions runs lint, TypeScript, database/provider/native-media tests, a Next.js build and Playwright checks on Ubuntu. The browser suite tests the explicit unconfigured state. Cloud-provider acceptance is a separate check.

Deployment does not start background workers. The production web project has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The database password and Gemini key were also stored as server-side Vercel secrets at the user's request; the web app does not read either value.
