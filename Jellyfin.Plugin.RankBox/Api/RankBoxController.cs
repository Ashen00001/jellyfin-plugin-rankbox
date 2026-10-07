using System.Reflection;
using System.Text;
using Jellyfin.Plugin.RankBox.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.RankBox.Api;

[ApiController]
[Route("RankBox")]
public class RankBoxController : ControllerBase
{
    private readonly LibraryService _library;
    private readonly StateStore _store;

    public RankBoxController(
        ILibraryManager libraryManager,
        IUserManager userManager,
        IUserDataManager userDataManager,
        IApplicationPaths applicationPaths)
    {
        _library = new LibraryService(libraryManager, userManager, userDataManager);
        _store = new StateStore(applicationPaths);
        _inbox = new InboxService(applicationPaths, _store, libraryManager);
    }

    private readonly InboxService _inbox;

    /// <summary>The RankBox web app. Public HTML; all data calls below need a signed-in user.</summary>
    [HttpGet("App")]
    [AllowAnonymous]
    public ActionResult App()
    {
        using var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream(typeof(Plugin).Namespace + ".Web.app.html");
        if (stream == null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream);
        Response.Headers["Cache-Control"] = "no-cache";
        return Content(reader.ReadToEnd(), "text/html; charset=utf-8");
    }

    /// <summary>
    /// Fragment for the Plugin Pages side-menu entry. Plugin Pages pastes this straight into
    /// Jellyfin's page, so it only frames the real app instead of dragging its CSS/JS in.
    /// </summary>
    [HttpGet("Embed")]
    [AllowAnonymous]
    public ActionResult Embed()
    {
        Response.Headers["Cache-Control"] = "no-cache";
        const string html = """
            <div style="margin:0 -1em">
              <iframe src="../RankBox/App" title="RankBox" allow="clipboard-write"
                      style="display:block;width:100%;height:calc(100vh - 5.5em);border:0;background:#101014"></iframe>
            </div>
            """;
        return Content(html, "text/html; charset=utf-8");
    }

    [HttpGet("Candidates")]
    [Authorize]
    public ActionResult<List<Candidate>> Candidates([FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!StateStore.IsValidList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        var uid = ResolveUser(userId);
        return uid == null ? Unauthorized() : _library.GetCandidates(uid.Value, list);
    }

    [HttpGet("State")]
    [Authorize]
    public ActionResult<ListState> GetState([FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!StateStore.IsValidList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        var uid = ResolveUser(userId);
        return uid == null ? Unauthorized() : _store.Get(uid.Value, list);
    }

    [HttpPost("State")]
    [Authorize]
    public ActionResult<ListState> SaveState([FromBody] ListState state, [FromQuery] string list = "series", [FromQuery] Guid? userId = null)
    {
        if (!StateStore.IsValidList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        var uid = ResolveUser(userId);
        return uid == null ? Unauthorized() : _store.Save(uid.Value, list, state);
    }

    /// <summary>Download the ranking as txt, md, csv or json.</summary>
    [HttpGet("Export")]
    [Authorize]
    public ActionResult Export([FromQuery] string list = "series", [FromQuery] string format = "md", [FromQuery] Guid? userId = null)
    {
        if (!StateStore.IsValidList(list) || !LibraryService.Formats.TryGetValue(format, out var f))
        {
            return BadRequest("list must be series/movies/all, format must be txt/md/csv/json");
        }

        var uid = ResolveUser(userId);
        if (uid == null)
        {
            return Unauthorized();
        }

        var text = _library.Export(uid.Value, list, _store.Get(uid.Value, list), format);
        var name = $"rankbox-{list}-{DateTime.Now:yyyy-MM-dd}.{f.Ext}";
        return File(new UTF8Encoding(false).GetBytes(text), f.Mime + "; charset=utf-8", name);
    }

    /// <summary>Star the top N ranked items as favorites in Jellyfin.</summary>
    [HttpPost("Favorites")]
    [Authorize]
    public ActionResult Favorites([FromQuery] string list = "series", [FromQuery] int top = 10, [FromQuery] Guid? userId = null)
    {
        if (!StateStore.IsValidList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        var uid = ResolveUser(userId);
        if (uid == null)
        {
            return Unauthorized();
        }

        var ids = _store.Get(uid.Value, list).Ranked.Take(Math.Clamp(top, 1, 100));
        return Ok(new { marked = _library.MarkFavorites(uid.Value, ids) });
    }

    /// <summary>Just-finished shows waiting to be placed, plus recency checks that are due.</summary>
    [HttpGet("Inbox")]
    [Authorize]
    public ActionResult<Inbox> GetInbox([FromQuery] Guid? userId = null)
    {
        var uid = ResolveUser(userId);
        return uid == null ? Unauthorized() : _inbox.Get(uid.Value);
    }

    [HttpPost("Inbox/Dismiss")]
    [Authorize]
    public ActionResult Dismiss([FromQuery] string id, [FromQuery] Guid? userId = null)
    {
        var uid = ResolveUser(userId);
        if (uid == null)
        {
            return Unauthorized();
        }

        _inbox.Dismiss(uid.Value, Guid.TryParse(id, out var g) ? g.ToString("N") : id);
        return NoContent();
    }

    /// <summary>Answer a recency check: agree=true keeps the old answer, false flips it, omitted = not sure.</summary>
    [HttpPost("Recheck")]
    [Authorize]
    public ActionResult<ListState> Recheck([FromQuery] string list, [FromQuery] string answerId, [FromQuery] bool? agree = null, [FromQuery] Guid? userId = null)
    {
        if (!StateStore.IsValidList(list))
        {
            return BadRequest("list must be series, movies or all");
        }

        var uid = ResolveUser(userId);
        if (uid == null)
        {
            return Unauthorized();
        }

        var state = _inbox.Recheck(uid.Value, list, answerId, agree);
        return state == null ? NotFound() : state;
    }

    /// <summary>The little top-of-screen banner that runs inside Jellyfin's web app.</summary>
    [HttpGet("notify.js")]
    [AllowAnonymous]
    public ActionResult NotifyScript()
    {
        using var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream(typeof(Plugin).Namespace + ".Web.notify.js");
        if (stream == null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream);
        Response.Headers["Cache-Control"] = "public, max-age=3600";
        return Content(reader.ReadToEnd(), "application/javascript; charset=utf-8");
    }

    /// <summary>
    /// Signed-in users always act as themselves. An API key has no user, so it may
    /// name one with ?userId= (handy for scripts and testing).
    /// </summary>
    private Guid? ResolveUser(Guid? requested)
    {
        var claim = User.Claims.FirstOrDefault(c => c.Type == "Jellyfin-UserId")?.Value;
        if (Guid.TryParse(claim, out var own) && own != Guid.Empty)
        {
            return own;
        }

        var isApiKey = string.Equals(
            User.Claims.FirstOrDefault(c => c.Type == "Jellyfin-IsApiKey")?.Value, "true", StringComparison.OrdinalIgnoreCase);
        if (isApiKey && requested is Guid r && r != Guid.Empty && _library.UserExists(r))
        {
            return r;
        }

        return null;
    }
}
