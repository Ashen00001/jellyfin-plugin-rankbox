using System.Globalization;
using System.Text.Json;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.RankBox.Services;

public class Answer
{
    public string Id { get; set; } = string.Empty;

    public string A { get; set; } = string.Empty;

    public string B { get; set; } = string.Empty;

    /// <summary>1 = A better, 0 = B better, 0.5 = about the same.</summary>
    public double R { get; set; }

    public string At { get; set; } = string.Empty;

    public string Kind { get; set; } = "place";

    public bool? FreshA { get; set; }

    public bool? FreshB { get; set; }

    public string? CheckedAt { get; set; }

    public string? Outcome { get; set; }
}

public class SnapItem
{
    public string Id { get; set; } = string.Empty;

    public int Rank { get; set; }

    public double Score { get; set; }

    public string Tier { get; set; } = "B";
}

public class Snapshot
{
    public string At { get; set; } = string.Empty;

    public List<SnapItem> Items { get; set; } = new();
}

/// <summary>One person's ranking list. The browser runs the engine; the server keeps the evidence.</summary>
public class ListState
{
    public int Version { get; set; } = 2;

    public List<Answer> Answers { get; set; } = new();

    public List<string> Excluded { get; set; } = new();

    public Dictionary<string, string> TierOverrides { get; set; } = new();

    public bool WatchedOnly { get; set; }

    public Snapshot? Snapshot { get; set; }
}

public class UserSettings
{
    public bool ShareWithFriends { get; set; }
}

/// <summary>Per-user JSON files in Jellyfin's data folder: rankings follow you across devices.</summary>
public class Store
{
    public static readonly string[] Lists = { "series", "movies", "all" };
    private static readonly string[] Tiers = { "S", "A", "B", "C", "D" };
    private static readonly object Gate = new();
    private readonly string _dir;

    public Store(IApplicationPaths paths)
    {
        _dir = Path.Combine(paths.DataPath, "rankbox");
    }

    public static bool IsList(string list) => Lists.Contains(list);

    public ListState Get(Guid user, string list)
    {
        lock (Gate)
        {
            var all = Read<Dictionary<string, ListState>>(V2File(user)) ?? new();
            if (all.TryGetValue(list, out var s))
            {
                return s;
            }

            // first visit since v2: carry over a v1 list if there was one
            var migrated = MigrateV1(user, list);
            if (migrated != null)
            {
                all[list] = migrated;
                Write(V2File(user), all);
                return migrated;
            }

            return new ListState();
        }
    }

    public void Save(Guid user, string list, ListState incoming)
    {
        var clean = Clean(incoming);
        lock (Gate)
        {
            var all = Read<Dictionary<string, ListState>>(V2File(user)) ?? new();
            all[list] = clean;
            Write(V2File(user), all);
        }
    }

    /// <summary>Change a list in place under the lock (used by server-side edits).</summary>
    public void Update(Guid user, string list, Action<ListState> change)
    {
        lock (Gate)
        {
            var all = Read<Dictionary<string, ListState>>(V2File(user)) ?? new();
            var s = all.TryGetValue(list, out var x) ? x : new ListState();
            change(s);
            all[list] = Clean(s);
            Write(V2File(user), all);
        }
    }

    public UserSettings GetSettings(Guid user)
    {
        lock (Gate)
        {
            return Read<UserSettings>(SettingsFile(user)) ?? new UserSettings();
        }
    }

    public void SaveSettings(Guid user, UserSettings s)
    {
        lock (Gate)
        {
            Write(SettingsFile(user), s);
        }
    }

    /// <summary>Everyone who has a RankBox file (for taste match).</summary>
    public IEnumerable<Guid> Users()
    {
        if (!Directory.Exists(_dir))
        {
            return Enumerable.Empty<Guid>();
        }

        return Directory.GetFiles(_dir, "*.v2.json")
            .Select(f => Path.GetFileName(f).Split('.')[0])
            .Select(n => Guid.TryParse(n, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty);
    }

    private static string? Id(string? s) => Guid.TryParse(s, out var g) ? g.ToString("N") : null;

    private static ListState Clean(ListState s)
    {
        var answers = (s.Answers ?? new())
            .Select(a => new Answer
            {
                Id = string.IsNullOrWhiteSpace(a.Id) ? Guid.NewGuid().ToString("N")[..12] : a.Id[..Math.Min(40, a.Id.Length)],
                A = Id(a.A) ?? string.Empty,
                B = Id(a.B) ?? string.Empty,
                R = a.R >= 0.75 ? 1 : a.R <= 0.25 ? 0 : 0.5,
                At = DateTime.TryParse(a.At, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at) ? at.ToUniversalTime().ToString("o") : DateTime.UtcNow.ToString("o"),
                Kind = a.Kind is "place" or "refine" or "recheck" or "conflict" or "manual" ? a.Kind : "place",
                FreshA = a.FreshA == true ? true : null,
                FreshB = a.FreshB == true ? true : null,
                CheckedAt = string.IsNullOrEmpty(a.CheckedAt) ? null : a.CheckedAt,
                Outcome = a.Outcome is "kept" or "flipped" ? a.Outcome : null,
            })
            .Where(a => a.A.Length > 0 && a.B.Length > 0 && a.A != a.B)
            .TakeLast(20000)
            .ToList();

        var snap = s.Snapshot == null ? null : new Snapshot
        {
            At = s.Snapshot.At,
            Items = (s.Snapshot.Items ?? new())
                .Select(i => new SnapItem { Id = Id(i.Id) ?? string.Empty, Rank = i.Rank, Score = Math.Round(Math.Clamp(i.Score, 0, 10), 1), Tier = Tiers.Contains(i.Tier) ? i.Tier : "B" })
                .Where(i => i.Id.Length > 0)
                .Take(10000)
                .ToList(),
        };

        return new ListState
        {
            Version = 2,
            Answers = answers,
            Excluded = (s.Excluded ?? new()).Select(Id).Where(x => x != null).Select(x => x!).Distinct().ToList(),
            TierOverrides = (s.TierOverrides ?? new())
                .Where(kv => Id(kv.Key) != null && Tiers.Contains(kv.Value))
                .ToDictionary(kv => Id(kv.Key)!, kv => kv.Value),
            WatchedOnly = s.WatchedOnly,
            Snapshot = snap,
        };
    }

    /// <summary>v1 kept an ordered list plus a log of answers. Turn both into v2 evidence.</summary>
    private ListState? MigrateV1(Guid user, string list)
    {
        var path = Path.Combine(_dir, user.ToString("N") + ".json");
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (!doc.RootElement.TryGetProperty(list, out var v1))
            {
                return null;
            }

            static List<string> Ids(JsonElement e, string name) =>
                e.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array
                    ? arr.EnumerateArray().Select(x => x.GetString() ?? string.Empty).Where(x => x.Length > 0).ToList()
                    : new List<string>();

            var ranked = Ids(v1, "Ranked");
            var state = new ListState { Excluded = Ids(v1, "Excluded") };
            if (v1.TryGetProperty("Answers", out var ans) && ans.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in ans.EnumerateArray())
                {
                    var aa = a.GetProperty("A").GetString() ?? string.Empty;
                    var w = a.GetProperty("W").GetString();
                    state.Answers.Add(new Answer
                    {
                        Id = a.GetProperty("Id").GetString() ?? string.Empty,
                        A = aa,
                        B = a.GetProperty("B").GetString() ?? string.Empty,
                        R = w == aa ? 1 : 0,
                        At = a.GetProperty("At").GetDateTime().ToUniversalTime().ToString("o"),
                        FreshA = a.TryGetProperty("FreshA", out var fa) && fa.GetBoolean(),
                        FreshB = a.TryGetProperty("FreshB", out var fb) && fb.GetBoolean(),
                        CheckedAt = a.TryGetProperty("CheckedAt", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null,
                    });
                }
            }

            if (state.Answers.Count == 0)
            {
                // only an order was saved: neighbours become the evidence
                var now = DateTime.UtcNow.ToString("o");
                for (var i = 0; i + 1 < ranked.Count; i++)
                {
                    state.Answers.Add(new Answer { A = ranked[i], B = ranked[i + 1], R = 1, At = now, Kind = "manual" });
                }
            }

            return state.Answers.Count == 0 && state.Excluded.Count == 0 ? null : Clean(state);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private string V2File(Guid user) => Path.Combine(_dir, user.ToString("N") + ".v2.json");

    private string SettingsFile(Guid user) => Path.Combine(_dir, user.ToString("N") + ".settings.json");

    private static T? Read<T>(string path)
        where T : class
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json.File);
        }
        catch (JsonException)
        {
            File.Copy(path, path + ".broken-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"), true);
            return null;
        }
    }

    private void Write(string path, object value)
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(value, Json.File));
        File.Move(path + ".tmp", path, true);
    }
}
