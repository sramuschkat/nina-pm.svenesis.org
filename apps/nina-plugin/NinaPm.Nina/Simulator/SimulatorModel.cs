using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using NINA.Core.Utility;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Simulator;
using NinaPm.Core.Status;
using NinaPm.Core.Time;
using NinaPm.Nina.Sequencer;
using NinaPm.Nina.Ui;

namespace NinaPm.Nina.Simulator;

/// <summary>
/// Was der Simulator von der Laufzeit braucht (in Adapter-Tests frei gesetzt). <see cref="LoadSettings"/> lädt Bootstrap
/// und Ziele, wenn noch keine Nacht-Tabelle da ist – ohne laufende Sequenz lädt sie sonst niemand.
/// </summary>
internal sealed record SimulatorContext(ISimulationApi Api, NinaBootstrap? Bootstrap, bool OfflineMode, DateTimeOffset? TargetsFetchedUtc,
    NinaPmLog Log, Func<CancellationToken, Task>? LoadSettings = null, Func<NinaSimulation, NightViewInputs?>? NightInputs = null);

/// <summary>
/// Simulator auf der Optionsseite (FA-NIN-18, AP-53) mit der Gliederung von S-40: Infobox mit
/// <em>Beispielsequenzen herunterladen</em>, Schritt 1 gesperrte Einstellungen („Gesteuert von NINA-PM – Änderungen in
/// der Web-App“), Datum/<em>Heute Nacht</em>/<em>Simulieren</em> mit „Ziele zuletzt abgerufen“, Schritt 2 Zielkarten,
/// Schritt 3 Plangrafik und Planprotokoll mit <em>Protokoll kopieren</em>. Es rechnet immer der Server
/// (<c>GET /simulation</c>); ohne Verbindung bzw. im Offline-Modus ist der Simulator nicht verfügbar. Die Werte rechnet
/// der Kern (<c>NinaPm.Core.Simulator</c>), hier nur Texte, Farben und Pixel.
/// </summary>
/// <remarks>Gliederung (Lauf-Leiste mit ◀ ▶ <em>Heute Nacht</em> <em>Simulieren</em>, Statuspunkt, gesperrte Einstellungen
/// hinter halbtransparenter Fläche mit Schloss-Karte, Zielkarten nebeneinander, Protokoll mit Kopierknopf) nach
/// <c>ViewModels/SimulatorViewModel.cs</c> und <c>Views/SimulatorPanel.xaml</c> des Astro-PM-NINA-Plugins (MIT, Commit
/// <c>5dd621d</c>); dessen lokale Planung ist nicht übernommen.</remarks>
public sealed class SimulatorModel : INotifyPropertyChanged
{
    private readonly Func<SimulatorContext?> context;
    private readonly IClock clock;
    private string? night;
    private string status = "";
    private bool available;
    private bool running;
    private NinaSimulation? simulation;
    private IReadOnlyList<PlanLogRow> logRows = [];
    private IReadOnlyList<Dock.NightLogRowView>? actualRows;

    internal SimulatorModel(Func<SimulatorContext?>? context = null, IClock? clock = null)
    {
        this.context = context ?? FromRuntime;
        this.clock = clock ?? SystemClock.Instance;
        // Während einer Simulation sind alle Lauf-Knöpfe gesperrt (wie der Simulator des Astro-PM-NINA-Plugins,
        // SimulatorViewModel.cs, IsSimulating; Wunsch Sven 04.10.2026): kein zweiter Lauf, keine Nacht gewechselt.
        PrevCommand = new RelayCommand(() => Move(-1), () => running);
        NextCommand = new RelayCommand(() => Move(1), () => running);
        TonightCommand = new RelayCommand(() =>
        {
            if (running) return Task.CompletedTask;
            night = Dates.Tonight(this.clock.UtcNow);
            RaiseDate();
            return SimulateAsync(CancellationToken.None);
        }, () => running);
        SimulateCommand = new RelayCommand(() => SimulateAsync(CancellationToken.None), () => running);
        CopyCommand = new RelayCommand(Copy);
        Samples = SampleSequences.Files
            .Select(f => new SampleLinkView(Texts.SampleName(f), SampleSequences.Url(NinaPmPlugin.PluginVersion, f)))
            .ToList();
    }

    private static SimulatorContext? FromRuntime()
    {
        if (NinaPmRuntime.Current is not { } rt) return null;
        return new SimulatorContext(rt.SimulationApi, rt.Runner.Bootstrap, rt.Runner.OfflineMode, rt.Runner.TargetsFetchedUtc, rt.Log,
            t => rt.Runner.RefreshAsync(t), s => rt.Runner.NightViewInputs(s));
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    // ---- Infobox ----

    public string Info => Texts.SimulatorInfo;

    public IReadOnlyList<SampleLinkView> Samples { get; }

    // ---- Schritt 1: gesperrte Einstellungen ----

    /// <summary>
    /// Beim ersten Lesen (Optionsseite geöffnet, UI-Thread) einmal aus der Laufzeit füllen; danach über
    /// <see cref="Refresh"/> (Aktualisieren, Simulieren, Pfeile).
    /// </summary>
    public ObservableCollection<SettingRowView> Settings
    {
        get
        {
            if (!initialized)
            {
                initialized = true;
                Refresh();
            }
            return settings;
        }
    }

    private readonly ObservableCollection<SettingRowView> settings = [];
    private bool initialized;

    public string SettingsVersionText { get; private set; } = "";

    public bool HasSettings => settings.Count > 0;

    public string LockedTitle => Texts.LockedTitle;

    public string LockedHint => Texts.LockedHint;

    // ---- Datum und Lauf ----

    private SimulatorDates Dates => SimulatorDates.From(context()?.Bootstrap);

    public string NightText => night is null ? "—" : SimulatorDates.Label(night);

    public ICommand PrevCommand { get; }

    public ICommand NextCommand { get; }

    public ICommand TonightCommand { get; }

    public ICommand SimulateCommand { get; }

    public ICommand CopyCommand { get; }

    /// <summary>Grün: Server hat gerechnet; rot: nicht verfügbar (Grund in <see cref="Status"/>).</summary>
    public bool Available
    {
        get => available;
        private set
        {
            available = value;
            Raise();
            Raise(nameof(StatusBrush));
        }
    }

    /// <summary>Statuspunkt: grün verfügbar, rot nicht verfügbar.</summary>
    public System.Windows.Media.SolidColorBrush StatusBrush =>
        Brush.Of(available ? ChartPalette.Ok : ChartPalette.Now, ChartPalette.Marker);

    public bool IsRunning
    {
        get => running;
        private set
        {
            running = value;
            Raise();
            foreach (var c in new[] { PrevCommand, NextCommand, TonightCommand, SimulateCommand })
                ((RelayCommand)c).Requery();
        }
    }

    public string Status
    {
        get => status;
        private set
        {
            status = value;
            Raise();
        }
    }

    public string FetchedText { get; private set; } = Texts.TargetsFetched(null);

    public string SummaryText { get; private set; } = "";

    public string ComputedText { get; private set; } = "";

    // ---- Schritt 2 und 3 ----

    public bool HasResults => simulation is not null;

    public bool IsEmpty => simulation is not null && simulation.Cards.Count == 0 && simulation.Unallocated.Count == 0;

    public string EmptyText => Texts.SimEmpty;

    public ObservableCollection<SimulatorCardView> Cards { get; } = [];

    public ObservableCollection<UnallocatedView> Unallocated { get; } = [];

    public bool HasUnallocated => Unallocated.Count > 0;

    public PlanChartView? Chart { get; private set; }

    public string PlanHeader { get; private set; } = Texts.PlanZone("");

    public ObservableCollection<LogRowView> Log { get; } = [];

    public ObservableCollection<string> Warnings { get; } = [];

    public bool HasWarnings => Warnings.Count > 0;

    public string CopyStatus { get; private set; } = "";

    /// <summary>Optionsseite geöffnet bzw. Laufzeit neu: Einstellungen, Datum und „zuletzt abgerufen“ auffrischen (ohne Aufruf).</summary>
    public void Refresh()
    {
        initialized = true;
        var ctx = context();
        settings.Clear();
        var locked = LockedSettings.From(ctx?.Bootstrap);
        if (locked is not null)
            foreach (var row in SettingRows(locked))
                settings.Add(row);
        SettingsVersionText = locked is null ? Texts.NoSettings : Texts.SettingsVersion(locked.SettingsVersion);
        var now = clock.UtcNow;
        if (night is null || !Dates.Contains(night)) night = Dates.Tonight(now);
        UpdateFetched(ctx);
        if (!IsRunning && simulation is null)
        {
            var pre = ctx is null ? SimulatorState.NotConfigured : SimulatorService.Precheck(true, ctx.OfflineMode);
            Available = pre is null && night is not null;
            Status = pre is { } p ? Texts.SimUnavailable(Reason(p))
                : night is null ? Texts.SimUnavailable(Texts.SimNoNights)
                : "";
        }
        Raise(nameof(HasSettings));
        Raise(nameof(SettingsVersionText));
        Raise(nameof(FetchedText));
        RaiseDate();
    }

    /// <summary>„Ziele zuletzt abgerufen“ in Standortzeit – mit Kürzel, sobald eine Simulation vorliegt.</summary>
    private void UpdateFetched(SimulatorContext? ctx)
    {
        var site = simulation is not null ? SiteTime.From(simulation) : SiteTime.From(ctx?.Bootstrap);
        FetchedText = Texts.TargetsFetched(ctx?.TargetsFetchedUtc is { } t ? site.DateClockZone(t) : null);
        Raise(nameof(FetchedText));
    }

    private async Task Move(int direction)
    {
        if (running) return;
        Refresh();
        await EnsureSettingsAsync(CancellationToken.None);
        if (night is null) return;
        night = direction < 0 ? Dates.Previous(night, clock.UtcNow) : Dates.Next(night);
        RaiseDate();
        await SimulateAsync(CancellationToken.None);
    }

    /// <summary>
    /// Ohne Nacht-Tabelle (NINA frisch gestartet, noch keine Sequenz gelaufen) Bootstrap und Ziele laden, statt mit
    /// „keine Nacht-Tabelle“ stehen zu bleiben (Abnahme AP-53, 04.10.2026). Im Offline-Modus nicht.
    /// </summary>
    private async Task EnsureSettingsAsync(CancellationToken token)
    {
        if (context() is not { Bootstrap: null, OfflineMode: false, LoadSettings: { } load }) return;
        IsRunning = true;
        Status = Texts.SimLoadingSettings;
        try
        {
            await load(token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fehler meldet der Lauf im NINA-Log (API …); unten bleibt „keine Nacht-Tabelle“.
        }
        finally
        {
            IsRunning = false;
        }
        Refresh();
    }

    internal async Task SimulateAsync(CancellationToken token)
    {
        if (running) return;
        Refresh();
        await EnsureSettingsAsync(token);
        var ctx = context();
        if (night is null)
        {
            Available = false;
            Status = Texts.SimUnavailable(ctx is null ? Reason(SimulatorState.NotConfigured) : Texts.SimNoNights);
            return;
        }
        IsRunning = true;
        Status = Texts.SimRunning;
        try
        {
            var outcome = await SimulatorService.RunAsync(ctx?.Api, ctx?.OfflineMode ?? false, night,
                ctx?.Log ?? new NinaPmLog(NinaLogSink.Instance), token);
            if (outcome.Ok) Apply(outcome.Simulation!, clock.UtcNow);
            else
            {
                Available = false;
                Status = Texts.SimUnavailable(Reason(outcome.State, outcome.Status, outcome.Code));
            }
        }
        finally
        {
            IsRunning = false;
        }
    }

    /// <summary>Ergebnis des Servers anzeigen (in Adapter-Tests direkt aufgerufen).</summary>
    internal void Apply(NinaSimulation s, DateTimeOffset now)
    {
        simulation = s;
        night = s.Night;
        var site = SiteTime.From(s);
        var inv = CultureInfo.InvariantCulture;
        SummaryText = Texts.SimStats(s.Header.DarkHours.ToString("0.0", CultureInfo.CurrentCulture), s.Header.Targets, s.Header.Frames,
            s.Header.MoonIllumPct.ToString("0", inv));
        ComputedText = Texts.SimComputed(site.DateClockZone(s.GeneratedAtUtc), s.SettingsVersion);
        Cards.Clear();
        foreach (var c in SimulatorCards.Build(s, site)) Cards.Add(new SimulatorCardView(c));
        // Laufende Nacht mit gespeichertem Plan (AP-53c): Ist + Plan wie die Fenster im Imaging-Reiter – Erledigtes aus
        // lokalem Journal und Server-Ist (blass), der Rest aus dem gespeicherten Plan (kräftig), Protokoll mit Spalte „Ist“.
        var inside = now > s.NightWindow.StartUtc && now < s.NightWindow.EndUtc;
        var local = inside ? context()?.NightInputs?.Invoke(s) : null;
        var actual = local is { Plan: not null } inputs && inputs.Night == s.Night
            ? NightViewBuilder.Build(inputs with { Simulation = s, Site = site })
            : null;
        // Plugin 0.4.18: nicht Zugeteiltes mit dem Stand an der Rig (gespeicherter Plan, Nachtjournal) wie im Web.
        Unallocated.Clear();
        foreach (var u in SimulatorCards.Unallocated(s, local)) Unallocated.Add(new UnallocatedView(u));
        Chart = new PlanChartView(actual?.Chart ?? PlanChart.Build(s, site, now));
        PlanHeader = Texts.PlanZone(Chart.Chart.Zone);
        PlanState = s.StoredPlan is { } sp
            ? Texts.SimPlanState(sp.NightPlanId.ToString("N")[..8], sp.Revision, site.ClockZone(sp.CreatedAtUtc),
                sp.Stale, sp.StaleCause == StoredPlanInfoStaleCause.Settings)
            : "";
        logRows = PlanLog.Build(s, site, LogTexts.Instance);
        actualRows = actual is null ? null : [.. actual.Rows.Select(r => new Dock.NightLogRowView(r, site))];
        Log.Clear();
        if (actualRows is null)
            foreach (var r in logRows) Log.Add(new LogRowView(r));
        else
            foreach (var r in actualRows) Log.Add(LogRowView.From(r));
        Warnings.Clear();
        foreach (var w in s.Warnings)
        {
            var code = LockedSettings.Code(w.Code);
            var when = w.AtUtc is { } at ? $" · {site.ClockZone(at)}" : "";
            Warnings.Add($"⚠ {Texts.Warning(code)}{when}");
        }
        UpdateFetched(context());
        Available = true;
        Status = "";
        CopyStatus = "";
        Raise(nameof(SummaryText));
        Raise(nameof(ComputedText));
        Raise(nameof(HasResults));
        Raise(nameof(IsEmpty));
        Raise(nameof(HasUnallocated));
        Raise(nameof(Chart));
        Raise(nameof(PlanHeader));
        Raise(nameof(PlanState));
        Raise(nameof(HasPlanState));
        Raise(nameof(HasWarnings));
        Raise(nameof(CopyStatus));
        RaiseDate();
    }

    /// <summary>Text für die Zwischenablage (Tab-getrennt mit Kopfzeile).</summary>
    internal string ProtocolText => actualRows is { } rows ? Dock.NightLogRowView.Tsv(rows) : PlanLog.Tsv(logRows, LogTexts.Instance);

    /// <summary>„Plan 4c2e91d0 · Rev. 9 · 03:31 CDT“ und ggf. „Rig plant noch mit Rev. n …“ (AP-53c).</summary>
    public string PlanState { get; private set; } = "";

    public bool HasPlanState => PlanState.Length > 0;

    private Task Copy()
    {
        try
        {
            System.Windows.Clipboard.SetText(ProtocolText);
            CopyStatus = Texts.Copied;
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
            Logger.Warning($"NINA-PM: clipboard: {ex.Message}");
            CopyStatus = ex.Message;
        }
        Raise(nameof(CopyStatus));
        return Task.CompletedTask;
    }

    private static string Reason(SimulatorState state, int status = 0, string? code = null) => state switch
    {
        SimulatorState.NotConfigured => Texts.NotConfigured,
        SimulatorState.Offline => Texts.SimOffline,
        SimulatorState.Unreachable => Texts.Unreachable,
        SimulatorState.TokenInvalid => Texts.TokenInvalid,
        SimulatorState.TenantLocked => Texts.TenantLocked,
        SimulatorState.UpdateNeeded => Texts.UpdateNeeded,
        SimulatorState.NightInvalid => Texts.SimNightInvalid,
        _ => Texts.Failed(status, code),
    };

    private static IEnumerable<SettingRowView> SettingRows(LockedSettings s)
    {
        string N(double v) => v.ToString("0.##", CultureInfo.CurrentCulture);
        yield return new(Texts.SetStrategy, Texts.Strategy(s.Strategy));
        yield return new(Texts.SetPlayback, Texts.Playback(s.Playback));
        yield return new(Texts.SetBonus, Texts.BonusValue(s.BonusEnabled, N(s.OvershootPct)));
        yield return new(Texts.SetMosaic, s.MosaicPanelsIndependent ? Texts.Yes : Texts.No);
        yield return new(Texts.SetDither, Texts.DitherValue(s.DitherEnabled, s.DitherEvery));
        yield return new(Texts.SetFilterSwitch, Texts.FilterSwitchValue(s.FilterSwitchEnabled, s.FilterSwitchEvery, N(s.FilterSwitchTolerancePct)));
        yield return new(Texts.SetFlats, Texts.FlatsValue(s.FlatsEnabled, s.FlatCount, s.FlatsSource));
        yield return new(Texts.SetFullFlatSet, s.FullFlatSet ? Texts.On : Texts.Off);
        yield return new(Texts.SetDarkFlats, Texts.DarkFlatsValue(s.DarkFlatsEnabled, s.DarkFlatCount));
        yield return new(Texts.SetFlip, Texts.FlipValue(s.FlipEnabled, N(s.FlipAfterMin), N(s.FlipMaxAfterMin), N(s.FlipPauseBeforeMin),
            N(s.FlipDurationS)));
        yield return new(Texts.SetSortChain, string.Join(" › ", s.SortChain.Select((k, i) => $"{i + 1}. {Texts.SortKey(k)}")));
    }

    private void RaiseDate()
    {
        Raise(nameof(NightText));
    }

    private void Raise([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    /// <summary>Texte des Planprotokolls aus <see cref="Texts"/>.</summary>
    internal sealed class LogTexts : IPlanLogTexts
    {
        public static readonly LogTexts Instance = new();

        public IReadOnlyList<string> Headers => PlanLog.Columns.Select(Texts.LogColumn).ToList();

        public string Command(string code) => Texts.Command(code);

        public string Until(string time) => Texts.Until(time);

        public string Bonus => Texts.Bonus;

        public string Yes => Texts.Yes;

        public string No => Texts.No;

        public string MoonProfile(string raw) => Texts.MoonProfile(raw);
    }
}

/// <summary>Link der Infobox; öffnet den Browser.</summary>
public sealed class SampleLinkView
{
    internal SampleLinkView(string name, string url)
    {
        Name = name;
        Url = url;
        OpenCommand = new RelayCommand(() =>
        {
            try
            {
                Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or PlatformNotSupportedException)
            {
                Logger.Warning($"NINA-PM: link not opened: {ex.Message}");
            }
            return Task.CompletedTask;
        });
    }

    public string Name { get; }

    public string Url { get; }

    public ICommand OpenCommand { get; }
}

/// <summary>Zeile der gesperrten Einstellungen (Beschriftung, Wert).</summary>
public sealed record SettingRowView(string Label, string Value);
