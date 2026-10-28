import { Check, Circle, Database, KeyRound, LockKeyhole } from "lucide-react";
import { getSupabaseConfig } from "@/lib/env";

export const metadata = { title: "Workspace settings" };

export default function SettingsPage() {
  const configured = !!getSupabaseConfig();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE SETTINGS</div>
          <h1>
            A foundation for good work<span className="accent-dot">.</span>
          </h1>
          <p>Connect the services that power your creative studio.</p>
        </div>
      </div>
      <div className="settings-layout">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <span className="settings-icon">
                <Database size={20} />
              </span>
              <h2>Supabase</h2>
            </div>
            <span className={`connection-state ${configured ? "present" : ""}`}>
              {configured ? <Check size={13} /> : <Circle size={11} />}
              {configured ? "Configuration present" : "Configuration needed"}
            </span>
          </div>
          <p>
            Campaigns and account sessions use your Supabase project. Configuration presence does
            not verify database connectivity or migrations.
          </p>
          <ol className="setup-steps">
            <li>
              <strong>Create a Supabase project</strong>
              <span>
                Use the project URL and publishable key from your project’s API settings. A legacy
                anon key is also supported.
              </span>
            </li>
            <li>
              <strong>Set server environment variables</strong>
              <span>
                Copy <code>.env.example</code> to <code>.env.local</code> in the project root, then
                fill in:
              </span>
              <pre>SUPABASE_URL=…{"\n"}SUPABASE_PUBLISHABLE_KEY=…</pre>
            </li>
            <li>
              <strong>Apply the migrations</strong>
              <span>
                Apply all files in <code>supabase/migrations</code> in order through the Supabase
                SQL editor or CLI. Apply each file separately, including the voice and video queues
                and their status migrations.
              </span>
            </li>
            <li>
              <strong>Configure authentication</strong>
              <span>
                Enable email/password sign-in. Add your app URL and <code>/auth/callback</code> to
                the Auth URL allowlist. Restart the development server, then create an account.
              </span>
            </li>
          </ol>
          <div className="inline-note">
            <LockKeyhole size={17} />
            <p>Both variables stay on the server. Do not put a service-role key in the web app.</p>
          </div>
        </section>
        <aside>
          <section className="panel settings-panel">
            <KeyRound size={21} />
            <h2>AI integrations</h2>
            <p>
              The planner and script writer run in a separate background worker. Add the worker
              credentials when you’re ready for live generation.
            </p>
            <div className="integration-list">
              <span>
                Gemini <small>Planner + writer implemented</small>
              </span>
              <span>
                Cloudflare Workers AI <small>Scene images implemented</small>
              </span>
              <span>
                ElevenLabs / local voice <small>Voiceover implemented</small>
              </span>
              <span>
                FFmpeg worker <small>MP4 rendering implemented</small>
              </span>
              <span>
                Gemini reviewer <small>Video + audio quality scoring implemented</small>
              </span>
            </div>
            <div className="worker-setup">
              <h3>Text worker setup</h3>
              <p>
                Configure <code>GEMINI_API_KEY</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in
                the worker environment. Then run:
              </p>
              <pre>npm run worker</pre>
              <p>
                The worker key is privileged. It is never read by the web application. See the
                README for deployment and migration instructions.
              </p>
            </div>
            <div className="worker-setup">
              <h3>Image worker setup</h3>
              <p>
                Configure <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_API_TOKEN</code>
                alongside the worker’s Supabase credentials. In another terminal, run:
              </p>
              <pre>npm run worker:images</pre>
              <p>
                New scripts queue each scene automatically. Images wait safely in the database until
                this worker is available.
              </p>
            </div>
            <div className="worker-setup">
              <h3>Review worker setup</h3>
              <p>
                Uses the Gemini and Supabase worker credentials, plus FFmpeg/FFprobe for video
                validation. Set <code>QUALITY_THRESHOLD</code> between 1 and 10; the default is 8.
              </p>
              <pre>npm run worker:review</pre>
              <p>
                Completed renders queue an audiovisual review automatically. Scores and feedback are
                saved with the version. Passing the threshold never approves a video.
              </p>
              <p>
                Set <code>MAX_AUTOMATIC_REVISIONS</code> to 0, 1 or 2 (default 2). Low scores can
                create a new version using the review feedback; the loop stops at this cap. Script
                edits and single-scene changes keep automatic rewrites off.
              </p>
            </div>
            <div className="worker-setup">
              <h3>Human approval</h3>
              <p>
                Apply migration 014 after the earlier migrations. Approval needs no extra provider
                or worker: the campaign owner approves the exact reviewed version in the workspace.
              </p>
              <p>
                Below-threshold approval requires an explicit acknowledgment. New versions never
                inherit an earlier approval.
              </p>
            </div>
            <p className="phase-note">
              Provider integrations need their own credentials. Local speech synthesis needs no API
              key. No runtime mock provider is active.
            </p>
            <div className="worker-setup">
              <h3>Voice worker setup</h3>
              <p>
                Uses ElevenLabs when <code>ELEVENLABS_API_KEY</code> and{" "}
                <code>ELEVENLABS_VOICE_ID</code> are configured. Otherwise it uses Windows system
                speech or an installed eSpeak NG engine.
              </p>
              <pre>npm run worker:voice</pre>
              <p>
                The voice worker uses the same Supabase worker credentials. Test local speech
                independently with <code>npm run voice:smoke</code>.
              </p>
            </div>
            <div className="worker-setup">
              <h3>Render worker setup</h3>
              <p>
                Install FFmpeg and FFprobe with H.264, AAC and caption support, then use the same
                Supabase worker credentials. Successful narration queues a video automatically.
              </p>
              <pre>npm run worker:render</pre>
              <p>
                Check local rendering with <code>npm run render:smoke</code>. It creates a real MP4
                using explicitly labeled test artwork and local speech. See the README for
                installation and optional background music.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
