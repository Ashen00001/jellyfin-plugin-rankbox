# RankBox for Jellyfin

Rank your shows and movies by comparing them head to head, right inside Jellyfin.

RankBox asks one thing at a time: **"Rate *X* higher or lower than *Y*?"**. Every answer feeds a rating model, so each title gets a **score**, a **tier** (S–D) and a **confidence** level. You can tap "about the same", and RankBox finds contradictions and asks again. A recency check later re-asks answers you gave right after a binge, so last week's show doesn't float to the top just for being fresh.

## Features

**Rank**
- Higher / about the same / lower questions.
- New titles find their spot in about log₂(n) questions, and a ladder shows where they can still land.

**Ranking**
- A leaderboard with scores and confidence, grouped by tier.
- Drag to reorder. A drag is evidence: moving a title up past others means "it's better than those".
- Search, jump to a position, re-rank a single title, or hide anything you haven't seen.

**Tiers**
- Tiers split where your scores have natural gaps (Jenks breaks).
- Drag posters between rows to pin a title to a tier.

**Insights**
- **Recency-bias meter:** how often fresh watches win compared with what the rest of your answers predict.
- **Taste profile:** genres, animation studios and eras you rate highest.
- **Taste match:** compare with other users on the server. Opt-in, both sides.

**Share**
- A share image: a podium-style top 10, or the tier list.
- Export as Markdown, text, CSV or JSON.
- Star your top 10 as Jellyfin favorites.

**Inside Jellyfin**
- A **home-screen pane** where you answer the next question in place and see your top 5.
- A **RankBox** link in the header.
- A **"#4 · A tier" badge** on show and movie pages.
- **Slide-down banners** when you finish something or a recency check is due.

**Under the hood**
- Watch events (finishing a show, marking it watched, Trakt syncs) fill a "just finished" inbox.
- Rankings are stored per user on the server, so they follow you across devices.

## Install

Requires Jellyfin **12.1**.

1. Download `rankbox_<version>.zip` from [Releases](../../releases).
2. Unzip it into your Jellyfin `plugins` folder.
3. Restart Jellyfin.

**Recommended:** **[File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)** turns on the home pane, the header link, the badges and the banners, without editing Jellyfin's files. Without it, RankBox still works at `https://<your-server>/RankBox/App`.

## How the ranking works

- **Model:** Bradley–Terry with ties, fitted as a MAP estimate with a normal prior (`web/src/lib/engine`). Strength θ maps to a 0–10 score.
- **Answer weights:** the newest answer about a pair outweighs older ones. Answers lose half their weight per year. Answers given right after watching count at 70% until a recency check re-confirms them.
- **Question choice:**
  1. Finish placing the current title against the closest-strength opponent.
  2. Due recency checks.
  3. Contradictions, where an old answer the model now finds very unlikely gets re-asked.
  4. New titles, older watches first.
  5. Optional refinement of close neighbours watched far apart in time.
- **Tests:** in `engine.test.ts`. A known order is rebuilt from about log₂(n) questions per title and survives 10% wrong answers.

## Develop

```bash
cd web
npm ci
npm run dev      # demo mode with sample data at http://localhost:5173
npm test         # engine tests
npm run build    # -> web/dist, embedded into the plugin
```

**Plugin build:** `dotnet build Jellyfin.Plugin.RankBox -c Release`. It compiles against a local Jellyfin install when one exists, otherwise against the official NuGet packages.

**Local install:** `deploy.ps1` runs the tests, builds both parts, installs into a local Jellyfin and restarts it.

## API

All endpoints need a signed-in user, except the app files.

| Endpoint | Description |
|---|---|
| `GET /RankBox/App` | The web app |
| `GET /RankBox/Candidates?list=series\|movies\|all` | Titles, with watch status, last-watched date, genres and studios |
| `GET/POST /RankBox/State?list=…` | A user's answers, tier pins and the latest ranking snapshot |
| `GET /RankBox/Inbox?withRechecks=true` | Just-finished titles and due recency checks |
| `GET /RankBox/Badge?itemId=…` | Rank, tier and score for a show/movie page |
| `GET /RankBox/Friends?list=…` | Other users' snapshots (only when both share) |
| `GET/POST /RankBox/Settings` | `{ shareWithFriends }` |
| `POST /RankBox/Favorites` | `{ ids: [...] }` → star them in Jellyfin |
| `GET /RankBox/Export?list=…&format=txt\|md\|csv\|json` | Download the ranking |
