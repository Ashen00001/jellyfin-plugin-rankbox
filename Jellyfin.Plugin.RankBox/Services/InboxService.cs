using System.Globalization;
using System.Text.Json;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>Something just finished (or marked watched) that RankBox wants placed.</summary>
public class PendingFinish
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Type { get; set; } = "Series";

    public string List { get; set; } = "series";

    public string FinishedAt { get; set; } = string.Empty;

    public int? RankedAt { get; set; }
}

/// <summary>"On Oct 7 you rated W over L right after watching W. Still agree?"</summary>
public class RecheckDue
{
    public string List { get; set; } = string.Empty;

    public string AnswerId { get; set; } = string.Empty;

    public string Winner { get; set; } = string.Empty;

    public string Loser { get; set; } = string.Empty;

    public string WinnerName { get; set; } = string.Empty;

    public string LoserName { get; set; } = string.Empty;

    public string At { get; set; } = string.Empty;
}

public class InboxService
{
    public static readonly TimeSpan RecheckAfter = TimeSpan.FromDays(21);
    private static readonly object Gate = new();
    private readonly string _dir;
    private readonly Store _store;

    public InboxService(IApplicationPaths paths, Store store)
    {
        _dir = Path.Combine(paths.DataPath, "rankbox");
        _store = store;
    }

    public List<PendingFinish> Finished(Guid user)
    {
        var cutoff = DateTime.UtcNow.AddDays(-30);
        return ReadPending(user)
            .Where(p => DateTime.TryParse(p.FinishedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var d) && d > cutoff)
            .OrderByDescending(p => p.FinishedAt)
            .ToList();
    }

    /// <summary>
    /// Same rule as the app's engine: re-ask wins a title got while it was fresh, 3+ weeks later,
    /// at most two per title, only while the saved order still agrees with the answer.
    /// </summary>
    public List<RecheckDue> Rechecks(Guid user, Func<string, string?> name)
    {
        var due = new List<RecheckDue>();
        var cutoff = DateTime.UtcNow - RecheckAfter;
        foreach (var list in Store.Lists)
        {
            var s = _store.Get(user, list);
            if (s.Snapshot == null || s.Answers.Count == 0)
            {
                continue;
            }

            var rank = s.Snapshot.Items.ToDictionary(i => i.Id, i => i.Rank);
            var latest = s.Answers
                .GroupBy(a => string.CompareOrdinal(a.A, a.B) < 0 ? a.A + a.B : a.B + a.A)
                .Select(g => g.OrderBy(a => a.At, StringComparer.Ordinal).Last());

            var perWinner = new Dictionary<string, List<RecheckDue>>();
            foreach (var a in latest)
            {
                if (a.CheckedAt != null || a.R == 0.5 || a.Kind == "manual")
                {
                    continue;
                }

                if (!DateTime.TryParse(a.At, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at) || at > cutoff)
                {
                    continue;
                }

                var winner = a.R == 1 ? a.A : a.B;
                var loser = a.R == 1 ? a.B : a.A;
                var winnerFresh = winner == a.A ? a.FreshA == true : a.FreshB == true;
                if (!winnerFresh || !rank.TryGetValue(winner, out var wr) || !rank.TryGetValue(loser, out var lr) || wr > lr)
                {
                    continue;
                }

                if (!perWinner.TryGetValue(winner, out var l))
                {
                    perWinner[winner] = l = new List<RecheckDue>();
                }

                l.Add(new RecheckDue { List = list, AnswerId = a.Id, Winner = winner, Loser = loser, At = a.At });
            }

            foreach (var (_, l) in perWinner)
            {
                due.AddRange(l.OrderBy(d => rank[d.Loser]).Take(2));
            }
        }

        foreach (var d in due)
        {
            d.WinnerName = name(d.Winner) ?? "?";
            d.LoserName = name(d.Loser) ?? "?";
        }

        return due.OrderBy(d => d.At, StringComparer.Ordinal).Take(20).ToList();
    }

    public void AddPending(Guid user, PendingFinish item)
    {
        lock (Gate)
        {
            var all = ReadPending(user);
            all.RemoveAll(p => p.Id == item.Id);
            all.Add(item);
            WritePending(user, all.OrderByDescending(p => p.FinishedAt).Take(50).ToList());
        }
    }

    public void Dismiss(Guid user, string id)
    {
        lock (Gate)
        {
            var all = ReadPending(user);
            if (all.RemoveAll(p => p.Id == id) > 0)
            {
                WritePending(user, all);
            }
        }
    }

    private string FileFor(Guid user) => Path.Combine(_dir, user.ToString("N") + ".inbox.json");

    private List<PendingFinish> ReadPending(Guid user)
    {
        var path = FileFor(user);
        if (!File.Exists(path))
        {
            return new List<PendingFinish>();
        }

        try
        {
            // v1 wrote DateTime FinishedAt; read leniently and normalise to ISO strings
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.EnumerateArray().Select(e => new PendingFinish
            {
                Id = Get(e, "Id") ?? string.Empty,
                Name = Get(e, "Name") ?? string.Empty,
                Type = Get(e, "Type") ?? "Series",
                List = Get(e, "List") ?? "series",
                FinishedAt = Get(e, "FinishedAt") ?? DateTime.UtcNow.ToString("o"),
                RankedAt = (e.TryGetProperty("RankedAt", out var r) || e.TryGetProperty("rankedAt", out r)) && r.ValueKind == JsonValueKind.Number ? r.GetInt32() : null,
            }).Where(p => p.Id.Length > 0).ToList();
        }
        catch (JsonException)
        {
            return new List<PendingFinish>();
        }

        static string? Get(JsonElement e, string n) =>
            e.TryGetProperty(n, out var v) || e.TryGetProperty(char.ToLowerInvariant(n[0]) + n[1..], out v) ? v.ToString() : null;
    }

    private void WritePending(Guid user, List<PendingFinish> items)
    {
        Directory.CreateDirectory(_dir);
        var path = FileFor(user);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(items, Json.File));
        File.Move(path + ".tmp", path, true);
    }
}
