using System.ComponentModel;
using System.ComponentModel.Composition;
using System.Runtime.CompilerServices;
using System.Reflection;
using System.Windows.Input;
using NINA.Plugin;
using NINA.Plugin.Interfaces;
using NINA.Profile;
using NINA.Profile.Interfaces;
using NinaPm.Core.Api;
using NinaPm.Core.Logging;
using NinaPm.Core.Options;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Sequencer;
using NinaPm.Nina.Ui;

namespace NinaPm.Nina;

/// <summary>
/// Plugin-Manifest und Optionsseite (FA-NIN-01, FA-NIN-03, AP-16a, P-04): Server-URL und Sync-Token je NINA-Profil,
/// *Verbindung testen* mit Anzeige von Mandant, Instanz, Rig und Standort-Abgleich. Das Token liegt DPAPI-geschützt
/// in NINAs Plugin-Einstellungen, Klartext nur kurz im Speicher und nie im Log (SV-08).
/// </summary>
[Export(typeof(IPluginManifest))]
public sealed class NinaPmPlugin : PluginBase, INotifyPropertyChanged
{
    private readonly IProfileService profileService;
    private readonly ITokenProtector protector;
    private readonly NinaPmLog log = new(NinaLogSink.Instance);
    private PluginOptionsAccessor accessor;
    private readonly NinaMediators? mediators;

    /// <summary>
    /// MEF: NINAs Mediatoren schon beim Laden, damit Laufzeit und Heartbeat unabhängig von der Sequenz laufen, sobald
    /// Server-URL und Token eingetragen sind (execution.md §6, AP-16e).
    /// </summary>
    [ImportingConstructor]
    public NinaPmPlugin(IProfileService profileService, NINA.Equipment.Interfaces.Mediator.ITelescopeMediator telescope,
        NINA.Equipment.Interfaces.Mediator.IImagingMediator imaging, NINA.Equipment.Interfaces.Mediator.ICameraMediator camera,
        NINA.Equipment.Interfaces.Mediator.IFilterWheelMediator filterWheel, NINA.Equipment.Interfaces.Mediator.IRotatorMediator rotator,
        NINA.Equipment.Interfaces.Mediator.IGuiderMediator guider, NINA.Equipment.Interfaces.Mediator.IDomeMediator dome,
        NINA.Equipment.Interfaces.IDomeFollower domeFollower, NINA.PlateSolving.Interfaces.IPlateSolverFactory plateSolverFactory,
        NINA.Core.Utility.WindowService.IWindowServiceFactory windowServiceFactory,
        NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator imageSave, NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM imageHistory,
        NINA.Equipment.Interfaces.Mediator.ISafetyMonitorMediator safetyMonitor,
        NINA.WPF.Base.Interfaces.ViewModel.IFramingAssistantVM framingAssistant,
        NINA.WPF.Base.Interfaces.Mediator.IApplicationMediator applicationMediator)
        : this(profileService, new DpapiTokenProtector(), new NinaMediators(profileService, telescope, imaging, camera, filterWheel,
            rotator, guider, dome, domeFollower, plateSolverFactory, windowServiceFactory, imageSave, imageHistory, safetyMonitor),
            new FramingLoader(framingAssistant, applicationMediator, profileService))
    {
    }

    internal NinaPmPlugin(IProfileService profileService, ITokenProtector protector, NinaMediators? mediators = null,
        FramingLoader? framing = null)
    {
        this.profileService = profileService;
        Targets = new Browser.TargetBrowserModel(framing);
        this.mediators = mediators;
        this.protector = protector;
        accessor = new PluginOptionsAccessor(profileService, Guid.Parse(Identifier));
        profileService.ProfileChanged += (_, _) =>
        {
            accessor = new PluginOptionsAccessor(profileService, Guid.Parse(Identifier));
            ResetStatus();
            RaiseAllPropertiesChanged();
        };
        TestCommand = new RelayCommand(() => TestAsync(CancellationToken.None));
        SaveAndTestCommand = new RelayCommand(() => SaveAndTestAsync(CancellationToken.None));
        ResetCommand = new RelayCommand(() => Operate(r => r.Reset()));
        SkipBlockCommand = new RelayCommand(() => Operate(r => r.SkipBlock()));
        ReuploadCommand = new RelayCommand(Reupload);
        RefreshCommand = new RelayCommand(() =>
        {
            RaiseOperationChanged();
            Targets.Rebuild();
            return Task.CompletedTask;
        });
        ResetStatus();
        profileService.ProfileChanged += (_, _) => StartRuntime();
        StartRuntime();
    }

    /// <summary>Laufzeit (und damit den Heartbeat) im Hintergrund anlegen bzw. für geänderte Optionen neu aufbauen.</summary>
    private void StartRuntime()
    {
        if (mediators is not { } m) return;
        _ = Task.Run(() =>
        {
            try
            {
                NinaPmRuntime.Ensure(profileService, () => new NinaHost(m));
            }
            catch (Exception ex)
            {
                NINA.Core.Utility.Logger.Warning($"NINA-PM: Laufzeit nicht gestartet: {ex.Message}");
            }
        });
    }

    /// <summary>Plugin-Version für <c>X-NPM-Plugin-Version</c>.</summary>
    public static string PluginVersion =>
        typeof(NinaPmPlugin).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? typeof(NinaPmPlugin).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    public string ServerUrl
    {
        get => accessor.GetValueString(nameof(ServerUrl), PluginOptions.DefaultServerUrl);
        set
        {
            accessor.SetValueString(nameof(ServerUrl), value?.Trim() ?? "");
            RaisePropertyChanged();
        }
    }

    public bool TestMode
    {
        get => accessor.GetValueBoolean(nameof(TestMode), false);
        set
        {
            accessor.SetValueBoolean(nameof(TestMode), value);
            RaisePropertyChanged();
        }
    }

    private string ProtectedToken
    {
        get => accessor.GetValueString(nameof(ProtectedToken), "");
        set => accessor.SetValueString(nameof(ProtectedToken), value);
    }

    /// <summary>Eingabe aus der PasswordBox; wird beim Speichern geschützt abgelegt und geleert.</summary>
    public string TokenInput { get; set; } = "";

    public string TokenState => ProtectedToken.Length > 0 ? Texts.TokenStored : Texts.TokenMissing;

    // ---- Betrieb (AP-16g, FA-NIN-04/13): Offline-Modus, Zurücksetzen, Block überspringen, Erneut hochladen ----

    /// <summary>Offline-Modus (FA-NIN-04); wirkt sofort auf die laufende Laufzeit, ohne sie neu aufzubauen.</summary>
    public bool OfflineMode
    {
        get => accessor.GetValueBoolean(nameof(OfflineMode), false);
        set
        {
            accessor.SetValueBoolean(nameof(OfflineMode), value);
            if (NinaPmRuntime.Current is { } rt) rt.Runner.OfflineMode = value;
            RaisePropertyChanged();
            RaiseOperationChanged();
        }
    }

    /// <summary>*Erneut hochladen ab* (Datum, Standard: vor 7 Tagen).</summary>
    public DateTime ReuploadFrom { get; set; } = NinaPm.Core.Time.SystemClock.Instance.UtcNow.UtcDateTime.Date.AddDays(-7);

    public ICommand ResetCommand { get; }

    public ICommand SkipBlockCommand { get; }

    public ICommand ReuploadCommand { get; }

    public ICommand RefreshCommand { get; }

    /// <summary>Zielbrowser „An NINA ausgeliefert“ (FA-NIN-02, AP-16h).</summary>
    public Browser.TargetBrowserModel Targets { get; }

    /// <summary>Zustand der Laufzeit für die Optionsseite: gesperrt (mit Grund), Outbox, Dead-Letter, Uhr ungeprüft (offline).</summary>
    public string OperationStatus
    {
        get
        {
            if (NinaPmRuntime.Current is not { } rt) return Texts.NotConfigured;
            var r = rt.Runner;
            var blocked = r.Loop.Blocked switch
            {
                NinaPm.Core.Api.Generated.NinaHeartbeatBlockedReason.Token_invalid => Texts.TokenInvalid,
                NinaPm.Core.Api.Generated.NinaHeartbeatBlockedReason.Tenant_locked => Texts.TenantLocked,
                NinaPm.Core.Api.Generated.NinaHeartbeatBlockedReason.Engine_incompatible => Texts.UpdateNeeded,
                NinaPm.Core.Api.Generated.NinaHeartbeatBlockedReason.Clock_skew => Texts.ClockSkew,
                { } other => Texts.Blocked(Texts.BlockedReason(other.ToString().ToLowerInvariant())),
                null => null,
            };
            var parts = new List<string> { Texts.Outbox(r.OutboxPending, r.DeadLetters) };
            if (blocked is not null) parts.Insert(0, blocked);
            if (r.OfflineMode) parts.Add(Texts.ClockUnchecked);
            return string.Join(" · ", parts);
        }
    }

    /// <summary>Gründe der letzten Dead-Letter-Einträge (z. B. „Nacht seit … abgeschlossen – erneut hochladen“).</summary>
    public string DeadLetterInfo =>
        NinaPmRuntime.Current is { } rt ? string.Join(Environment.NewLine, rt.Store.DeadLetterReasons(3)) : "";

    private Task Operate(Action<NinaPm.Core.Execution.NightRunner> action)
    {
        if (NinaPmRuntime.Current is { } rt) action(rt.Runner);
        RaiseOperationChanged();
        return Task.CompletedTask;
    }

    private Task Reupload()
    {
        if (NinaPmRuntime.Current is { } rt)
        {
            var n = rt.Store.ReuploadSince(new DateTimeOffset(DateTime.SpecifyKind(ReuploadFrom.Date, DateTimeKind.Utc)));
            rt.Store.OutboxDueNow();
            rt.Log.Note($"Erneut hochladen ab {ReuploadFrom:yyyy-MM-dd}: {n} Meldungen in der Outbox");
        }
        RaiseOperationChanged();
        return Task.CompletedTask;
    }

    private void RaiseOperationChanged()
    {
        RaisePropertyChanged(nameof(OperationStatus));
        RaisePropertyChanged(nameof(DeadLetterInfo));
    }

    public ICommand TestCommand { get; }

    public ICommand SaveAndTestCommand { get; }

    public string ConnectionStatus { get; private set; } = "";
    public string TenantName { get; private set; } = "";
    public string InstanceName { get; private set; } = "";
    public string RigName { get; private set; } = "";
    public string SiteCheck { get; private set; } = "";

    internal PluginOptions Options() => new() { ServerUrl = ServerUrl, ProtectedToken = ProtectedToken, TestMode = TestMode };

    internal async Task SaveAndTestAsync(CancellationToken token)
    {
        var input = TokenInput.Trim();
        if (input.Length > 0)
        {
            ProtectedToken = protector.Protect(input);
            TokenInput = "";
            RaisePropertyChanged(nameof(TokenInput));
            RaisePropertyChanged(nameof(TokenState));
        }
        await TestAsync(token);
        StartRuntime();
    }

    internal async Task TestAsync(CancellationToken token)
    {
        var options = Options();
        ResetStatus();
        if (options.ApiBase is not { } apiBase)
        {
            SetStatus(Texts.InvalidUrl);
            return;
        }
        if (options.ProtectedToken.Length == 0)
        {
            SetStatus(Texts.NotConfigured);
            return;
        }
        var clear = protector.Unprotect(options.ProtectedToken);
        if (clear is null)
        {
            SetStatus(Texts.TokenUnreadable);
            return;
        }
        SetStatus(Texts.Testing);
        var host = new NinaSequenceHost(profileService);
        var (lat, lon, _) = host.ProfileLocation;
        using var api = new NinaApi(apiBase, clear, PluginVersion);
        var r = await api.TestConnectionAsync(log, (lat, lon), token);
        ApplyResult(r, options);
    }

    internal void ApplyResult(ConnectionResult r, PluginOptions options)
    {
        if (r.Ok)
        {
            TenantName = r.TenantName ?? "";
            InstanceName = r.InstanceName ?? "";
            RigName = r.RigName is null ? "" : $"{r.RigName} · {r.SiteName}";
            SiteCheck = r.SiteDistanceKm switch
            {
                null => Texts.SiteUnknown,
                <= Geo.SiteWarnKm => Texts.SiteOk(r.SiteDistanceKm.Value),
                _ => Texts.SiteFar(r.SiteDistanceKm.Value),
            };
            // Testbetrieb nur mit allen drei Bedingungen (NIN-17): Schalter, lokale URL, Antwort mit X-NPM-Test: 1.
            SetStatus(r.TestServer && options.IsLocalServer ? Texts.ConnectedTestServer : Texts.Connected);
            return;
        }
        SetStatus(r.Status switch
        {
            401 => Texts.TokenInvalid,
            403 when r.Code == "tenant.locked" => Texts.TenantLocked,
            409 when r.Code == "engine.incompatible" => Texts.UpdateNeeded,
            0 => Texts.Unreachable,
            _ => Texts.Failed(r.Status, r.Code),
        });
    }

    private void ResetStatus()
    {
        TenantName = InstanceName = RigName = SiteCheck = "";
        SetStatus("");
    }

    private void SetStatus(string text)
    {
        ConnectionStatus = text;
        RaisePropertyChanged(nameof(ConnectionStatus));
        RaisePropertyChanged(nameof(TenantName));
        RaisePropertyChanged(nameof(InstanceName));
        RaisePropertyChanged(nameof(RigName));
        RaisePropertyChanged(nameof(SiteCheck));
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void RaisePropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private void RaiseAllPropertiesChanged()
    {
        RaisePropertyChanged(nameof(ServerUrl));
        RaisePropertyChanged(nameof(TestMode));
        RaisePropertyChanged(nameof(OfflineMode));
        RaisePropertyChanged(nameof(TokenState));
        RaiseOperationChanged();
    }
}
