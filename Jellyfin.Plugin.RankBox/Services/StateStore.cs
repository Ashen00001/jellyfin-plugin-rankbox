using System.Text.Json;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>One ranking list (series, movies or everything) for one user.</summary>
public class ListState
{
    public List<string> Ranked { get; set; } = new();

    public List<string> Queue { get; set; } = new();

    public List<string> Excluded { get; set; } = new();

    public int Comparisons { get; set; }

    public bool WatchedOnly { get; set; }

    public DateTime? Updated { get; set; }

    /// <summary>Every higher/lower answer, newest last. Recency checks are built from these.</summary>
    public List<AnswerRecord> Answers { get; set; } = new();
}

/// <summary>One answer: W beat the other of A/B at time At.</summary>
public class AnswerRecord
{
    public string Id { get; set; } = string.Empty;

    public string A { get; set; } = string.Empty;

    public string B { get; set; } = string.Empty;

    public string W { get; set; } = string.Empty;

    public DateTime At { get; set; }

    /// <summary>A was watched within the last 3 weeks when this was answered.</summary>
    public bool FreshA { get; set; }

    public bool FreshB { get; set; }

    /// <summary>Set once a recency check re-asked this answer (or it was superseded).</summary>
    public DateTime? CheckedAt { get; set; }

    /// <summary>"kept" or "flipped" after a recency check.</summary>
    public string? Outcome { get; set; }
}

/// <summary>Stores each user's lists as JSON in the server data folder, so rankings follow you across devices.</summary>
public class StateStore
{
    public static readonly string[] Lists = { "series", "movies", "all" };

    private const int MaxAnswers = 3000;

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private static readonly object Gate = new();
    private readonly string _dir;

    public StateStore(IApplicationPaths paths)
    {
        _dir = Path.Combine(paths.DataPath, "rankbox");
    }

    public static bool IsValidList(string list) => Lists.Contains(list);

    public ListState Get(Guid userId, string list)
    {
        lock (Gate)
        {
            return ReadAll(userId).TryGetValue(list, out var s) ? s : new ListState();
        }
    }

    public ListState Save(Guid userId, string list, ListState state)
    {
        // keep each id in exactly one bucket, in order, and drop anything that isn't a guid
        var seen = new HashSet<string>();
        List<string> Clean(IEnumerable<string>? ids) =>
            (ids ?? Enumerable.Empty<string>())
                .Select(i => Guid.TryParse(i, out var g) ? g.ToString("N") : null)
                .Where(i => i != null && seen.Add(i))
                .Select(i => i!)
                .ToList();

        static string? G(string? s) => Guid.TryParse(s, out var g) ? g.ToString("N") : null;
        var answers = (state.Answers ?? new List<AnswerRecord>())
            .Select(a => new AnswerRecord
            {
                Id = string.IsNullOrWhiteSpace(a.Id) ? Guid.NewGuid().ToString("N")[..10] : a.Id[..Math.Min(32, a.Id.Length)],
                A = G(a.A) ?? string.Empty,
                B = G(a.B) ?? string.Empty,
                W = G(a.W) ?? string.Empty,
                At = a.At == default ? DateTime.UtcNow : a.At.ToUniversalTime(),
                FreshA = a.FreshA,
                FreshB = a.FreshB,
                CheckedAt = a.CheckedAt?.ToUniversalTime(),
                Outcome = a.Outcome is "kept" or "flipped" ? a.Outcome : null
            })
            .Where(a => a.A.Length > 0 && a.B.Length > 0 && (a.W == a.A || a.W == a.B))
            .TakeLast(MaxAnswers)
            .ToList();

        var clean = new ListState
        {
            Ranked = Clean(state.Ranked),
            Queue = Clean(state.Queue),
            Excluded = Clean(state.Excluded),
            Comparisons = Math.Max(0, state.Comparisons),
            WatchedOnly = state.WatchedOnly,
            Updated = DateTime.UtcNow,
            Answers = answers
        };

        lock (Gate)
        {
            var all = ReadAll(userId);
            all[list] = clean;
            Directory.CreateDirectory(_dir);
            var path = FileFor(userId);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(all, Json));
            File.Move(tmp, path, true);
        }

        return clean;
    }

    private Dictionary<string, ListState> ReadAll(Guid userId)
    {
        var path = FileFor(userId);
        if (!File.Exists(path))
        {
            return new Dictionary<string, ListState>();
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, ListState>>(File.ReadAllText(path))
                   ?? new Dictionary<string, ListState>();
        }
        catch (JsonException)
        {
            // never throw away a broken file silently; park it next to the new one
            File.Copy(path, path + ".broken-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"), true);
            return new Dictionary<string, ListState>();
        }
    }

    private string FileFor(Guid userId) => Path.Combine(_dir, userId.ToString("N") + ".json");
}
