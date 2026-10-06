using NinaPm.Core.Flats;

namespace NinaPm.Sim;

/// <summary>
/// Simuliertes NINA für den Flat-Ablauf (AP-50): Boxen nach <see cref="SimSetup.FlatBox"/>, trainierte Belichtung
/// 1,5 s, jede Datei geht über den einen Handler; Dateien liegen unter <c>SIM/&lt;Ziel&gt;/FLAT|DARK/…</c>.
/// </summary>
public sealed partial class SimNina : IFlatHost
{
    private const double TrainedS = 1.5;
    private Action<FlatImage>? flatSink;

    public FlatBoxes Boxes() => world.FlatBox switch
    {
        "none" => FlatBoxes.Empty,
        "auto" => new FlatBoxes(true, true, true, HasDarkFlats: false, UsesTrainedTable: false, CountsKnown: false),
        "trained_no_darks" => new FlatBoxes(true, true, true, HasDarkFlats: false, UsesTrainedTable: true, CountsKnown: true),
        _ => new FlatBoxes(true, true, true, HasDarkFlats: true, UsesTrainedTable: true, CountsKnown: true),
    };


    public async Task MoveMechanicalAsync(double degrees, CancellationToken token)
    {
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(15), token).ConfigureAwait(false);
        world.RotatorMechDeg = degrees;
    }

    public IReadOnlyList<string> ProfileFilterNames() => world.ProfileFilters;

    public async Task ChangeFilterAsync(int filterIndex, CancellationToken token)
    {
        currentFilter = filterIndex >= 0 && filterIndex < world.ProfileFilters.Count ? world.ProfileFilters[filterIndex] : null;
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(5), token).ConfigureAwait(false);
    }

    public IReadOnlyList<string>? ReadoutModes() => world.ReadoutModes;

    public void SetReadoutMode(int index) { }

    public double? TrainedFlatExposureS(int filterIndex, int binning, int gain, int offset) => TrainedS;

    public double? MaxAdu() => 65535;

    public Task RunSetupAsync(CancellationToken token) => clock.AdvanceToAsync(clock.UtcNow.AddSeconds(30), token);

    public Task RunTeardownAsync(CancellationToken token) => clock.AdvanceToAsync(clock.UtcNow.AddSeconds(20), token);

    public async Task RunCombinationAsync(FlatComboRun run, CancellationToken token)
    {
        var exposureS = world.FlatBox == "auto" ? 2.0 : TrainedS;
        for (var i = 0; i < run.Flats; i++) await SaveFlatAsync(run, exposureS, dark: false, token).ConfigureAwait(false);
        for (var i = 0; i < run.DarkFlats; i++) await SaveFlatAsync(run, exposureS, dark: true, token).ConfigureAwait(false);
    }

    private async Task SaveFlatAsync(FlatComboRun run, double exposureS, bool dark, CancellationToken token)
    {
        var start = clock.UtcNow;
        await clock.AdvanceToAsync(start.AddSeconds(exposureS), token).ConfigureAwait(false);
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(DownloadS), CancellationToken.None).ConfigureAwait(false);
        if (dead()) return;
        world.ImageCounter++;
        var path = $"SIM/{run.TargetName}/{(dark ? "DARK" : "FLAT")}/SIM_{currentFilter}_{world.ImageCounter:0000}.fits";
        world.FlatFiles.Add(path);
        flatSink?.Invoke(new FlatImage(path, dark, currentFilter, run.Binning, exposureS,
            dark ? 300 : world.FlatMeanShare * 65535, start, start.AddSeconds(exposureS / 2), world.CameraTemperatureC, world.CameraSetpointC));
    }

    public void BeginImages(Action<FlatImage> sink) => flatSink = sink;

    public void EndImages() => flatSink = null;

    public bool CopyFile(string source, string destination)
    {
        if (world.FlatFiles.Contains(destination)) return false;
        world.FlatFiles.Add(destination);
        return true;
    }
}
