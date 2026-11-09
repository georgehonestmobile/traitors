# Round Table

Secret Slack voting for a Traitors-style game.

- **Admin GUI** (this web app): pick which Slack members can vote, set when voting opens and a strict deadline.
- **Slack DMs**: each selected player gets a private DM with a dropdown of the eligible players (including themselves). They pick once, confirm, and the vote is locked in.

Built with Next.js on Vercel, Upstash Redis for storage, and the Slack Web API.

## How it works

1. You create a round in the admin GUI: players, open time, close time.
2. The app opens a DM with each player. If voting opens now, the ballot is posted straight away; otherwise it is scheduled with Slack (`chat.scheduleMessage`) for the opening time. A "voting has closed" DM is also scheduled for the deadline.
3. When a player picks someone, Slack calls `/api/slack/interactions`. The app checks the Slack signature, that the player is eligible, that the target is eligible, and that **the server clock is inside the voting window**. Votes are written with `HSETNX`, so each player gets exactly one vote.
4. The DM is replaced with "Your vote is locked in: Adam". Late votes are rejected and the DM says so.
5. In the GUI you can watch turnout live, close voting early, or cancel a round (scheduled DMs are deleted, sent ones are marked cancelled).

6. After voting closes, run **the reveal** from the round's page: pick a Slack channel, the pace, and how often to post the running count, then press **Begin the reveal**.

## The reveal

The bot posts in the chosen channel:

1. An opener: how many voted, and who didn't.
2. For each vote: "*Jack* picks up their slate…", then a few seconds later the same message changes to "*Jack* votes for… *ADAM*".
3. The running count every few votes (configurable).
4. The verdict: who is banished, or a tie for the host to settle, with the final count.

**Suspense ordering** (`lib/suspense.ts`): the app tries many orderings and keeps the one where the result becomes mathematically certain as late as possible, the gap between first and second stays small, the eventual loser doesn't lead alone early, and the lead changes hands when it can. A 6–4 split comes out like `B A A B B A B A A A`.

**Pacing is driven by the admin page**, so no scheduler is needed: keep the round's page open while the reveal runs. Closing it pauses the reveal; reopening the page carries on where it left off. Pause, Resume and "Post next now" are on the page. Each step is claimed atomically in Redis, so two open tabs can't double-post. Reset lets you run it again (posts already in Slack stay).

## Test rounds

Choose **🧪 Test round** when creating a round to rehearse without bothering anyone. Nobody is DM'd. On the round's page a **Vote as a player** panel lets you pick who's voting and click who they vote for, or **fill in the rest randomly**. Close voting, then run the reveal as normal; reveal posts are labelled TEST. Voting on someone's behalf is only allowed in test rounds.

## Setup

### 1. Deploy to Vercel

1. Push this folder to a GitHub repo and import it into Vercel (**Add New → Project**).
2. In the Vercel project, go to **Storage → Create Database → Upstash (Redis)** and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Add environment variables (Settings → Environment Variables):
   - `ADMIN_PASSWORD`: the password for the admin GUI
   - `APP_TIMEZONE`: optional, defaults to `Europe/London`
   - `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`: from step 2 below
4. Deploy and note your URL, e.g. `https://round-table-xyz.vercel.app`.

### 2. Create the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App → From a manifest**, pick your workspace.
2. Paste `slack-app-manifest.json`, replacing `YOUR-APP.vercel.app` with your Vercel domain.
3. **Install to Workspace**.
4. Copy **OAuth & Permissions → Bot User OAuth Token** (`xoxb-…`) into `SLACK_BOT_TOKEN` on Vercel.
5. Copy **Basic Information → Signing Secret** into `SLACK_SIGNING_SECRET` on Vercel.
6. Redeploy on Vercel so the new env vars are picked up.

Scopes used: `chat:write` (send/update messages), `chat:write.public` (post the reveal in public channels without joining), `im:write` (open DMs), `users:read` (list members for the player picker), `channels:read` and `groups:read` (list channels for the reveal). Private channels appear once you've run `/invite @Round Table` in them.

**Adding scopes to an existing app:** in your Slack app, go to **OAuth & Permissions → Scopes → Bot Token Scopes**, add the missing ones, then **reinstall** the app when Slack prompts you. If the Bot User OAuth Token changes, update `SLACK_BOT_TOKEN` on Vercel and redeploy.

## Local development

```bash
npm install
cp .env.example .env.local   # optional
npm run dev
```

With no `SLACK_BOT_TOKEN`, the app runs in **demo mode**: a fake cast of players, and DMs are printed to the terminal instead of being sent. With no Redis env vars it uses in-memory storage. With no `ADMIN_PASSWORD` the admin is open (local only; production always requires it).

To test real Slack DMs locally, Slack needs a public URL for interactivity: run a tunnel (e.g. `ngrok http 3000`) and point the app's Interactivity Request URL at `https://<tunnel>/api/slack/interactions`.

## Notes

- Deadlines are enforced server-side using the server clock, not Slack's. Times in the GUI use `APP_TIMEZONE`; in Slack each player sees times in their own timezone.
- Slack can only schedule messages up to 120 days ahead.
- Votes are final. Players can vote for themselves.
- Reveals are named: everyone sees who voted for whom, like the show.
