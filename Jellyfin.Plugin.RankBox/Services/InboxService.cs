using System.Text.Json;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>Something the user just finished (or marked watched) that RankBox wants placed.</summary>
public class PendingFinish
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Type { get; set; } = string.Empty;

    public int? Year { get; set; }

    public DateTime FinishedAt { get; set; }

    /// <summary>#position in the user's list when finished, if it was already ranked.</summary>
    public int? RankedAt { get; set; }

    public string List { get; set; } = "series";
}

/// <summary>"You rated W over L back when W was fresh, still agree?"</summary>
public class RecheckItem
{
    public string List { get; set; } = string.Empty;

    public string AnswerId { get; set; } = string.Empty;

    public string WinnerId { get; set; } = string.Empty;

    public string WinnerName { get; set; } = string.Empty;

    public string LoserId { get; set; } = string.Empty;

    public string LoserName { get; set; } = string.Empty;

    /// <summary>Which of the two was fresh (watched in the 3 weeks before the answer).</summary>
    public string FreshId { get; set; } = string.Empty;

    public DateTime AnsweredAt { get; set; }

    public int WinnerRank { get; set; }

    public int LoserRank { get; set; }
}

public class Inbox
{
    public List<PendingFinish> Finished { get; set; } = new();

    public List<RecheckItem> Rechecks { get; set; } = new();

    public int Count => Finished.Count + Rechecks.Count;
}

public class InboxService
{
    /// <summary>How long after a "fresh" answer before it gets re-asked.</summary>
    public static readonly TimeSpan RecheckAfter = TimeSpan.FromDays(21);

    private static readonly object Gate = new();
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private readonly string _dir;
    private readonly StateStore _store;
    private readonly ILibraryManager _library;

    public InboxService(IApplicationPaths paths, StateStore store, ILibraryManager library)
    {
        _dir = Path.Combine(paths.DataPath, "rankbox");
        _store = store;
        _library = library;
    }

    public Inbox Get(Guid userId)
    {
        var inbox = new Inbox();
        var cutoff = DateTime.UtcNow.AddDays(-30);
        inbox.Finished = ReadPending(userId).Where(p => p.FinishedAt > cutoff).OrderByDescending(p => p.FinishedAt).ToList();

        var now = DateTime.UtcNow;
        foreach (var list in StateStore.Lists)
        {
            var state = _store.Get(userId, list);
            if (state.Answers.Count == 0)
            {
                continue;
            }

            var pos = new Dictionary<string, int>();
            for (var i = 0; i < state.Ranked.Count; i++)
            {
                pos[state.Ranked[i]] = i;
            }

            // newest answer per pair wins; older ones about the same pair don't count
            var latest = state.Answers
                .GroupBy(a => string.CompareOrdinal(a.A, a.B) < 0 ? a.A + a.B : a.B + a.A)
                .Select(g => g.OrderBy(a => a.At).Last());

            foreach (var a in latest)
            {
                if (a.CheckedAt != null || !(a.FreshA || a.FreshB) || now - a.At < RecheckAfter)
                {
                    continue;
                }

                var loser = a.W == a.A ? a.B : a.A;
                // only ask while the list still says what that answer said
                if (!pos.TryGetValue(a.W, out var wp) || !pos.TryGetValue(loser, out var lp) || wp > lp)
                {
                    continue;
                }

                inbox.Rechecks.Add(new RecheckItem
                {
                    List = list,
                    AnswerId = a.Id,
                    WinnerId = a.W,
                    WinnerName = NameOf(a.W),
                    LoserId = loser,
                    LoserName = NameOf(loser),
                    FreshId = a.FreshA && a.FreshB ? string.Empty : a.FreshA ? a.A : a.B,
                    AnsweredAt = a.At,
                    WinnerRank = wp + 1,
                    LoserRank = lp + 1
                });
            }
        }

        inbox.Rechecks = inbox.Rechecks.OrderBy(r => r.AnsweredAt).Take(20).ToList();
        return inbox;
    }

    /// <summary>Apply a recency check. agree: true = keep, false = flip, null = not sure (just retire it).</summary>
    public ListState? Recheck(Guid userId, string list, string answerId, bool? agree)
    {
        var state = _store.Get(userId, list);
        var ans = state.Answers.FirstOrDefault(a => a.Id == answerId);
        if (ans == null)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var loser = ans.W == ans.A ? ans.B : ans.A;
        var winner = ans.W;

        // retire every open answer about this pair
        foreach (var a in state.Answers.Where(a => (a.A == ans.A && a.B == ans.B) || (a.A == ans.B && a.B == ans.A)))
        {
            a.CheckedAt ??= now;
        }

        ans.Outcome = agree switch { true => "kept", false => "flipped", _ => null };

        if (agree != null)
        {
            if (agree == false)
            {
                var wi = state.Ranked.IndexOf(winner);
                var li = state.Ranked.IndexOf(loser);
                if (wi >= 0 && li > wi)
                {
                    state.Ranked.RemoveAt(li);
                    state.Ranked.Insert(wi, loser);
                }
            }

            state.Comparisons++;
            state.Answers.Add(new AnswerRecord
            {
                Id = Guid.NewGuid().ToString("N")[..10],
                A = winner,
                B = loser,
                W = agree == true ? winner : loser,
                At = now,
                CheckedAt = now   // a deliberate second look doesn't need a third
            });
        }

        return _store.Save(userId, list, state);
    }

    public void AddPending(Guid userId, PendingFinish item)
    {
        lock (Gate)
        {
            var all = ReadPending(userId);
            all.RemoveAll(p => p.Id == item.Id);
            all.Add(item);
            WritePending(userId, all.OrderByDescending(p => p.FinishedAt).Take(50).ToList());
        }
    }

    public void Dismiss(Guid userId, string id)
    {
        lock (Gate)
        {
            var all = ReadPending(userId);
            if (all.RemoveAll(p => p.Id == id) > 0)
            {
                WritePending(userId, all);
            }
        }
    }

    private string NameOf(string id) =>
        Guid.TryParse(id, out var g) && _library.GetItemById(g) is { } item ? item.Name : "(removed)";

    private string FileFor(Guid userId) => Path.Combine(_dir, userId.ToString("N") + ".inbox.json");

    private List<PendingFinish> ReadPending(Guid userId)
    {
        lock (Gate)
        {
            var path = FileFor(userId);
            if (!File.Exists(path))
            {
                return new List<PendingFinish>();
            }

            try
            {
                return JsonSerializer.Deserialize<List<PendingFinish>>(File.ReadAllText(path)) ?? new List<PendingFinish>();
            }
            catch (JsonException)
            {
                return new List<PendingFinish>();
            }
        }
    }

    private void WritePending(Guid userId, List<PendingFinish> items)
    {
        Directory.CreateDirectory(_dir);
        var path = FileFor(userId);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(items, Json));
        File.Move(path + ".tmp", path, true);
    }
}
