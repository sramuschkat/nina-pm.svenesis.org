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
        NINA.Equipment.Interfaces.Mediator.ISafetyMonitorMediator safetyMonitor)
        : this(profileService, new DpapiTokenProtector(), new NinaMediators(profileService, telescope, imaging, camera, filterWheel,
            rotator, guider, dome, domeFollower, plateSolverFactory, windowServiceFactory, imageSave, imageHistory, safetyMonitor))
    {
    }

    internal NinaPmPlugin(IProfileService profileService, ITokenProtector protector, NinaMediators? mediators = null)
    {
        this.profileService = profileService;
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
        RaisePropertyChanged(nameof(TokenState));
    }
}
