using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Time;

namespace NinaPm.Core.Tests;

/// <summary>
/// NINA-Attrappe für den Blockablauf: jede Aktion rückt die simulierte Uhr um ihre Dauer vor (Belichtung + Download,
/// Dither 15 s, Flip 240 s, Zentrieren 90 s), <see cref="DelayAsync"/> springt zur Zielzeit. Protokolliert alle Aufrufe.
/// </summary>
public sealed class FakeNina(FixedClock clock) : IBlockHost, INightHost
{
    public List<string> Calls { get; } = [];
    public Func<int, CenterResult> Center { get; set; } = _ => new CenterResult(true);
    public bool Viable { get; set; } = true;
    public bool SkipSlew { get; set; }
    public double DownloadS { get; set; } = 3;

    /// <summary>Bricht während der n-ten Belichtung (1-basiert) ab: wirft wie NINA mit abgebrochenem Token.</summary>
    public int CancelAtExposure { get; set; }
    public CancellationTokenSource Sequence { get; } = new();
    public SafetyState Safety { get; set; } = new(true, true, true);
    public DateTimeOffset? LastAutofocusUtc { get; set; }

    private int centerAttempts;
    private int exposures;

    public int Exposures => exposures;

    public SafetyState ReadSafety() => Safety;

    public int Interruptions { get; private set; }

    public void OnInterrupted() => Interruptions++;

    public bool IsViableNow(Blocks block) => Viable;

    public void SetTarget(Blocks block) => Calls.Add("target");

    public bool CanSkipSlew(Blocks block) => SkipSlew;

    public Task<CenterResult> SlewCenterAsync(Blocks block, CancellationToken token)
    {
        Calls.Add($"center@{UtcText.Format(clock.UtcNow)}");
        clock.Advance(TimeSpan.FromSeconds(90));
        return Task.FromResult(Center(++centerAttempts));
    }

    public Task BeforeTargetChangeAsync(CancellationToken token)
    {
        Calls.Add("before");
        return Task.CompletedTask;
    }

    public Task AfterTargetChangeAsync(CancellationToken token)
    {
        Calls.Add("after");
        return Task.CompletedTask;
    }

    public Task StartGuidingAsync(CancellationToken token)
    {
        Calls.Add("guide");
        return Task.CompletedTask;
    }

    public Task ChangeFilterAsync(Entries entry, CancellationToken token)
    {
        Calls.Add($"filter:{entry.Filter}");
        clock.Advance(TimeSpan.FromSeconds(entry.DurationS ?? 10));
        return Task.CompletedTask;
    }

    public Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, CancellationToken token)
    {
        exposures++;
        Calls.Add($"expose:{entry.Seq}@{UtcText.Format(clock.UtcNow)}");
        if (exposures == CancelAtExposure)
        {
            Sequence.Cancel();
            token.ThrowIfCancellationRequested();
        }
        clock.Advance(TimeSpan.FromSeconds((entry.ExposureS ?? 0) + DownloadS));
        return Task.FromResult(ExposureResult.Saved);
    }

    public Task DitherAsync(CancellationToken token)
    {
        Calls.Add("dither");
        clock.Advance(TimeSpan.FromSeconds(15));
        return Task.CompletedTask;
    }

    public Task MeridianFlipAsync(Blocks block, Entries entry, CancellationToken token)
    {
        Calls.Add("flip");
        clock.Advance(TimeSpan.FromSeconds(entry.DurationS ?? 240));
        return Task.CompletedTask;
    }

    public Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        Calls.Add($"delay:{UtcText.Format(untilUtc)}");
        if (untilUtc > clock.UtcNow) clock.UtcNow = untilUtc;
        return Task.CompletedTask;
    }
}
