using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Newtonsoft.Json;

namespace NinaPm.Core.Flats;

/// <summary>Was ein Flat-Lauf aus Bootstrap und Plan braucht.</summary>
/// <param name="FlatCount">Flats je Kombination (Rig, FA-SCH-08).</param>
/// <param name="DarkFlatCount">Dark-Flats je Gruppe; 0 = keine Dark-Flats.</param>
/// <param name="NotAfterUtc"><c>flatsNotAfterUtc</c> (Himmelsflats, NT-40): später beginnt keine Kombination mehr.</param>
public sealed record FlatRunSettings(string Night, Guid? NightPlanId, int FlatCount, int DarkFlatCount, DateTimeOffset? NotAfterUtc, FlatPlanOptions Options);

/// <summary>
/// Flat-Ablauf am Nachtende (FA-NIN-17, execution.md §7, TK 10.3 Nr. 12): Guiding stoppen → <em>Vor Flats</em> einmal →
/// je Kombination **streng seriell** Rotator (mechanisch, eingefrorener Winkel), Filter über den bestätigten NINA-Namen,
/// Auslesemodus, Werte in die Box <em>Je Kombination</em>, ausführen und auf die letzten Dateien warten → Kopie in die
/// Ordner der übrigen Ziele → <em>Nach Flats</em> einmal. Jede Flat-/Dark-Flat-Datei wird einmal gemeldet
/// (<c>projectIds</c>, eingefrorener <c>rotatorMechDeg</c>, <c>flatsPlanned</c>/<c>darkFlatsPlanned</c>, NIN5-8/9).
/// Status und Zähler stehen nach jeder Datei in <c>flat_combination_local</c>; ein Neustart setzt bei der ersten offenen
/// Kombination mit den fehlenden Aufnahmen fort.
/// </summary>
/// <remarks>
/// Muster nach dem Astro-PM-Plugin (MIT), <c>Instructions/TargetInstructionSet.cs</c> (<c>RunFlatsIfNeeded</c>,
/// <c>RunFlatsCore</c>, <c>StopGuidingForFlats</c>), Commit 5dd621d; Zuordnung der Dateien, Fortsetzen, Dark-Flat-Gruppen
/// und Meldungen sind eigene Ergänzungen (NIN-15/16, NIN5-8/9/11).
/// </remarks>
public sealed class FlatExecutor(IFlatHost host, LocalStore store, IClock clock, NinaPmLog log)
{
    /// <summary>Frist nach dem letzten <c>ImageSaved</c>, bevor eine Kombination ohne volle Zählung abgeschlossen wird (wie Lights, §4.3).</summary>
    public static readonly TimeSpan SaveGrace = TimeSpan.FromSeconds(120);

    private static readonly TimeSpan Poll = TimeSpan.FromSeconds(2);

    private readonly object gate = new();
    private FlatCombination? running;
    private DarkFlatGroup? runningGroup;
    private FlatRunSettings? settings;
    private int? runningFlatTarget;
    private int? runningDarkTarget;
    private DateTimeOffset? lastSaved;

    /// <summary>Meldung einer Aufnahme (Outbox); ohne Session meldet der Aufrufer nicht.</summary>
    public Action<Captures>? ReportCapture { get; set; }

    /// <summary>Ereignis an den Server (<c>flats_start</c>, <c>flats_end</c>, <c>warning</c>).</summary>
    public Action<EventsKind, string?, IDictionary<string, object>?>? ReportEvent { get; set; }

    /// <summary>Nachholen ausgefallener Flats höchstens so viele Nächte nach ihrer Entstehung (AP-50b, wie Astro PM).</summary>
    public const int CarryOverMaxNights = 3;

    /// <summary>Vorhandene Flats je Projekt aus <c>targets</c> (Auto-Flats, AP-50b); ohne Ziele keine.</summary>
    public Func<Guid, IReadOnlyList<FlatsOnRecord>?>? Records { get; set; }

    /// <summary>Inhalt der Boxen am Container.</summary>
    public FlatBoxes Boxes() => host.Boxes();

    /// <summary>Läuft gerade ein Flat-Lauf (Heartbeat <c>flats</c>, Schleifenbedingung).</summary>
    public bool Running { get; private set; }

    /// <summary>Kombination, die gerade aufgenommen wird (Live-Status).</summary>
    public FlatCombination? Current
    {
        get
        {
            lock (gate) return running;
        }
    }

    /// <summary>
    /// Kombinationen der Nacht aus den gespeicherten Lights bilden bzw. fortschreiben und speichern (neue Kombinationen
    /// <c>pending</c>, bestehende behalten Winkel und Status).
    /// </summary>
    public IReadOnlyList<FlatCombination> Prepare(string night, FlatPlanOptions options, bool includeCarryOver = false)
    {
        var lights = store.FlatLights(night);
        var before = store.FlatCombinations(night);
        var combos = FlatPlanner.Update(lights, before, options);
        if (options.Auto is { On: true } auto)
        {
            if (includeCarryOver) MergeCarryOver(night, combos);
            ApplyAuto(combos, auto, options.RotationToleranceDeg);
        }
        foreach (var c in combos)
        {
            var old = before.FirstOrDefault(b => b.Key == c.Key);
            if (old is null || JsonConvert.SerializeObject(old) != JsonConvert.SerializeObject(c)) store.SaveFlatCombination(night, c);
        }
        return combos;
    }

    /// <summary>Offene Kombinationen der Nacht (nach <see cref="Prepare"/>).</summary>
    public bool Pending(string night, FlatPlanOptions options, bool includeCarryOver = false) =>
        Prepare(night, options, includeCarryOver).Any(c => c.Open);

    /// <summary>
    /// Offene Kombinationen auf <c>skipped</c> setzen (Nachtende bei <c>sessionEndUtc</c>, veraltete Nacht, unsicherer
    /// Abschluss). Mit <paramref name="carryOver"/> (Auto-Flats an, AP-50b) gehen sie in den nächsten Morgen über.
    /// </summary>
    public int SkipOpen(string night, string reason, bool carryOver = false)
    {
        var skipped = new List<FlatCombination>();
        foreach (var c in store.FlatCombinations(night).Where(c => c.Open))
        {
            c.Status = FlatStatus.Skipped;
            store.SaveFlatCombination(night, c);
            log.Event("FLATS_END", ("combination", c.LogKey), ("mechDg", c.MechDg), ("status", "skipped"), ("reason", reason));
            skipped.Add(c);
        }
        if (carryOver && skipped.Count > 0)
        {
            var carry = LoadCarryOver();
            var list = carry?.Night == night ? carry.Combinations : [];
            foreach (var c in skipped)
            {
                c.CarriedFrom ??= night;
                if (!list.Any(x => x.Key == c.Key)) list.Add(c);
            }
            store.SetState(StateKeys.FlatCarryOver, JsonConvert.SerializeObject(new FlatCarryOver(night, list)));
            log.Note($"Flats: {skipped.Count} combination(s) carried over to the next morning (at most {CarryOverMaxNights} nights)");
        }
        return skipped.Count;
    }

    /// <summary>Nachholen verwerfen (Flats oder Auto-Flats im Rig ausgeschaltet).</summary>
    public void DropCarryOver(string why)
    {
        if (store.GetState(StateKeys.FlatCarryOver) is null) return;
        store.SetState(StateKeys.FlatCarryOver, null);
        log.Note($"Flats: nachzuholende Kombinationen verworfen ({why})");
    }

    private FlatCarryOver? LoadCarryOver() =>
        store.GetState(StateKeys.FlatCarryOver) is { } json ? JsonConvert.DeserializeObject<FlatCarryOver>(json) : null;

    /// <summary>
    /// Nachzuholende Kombinationen einer früheren Nacht als offene Kombinationen dieser Nacht übernehmen (volle Anzahl,
    /// eigener eingefrorener Winkel und Zielliste); älter als <see cref="CarryOverMaxNights"/> Nächte → verworfen.
    /// </summary>
    private void MergeCarryOver(string night, List<FlatCombination> combos)
    {
        if (LoadCarryOver() is not { } carry || carry.Night == night) return;
        store.SetState(StateKeys.FlatCarryOver, null);
        var order = combos.Count == 0 ? 0 : combos.Max(c => c.Order) + 1;
        foreach (var old in carry.Combinations)
        {
            var origin = old.CarriedFrom ?? carry.Night;
            if (NightsBetween(origin, night) > CarryOverMaxNights)
            {
                log.Event("FLATS_END", ("combination", old.LogKey), ("mechDg", old.MechDg), ("status", "skipped"), ("reason", "carry_over_expired"));
                continue;
            }
            if (combos.Any(c => c.Key == old.Key)) continue;
            combos.Add(new FlatCombination
            {
                FilterShort = old.FilterShort,
                NinaFilter = old.NinaFilter,
                Gain = old.Gain,
                Offset = old.Offset,
                Binning = old.Binning,
                ReadoutIndex = old.ReadoutIndex,
                ReadoutName = old.ReadoutName,
                MechDg = old.MechDg,
                MedianDg = old.MedianDg,
                Targets = [.. old.Targets],
                FullSet = old.FullSet,
                CarriedFrom = origin,
                Order = order++,
            });
            log.Note($"Flats: {old.LogKey} @ {old.MechDg / 10.0:0.0}° from night {origin} is caught up");
        }
    }

    private static int NightsBetween(string from, string to) =>
        DateOnly.TryParse(from, System.Globalization.CultureInfo.InvariantCulture, out var a)
        && DateOnly.TryParse(to, System.Globalization.CultureInfo.InvariantCulture, out var b)
            ? b.DayNumber - a.DayNumber
            : int.MaxValue;

    /// <summary>
    /// Auto-Flats (AP-50b): eine noch nicht begonnene Kombination entfällt, wenn **alle** Projekte ihrer Zielliste
    /// gültige Flats dafür haben; einmal je Kombination geprüft (danach bleibt die Entscheidung bis zum Ende der Nacht).
    /// </summary>
    private void ApplyAuto(List<FlatCombination> combos, FlatAutoSettings auto, double rotationToleranceDeg)
    {
        if (Records is not { } records) return;
        var now = clock.UtcNow;
        foreach (var c in combos.Where(c => c.Status == FlatStatus.Pending && !c.AutoChecked && c.FlatsSaved == 0 && c.DarkFlatsSaved == 0))
        {
            c.AutoChecked = true;
            var projects = c.Targets.Select(t => t.ProjectId).Distinct().ToList();
            if (projects.Count == 0) continue;
            if (!projects.All(p => FlatCoverage.Covered(records(p), c, auto, rotationToleranceDeg, now, out _))) continue;
            c.Status = FlatStatus.Skipped;
            log.Event("FLATS_END", ("combination", c.LogKey), ("mechDg", c.MechDg), ("status", "skipped"), ("reason", "covered"));
        }
    }

    public async Task RunAsync(FlatRunSettings s, CancellationToken token)
    {
        var boxes = host.Boxes();
        var combos = FlatPlanner.ExecutionOrder(Prepare(s.Night, s.Options), s.Options).Where(c => c.Open).ToList();
        if (combos.Count == 0) return;
        settings = s;
        Running = true;
        log.Event("FLATS_START", ("atUtc", clock.UtcNow));
        ReportEvent?.Invoke(EventsKind.Flats_start, null, new Dictionary<string, object> { ["combinations"] = combos.Count });
        try
        {
            await host.StopGuidingAsync(token).ConfigureAwait(false);
            host.BeginImages(OnImage);
            if (boxes.Setup) await Guarded("before_flats", () => host.RunSetupAsync(token)).ConfigureAwait(false);
            int? currentMech = null;
            foreach (var combo in combos)
            {
                token.ThrowIfCancellationRequested();
                currentMech = await RunCombinationAsync(combo, boxes, s, currentMech, token).ConfigureAwait(false);
            }
            if (boxes.Teardown) await Guarded("after_flats", () => host.RunTeardownAsync(token)).ConfigureAwait(false);
        }
        finally
        {
            lock (gate)
            {
                running = null;
                runningGroup = null;
            }
            host.EndImages();
            Running = false;
        }
        log.Event("FLATS_END", ("atUtc", clock.UtcNow));
        ReportEvent?.Invoke(EventsKind.Flats_end, null, null);
    }

    private async Task<int?> RunCombinationAsync(FlatCombination combo, FlatBoxes boxes, FlatRunSettings s, int? currentMech, CancellationToken token)
    {
        if (s.NotAfterUtc is { } notAfter && clock.UtcNow >= notAfter)
        {
            Skip(combo, s.Night, "flats_not_after");
            return currentMech;
        }

        var profileFilters = host.ProfileFilterNames();
        var filter = FilterResolver.Resolve(combo.NinaFilter, profileFilters);
        if (filter.Kind == FilterResolutionKind.NotFound)
        {
            log.Event("FILTER_NOT_FOUND", ("filter", combo.NinaFilter), ("short", combo.FilterShort));
            Skip(combo, s.Night, "filter_not_found");
            return currentMech;
        }
        var readout = ReadoutResolver.Resolve(combo.ReadoutName, host.ReadoutModes());
        if (readout.Kind == ReadoutResolutionKind.NotFound)
        {
            log.Event("READOUT_MODE_NOT_FOUND", ("name", combo.ReadoutName));
            Skip(combo, s.Night, "readout_mode_not_found");
            return currentMech;
        }

        // Trained Flats (NT-39): NINAs Tabelle hängt an der Filterposition – hat sie sich seit dem letzten Flat-Lauf geändert, gilt sie nicht mehr.
        // Bemerkt wird der Wechsel einmal je Nacht: in dieser Nacht übersprungen (Hinweis), ab der nächsten gilt die Tabelle der
        // neuen Position – sonst übersprang der Filter jede Nacht, ohne Weg zurück (Analyse 04.10.2026). Ist sie nicht neu
        // trainiert, meldet die Prüfung der ersten Aufnahme `flat_exposure_off`.
        var positions = TrainedPositions();
        var noticed = PositionNoticed();
        if (boxes.UsesTrainedTable && filter.Kind == FilterResolutionKind.Found
            && positions.TryGetValue(combo.NinaFilter, out var lastPosition) && lastPosition != filter.Index + 1
            && (!noticed.TryGetValue(combo.NinaFilter, out var noticedNight) || noticedNight == s.Night))
        {
            noticed[combo.NinaFilter] = s.Night;
            store.SetState(StateKeys.TrainedFlatPositionNoticed, JsonConvert.SerializeObject(noticed));
            log.Warning("WARNING", ("code", "trained_flat_position_changed"), ("filter", combo.NinaFilter));
            ReportEvent?.Invoke(EventsKind.Warning, "trained_flat_position_changed",
                new Dictionary<string, object> { ["filter"] = combo.NinaFilter, ["before"] = lastPosition, ["now"] = filter.Index + 1 });
            Skip(combo, s.Night, "trained_flat_position_changed");
            return currentMech;
        }
        double? trainedS = null;
        if (boxes.UsesTrainedTable && filter.Kind == FilterResolutionKind.Found)
        {
            trainedS = host.TrainedFlatExposureS(filter.Index, combo.Binning, combo.Gain, combo.Offset);
            if (trainedS is null)
                log.Note($"Flats: no trained flat exposure for {combo.NinaFilter} Bin {combo.Binning} Gain {combo.Gain} Offset {combo.Offset} " +
                    "– train it in NINA under Equipment → Flat Panel (the trained flat instruction fails otherwise)");
        }

        // Dark-Flats je (Belichtungszeit, Gain, Offset, Binning, Auslesemodus) einmal je Nacht (NIN-15).
        var exposureS = trainedS ?? combo.FlatExposureS;
        var darkCount = boxes.HasDarkFlats ? s.DarkFlatCount : 0;
        DarkFlatGroup? group = null;
        var darkMissing = 0;
        if (darkCount > 0)
        {
            if (exposureS is { } t)
            {
                var key = DarkFlatGroup.KeyFor(t, combo.Gain, combo.Offset, combo.Binning, combo.ReadoutIndex);
                group = store.DarkFlatGroups(s.Night).FirstOrDefault(g => g.Key == key) ?? new DarkFlatGroup { Key = key, CombinationKey = combo.Key };
                // Eine Gruppe ohne gespeicherte Dark-Flats übernimmt die nächste passende Kombination (VM-Lauf 04.10.2026).
                group.CombinationKey ??= combo.Key;
                darkMissing = group.Status == FlatStatus.Done || group.CombinationKey != combo.Key ? 0 : Math.Max(0, darkCount - group.Saved);
            }
            else
            {
                // Belichtung vorab unbekannt (Auto-Exposure/Sky-Flat): keine Gruppe, die Kombination nimmt ihre eigenen Dark-Flats.
                darkMissing = Math.Max(0, darkCount - combo.DarkFlatsSaved);
            }
        }
        var flatsMissing = boxes.CountsKnown ? Math.Max(0, s.FlatCount - combo.FlatsSaved) : s.FlatCount;
        var resuming = combo.Status == FlatStatus.Running || combo.FlatsSaved > 0 || combo.DarkFlatsSaved > 0;
        combo.FlatsPlanned ??= boxes.CountsKnown ? flatsMissing : null;
        combo.DarkFlatsPlanned ??= darkMissing;
        if (resuming)
            log.Event("FLATS_RESUME", ("combination", combo.LogKey), ("mechDg", combo.MechDg), ("missing", flatsMissing + darkMissing));
        if (boxes.CountsKnown && flatsMissing == 0 && darkMissing == 0)
        {
            Finish(combo, group, s.Night, darkCount);
            return currentMech;
        }

        if (host.RotatorConnected && currentMech != combo.MechDg)
        {
            await host.MoveMechanicalAsync(combo.MechDg / 10.0, token).ConfigureAwait(false);
            currentMech = combo.MechDg;
        }
        if (filter.Kind == FilterResolutionKind.Found) await host.ChangeFilterAsync(filter.Index, token).ConfigureAwait(false);
        if (readout.Kind == ReadoutResolutionKind.Found) host.SetReadoutMode(readout.Index);

        combo.Status = FlatStatus.Running;
        store.SaveFlatCombination(s.Night, combo);
        if (group is not null && darkMissing > 0) store.SaveDarkFlatGroup(s.Night, group);
        log.Event("FLATS_START", ("combination", combo.LogKey), ("mechDg", combo.MechDg), ("filter", combo.NinaFilter));
        lock (gate)
        {
            running = combo;
            runningGroup = darkMissing > 0 ? group : null;
            runningFlatTarget = boxes.CountsKnown ? combo.FlatsSaved + flatsMissing : null;
            runningDarkTarget = combo.DarkFlatsSaved + darkMissing;
            lastSaved = null;
        }

        var primary = combo.Targets.FirstOrDefault()?.Name ?? "NINA-PM";
        var run = new FlatComboRun(filter.Kind == FilterResolutionKind.Found ? filter.Index : -1, combo.Gain, combo.Offset, combo.Binning,
            flatsMissing, darkMissing, primary);
        var boxOk = await Guarded("flats", () => host.RunCombinationAsync(run, token)).ConfigureAwait(false);
        if (!boxOk && combo.FlatsSaved == 0 && combo.DarkFlatsSaved == 0)
        {
            // Box gescheitert, nichts gespeichert: nicht als erledigt melden und nicht 120 s auf Dateien warten.
            lock (gate)
            {
                running = null;
                runningGroup = null;
            }
            ReleaseGroup(group, s.Night);
            Skip(combo, s.Night, "box_failed");
            return currentMech;
        }

        // Abschluss: volle Zählung oder 120 s nach dem letzten ImageSaved (NIN5-11) – sonst fehlen die letzten Dateien.
        var boxEnd = clock.UtcNow;
        while (true)
        {
            DateTimeOffset since;
            lock (gate)
            {
                if (Complete()) break;
                since = lastSaved ?? boxEnd;
            }
            if (clock.UtcNow - since >= SaveGrace) break;
            await host.DelayAsync(clock.UtcNow + Poll, token).ConfigureAwait(false);
        }
        lock (gate)
        {
            running = null;
            runningGroup = null;
        }

        Finish(combo, group, s.Night, darkCount);
        CopyToOtherTargets(combo);
        if (filter.Kind == FilterResolutionKind.Found)
        {
            positions[combo.NinaFilter] = filter.Index + 1;
            store.SetState(StateKeys.TrainedFlatPositions, JsonConvert.SerializeObject(positions));
            if (noticed.Remove(combo.NinaFilter))
                store.SetState(StateKeys.TrainedFlatPositionNoticed, JsonConvert.SerializeObject(noticed));
        }
        return currentMech;
    }

    private bool Complete()
    {
        if (running is null) return true;
        if (runningFlatTarget is not { } flats) return false;
        return running.FlatsSaved >= flats && running.DarkFlatsSaved >= (runningDarkTarget ?? 0);
    }

    private void Finish(FlatCombination combo, DarkFlatGroup? group, string night, int darkCount)
    {
        combo.Status = FlatStatus.Done;
        store.SaveFlatCombination(night, combo);
        if (group is not null && group.CombinationKey == combo.Key && group.Status != FlatStatus.Done)
        {
            // Erledigt erst mit allen Dark-Flats; sonst übernimmt die nächste passende Kombination die Gruppe.
            if (group.Saved >= darkCount)
            {
                group.Status = FlatStatus.Done;
                store.SaveDarkFlatGroup(night, group);
                log.Event("DARKFLAT_GROUP", ("combination", combo.LogKey), ("mechDg", combo.MechDg), ("status", "done"));
            }
            else
            {
                ReleaseGroup(group, night);
            }
        }
        log.Event("FLATS_END", ("combination", combo.LogKey), ("mechDg", combo.MechDg), ("status", "done"));
    }

    /// <summary>Gruppe ohne vollständige Dark-Flats freigeben: die nächste Kombination mit demselben Schlüssel übernimmt sie.</summary>
    private void ReleaseGroup(DarkFlatGroup? group, string night)
    {
        if (group is null || group.Status == FlatStatus.Done) return;
        group.CombinationKey = null;
        store.SaveDarkFlatGroup(night, group);
    }

    private void Skip(FlatCombination combo, string night, string reason)
    {
        combo.Status = FlatStatus.Skipped;
        store.SaveFlatCombination(night, combo);
        log.Event("FLATS_END", ("combination", combo.LogKey), ("mechDg", combo.MechDg), ("status", "skipped"), ("reason", reason));
    }

    /// <summary>
    /// Globaler <c>ImageSaved</c>-Handler (NIN5-11): die Datei gehört zur laufenden Kombination, wenn Filter und Binning
    /// passen – die Kombinationen laufen streng seriell, eine Datei kann nie zwei Kombinationen zugeordnet werden.
    /// </summary>
    public void OnImage(FlatImage image)
    {
        Captures capture;
        FlatCombination combo;
        string night;
        bool checkExposure;
        lock (gate)
        {
            if (running is null || settings is null)
            {
                log.Note($"Flat file without a running combination not assigned: {Path.GetFileName(image.Path)}");
                return;
            }
            combo = running;
            if (image.Binning != combo.Binning || (image.FilterName is { } f && !string.Equals(f, combo.NinaFilter, StringComparison.Ordinal)))
            {
                log.Note($"Flat file does not match combination {combo.LogKey}: {Path.GetFileName(image.Path)}");
                return;
            }
            night = settings.Night;
            if (image.Dark)
            {
                combo.DarkFlatsSaved++;
                if (runningGroup is { } g) g.Saved++;
            }
            else
            {
                combo.FlatsSaved++;
                combo.FlatExposureS ??= image.ExposureS;
            }
            checkExposure = !image.Dark && !combo.ExposureChecked;
            if (checkExposure) combo.ExposureChecked = true;
            combo.SavedFiles.Add(image.Path);
            lastSaved = clock.UtcNow;
            store.SaveFlatCombination(night, combo);
            if (runningGroup is { } group) store.SaveDarkFlatGroup(night, group);
            capture = Build(combo, image, settings);
        }
        log.Event("CAPTURE", ("id", capture.Id), ("result", "saved"), ("file", capture.FileName), ("type", image.Dark ? "dark_flat" : "flat"));
        if (checkExposure && image.MeanAdu is { } mean && host.MaxAdu() is { } max && max > 0)
        {
            var share = mean / max;
            if (share < 0.2 || share > 0.8)
            {
                log.Warning("WARNING", ("code", "flat_exposure_off"), ("combination", combo.LogKey), ("mechDg", combo.MechDg));
                ReportEvent?.Invoke(EventsKind.Warning, "flat_exposure_off",
                    new Dictionary<string, object> { ["filter"] = combo.NinaFilter, ["meanAduPct"] = Math.Round(share * 100, 1) });
            }
        }
        ReportCapture?.Invoke(capture);
    }

    private Captures Build(FlatCombination c, FlatImage image, FlatRunSettings s) => new()
    {
        Id = Uuid7.New(clock),
        CapturedAtUtc = image.CapturedAtUtc,
        ExposureMidUtc = image.ExposureMidUtc,
        Night = s.Night,
        NightPlanId = s.NightPlanId,
        FilterShortName = c.FilterShort,
        FilterActual = image.FilterName ?? c.NinaFilter,
        ExposureS = image.ExposureS,
        Gain = c.Gain == -1 ? null : c.Gain,
        Offset = c.Offset == -1 ? null : c.Offset,
        Binning = c.Binning,
        ReadoutMode = c.ReadoutName,
        ReadoutModeIndex = c.ReadoutIndex,
        RotatorMechDeg = c.MechDg / 10.0,
        TemperatureDeviation = false,
        Result = CapturesResult.Saved,
        FileName = Path.GetFileName(image.Path),
        Metrics = new Metrics
        {
            MeanAdu = image.Dark ? null : image.MeanAdu,
            SensorTempC = image.SensorTempC,
            SetPointC = image.SetPointC,
        },
        FrameType = image.Dark ? CapturesFrameType.Dark_flat : CapturesFrameType.Flat,
        ProjectIds = c.Targets.Select(t => t.ProjectId).Distinct().ToList(),
        FlatsPlanned = c.FlatsPlanned,
        DarkFlatsPlanned = c.DarkFlatsPlanned,
    };

    /// <summary>Dateien der Kombination vom Primärziel in die Ordner der übrigen Ziele kopieren (nicht melden, NIN-16b).</summary>
    private void CopyToOtherTargets(FlatCombination combo)
    {
        if (combo.Targets.Count < 2) return;
        var primary = combo.Targets[0].Name;
        foreach (var other in combo.Targets.Skip(1))
        {
            if (FlatFiles.Sanitize(other.Name) == FlatFiles.Sanitize(primary)) continue;
            foreach (var source in combo.SavedFiles)
            {
                var destination = FlatFiles.PathFor(source, primary, other.Name);
                if (destination is null)
                {
                    log.Event("COPY", ("file", Path.GetFileName(source)), ("status", "no_target_segment"));
                    continue;
                }
                var ok = host.CopyFile(source, destination);
                log.Event("COPY", ("file", Path.GetFileName(destination)), ("status", ok ? "copied" : "skipped"));
            }
        }
    }

    private Dictionary<string, string> PositionNoticed()
    {
        var json = store.GetState(StateKeys.TrainedFlatPositionNoticed);
        return json is null
            ? new Dictionary<string, string>(StringComparer.Ordinal)
            : new Dictionary<string, string>(JsonConvert.DeserializeObject<Dictionary<string, string>>(json) ?? [], StringComparer.Ordinal);
    }

    private Dictionary<string, int> TrainedPositions()
    {
        var json = store.GetState(StateKeys.TrainedFlatPositions);
        return json is null
            ? new Dictionary<string, int>(StringComparer.Ordinal)
            : new Dictionary<string, int>(JsonConvert.DeserializeObject<Dictionary<string, int>>(json) ?? [], StringComparer.Ordinal);
    }

    /// <summary>Fehler einer Box (nicht Abbruch) protokollieren und weitermachen – wie im Original; <c>false</c> bei Fehler.</summary>
    private async Task<bool> Guarded(string box, Func<Task> action)
    {
        try
        {
            await action().ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            log.Note($"Flats: box {box} failed, continuing with the next step: {ex.Message}");
            return false;
        }
    }
}

/// <summary>Nachzuholende Kombinationen (Auto-Flats, AP-50b): Nacht, in der sie ausfielen, und die Kombinationen.</summary>
public sealed record FlatCarryOver(string Night, List<FlatCombination> Combinations);
