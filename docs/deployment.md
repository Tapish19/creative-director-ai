# GitHub and Vercel deployment

- Public repository: https://github.com/Tapish19/creative-director-ai
- Production web app: https://creative-director-ai-ochre.vercel.app
- Vercel project: `creative-director-ai`, team `tapish19s-projects`.
- Production branch: `main`, connected through Vercel's GitHub integration.
- Build: `npm ci`, then `npm run build`, using the Next.js framework preset.

The web deployment is connected to the dedicated Supabase project `iyqoxosvhpljpvgxfyqg` in Mumbai. All 14 migrations are applied, including the private asset bucket. Authentication redirects to the production site and permits the localhost callback for development. Public email delivery still needs custom SMTP, and the AI production pipeline still needs provider credentials and hosted workers.

## Remaining setup

1. Configure custom SMTP in Supabase Auth for public registration. Supabase's default sender is restricted to project team addresses.
2. Host the five long-running Node workers separately, with their server-side credentials. Rendering/review need FFmpeg and FFprobe; free local speech on Linux requires eSpeak NG. See the README's deployment commands.
3. Run an authenticated MyHotelLine campaign through generation, review, approval and download. Verify ownership isolation with a second account before presenting it as a working end-to-end demo.

Do not put `SUPABASE_SERVICE_ROLE_KEY`, Gemini, Cloudflare or ElevenLabs keys in the web deployment. They belong to the corresponding worker environments. `.env.local`, local media, FFmpeg binaries, build output and Vercel link metadata are excluded from Git; `.vercelignore` also excludes them from CLI uploads.

GitHub Actions runs lint, TypeScript, database/provider/native-media tests, a Next.js build and Playwright checks on Ubuntu. The browser suite tests the explicit unconfigured state. Cloud-provider acceptance is a separate check.

Deployment does not start background workers. The production web project has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The database password was also stored as a server-side Vercel secret at the user's request; the web app does not read it. No AI provider credentials are in Vercel.
