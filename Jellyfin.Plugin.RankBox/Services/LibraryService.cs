using System.Globalization;
using System.Text;
using System.Text.Json;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.RankBox.Services;

public class Candidate
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int? Year { get; set; }

    public string Type { get; set; } = string.Empty;

    /// <summary>finished, watching or unwatched (as far as Jellyfin knows).</summary>
    public string Status { get; set; } = "unwatched";

    public int PlayedEpisodes { get; set; }

    public int TotalEpisodes { get; set; }

    /// <summary>Latest play of the movie, or of any episode in the series. Null when Jellyfin never saw it played.</summary>
    public DateTime? LastWatched { get; set; }

    public bool IsFavorite { get; set; }
}

public class LibraryService
{
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;
    private readonly IUserDataManager _userData;

    public LibraryService(ILibraryManager library, IUserManager users, IUserDataManager userData)
    {
        _library = library;
        _users = users;
        _userData = userData;
    }

    public bool UserExists(Guid userId) => _users.GetUserById(userId) != null;

    public List<Candidate> GetCandidates(Guid userId, string list)
    {
        var user = _users.GetUserById(userId) ?? throw new ArgumentException("Unknown user");
        var result = new List<Candidate>();

        if (list != "movies")
        {
            // Series-level Played is unreliable for half-watched shows, so build status
            // from the episodes themselves (specials don't count toward "finished").
            var stats = new Dictionary<Guid, (int Played, int Total, DateTime? Last)>();
            var episodes = _library.GetItemList(new InternalItemsQuery(user)
            {
                IncludeItemTypes = new[] { BaseItemKind.Episode },
                Recursive = true,
                IsVirtualItem = false
            });

            foreach (var item in episodes)
            {
                if (item is not Episode ep || ep.SeriesId == Guid.Empty)
                {
                    continue;
                }

                var ud = _userData.GetUserData(user, ep);
                stats.TryGetValue(ep.SeriesId, out var s);
                var regular = ep.ParentIndexNumber != 0;
                var played = ud != null && (ud.Played || ud.PlayCount > 0);
                if (regular)
                {
                    s.Total++;
                    if (played)
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

            var series = _library.GetItemList(new InternalItemsQuery(user)
            {
                IncludeItemTypes = new[] { BaseItemKind.Series },
                Recursive = true
            });

            foreach (var item in series)
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
                    LastWatched = last,
                    IsFavorite = ud?.IsFavorite == true
                });
            }
        }

        if (list != "series")
        {
            var movies = _library.GetItemList(new InternalItemsQuery(user)
            {
                IncludeItemTypes = new[] { BaseItemKind.Movie },
                Recursive = true,
                IsVirtualItem = false
            });

            foreach (var item in movies)
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
                    LastWatched = ud?.LastPlayedDate,
                    IsFavorite = ud?.IsFavorite == true
                });
            }
        }

        return result.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Marks the top N ranked items as favorites. Never un-favorites anything.</summary>
    public int MarkFavorites(Guid userId, IEnumerable<string> ids)
    {
        var user = _users.GetUserById(userId) ?? throw new ArgumentException("Unknown user");
        var count = 0;
        foreach (var id in ids)
        {
            if (!Guid.TryParse(id, out var guid) || _library.GetItemById(guid) is not BaseItem item)
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
        ["json"] = ("json", "application/json")
    };

    public string Export(Guid userId, string list, ListState state, string format)
    {
        var user = _users.GetUserById(userId) ?? throw new ArgumentException("Unknown user");
        var byId = GetCandidates(userId, list).ToDictionary(c => c.Id);
        var rows = state.Ranked.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
        var title = list switch { "series" => "Shows", "movies" => "Movies", _ => "Shows & movies" };
        var date = DateTime.Now.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        string Year(Candidate c) => c.Year is int y ? $" ({y})" : string.Empty;

        var sb = new StringBuilder();
        switch (format)
        {
            case "md":
                sb.AppendLine($"# {user.Username}'s {title} ranking");
                sb.AppendLine();
                sb.AppendLine($"_{rows.Count} ranked · {state.Comparisons} comparisons · exported {date} with RankBox_");
                sb.AppendLine();
                for (var i = 0; i < rows.Count; i++)
                {
                    var c = rows[i];
                    var kind = list == "all" ? (c.Type == "Movie" ? " · movie" : " · series") : string.Empty;
                    sb.AppendLine($"{i + 1}. **{EscapeMd(c.Name)}**{Year(c)}{kind}");
                }

                break;

            case "csv":
                sb.AppendLine("rank,title,year,type,status,last_watched,jellyfin_id");
                for (var i = 0; i < rows.Count; i++)
                {
                    var c = rows[i];
                    sb.AppendLine(string.Join(',',
                        i + 1,
                        Csv(c.Name),
                        c.Year?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
                        c.Type,
                        c.Status,
                        c.LastWatched?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty,
                        c.Id));
                }

                break;

            case "json":
                return JsonSerializer.Serialize(
                    new
                    {
                        user = user.Username,
                        list,
                        exported = DateTime.UtcNow,
                        comparisons = state.Comparisons,
                        ranking = rows.Select((c, i) => new { rank = i + 1, c.Name, c.Year, c.Type, c.Status, c.LastWatched, c.Id })
                    },
                    new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

            default:
                sb.AppendLine($"{user.Username}'s {title} ranking ({date})");
                sb.AppendLine();
                for (var i = 0; i < rows.Count; i++)
                {
                    sb.AppendLine($"{i + 1}. {rows[i].Name}{Year(rows[i])}");
                }

                break;
        }

        return sb.ToString();
    }

    private static string EscapeMd(string s) =>
        s.Replace("\\", "\\\\").Replace("*", "\\*").Replace("_", "\\_").Replace("[", "\\[").Replace("]", "\\]");

    private static string Csv(string s) =>
        s.IndexOfAny(new[] { ',', '"', '\n' }) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
}
