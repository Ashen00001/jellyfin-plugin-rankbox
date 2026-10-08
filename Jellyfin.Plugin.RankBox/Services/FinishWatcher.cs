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
/// Notices when something is finished: the last episode of a show played, a movie played,
/// or a show/movie marked as watched. Each lands in that person's RankBox inbox.
/// </summary>
public class FinishWatcher : IHostedService
{
    /// <summary>Played dates older than this are history imports (e.g. Trakt), not something you just watched.</summary>
    private static readonly TimeSpan FreshWindow = TimeSpan.FromDays(14);

    private readonly IUserDataManager _userData;
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;
    private readonly Store _store;
    private readonly InboxService _inbox;
    private readonly ILogger<FinishWatcher> _log;

    public FinishWatcher(IUserDataManager userData, ILibraryManager library, IUserManager users, IApplicationPaths paths, ILogger<FinishWatcher> log)
    {
        _userData = userData;
        _library = library;
        _users = users;
        _log = log;
        _store = new Store(paths);
        _inbox = new InboxService(paths, _store);
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

        LibraryService.Invalidate(e.UserId);
        var item = e.Item;
        var userId = e.UserId;
        var played = e.UserData.Played;
        var lastPlayed = e.UserData.LastPlayedDate;
        _ = Task.Run(() =>
        {
            try
            {
                Handle(userId, item, played, lastPlayed);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RankBox: couldn't process a watch event for {Item}", item.Name);
            }
        });
    }

    private void Handle(Guid userId, BaseItem item, bool played, DateTime? lastPlayed)
    {
        if (!played)
        {
            // un-marked as watched: take it back out of the inbox
            if (item is Movie || item is Series)
            {
                _inbox.Dismiss(userId, item.Id.ToString("N"));
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
            case Episode ep when ep.ParentIndexNumber != 0 && ep.SeriesId != Guid.Empty:
                if (_library.GetItemById(ep.SeriesId) is Series s && IsFinished(userId, s))
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

        var regular = _library.GetItemList(new InternalItemsQuery(user)
        {
            AncestorIds = new[] { series.Id },
            IncludeItemTypes = new[] { BaseItemKind.Episode },
            Recursive = true,
            IsVirtualItem = false,
        }).OfType<Episode>().Where(ep => ep.ParentIndexNumber != 0).ToList();
        return regular.Count > 0 && regular.All(ep => _userData.GetUserData(user, ep) is { } ud && (ud.Played || ud.PlayCount > 0));
    }

    private void Add(Guid userId, BaseItem item, string list)
    {
        var id = item.Id.ToString("N");
        var rank = _store.Get(userId, list).Snapshot?.Items.FirstOrDefault(i => i.Id == id)?.Rank;
        _inbox.AddPending(userId, new PendingFinish
        {
            Id = id,
            Name = item.Name,
            Type = item is Movie ? "Movie" : "Series",
            List = list,
            FinishedAt = DateTime.UtcNow.ToString("o"),
            RankedAt = rank,
        });
        _log.LogInformation("RankBox: {Name} finished, added to the inbox", item.Name);
    }
}
