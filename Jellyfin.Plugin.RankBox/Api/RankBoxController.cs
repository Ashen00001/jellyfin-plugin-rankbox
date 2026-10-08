using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.RankBox.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.RankBox.Api;

[ApiController]
[Route("RankBox")]
public class RankBoxController : ControllerBase
{
    private readonly LibraryService _library;
    private readonly Store _store;
    private readonly InboxService _inbox;

    public RankBoxController(ILibraryManager libraryManager, IUserManager userManager, IUserDataManager userDataManager, IApplicationPaths paths)
    {
        _library = new LibraryService(libraryManager, userManager, userDataManager);
        _store = new Store(paths);
        _inbox = new InboxService(paths, _store);
    }

    /* ---------------- the web app ---------------- */

    [HttpGet("App")]
    [AllowAnonymous]
    public ActionResult App() => Asset("index.html", "no-cache");

    [HttpGet("assets/{file}")]
    [AllowAnonymous]
    public ActionResult AppAsset(string file) => Asset("assets/" + file, "public, max-age=31536000, immutable");

    [HttpGet("favicon.svg")]
    [AllowAnonymous]
    public ActionResult Favicon() => Asset("favicon.svg", "public, max-age=86400");

    [HttpGet("inject.js")]
    [AllowAnonymous]
    public ActionResult Inject() => Asset("inject.js", "no-cache");

    /// <summary>For the dashboard page: the app in a frame.</summary>
    [HttpGet("Embed")]
    [AllowAnonymous]
    public ActionResult Embed()
    {
        Response.Headers["Cache-Control"] = "no-cache";
        return Content(
            "<div style=\"margin:0 -1em\"><iframe src=\"../RankBox/App\" title=\"RankBox\" allow=\"clipboard-write\" style=\"display:block;width:100%;height:calc(100vh - 5.5em);border:0;background:#0c0f14\"></iframe></div>",
            "text/html; charset=utf-8");
    }

    private ActionResult Asset(string path, string cache)
    {
        if (path.Contains("..", StringComparison.Ordinal) || Assets.Read(path) is not byte[] bytes)
        {
            return NotFound();
        }

        Response.Headers["Cache-Control"] = cache;
        return File(bytes, Assets.Mime(path));
    }

    /* ---------------- data ---------------- */

    [HttpGet("Me")]
    [Authorize]
    public ActionResult Me([FromQuery] Guid? userId = null) =>
        Who(userId) is Guid u ? Ok(new { id = u.ToString("N"), name = _library.UserName(u) }) : Unauthorized();

    [HttpGet("Candidates")]
    [Authorize]
    public ActionResult Candidates([FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!Store.IsList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        return Who(userId) is Guid u ? J(_library.GetCandidates(u, list)) : Unauthorized();
    }

    [HttpGet("State")]
    [Authorize]
    public ActionResult GetState([FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!Store.IsList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        return Who(userId) is Guid u ? J(_store.Get(u, list)) : Unauthorized();
    }

    [HttpPost("State")]
    [Authorize]
    public async Task<ActionResult> SaveState([FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!Store.IsList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        var state = await Body<ListState>();
        if (state == null)
        {
            return BadRequest("expected a RankBox list");
        }

        _store.Save(u, list, state);
        return NoContent();
    }

    /// <summary>Just-finished titles; with withRechecks=true also the recency checks that are due (for the banners).</summary>
    [HttpGet("Inbox")]
    [Authorize]
    public ActionResult Inbox([FromQuery] bool withRechecks = false, [FromQuery] Guid? userId = null)
    {
        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        var finished = _inbox.Finished(u);
        return withRechecks ? J(new { finished, rechecks = _inbox.Rechecks(u, _library.Name) }) : J(finished);
    }

    [HttpPost("Inbox/Dismiss")]
    [Authorize]
    public ActionResult Dismiss([FromQuery] string id, [FromQuery] Guid? userId = null)
    {
        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        _inbox.Dismiss(u, Guid.TryParse(id, out var g) ? g.ToString("N") : id);
        return NoContent();
    }

    /// <summary>"#4 · A tier" for a show or movie page (episodes and seasons count as their show).</summary>
    [HttpGet("Badge")]
    [Authorize]
    public ActionResult Badge([FromQuery] string itemId, [FromQuery] Guid? userId = null)
    {
        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        if (_library.BadgeTarget(itemId) is not (string id, string list))
        {
            return NoContent();
        }

        foreach (var l in new[] { list, "all" })
        {
            var snap = _store.Get(u, l).Snapshot;
            var hit = snap?.Items.FirstOrDefault(i => i.Id == id);
            if (hit != null)
            {
                return J(new { list = l, hit.Rank, hit.Tier, hit.Score, total = snap!.Items.Count });
            }
        }

        return NoContent();
    }

    public class FavoritesBody
    {
        public List<string> Ids { get; set; } = new();
    }

    [HttpPost("Favorites")]
    [Authorize]
    public async Task<ActionResult> Favorites([FromQuery] Guid? userId = null)
    {
        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        var body = await Body<FavoritesBody>();
        return J(new { marked = _library.MarkFavorites(u, body?.Ids ?? new()) });
    }

    [HttpGet("Settings")]
    [Authorize]
    public ActionResult GetSettings([FromQuery] Guid? userId = null) => Who(userId) is Guid u ? J(_store.GetSettings(u)) : Unauthorized();

    [HttpPost("Settings")]
    [Authorize]
    public async Task<ActionResult> SaveSettings([FromQuery] Guid? userId = null)
    {
        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        _store.SaveSettings(u, await Body<UserSettings>() ?? new UserSettings());
        return NoContent();
    }

    /// <summary>Other people's saved order for taste match. Both sides must have sharing on.</summary>
    [HttpGet("Friends")]
    [Authorize]
    public ActionResult Friends([FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!Store.IsList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        if (!_store.GetSettings(u).ShareWithFriends)
        {
            return J(Array.Empty<object>());
        }

        var friends = _store.Users()
            .Where(o => o != u && _library.UserExists(o) && _store.GetSettings(o).ShareWithFriends)
            .Select(o => (o, snap: _store.Get(o, list).Snapshot))
            .Where(x => x.snap != null && x.snap.Items.Count > 0)
            .Select(x => new { userId = x.o.ToString("N"), name = _library.UserName(x.o), items = x.snap!.Items })
            .ToList();
        return J(friends);
    }

    /// <summary>Download a ranking as txt, md, csv or json (from the last saved snapshot).</summary>
    [HttpGet("Export")]
    [Authorize]
    public ActionResult Export([FromQuery] string list = "series", [FromQuery] string format = "md", [FromQuery] Guid? userId = null)
    {
        if (!Store.IsList(list) || !LibraryService.Formats.TryGetValue(format, out var f))
        {
            return BadRequest("list must be series/movies/all, format txt/md/csv/json");
        }

        if (Who(userId) is not Guid u)
        {
            return Unauthorized();
        }

        var text = _library.Export(u, list, _store.Get(u, list), format);
        return File(new UTF8Encoding(false).GetBytes(text), f.Mime + "; charset=utf-8", $"rankbox-{list}-{DateTime.Now:yyyy-MM-dd}.{f.Ext}");
    }

    /* ---------------- helpers ---------------- */

    private ContentResult J(object value) => Content(JsonSerializer.Serialize(value, Services.Json.Options), "application/json; charset=utf-8");

    private async Task<T?> Body<T>()
        where T : class
    {
        try
        {
            return await JsonSerializer.DeserializeAsync<T>(Request.Body, Services.Json.Options).ConfigureAwait(false);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Signed-in users act as themselves; an API key (no user) may name one with ?userId=.</summary>
    private Guid? Who(Guid? requested)
    {
        var claim = User.Claims.FirstOrDefault(c => c.Type == "Jellyfin-UserId")?.Value;
        if (Guid.TryParse(claim, out var own) && own != Guid.Empty)
        {
            return own;
        }

        var isApiKey = string.Equals(User.Claims.FirstOrDefault(c => c.Type == "Jellyfin-IsApiKey")?.Value, "true", StringComparison.OrdinalIgnoreCase);
        return isApiKey && requested is Guid r && r != Guid.Empty && _library.UserExists(r) ? r : null;
    }
}
