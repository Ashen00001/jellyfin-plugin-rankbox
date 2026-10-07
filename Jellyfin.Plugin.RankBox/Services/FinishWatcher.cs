using Jellyfin.Data.Enums;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.RankBox.Services;

/// <summary>
/// Watches for things being finished: the last episode of a show played, a movie played,
/// or a show/movie marked as watched. Each one lands in the user's RankBox inbox.
/// </summary>
public class FinishWatcher : IHostedService
{
    /// <summary>Played-dates older than this are history imports (e.g. Trakt), not something you just watched.</summary>
    private static readonly TimeSpan FreshWindow = TimeSpan.FromDays(14);

    private readonly IUserDataManager _userData;
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;
    private readonly StateStore _store;
    private readonly InboxService _inbox;
    private readonly ILogger<FinishWatcher> _log;

    public FinishWatcher(
        IUserDataManager userData,
        ILibraryManager library,
        IUserManager users,
        IApplicationPaths paths,
        ILogger<FinishWatcher> log)
    {
        _userData = userData;
        _library = library;
        _users = users;
        _log = log;
        _store = new StateStore(paths);
        _inbox = new InboxService(paths, _store, library);
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _userData.UserDataSaved += OnUserDataSaved;
        WebInjector.Register(_log);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _userData.UserDataSaved -= OnUserDataSaved;
        return Task.CompletedTask;
    }

    private void OnUserDataSaved(object? sender, UserDataSaveEventArgs e)
    {
        if (e.Item == null || e.UserData == null)
        {
            return;
        }

        var item = e.Item;
        var userId = e.UserId;
        var played = e.UserData.Played;
        var lastPlayed = e.UserData.LastPlayedDate;

        // keep the save path fast: do the work off-thread
        _ = Task.Run(() =>
        {
            try
            {
                Handle(userId, item, played, lastPlayed);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RankBox: couldn't process watch event for {Item}", item.Name);
            }
        });
    }

    private void Handle(Guid userId, BaseItem item, bool played, DateTime? lastPlayed)
    {
        if (!played)
        {
            // un-marked as watched: take it back out of the inbox
            var target = item is Episode ep0 ? ep0.SeriesId : item.Id;
            if (item is Movie || item is Series)
            {
                _inbox.Dismiss(userId, target.ToString("N"));
            }

            return;
        }

        if (lastPlayed is DateTime lp && DateTime.UtcNow - lp.ToUniversalTime() > FreshWindow)
        {
            return;
        }

        switch (item)
        {
            case Movie movie:
                Add(userId, movie, "movies");
                break;

            case Series series:
                Add(userId, series, "series");
                break;

            case Episode episode when episode.ParentIndexNumber != 0 && episode.SeriesId != Guid.Empty:
                if (_library.GetItemById(episode.SeriesId) is Series s && IsFinished(userId, s))
                {
                    Add(userId, s, "series");
                }

                break;
        }
    }

    private bool IsFinished(Guid userId, Series series)
    {
        var user = _users.GetUserById(userId);
        if (user == null)
        {
            return false;
        }

        var episodes = _library.GetItemList(new InternalItemsQuery(user)
        {
            AncestorIds = new[] { series.Id },
            IncludeItemTypes = new[] { BaseItemKind.Episode },
            Recursive = true,
            IsVirtualItem = false
        });

        var regular = episodes.OfType<Episode>().Where(ep => ep.ParentIndexNumber != 0).ToList();
        return regular.Count > 0 && regular.All(ep => _userData.GetUserData(user, ep) is { } ud && (ud.Played || ud.PlayCount > 0));
    }

    private void Add(Guid userId, BaseItem item, string list)
    {
        var id = item.Id.ToString("N");
        var pos = _store.Get(userId, list).Ranked.IndexOf(id);
        _inbox.AddPending(userId, new PendingFinish
        {
            Id = id,
            Name = item.Name,
            Type = item is Movie ? "Movie" : "Series",
            Year = item.ProductionYear,
            FinishedAt = DateTime.UtcNow,
            RankedAt = pos >= 0 ? pos + 1 : null,
            List = list
        });
        _log.LogInformation("RankBox: {Name} finished, added to inbox", item.Name);
    }
}
