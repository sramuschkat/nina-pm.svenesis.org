using System.Globalization;
using NINA.Astrometry;
using NinaPm.Core.Status;
using NinaPm.Nina.Ui;

namespace NinaPm.Nina.Status;

/// <summary>
/// Anzeigetexte des Live-Status im Container (FA-NIN-13, AP-16h) aus der Kern-Momentaufnahme <see cref="LiveStatus"/>:
/// Zustand, Grund eines gesperrten Zustands, Ziel mit Koordinaten und Rotation, Belichtung, Zähler, rotes Banner im
/// Testbetrieb und die Blockliste „Heutige Ziele“ (Zeiten in Standortzeit). Rechnet nichts selbst.
/// </summary>
public sealed class LiveStatusView(LiveStatus s)
{
    public LiveStatus Status { get; } = s;

    public bool TestBanner => Status.TestBanner;

    public string TestBannerText => Texts.TestBanner;

    public string StateText => Status.State switch
    {
        LiveState.Running => Texts.LiveRunning,
        LiveState.Blocked => Texts.LiveBlocked,
        LiveState.Finished => Texts.LiveFinished,
        _ => Texts.LiveWaiting,
    } + (Status.Offline ? $" · {Texts.LiveOffline}" : "");

    public bool IsBlocked => Status.BlockedReason is not null;

    public string BlockedText => Status.BlockedReason is { } code ? Texts.BlockedReason(code) : "";

    public string TargetText => Status.Target ?? (Status.NoPlan ? Texts.PlanAtStart
        : Status.NextBlock is { } next ? Texts.NextBlock(Time(next)) : "");

    public string CoordinatesText => Status.RaDeg is { } ra && Status.DecDeg is { } dec
        ? $"RA {AstroUtil.HoursToHMS(ra / 15)}  Dec {AstroUtil.DegreesToDMS(dec)}" : "";

    public string RotationText => Status.RotationDeg is { } r ? $"{r.ToString("0.0", CultureInfo.CurrentCulture)}°" : "";

    public string ExposureText => Status.Exposure is { } e
        ? string.Join(" · ", new[]
        {
            e.Filter,
            e.ExposureS is { } x ? $"{x.ToString("0.#", CultureInfo.CurrentCulture)} s" : null,
            e.Gain is { } g ? $"Gain {g}" : null,
            e.Offset is { } o ? $"Offset {o}" : null,
            e.Binning is { } b ? $"Bin {b}" : null,
            e.ReadoutMode,
        }.Where(t => !string.IsNullOrEmpty(t)))
        : "";

    public string CountersText => Texts.Outbox(Status.OutboxPending, Status.DeadLetters);

    public IReadOnlyList<LiveBlockView> Blocks { get; } = [.. s.Blocks.Select(b => new LiveBlockView(b))];

    internal static string Time(DateTimeOffset t) => t.ToString("HH:mm", CultureInfo.InvariantCulture);
}

/// <summary>Zeile „Heutige Ziele“: Name, Zeitfenster in Standortzeit, Zustand.</summary>
public sealed class LiveBlockView(LiveBlock b)
{
    public string Title => b.Transit ? $"{b.Title} ({Texts.Transit})" : b.Title;

    public string Window => $"{LiveStatusView.Time(b.Start)}–{LiveStatusView.Time(b.End)}";

    public string StateText => b.State switch
    {
        LiveBlockState.Running => Texts.BlockRunning,
        LiveBlockState.Done => Texts.BlockDone,
        LiveBlockState.Elapsed => Texts.BlockElapsed,
        _ => Texts.BlockPending,
    };

    public bool IsRunning => b.State == LiveBlockState.Running;
}

/// <summary>Takt für den Live-Status (2 s); Container hängen sich schwach an (<c>WeakEventManager</c>), damit Kopien nicht festgehalten werden.</summary>
public sealed class LiveTicker
{
    public static readonly LiveTicker Instance = new();
    private readonly Timer timer;

    private LiveTicker() => timer = new Timer(_ => Tick?.Invoke(this, EventArgs.Empty), null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));

    public event EventHandler? Tick;
}
