# GitHub and Vercel deployment

- Public repository: https://github.com/Tapish19/creative-director-ai
- Production web app: https://creative-director-ai-ochre.vercel.app
- Vercel project: `creative-director-ai`, team `tapish19s-projects`.
- Production branch: `main`, connected through Vercel's GitHub integration.
- Build: `npm ci`, then `npm run build`, using the Next.js framework preset.

The web deployment serves the dashboard, sample brief, login and settings pages. Until Supabase is configured, it explicitly disables saving and authentication. A deployed web page does not mean the AI production pipeline is operational.

## Remaining setup

1. Apply all 14 SQL migrations to the intended Supabase project, in order.
2. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the Vercel project's Production environment. Redeploy after setting them. Configure Preview separately if needed.
3. In Supabase Auth, set the production Site URL to `https://creative-director-ai-ochre.vercel.app` and allow `https://creative-director-ai-ochre.vercel.app/auth/callback`. Keep localhost allowed for development. Configure SMTP for public registration.
4. Host the five long-running Node workers separately, with their server-side credentials. Rendering/review need FFmpeg and FFprobe; free local speech on Linux requires eSpeak NG. See the README's deployment commands.
5. Run an authenticated MyHotelLine campaign through generation, review, approval and download. Verify ownership isolation with a second account before presenting it as a working end-to-end demo.

Do not put `SUPABASE_SERVICE_ROLE_KEY`, Gemini, Cloudflare or ElevenLabs keys in the web deployment. They belong to the corresponding worker environments. `.env.local`, local media, FFmpeg binaries, build output and Vercel link metadata are excluded from Git; `.vercelignore` also excludes them from CLI uploads.

GitHub Actions runs lint, TypeScript, database/provider/native-media tests, a Next.js build and Playwright checks on Ubuntu. The browser suite tests the explicit unconfigured state. Cloud-provider acceptance is a separate check.

Deployment does not start background workers, apply SQL migrations or configure Supabase Auth automatically. No provider credentials were uploaded during the initial web deployment.
