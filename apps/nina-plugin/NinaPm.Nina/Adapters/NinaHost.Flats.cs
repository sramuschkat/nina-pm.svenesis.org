using System.IO;
using NINA.Astrometry;
using NINA.Core.Model;
using NINA.Core.Model.Equipment;
using NINA.Core.Utility;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.SequenceItem.FilterWheel;
using NINA.Sequencer.SequenceItem.FlatDevice;
using NINA.Sequencer.SequenceItem.Imaging;
using NINA.WPF.Base.Interfaces.Mediator;
using NinaPm.Core.Flats;
using NinaPm.Nina.Sequencer;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// NINA-Seite des Flat-Ablaufs (execution.md §7, TK 10.3 Nr. 12): Boxen am Container, Werte in NINAs
/// Flat-Anweisungen, ein globaler <c>ImageSaved</c>-Handler für den ganzen Lauf. Muster nach dem Astro-PM-Plugin
/// (MIT), <c>Instructions/TargetInstructionSet.cs</c> (<c>RunFlatsCore</c>, <c>ApplyComboToTrainedFlats</c>,
/// <c>ResetRunnerProgress</c>, <c>FlatsIsolationContainer</c>, <c>SetFlatsTarget</c>, <c>StopGuidingForFlats</c>),
/// Commit 5dd621d.
/// </summary>
internal sealed partial class NinaHost
{
    private FlatsIsolationContainer? flatsShim;
    private Action<FlatImage>? flatSink;

    public FlatBoxes Boxes()
    {
        if (Container is not { } c) return FlatBoxes.Empty;
        var items = Flatten(c.FlatsRunner).ToList();
        return new FlatBoxes(
            Setup: c.FlatsSetupRunner.GetItemsSnapshot().Count > 0,
            PerCombination: c.FlatsRunner.GetItemsSnapshot().Count > 0,
            Teardown: c.FlatsTeardownRunner.GetItemsSnapshot().Count > 0,
            HasDarkFlats: items.Any(i => i is TrainedDarkFlatExposure),
            UsesTrainedTable: items.Any(i => i is TrainedFlatExposure or TrainedDarkFlatExposure),
            CountsKnown: !items.Any(i => i is AutoExposureFlat or AutoBrightnessFlat or SkyFlat));
    }

    private static IEnumerable<ISequenceItem> Flatten(ISequenceContainer container)
    {
        foreach (var item in container.GetItemsSnapshot())
        {
            yield return item;
            // Die Flat-Anweisungen sind selbst Container; ihre Kinder (Belichtung, Filter) zählen hier nicht.
            if (item is ISequenceContainer child && item is not (TrainedFlatExposure or TrainedDarkFlatExposure or AutoExposureFlat or AutoBrightnessFlat or SkyFlat))
                foreach (var nested in Flatten(child)) yield return nested;
        }
    }

    public async Task StopGuidingAsync(CancellationToken token)
    {
        try
        {
            if (m.Guider.GetInfo().Connected) await m.Guider.StopGuiding(token);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: Guiding für die Flats nicht gestoppt: {ex.Message}");
        }
    }

    public Task MoveMechanicalAsync(double degrees, CancellationToken token) => m.Rotator.MoveMechanical((float)degrees, token);

    public async Task ChangeFilterAsync(int filterIndex, CancellationToken token)
    {
        var filters = m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        if (filters is null || filterIndex < 0 || filterIndex >= filters.Count) return;
        await m.FilterWheel.ChangeFilter(filters[filterIndex], token, Progress ?? new Progress<ApplicationStatus>());
    }

    public IReadOnlyList<string>? ReadoutModes() => m.Camera.GetInfo().ReadoutModes?.ToList();

    /// <summary>Flats/Dark-Flats laufen als FLAT/DARK über die Normal-Einstellung (Original <c>AstroPMChildItems.cs:394</c>).</summary>
    public void SetReadoutMode(int index) => m.Camera.SetReadoutModeForNormalImages((short)index);

    public double? TrainedFlatExposureS(int filterIndex, int binning, int gain, int offset)
    {
        var profile = m.Profile.ActiveProfile;
        var filters = profile.FilterWheelSettings.FilterWheelFilters;
        short? position = filters is not null && filterIndex >= 0 && filterIndex < filters.Count ? filters[filterIndex].Position : null;
        // Wie NINAs Trained Flat Exposure: -1 = Kamera-Standard des Profils.
        var g = gain == -1 ? profile.CameraSettings.Gain ?? -1 : gain;
        var o = offset == -1 ? profile.CameraSettings.Offset ?? -1 : offset;
        return profile.FlatDeviceSettings.GetTrainedFlatExposureSetting(position, new BinningMode((short)binning, (short)binning), g, o)?.Time;
    }

    public double? MaxAdu()
    {
        var bits = m.Camera.GetInfo().BitDepth;
        return bits is > 0 and <= 32 ? Math.Pow(2, bits) - 1 : null;
    }

    public Task RunSetupAsync(CancellationToken token) => RunBoxAsync(Box.FlatsSetupRunner, token);

    public Task RunTeardownAsync(CancellationToken token) => RunBoxAsync(Box.FlatsTeardownRunner, token);

    public async Task RunCombinationAsync(FlatComboRun run, CancellationToken token)
    {
        var runner = Box.FlatsRunner;
        var filters = m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        var filter = filters is not null && run.FilterIndex >= 0 && run.FilterIndex < filters.Count ? filters[run.FilterIndex] : null;
        SetFlatsTarget(run.TargetName);
        ResetRecursive(runner);
        Apply(runner, run, filter);
        await RunBoxAsync(runner, token, reset: false);
    }

    /// <summary>
    /// Werte der Kombination in jede Flat-Anweisung der Box schreiben (Trained Flat/Dark Flat Exposure, Auto Exposure Flat,
    /// Auto Brightness Flat, Sky Flat): Filter, Gain, Offset, Binning und Anzahl. Dark-Flats mit Anzahl 0 werden
    /// übersprungen (Gruppe erledigt, NIN-15).
    /// </summary>
    private static void Apply(ISequenceContainer container, FlatComboRun run, FilterInfo? filter)
    {
        foreach (var item in container.GetItemsSnapshot())
        {
            (SwitchFilter? Switch, TakeExposure? Exposure, NINA.Sequencer.Conditions.LoopCondition? Loop, bool Dark) parts = item switch
            {
                TrainedFlatExposure t => (t.GetSwitchFilterItem(), t.GetExposureItem(), t.GetIterations(), false),
                TrainedDarkFlatExposure d => (d.GetSwitchFilterItem(), d.GetExposureItem(), d.GetIterations(), true),
                AutoExposureFlat a => (a.GetSwitchFilterItem(), a.GetExposureItem(), a.GetIterations(), false),
                AutoBrightnessFlat b => (b.GetSwitchFilterItem(), b.GetExposureItem(), b.GetIterations(), false),
                SkyFlat s => (s.GetSwitchFilterItem(), s.GetExposureItem(), s.GetIterations(), false),
                _ => (null, null, null, false),
            };
            if (parts.Exposure is null)
            {
                if (item is ISequenceContainer child) Apply(child, run, filter);
                continue;
            }
            if (parts.Switch is not null && filter is not null) parts.Switch.Filter = filter;
            parts.Exposure.Gain = run.Gain;
            parts.Exposure.Offset = run.Offset;
            parts.Exposure.Binning = new BinningMode((short)run.Binning, (short)run.Binning);
            var count = parts.Dark ? run.DarkFlats : run.Flats;
            if (parts.Loop is not null) parts.Loop.Iterations = Math.Max(count, 0);
            if (count <= 0) item.Skip();
        }
    }

    /// <summary>
    /// Box am Container ohne Parent ausführen: keine Sequenz-Trigger während der Flats (Restore Guiding, Flip, AF),
    /// <c>$$TARGETNAME$$</c> über den Ziel-Container. Fortschritt vorher rekursiv inklusive Schleifenbedingungen
    /// zurücksetzen – sonst überspringt sich <em>Trained Flat Exposure</em> beim zweiten Lauf („20/20“).
    /// </summary>
    private async Task RunBoxAsync(SequentialContainer runner, CancellationToken token, bool reset = true)
    {
        flatsShim ??= new FlatsIsolationContainer { Target = Box.Target, NighttimeData = Box.NighttimeData };
        runner.AttachNewParent(flatsShim);
        try
        {
            if (reset) ResetRecursive(runner);
            await runner.Run(Progress ?? new Progress<ApplicationStatus>(), token);
        }
        finally
        {
            runner.AttachNewParent(Box);
        }
    }

    private static void ResetRecursive(ISequenceContainer container)
    {
        if (container is SequenceContainer sc)
        {
            sc.ResetProgress();
            foreach (var condition in sc.Conditions.ToList()) condition.ResetProgress();
        }
        foreach (var item in container.GetItemsSnapshot())
            if (item is ISequenceContainer child) ResetRecursive(child);
    }

    /// <summary>Ziel des Isolations-Containers: NINA speichert unter dem Namen der Lights (Primärziel der Kombination).</summary>
    private void SetFlatsTarget(string targetName)
    {
        var astro = m.Profile.ActiveProfile.AstrometrySettings;
        var target = new InputTarget(NINA.Astrometry.Angle.ByDegree(astro.Latitude), NINA.Astrometry.Angle.ByDegree(astro.Longitude), astro.Horizon)
        {
            TargetName = targetName,
        };
        flatsShim ??= new FlatsIsolationContainer { NighttimeData = Box.NighttimeData };
        flatsShim.Target = target;
    }

    public void BeginImages(Action<FlatImage> sink)
    {
        flatSink = sink;
        m.ImageSave.ImageSaved += OnFlatImageSaved;
    }

    public void EndImages()
    {
        m.ImageSave.ImageSaved -= OnFlatImageSaved;
        flatSink = null;
        flatsShim = null;
        Container?.RehomeFlatRunners();
    }

    /// <summary>Nur FLAT und DARK (NINA 3.2 speichert Dark-Flats als DARK); Lights laufen über die Bildzuordnung (§4.3).</summary>
    private void OnFlatImageSaved(object? sender, ImageSavedEventArgs e)
    {
        try
        {
            var type = e.MetaData?.Image?.ImageType;
            if (type is not ("FLAT" or "DARK") || e.PathToImage is null || flatSink is not { } sink) return;
            var meta = e.MetaData!;
            var start = meta.Image.ExposureStart != default ? Utc(meta.Image.ExposureStart) : clock.UtcNow.AddSeconds(-e.Duration);
            var mid = meta.Image.ExposureMidPoint != default ? Utc(meta.Image.ExposureMidPoint) : start.AddSeconds(e.Duration / 2);
            sink(new FlatImage(
                e.PathToImage.LocalPath,
                Dark: type == "DARK",
                FilterName: string.IsNullOrEmpty(e.Filter) ? null : e.Filter,
                Binning: meta.Camera.BinX > 0 ? meta.Camera.BinX : 1,
                ExposureS: e.Duration,
                MeanAdu: e.Statistics is { } st && double.IsFinite(st.Mean) ? st.Mean : null,
                CapturedAtUtc: start,
                ExposureMidUtc: mid,
                SensorTempC: double.IsFinite(meta.Camera.Temperature) ? meta.Camera.Temperature : null,
                SetPointC: double.IsFinite(meta.Camera.SetPoint) ? meta.Camera.SetPoint : null));
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: Flat-Datei nicht zugeordnet: {ex.Message}");
        }
    }

    private static DateTimeOffset Utc(DateTime t) => new(DateTime.SpecifyKind(t, DateTimeKind.Utc));

    public bool CopyFile(string source, string destination)
    {
        try
        {
            if (File.Exists(destination)) return false;
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(source, destination);
            return true;
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: Flat-Kopie {source} → {destination} fehlgeschlagen: {ex.Message}");
            return false;
        }
    }
}
