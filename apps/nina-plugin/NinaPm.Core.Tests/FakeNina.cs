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

    /// <summary>Anteil der Belichtungszeit, den die Kamera wirklich braucht (Sky-Simulator-Kamera: fast 0).</summary>
    public double ExposureScale { get; set; } = 1;

    /// <summary>Bricht während der n-ten Belichtung (1-basiert) ab: wirft wie NINA mit abgebrochenem Token.</summary>
    public int CancelAtExposure { get; set; }
    public CancellationTokenSource Sequence { get; } = new();
    public SafetyState Safety { get; set; } = new(true, true, true);
    public DateTimeOffset? LastAutofocusUtc { get; set; }

    /// <summary>Belichtete Lights, deren Speichern noch aussteht (INightHost).</summary>
    public int PendingImageSaves { get; set; }

    private int centerAttempts;
    private int exposures;

    public int Exposures => exposures;

    public SafetyState ReadSafety() => Safety;

    public int Interruptions { get; private set; }

    public void OnInterrupted() => Interruptions++;

    public List<NinaTargets?> PlansBuilt { get; } = [];

    public void PlanBuilt(NinaTargets? targets, NinaPlanResponse plan) => PlansBuilt.Add(targets);

    public bool IsViableNow(Blocks block) => Viable;

    /// <summary>Grund, den Block ohne mögliche Belichtung zu überspringen (§4.1 Nr. 1); Standard: belichtbar.</summary>
    public string? Unexposable { get; set; }

    public string? UnexposableReason(Blocks block) => Unexposable;

    public void SetTarget(Blocks block) => Calls.Add("target");

    public bool CanSkipSlew(Blocks block) => SkipSlew;

    public Task<CenterResult> SlewCenterAsync(Blocks block, bool rotate, CancellationToken token)
    {
        Calls.Add($"center@{UtcText.Format(clock.UtcNow)}");
        if (!rotate) Calls.Add("center-no-rotate");
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

    /// <summary>Wirft bei der n-ten Belichtung einen NINA-Fehler (kein Abbruch).</summary>
    public int FailAtExposure { get; set; }

    /// <summary>Kühlung, die <see cref="ReadCooling"/> liefert (Standard: an, ohne Messwert).</summary>
    public CameraCooling Cooling { get; set; } = new(true, null);

    public CameraCooling ReadCooling() => Cooling;

    /// <summary>Wird bei jeder Belichtung mit deren laufender Nummer (ab 1) aufgerufen.</summary>
    public Action<int>? OnExposure { get; set; }

    /// <summary><c>temperatureDeviation</c> je Belichtung in Reihenfolge.</summary>
    public List<bool> Deviations { get; } = [];

    /// <summary>
    /// NINAs Trigger flippt vor dem n-ten Belichtungsaufruf (1-basiert), der Adapter belichtet dann nicht (AP-68):
    /// <see cref="ExposureResult.Flipped"/> nach <see cref="FlipDurationS"/>.
    /// </summary>
    public int FlipBeforeExposure { get; set; }

    private int exposeCalls;

    public Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, bool temperatureDeviation, CancellationToken token)
    {
        if (++exposeCalls == FlipBeforeExposure && Pier is not null)
        {
            Calls.Add($"nina-flip@{UtcText.Format(clock.UtcNow)}");
            Pier = Pier == "west" ? "east" : "west";
            clock.Advance(TimeSpan.FromSeconds(FlipDurationS));
            return Task.FromResult(ExposureResult.Flipped);
        }
        Deviations.Add(temperatureDeviation);
        exposures++;
        OnExposure?.Invoke(exposures);
        if (exposures == FailAtExposure) throw new InvalidOperationException("Kamera meldet Fehler");
        Calls.Add($"expose:{entry.Seq}@{UtcText.Format(clock.UtcNow)}");
        if (exposures == FlipDuringExposure && Pier is not null)
        {
            Pier = Pier == "west" ? "east" : "west";
            clock.Advance(TimeSpan.FromSeconds(FlipDurationS));
        }
        if (exposures == CancelAtExposure)
        {
            Sequence.Cancel();
            token.ThrowIfCancellationRequested();
        }
        clock.Advance(TimeSpan.FromSeconds((entry.ExposureS ?? 0) * ExposureScale + DownloadS));
        return Task.FromResult(ExposureResult.Saved);
    }

    public Task DitherAsync(CancellationToken token)
    {
        Calls.Add("dither");
        clock.Advance(TimeSpan.FromSeconds(15));
        return Task.CompletedTask;
    }

    // ---- Flip und Rotation (AP-16f) ----------------------------------------------------------------

    public bool RotatorConnected { get; set; } = true;

    public bool NinaRecentersAfterFlip { get; set; }

    /// <summary>Pier-Seite der Montierung; <c>null</c> = unbekannt.</summary>
    public string? Pier { get; set; }

    public string? PierSide()
    {
        if (pendingPier is { } p && clock.UtcNow >= p.FromUtc)
        {
            Pier = p.Side;
            pendingPier = null;
        }
        return Pier;
    }

    /// <summary>Montierung meldet die neue Pier-Seite erst so viele Sekunden nach dem Flip (ASI am Starfront-Rig, AP-68).</summary>
    public double PierReportDelayS { get; set; }

    private (string Side, DateTimeOffset FromUtc)? pendingPier;

    // ---- Autofokus (AP-68) ----

    /// <summary>Dauer eines Autofokus in s.</summary>
    public double AutofocusS { get; set; } = 180;

    public bool AutofocusSucceeds { get; set; } = true;

    public int Autofocuses { get; private set; }

    public Task<bool> AutofocusAsync(CancellationToken token)
    {
        Calls.Add($"af@{UtcText.Format(clock.UtcNow)}");
        Autofocuses++;
        clock.Advance(TimeSpan.FromSeconds(AutofocusS));
        if (AutofocusSucceeds) LastAutofocusUtc = clock.UtcNow;
        return Task.FromResult(AutofocusSucceeds);
    }

    /// <summary>Zeitpunkt, ab dem NINAs früheste Flipzeit erreicht ist (<c>null</c>: unbekannt).</summary>
    public DateTimeOffset? EarliestFlipUtc { get; set; }

    public double? MinutesToEarliestFlip() => EarliestFlipUtc is { } t ? (t - clock.UtcNow).TotalMinutes : null;

    /// <summary>Dauer des Trigger-Aufrufs zur Flipzeit; flippt die Pier-Seite, wenn <see cref="FlipOnTriggers"/>.</summary>
    public double FlipTriggerS { get; set; } = 240;

    public bool FlipOnTriggers { get; set; }

    public Task RunTriggersAsync(CancellationToken token)
    {
        Calls.Add("flip");
        clock.Advance(TimeSpan.FromSeconds(FlipTriggerS));
        if (FlipOnTriggers && Pier is not null)
        {
            var side = Pier == "west" ? "east" : "west";
            if (PierReportDelayS > 0) pendingPier = (side, clock.UtcNow.AddSeconds(PierReportDelayS));
            else Pier = side;
        }
        return Task.CompletedTask;
    }

    /// <summary>Plate-Solve-Ergebnisse der Reihe nach (letztes bleibt stehen); leer = kein Solve.</summary>
    public List<SolveReading> Solves { get; } = [];

    private int solveCalls;

    public Task<SolveReading> SolveAsync(CancellationToken token)
    {
        Calls.Add("solve");
        var r = Solves.Count == 0 ? new SolveReading(null) : Solves[Math.Min(solveCalls, Solves.Count - 1)];
        solveCalls++;
        return Task.FromResult(r);
    }

    /// <summary>Wechselt die Pier-Seite während der n-ten Belichtung (1-basiert): ungeplanter Flip über NINAs Trigger.</summary>
    public int FlipDuringExposure { get; set; }

    /// <summary>Dauer des ungeplanten Flips in s (Warten auf den Meridian, Slew, Autofokus, Guiding), vor der Belichtung.</summary>
    public double FlipDurationS { get; set; }

    /// <summary>Wird bei jedem Warteschritt aufgerufen (z. B. Bedienung während des Wartens).</summary>
    public Action<DateTimeOffset>? OnDelay { get; set; }

    public Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        Calls.Add($"delay:{UtcText.Format(untilUtc)}");
        if (untilUtc > clock.UtcNow) clock.UtcNow = untilUtc;
        OnDelay?.Invoke(untilUtc);
        return Task.CompletedTask;
    }
}
