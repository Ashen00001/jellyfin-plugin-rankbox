# RankBox for Jellyfin

Rank your shows and movies by comparing them head to head, right inside Jellyfin.

RankBox asks one question at a time: **"Rate *X* higher or lower than *Y*?"**. New titles find their spot by binary search, so placing one into a list of 100 takes about 7 answers.

## Features

- **Higher / lower questions.** Rank shows, movies, or both together, as separate lists per user.
- **Full list with drag to reorder.** You can also tap a number to jump an item to a position, re-rank one item, or drop anything you haven't seen.
- **Fights recency bias.**
  - Every answer is logged with how recently you'd watched each title.
  - About 3 weeks later, answers made while one title was fresh come back as *"On Oct 7 you rated X over Y, right after watching X. Still agree?"*
  - "Keep refining" pairs up neighbours you watched far apart in time.
- **Just-finished prompts.** Finishing a movie, playing the last episode of a show, or marking something as watched puts it in your RankBox inbox.
- **Small banner in Jellyfin web.** A thumbnail card slides down from the top. It's never full screen and never shows during playback.
- **Export** as plain text, Markdown, CSV or JSON, or copy to the clipboard.
- **Star your top 10** as Jellyfin favorites, so they show in every client.
- **Saved on the server.** Rankings follow you across devices.
- **No extra login.** RankBox uses your Jellyfin session; there's no API key to paste.

## Install

Requires Jellyfin **12.1**.

1. Download `rankbox_<version>.zip` from [Releases](../../releases).
2. Unzip it into your Jellyfin `plugins` folder as `RankBox_<version>/`.
3. Restart Jellyfin.

**Optional companion plugins:**
- **[Plugin Pages](https://github.com/IAmParadox27/jellyfin-plugin-pages):** adds RankBox to every user's side menu.
- **[File Transformation](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation):** turns on the slide-down banners in Jellyfin web.

Without them, RankBox still works at `https://<your-server>/RankBox/App`.

## API

All endpoints need a signed-in user, except `App`, `Embed` and `notify.js`.

| Endpoint | Description |
|---|---|
| `GET /RankBox/App` | The web app |
| `GET /RankBox/Candidates?list=series\|movies\|all` | Titles, with watch status and last-watched dates |
| `GET/POST /RankBox/State?list=…` | A user's ranking |
| `GET /RankBox/Export?list=…&format=txt\|md\|csv\|json` | Download the ranking |
| `GET /RankBox/Inbox` | Just-finished titles and due recency checks |
| `POST /RankBox/Recheck?list=…&answerId=…&agree=true\|false` | Answer a recency check |
| `POST /RankBox/Favorites?list=…&top=10` | Star the top N as favorites |

## Build

```bash
dotnet build Jellyfin.Plugin.RankBox -c Release
```

On a Windows machine with Jellyfin installed, the build compiles against the local install. Anywhere else, it uses the official Jellyfin NuGet packages. `deploy.ps1` builds, installs into a local Jellyfin and restarts it.
