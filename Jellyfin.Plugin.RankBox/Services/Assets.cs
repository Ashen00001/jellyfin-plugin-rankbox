using System.Reflection;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>The built web app (web/dist) is embedded in the DLL as "rankbox-web/&lt;path&gt;".</summary>
public static class Assets
{
    private const string Prefix = "rankbox-web/";
    private static readonly Assembly Asm = typeof(Assets).Assembly;
    private static readonly Dictionary<string, string> Names = Asm.GetManifestResourceNames()
        .Where(n => n.Replace('\\', '/').StartsWith(Prefix, StringComparison.Ordinal))
        .ToDictionary(n => n.Replace('\\', '/')[Prefix.Length..], n => n, StringComparer.Ordinal);

    /// <summary>Changes with every build, for cache-busting the script tag.</summary>
    public static readonly string BuildStamp = Asm.ManifestModule.ModuleVersionId.ToString("N")[..8];

    public static byte[]? Read(string path)
    {
        if (!Names.TryGetValue(path, out var name))
        {
            return null;
        }

        using var s = Asm.GetManifestResourceStream(name);
        if (s == null)
        {
            return null;
        }

        using var ms = new MemoryStream();
        s.CopyTo(ms);
        return ms.ToArray();
    }

    public static string Mime(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "application/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".json" => "application/json",
        _ => "application/octet-stream",
    };
}
