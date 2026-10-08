using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.RankBox.Services;

public class Candidate
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int? Year { get; set; }

    public string Type { get; set; } = "Series";

    /// <summary>finished, watching or unwatched, as far as Jellyfin knows.</summary>
    public string Status { get; set; } = "unwatched";

    public int PlayedEpisodes { get; set; }

    public int TotalEpisodes { get; set; }

    public string? LastWatched { get; set; }

    public string[] Genres { get; set; } = Array.Empty<string>();

    public string[] Studios { get; set; } = Array.Empty<string>();
}

public class LibraryService
{
    // Building candidates walks every episode's user data (~1–2 s on a big library),
    // so keep it per user for a few minutes. Watch events clear it straight away.
    private static readonly ConcurrentDictionary<(Guid, string), (DateTime At, List<Candidate> Items)> Cache = new();
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(10);

    private readonly ILibraryManager _library;
    private readonly IUserManager _users;
    private readonly IUserDataManager _userData;

    public LibraryService(ILibraryManager library, IUserManager users, IUserDataManager userData)
    {
        _library = library;
        _users = users;
        _userData = userData;
    }

    public static void Invalidate(Guid userId)
    {
        foreach (var k in Cache.Keys.Where(k => k.Item1 == userId).ToList())
        {
            Cache.TryRemove(k, out _);
        }
    }

    public bool UserExists(Guid userId) => _users.GetUserById(userId) != null;

    public string UserName(Guid userId) => _users.GetUserById(userId)?.Username ?? "Someone";

    public string? Name(string id) => Guid.TryParse(id, out var g) ? _library.GetItemById(g)?.Name : null;

    public List<Candidate> GetCandidates(Guid userId, string list)
    {
        if (Cache.TryGetValue((userId, list), out var hit) && DateTime.UtcNow - hit.At < CacheFor)
        {
            return hit.Items;
        }

        var items = Build(userId, list);
        Cache[(userId, list)] = (DateTime.UtcNow, items);
        return items;
    }

    private List<Candidate> Build(Guid userId, string list)
    {
        var user = _users.GetUserById(userId) ?? throw new ArgumentException("Unknown user");
        var result = new List<Candidate>();
        static string? Iso(DateTime? d) => d?.ToUniversalTime().ToString("o");

        if (list != "movies")
        {
            // series-level Played is unreliable for half-watched shows: count episodes (specials don't count)
            var stats = new Dictionary<Guid, (int Played, int Total, DateTime? Last)>();
            foreach (var item in _library.GetItemList(new InternalItemsQuery(user)
            {
                IncludeItemTypes = new[] { BaseItemKind.Episode },
                Recursive = true,
                IsVirtualItem = false,
            }))
            {
                if (item is not Episode ep || ep.SeriesId == Guid.Empty)
                {
                    continue;
                }

                var ud = _userData.GetUserData(user, ep);
                stats.TryGetValue(ep.SeriesId, out var s);
                if (ep.ParentIndexNumber != 0)
                {
                    s.Total++;
                    if (ud != null && (ud.Played || ud.PlayCount > 0))
                    {
                        s.Played++;
                    }
                }

                if (ud?.LastPlayedDate is DateTime lp && (s.Last == null || lp > s.Last))
                {
                    s.Last = lp;
                }

                stats[ep.SeriesId] = s;
            }

            foreach (var item in _library.GetItemList(new InternalItemsQuery(user) { IncludeItemTypes = new[] { BaseItemKind.Series }, Recursive = true }))
            {
                stats.TryGetValue(item.Id, out var s);
                var ud = _userData.GetUserData(user, item);
                var last = s.Last;
                if (ud?.LastPlayedDate is DateTime slp && (last == null || slp > last))
                {
                    last = slp;
                }

                var finished = (s.Total > 0 && s.Played >= s.Total) || ud?.Played == true;
                result.Add(new Candidate
                {
                    Id = item.Id.ToString("N"),
                    Name = item.Name,
                    Year = item.ProductionYear,
                    Type = "Series",
                    Status = finished ? "finished" : s.Played > 0 ? "watching" : "unwatched",
                    PlayedEpisodes = s.Played,
                    TotalEpisodes = s.Total,
                    LastWatched = Iso(last),
                    Genres = item.Genres ?? Array.Empty<string>(),
                    Studios = item.Studios ?? Array.Empty<string>(),
                });
            }
        }

        if (list != "series")
        {
            foreach (var item in _library.GetItemList(new InternalItemsQuery(user)
            {
                IncludeItemTypes = new[] { BaseItemKind.Movie },
                Recursive = true,
                IsVirtualItem = false,
            }))
            {
                var ud = _userData.GetUserData(user, item);
                var played = ud != null && (ud.Played || ud.PlayCount > 0);
                result.Add(new Candidate
                {
                    Id = item.Id.ToString("N"),
                    Name = item.Name,
                    Year = item.ProductionYear,
                    Type = "Movie",
                    Status = played ? "finished" : (ud?.PlaybackPositionTicks ?? 0) > 0 ? "watching" : "unwatched",
                    LastWatched = Iso(ud?.LastPlayedDate),
                    Genres = item.Genres ?? Array.Empty<string>(),
                    Studios = item.Studios ?? Array.Empty<string>(),
                });
            }
        }

        return result.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Which list a details page belongs to: episodes and seasons count as their show.</summary>
    public (string Id, string List)? BadgeTarget(string itemId)
    {
        if (!Guid.TryParse(itemId, out var g) || _library.GetItemById(g) is not BaseItem item)
        {
            return null;
        }

        return item switch
        {
            Movie => (item.Id.ToString("N"), "movies"),
            Series => (item.Id.ToString("N"), "series"),
            Season s when s.SeriesId != Guid.Empty => (s.SeriesId.ToString("N"), "series"),
            Episode e when e.SeriesId != Guid.Empty => (e.SeriesId.ToString("N"), "series"),
            _ => null,
        };
    }

    /// <summary>Star these as favorites. Never removes a star.</summary>
    public int MarkFavorites(Guid userId, IEnumerable<string> ids)
    {
        var user = _users.GetUserById(userId) ?? throw new ArgumentException("Unknown user");
        var count = 0;
        foreach (var id in ids.Take(100))
        {
            if (!Guid.TryParse(id, out var g) || _library.GetItemById(g) is not BaseItem item)
            {
                continue;
            }

            var ud = _userData.GetUserData(user, item);
            if (ud == null)
            {
                continue;
            }

            if (!ud.IsFavorite)
            {
                ud.IsFavorite = true;
                _userData.SaveUserData(user, item, ud, UserDataSaveReason.UpdateUserRating, CancellationToken.None);
            }

            count++;
        }

        return count;
    }

    public static readonly Dictionary<string, (string Ext, string Mime)> Formats = new()
    {
        ["txt"] = ("txt", "text/plain"),
        ["md"] = ("md", "text/markdown"),
        ["csv"] = ("csv", "text/csv"),
        ["json"] = ("json", "application/json"),
    };

    /// <summary>Server-side export from the last saved snapshot (handy for scripts; the app exports on its own too).</summary>
    public string Export(Guid userId, string list, ListState state, string format)
    {
        var who = UserName(userId);
        var byId = GetCandidates(userId, list).ToDictionary(c => c.Id);
        var rows = (state.Snapshot?.Items ?? new()).Where(i => byId.ContainsKey(i.Id)).OrderBy(i => i.Rank).Select(i => (S: i, C: byId[i.Id])).ToList();
        var title = $"{who}'s {(list == "series" ? "Shows" : list == "movies" ? "Movies" : "Everything")} ranking";
        var date = DateTime.Now.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        string Yr(Candidate c) => c.Year is int y ? $" ({y})" : string.Empty;
        var sb = new StringBuilder();
        switch (format)
        {
            case "md":
                sb.AppendLine($"# {title}").AppendLine().AppendLine($"_{rows.Count} ranked · {state.Answers.Count} answers · {date} · made with RankBox_").AppendLine();
                foreach (var tier in new[] { "S", "A", "B", "C", "D" })
                {
                    var t = rows.Where(r => r.S.Tier == tier).ToList();
                    if (t.Count == 0)
                    {
                        continue;
                    }

                    sb.AppendLine($"## {tier} tier").AppendLine();
                    foreach (var (s, c) in t)
                    {
                        sb.AppendLine(CultureInfo.InvariantCulture, $"{s.Rank}. **{c.Name.Replace("*", "\\*")}**{Yr(c)} — {s.Score:0.0}");
                    }

                    sb.AppendLine();
                }

                break;
            case "csv":
                sb.AppendLine("rank,title,year,type,tier,score,last_watched,jellyfin_id");
                foreach (var (s, c) in rows)
                {
                    var name = c.Name.IndexOfAny(new[] { ',', '"', '\n' }) >= 0 ? "\"" + c.Name.Replace("\"", "\"\"") + "\"" : c.Name;
                    sb.AppendLine(CultureInfo.InvariantCulture, $"{s.Rank},{name},{c.Year},{c.Type},{s.Tier},{s.Score:0.0},{c.LastWatched?[..10]},{s.Id}");
                }

                break;
            case "json":
                return JsonSerializer.Serialize(
                    new { title, list, exported = DateTime.UtcNow, answers = state.Answers.Count, ranking = rows.Select(r => new { r.S.Rank, title = r.C.Name, r.C.Year, r.C.Type, r.S.Tier, r.S.Score, r.S.Id }) },
                    Json.File);
            default:
                sb.AppendLine($"{title} ({date})").AppendLine();
                var current = string.Empty;
                foreach (var (s, c) in rows)
                {
                    if (s.Tier != current)
                    {
                        if (current.Length > 0)
                        {
                            sb.AppendLine();
                        }

                        sb.AppendLine($"{s.Tier} TIER");
                        current = s.Tier;
                    }

                    sb.AppendLine($"{s.Rank}. {c.Name}{Yr(c)}");
                }

                break;
        }

        return sb.ToString();
    }
}
