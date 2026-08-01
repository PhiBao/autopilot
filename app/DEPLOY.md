# Deploying Autopilot to Fly.io

A one-click-judge demo: the app runs against the **live Coston2 testnet** and the dashboard
drives the executor itself (it polls `/api/executor/tick` every 10s), so no cron is needed.
The intent store lives on a persistent Fly volume at `/data`.

Prereqs: `docker` is **not** needed (Fly builds on their side). You need a Fly account.

---

## 1. Install flyctl

```bash
curl -L https://fly.io/install.sh | sh
# then add to PATH (the installer prints the line, typically ~/.fly/bin)
export PATH="$HOME/.fly/bin:$PATH"
fly version
```

## 2. Log in

```bash
fly auth login
```

## 3. Create the app

The `fly.toml` in `app/` declares `app = "autopilot-beta"`. Names are globally unique, so
if that one is taken pick a suffix and update the name **in `fly.toml` first**:

```bash
cd app
fly apps create autopilot-beta          # or: fly launch --no-deploy to create + sync fly.toml
```

> If you changed the app name in `fly.toml`, run `fly launch --no-deploy` once — it will sync
> your existing config instead of overwriting it (answer "N" to the generated-Dockerfile prompt
> if asked — we already have one).

## 4. Create the persistent volume

Must match the `[[mounts]]` block and your `primary_region` in `fly.toml`:

```bash
fly volumes create autopilot_data --region sin --size 1
```

(If you changed `primary_region`, use that region here instead of `sin`.)

## 5. Deploy

```bash
fly deploy
```

First deploy builds the image on Fly (2–5 min), then starts one machine. When it's up:

```bash
fly open        # opens https://autopilot-beta.fly.dev
fly logs        # tail logs; useful if the first request 500s
```

## 6. Verify the live demo

1. Open the URL, click **"Try the demo wallet"**.
2. You should see positions + risk cards load from Coston2.
3. Run a quick deposit/exit to confirm the executor key works on the deployed instance
   (it's the same key from `.env.example`; everything is baked into `fly.toml`).

## Cost & always-on note

The config keeps **1 machine always on** (`auto_stop_machines = false`) so the demo is up when
judges visit and the executor polling keeps running. This costs roughly $2.50–5/month, well
within Fly's free $5 credit — fine for the ~2 weeks of judging. To stop it after the event:
`fly machine stop <id>` or `fly destroy autopilot-beta`.

---

## Re-deploy after code changes

```bash
cd app && fly deploy
```

## Sensitive values (not now, but if you ever go mainnet)

`EXECUTOR_PRIVATE_KEY` and the demo seed in `fly.toml` are **testnet-only and safe**. If you
ever deploy a real build, move them to secrets instead:

```bash
fly secrets set EXECUTOR_PRIVATE_KEY=<real-key>
```

and delete the `EXECUTOR_PRIVATE_KEY` line from `[env]` in `fly.toml`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `app name is already taken` | Change `app` in `fly.toml` → `fly apps create <new-name>` → `fly deploy` |
| Build fails at `pnpm install` | Ensure `pnpm-lock.yaml` + `pnpm-workspace.yaml` are committed; delete and retry with `fly deploy --remote-only` |
| `401` / executor errors in logs | The executor needs C2FLR on Coston2 — fund `0x7E5F…5Bdf` and retry |
| Positions empty on first load | Polling updates every ~12s; give it one refresh |
| Volume/mount mismatch | `fly volumes create autopilot_data --region <your region> --size 1` then re-deploy |
