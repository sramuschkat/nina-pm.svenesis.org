using System.ComponentModel.Composition;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using NINA.Astrometry;
using NINA.Astrometry.Interfaces;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Core.Utility.WindowService;
using NINA.Equipment.Interfaces;
using NINA.Equipment.Interfaces.Mediator;
using NINA.PlateSolving.Interfaces;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Container;
using NINA.Sequencer.Container.ExecutionStrategy;
using NINA.Sequencer.SequenceItem;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Status;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// <em>NINA-PM-Anweisungen</em> (execution.md §1/§2, TK 10.3): ein <see cref="SequenceContainer"/> mit
/// <see cref="IDeepSkyObjectContainer"/> und überschriebenem <c>Execute</c>, der je Aufruf **einen** Schritt der
/// Nachtschleife ausführt (<c>NightRunner</c> im Kern: Plan, Warten, ein Block, Nachtende). Container-Grundmuster
/// (kein <c>base.Execute</c>, Platzhalter-Kind, Serialisierung, <c>Target</c>) nach dem Astro-PM-Plugin (MIT),
/// <c>Instructions/TargetInstructionSet.cs</c>, Commit 5dd621d. Bedingungen gehören an den umgebenden Zielcontainer.
/// </summary>
[ExportMetadata("Name", "NINA-PM Instructions")]
[ExportMetadata("Description", "Runs the NINA-PM night plan: one block per call (plan, slew/center, exposures, night end).")]
[ExportMetadata("Icon", "NinaPmSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceItem))]
[Export(typeof(ISequenceContainer))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class NinaPmContainer : SequenceContainer, IDeepSkyObjectContainer
{
    private readonly NinaMediators m;
    private readonly INighttimeCalculator nighttimeCalculator;

    [ImportingConstructor]
    public NinaPmContainer(IProfileService profile, ITelescopeMediator telescope, IImagingMediator imaging, ICameraMediator camera,
        IFilterWheelMediator filterWheel, IRotatorMediator rotator, IGuiderMediator guider, IDomeMediator dome, IDomeFollower domeFollower,
        IPlateSolverFactory plateSolverFactory, IWindowServiceFactory windowServiceFactory, IImageSaveMediator imageSave,
        IImageHistoryVM imageHistory, ISafetyMonitorMediator safetyMonitor, INighttimeCalculator nighttimeCalculator,
        IFocuserMediator focuser, [Import(AllowDefault = true)] NINA.WPF.Base.Interfaces.IAutoFocusVMFactory? autoFocusFactory = null)
        : this(new NinaMediators(profile, telescope, imaging, camera, filterWheel, rotator, guider, dome, domeFollower,
            plateSolverFactory, windowServiceFactory, imageSave, imageHistory, safetyMonitor, focuser, autoFocusFactory), nighttimeCalculator)
    {
    }

    private NinaPmContainer(NinaMediators m, INighttimeCalculator nighttimeCalculator) : base(new SequentialStrategy())
    {
        this.m = m;
        this.nighttimeCalculator = nighttimeCalculator;
        NighttimeData = nighttimeCalculator.Calculate(null);
        var astro = m.Profile.ActiveProfile.AstrometrySettings;
        target = new InputTarget(Angle.ByDegree(astro.Latitude), Angle.ByDegree(astro.Longitude), astro.Horizon);
        Add(new PlaceholderItem());
        FlatsSetupRunner = NewRunner();
        FlatsRunner = NewRunner();
        FlatsTeardownRunner = NewRunner();
        ResetPlanCommand = new RelayCommand(() => Operate(r => r.Reset()));
        SkipBlockCommand = new RelayCommand(() => Operate(r => r.SkipBlock()));
        System.Windows.WeakEventManager<LiveTicker, EventArgs>.AddHandler(LiveTicker.Instance, nameof(LiveTicker.Tick), OnLiveTick);
    }

    // ── Live-Status (FA-NIN-13, AP-16h) ──

    private LiveStatusView? live;

    /// <summary>Live-Status-Kopf; alle 2 s aus der Laufzeit (ohne eingerichtetes NINA-PM <c>null</c>).</summary>
    public LiveStatusView? Live
    {
        get => live;
        private set
        {
            live = value;
            RaisePropertyChanged();
        }
    }

    /// <summary>*Zurücksetzen*: Plan verwerfen, beim nächsten Aufruf neu (§3.2).</summary>
    public System.Windows.Input.ICommand ResetPlanCommand { get; }

    /// <summary>*Block überspringen* (§4.1 Nr. 2).</summary>
    public System.Windows.Input.ICommand SkipBlockCommand { get; }

    private void OnLiveTick(object? sender, EventArgs e)
    {
        try
        {
            Live = NinaPmRuntime.Current is { } r ? new LiveStatusView(r.Runner.LiveStatus(r.TestModeActive)) : null;
        }
        catch (Exception ex)
        {
            Logger.Debug($"NINA-PM: live status: {ex.Message}");
        }
    }

    private static Task Operate(Action<NinaPm.Core.Execution.NightRunner> action)
    {
        if (NinaPmRuntime.Current is { } r) action(r.Runner);
        return Task.CompletedTask;
    }

    public override object Clone()
    {
        var clone = new NinaPmContainer(m, nighttimeCalculator);
        clone.CopyMetaData(this);
        clone.FlatsSetupRunner = CloneRunner(FlatsSetupRunner, clone);
        clone.FlatsRunner = CloneRunner(FlatsRunner, clone);
        clone.FlatsTeardownRunner = CloneRunner(FlatsTeardownRunner, clone);
        return clone;
    }

    // ── Flat-Handling (FA-NIN-17, execution.md §7): drei Boxen, Serialisierung wie NINAs TriggerRunner ──
    // Muster nach dem Astro-PM-Plugin (MIT), Instructions/TargetInstructionSet.cs (FlatsSetupRunner, FlatsRunner,
    // FlatsTeardownRunner, FlatsIsolationContainer), Commit 5dd621d.

    /// <summary>
    /// <em>Vor Flats</em> (einmal): z. B. Guiding stoppen, auf eine Uhrzeit warten, parken, Flat-Panel schließen, Licht an
    /// (Himmelsflats: nicht parken). Das Plugin stoppt Guiding nicht selbst und wartet bei Panel-Flats nicht (06.10.2026).
    /// </summary>
    [JsonProperty]
    public SequentialContainer FlatsSetupRunner { get; private set; }

    /// <summary><em>Flats je Kombination</em>: Filter, Rotator, Gain, Offset, Binning und Auslesemodus setzt das Plugin.</summary>
    [JsonProperty]
    public SequentialContainer FlatsRunner { get; private set; }

    /// <summary><em>Nach Flats</em> (einmal): z. B. Licht aus, Flat-Panel öffnen.</summary>
    [JsonProperty]
    public SequentialContainer FlatsTeardownRunner { get; private set; }

    private SequentialContainer NewRunner()
    {
        var runner = new SequentialContainer();
        runner.AttachNewParent(this);
        return runner;
    }

    private static SequentialContainer CloneRunner(SequentialContainer? source, NinaPmContainer parent)
    {
        var runner = source is null ? new SequentialContainer() : (SequentialContainer)source.Clone();
        runner.AttachNewParent(parent);
        return runner;
    }

    /// <summary>Boxen wieder am Container einhängen (nach dem Flat-Lauf hängen sie am Container ohne Parent).</summary>
    internal void RehomeFlatRunners()
    {
        FlatsSetupRunner.AttachNewParent(this);
        FlatsRunner.AttachNewParent(this);
        FlatsTeardownRunner.AttachNewParent(this);
    }

    /// <summary>Bereits gemeldete unterdrückte Trigger-Typen (je Aufruf einmal, NT-23).</summary>
    internal HashSet<string> SuppressedLogged { get; } = new(StringComparer.Ordinal);

    // ── IDeepSkyObjectContainer ──

    private InputTarget target;

    public InputTarget Target
    {
        get => target;
        set
        {
            target = value;
            RaisePropertyChanged();
        }
    }

    public NighttimeData NighttimeData { get; }

    // ── Serialisierung: Platzhalter nie speichern (TargetInstructionSet.cs Z. 339–379) ──

    [OnSerializing]
    public void OnSerializingNinaPm(StreamingContext context) => ScrubPlaceholders();

    [OnSerialized]
    public void OnSerializedNinaPm(StreamingContext context) => EnsurePlaceholder();

    [OnDeserialized]
    public void OnDeserializedNinaPm(StreamingContext context)
    {
        ScrubPlaceholders();
        EnsurePlaceholder();
        // Ältere Sequenzen ohne Flat-Boxen: leere Boxen anlegen; gespeicherte Boxen am Container einhängen.
        FlatsSetupRunner ??= new SequentialContainer();
        FlatsRunner ??= new SequentialContainer();
        FlatsTeardownRunner ??= new SequentialContainer();
        RehomeFlatRunners();
    }

    private void ScrubPlaceholders()
    {
        foreach (var item in GetItemsSnapshot())
            if (item is PlaceholderItem || item is UnknownSequenceItem) Items.Remove(item);
    }

    private void EnsurePlaceholder()
    {
        if (Items.Count == 0) Add(new PlaceholderItem());
    }

    // ── Ablauf ──

    /// <summary>Ein Schritt der Nachtschleife je Aufruf; bewusst kein <c>base.Execute</c> (liefe über den Platzhalter).</summary>
    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var runtime = NinaPmRuntime.Ensure(m.Profile, () => new NinaHost(m));
        if (runtime is null)
        {
            Logger.Warning("NINA-PM: server URL or sync token missing (Options → Plugins → NINA-PM)");
            await Task.Delay(TimeSpan.FromSeconds(60), token);
            return;
        }
        runtime.Host.Container = this;
        runtime.Host.Progress = progress;
        SuppressedLogged.Clear();
        await runtime.Runner.RunOnceAsync(token);
    }

    public override string ToString() => "NINA-PM Instructions";
}
