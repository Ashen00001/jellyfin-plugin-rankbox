using System.Runtime.Loader;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>What File Transformation hands our callbacks.</summary>
public class PatchRequestPayload
{
    [JsonPropertyName("contents")]
    public string? Contents { get; set; }
}

/// <summary>
/// Hooks RankBox into Jellyfin's web app through the File Transformation plugin (no files on disk are edited):
///  - index.html gets the RankBox script (home pane, show-page badge, banners)
///  - config.json gets a "RankBox" menu link, which Jellyfin shows in its own header and side menu
/// Without File Transformation, RankBox still works at /RankBox/App.
/// </summary>
public static class WebInjector
{
    private const string Marker = "plugin=\"RankBox\"";

    public static void Register(ILogger log)
    {
        _ = Task.Run(async () =>
        {
            for (var attempt = 0; attempt < 12; attempt++)
            {
                var ft = AssemblyLoadContext.All
                    .SelectMany(c => c.Assemblies)
                    .FirstOrDefault(a => a.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);
                var register = ft?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface")?.GetMethod("RegisterTransformation");
                if (register != null)
                {
                    void Add(string id, string pattern, string method) => register.Invoke(null, new object?[]
                    {
                        new JObject
                        {
                            { "id", id },
                            { "fileNamePattern", pattern },
                            { "callbackAssembly", typeof(WebInjector).Assembly.FullName },
                            { "callbackClass", typeof(WebInjector).FullName },
                            { "callbackMethod", method },
                        },
                    });
                    // use the exact names: File Transformation runs only the exact-name pipeline when one exists
                    // (other plugins register "index.html" too). The names also work as regexes, so "index.html" reaches
                    // Jellyfin's "*-index-html.chunk.js" files as well; both transforms leave anything that isn't their file alone
                    Add("8a3d9c51-6b0e-4f6a-9d6e-6c1f0b2a7e31", "index.html", nameof(TransformIndex));
                    Add("5c1f7e62-2d4b-4b8e-8f0a-3b9d6e2c1a47", "config.json", nameof(TransformConfig));
                    log.LogInformation("RankBox: hooked into Jellyfin web via File Transformation");
                    return;
                }

                await Task.Delay(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
            }

            log.LogWarning("RankBox: File Transformation plugin not found; the home pane, badges and header link are off");
        });
    }

    private static string Version => (typeof(WebInjector).Assembly.GetName().Version?.ToString() ?? "2") + "-" + Assets.BuildStamp;

    public static string TransformIndex(PatchRequestPayload payload)
    {
        var html = payload.Contents ?? string.Empty;
        var at = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        // only ever touch the real page: anything without a </body> (e.g. a JS chunk) is left exactly as it was
        if (at < 0 || html.Contains(Marker, StringComparison.Ordinal))
        {
            return html;
        }

        return html.Insert(at, $"<script type=\"module\" {Marker} src=\"../RankBox/inject.js?v={Version}\"></script>");
    }

    public static string TransformConfig(PatchRequestPayload payload)
    {
        try
        {
            if (JsonNode.Parse(payload.Contents ?? string.Empty) is not JsonObject root || root["menuLinks"] is not (null or JsonArray))
            {
                return payload.Contents ?? string.Empty;
            }

            var links = root["menuLinks"] as JsonArray ?? new JsonArray();
            if (!links.Any(l => l?["name"]?.GetValue<string>() == "RankBox"))
            {
                links.Add(new JsonObject { ["name"] = "RankBox", ["icon"] = "leaderboard", ["url"] = "../RankBox/App" });
            }

            root["menuLinks"] = links;
            return root.ToJsonString();
        }
        catch (Exception)
        {
            return payload.Contents ?? "{}";
        }
    }
}
