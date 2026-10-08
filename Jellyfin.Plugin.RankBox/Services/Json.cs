using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>RankBox speaks camelCase JSON to its own front end, independent of Jellyfin's API style.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static readonly JsonSerializerOptions File = new(Options) { WriteIndented = true };
}
