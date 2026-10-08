using NINA.Core.Utility.WindowService;
using NINA.Equipment.Interfaces;
using NINA.Equipment.Interfaces.Mediator;
using NINA.PlateSolving.Interfaces;
using NINA.Profile.Interfaces;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// NINAs Mediatoren, die der Container per MEF erhält und an Adapter und interne Elemente weitergibt. <c>Focuser</c> zuletzt
/// und optional (AP-65: Autofokus-Läufe melden); ohne Fokussierer-Mediator (Adapter-Tests) keine <c>af</c>-Ereignisse.
/// <c>AutoFocusFactory</c> (AP-68) für den eigenen Autofokus über NINAs <em>Run Autofocus</em>; ohne sie kein eigener Autofokus.
/// </summary>
internal sealed record NinaMediators(
    IProfileService Profile,
    ITelescopeMediator Telescope,
    IImagingMediator Imaging,
    ICameraMediator Camera,
    IFilterWheelMediator FilterWheel,
    IRotatorMediator Rotator,
    IGuiderMediator Guider,
    IDomeMediator Dome,
    IDomeFollower DomeFollower,
    IPlateSolverFactory PlateSolverFactory,
    IWindowServiceFactory WindowServiceFactory,
    IImageSaveMediator ImageSave,
    IImageHistoryVM ImageHistory,
    ISafetyMonitorMediator SafetyMonitor,
    IFocuserMediator? Focuser = null,
    NINA.WPF.Base.Interfaces.IAutoFocusVMFactory? AutoFocusFactory = null);
