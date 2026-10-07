using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>What File Transformation hands our callback.</summary>
public class PatchRequestPayload
{
    [JsonPropertyName("contents")]
    public string? Contents { get; set; }
}

/// <summary>
/// Adds the small RankBox banner script to Jellyfin's web index.html through the
/// File Transformation plugin, so nothing on disk gets edited. Without that plugin
/// RankBox still works, you just don't get the banners.
/// </summary>
public static class WebInjector
{
    private const string Marker = "<script plugin=\"RankBox\"";

    public static void Register(ILogger log)
    {
        _ = Task.Run(async () =>
        {
            for (var attempt = 0; attempt < 12; attempt++)
            {
                var ft = AssemblyLoadContext.All
                    .SelectMany(c => c.Assemblies)
                    .FirstOrDefault(a => a.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);
                var iface = ft?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
                var register = iface?.GetMethod("RegisterTransformation");
                if (register != null)
                {
                    var payload = new JObject
                    {
                        { "id", "8a3d9c51-6b0e-4f6a-9d6e-6c1f0b2a7e31" },
                        { "fileNamePattern", "index.html" },
                        { "callbackAssembly", typeof(WebInjector).Assembly.FullName },
                        { "callbackClass", typeof(WebInjector).FullName },
                        { "callbackMethod", nameof(TransformIndex) }
                    };
                    register.Invoke(null, new object?[] { payload });
                    log.LogInformation("RankBox: banner script registered with File Transformation");
                    return;
                }

                await Task.Delay(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
            }

            log.LogWarning("RankBox: File Transformation plugin not found, in-Jellyfin banners are off");
        });
    }

    public static string TransformIndex(PatchRequestPayload payload)
    {
        var html = payload.Contents ?? string.Empty;
        if (html.Contains(Marker, StringComparison.Ordinal))
        {
            return html;
        }

        var v = typeof(WebInjector).Assembly.GetName().Version?.ToString() ?? "1";
        var tag = $"{Marker} defer src=\"../RankBox/notify.js?v={v}\"></script>";
        var at = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return at >= 0 ? html.Insert(at, tag) : html + tag;
    }
}
