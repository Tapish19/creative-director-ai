# Always Free worker hosting

The Vercel app serves the UI. The five long-running workers poll Supabase and need a separate machine with FFmpeg. A single Oracle Cloud Always Free Ampere A1 VM can host all five containers; no inbound application port is needed. The VM needs outbound HTTPS access to Supabase, Gemini and Cloudflare.

Oracle currently includes up to 2 A1 OCPUs and 12 GB memory on an Always Free tenancy, subject to availability in the tenancy's home region. Confirm the **Always Free** label and the cost estimate when creating the instance. A card is required for account verification. If A1 capacity is unavailable, try another availability domain or wait; do not select a paid shape unintentionally. See [Oracle's Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and [Free Tier FAQ](https://www.oracle.com/cloud/free/faq/).

## Create the VM

1. Create an Oracle Cloud Free Tier account. Choose the home region carefully because Always Free compute must run there.
2. Create an **Ubuntu 24.04 ARM64** VM with shape **VM.Standard.A1.Flex**, **2 OCPUs**, **12 GB RAM**, and the default **50 GB boot volume**. Confirm it is marked Always Free. Upload your SSH public key.
3. Allow SSH from your own IP. The worker containers expose no ports; they only make outbound connections.
4. Connect via SSH and install [Docker Engine and its Compose plugin for Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Use Docker's official repository rather than Ubuntu's older Docker package. Reconnect after adding your user to the `docker` group, or run the commands below with `sudo`.

## Start the workers

```bash
git clone https://github.com/Tapish19/creative-director-ai.git
cd creative-director-ai
cp .env.example .env.worker
chmod 600 .env.worker
nano .env.worker
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Keep `LOCAL_TTS_ENGINE=espeak`, `FFMPEG_PATH=ffmpeg` and `FFPROBE_PATH=ffprobe`. The voice worker uses eSpeak NG unless both ElevenLabs values are supplied. Do not put these secrets into GitHub or the Vercel web environment. `.env.worker` is ignored by Git and excluded from the Docker image; Compose injects it only at runtime.

```bash
docker compose -f compose.workers.yml up -d --build
docker compose -f compose.workers.yml ps
docker compose -f compose.workers.yml logs --tail=50 text images voice render review
```

Each worker should log that it started and is waiting for jobs. Then create a 15-second campaign in the Vercel app and check that the text, images, voice, render and review stages finish. A successful run should produce an MP4 that can be played, approved and downloaded. If a stage fails, inspect only that container's logs, for example `docker compose -f compose.workers.yml logs --tail=100 images`.

To deploy an update:

```bash
git pull --ff-only
docker compose -f compose.workers.yml up -d --build
```

To stop processing jobs: `docker compose -f compose.workers.yml down`. The database preserves queued work and assets across worker restarts.

## Limits

The free VM is a small shared host. Five idle workers are light, but FFmpeg and image processing can compete for its two OCPUs; keep one render worker and expect slower renders. Oracle can have A1 capacity shortages. Cloudflare, Gemini and Supabase have their own quotas; free VM hosting does not guarantee that provider usage remains free. For public signup, configure custom SMTP in Supabase Auth separately.
