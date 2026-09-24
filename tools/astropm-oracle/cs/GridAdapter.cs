// Adapter Grid → Original (TimeSlot, ProjectTarget, TargetProfile) und Log → Einträge nach
// specs/engine/allocation.md §11.2. Nachgebaut (nicht aufgerufen) wird nur, was im Original an
// Astronomie oder Cloud-Daten hängt: BuildTargetProfiles (SessionScheduler.cs 229–433, inkl.
// Aussortieren Z. 296–304 und Transitfenster) und die Prioritätsreihenfolge aus
// TargetInstructionSet.cs 1048–1053. BuildMatrix, PaintSlots/PaintSlotsGreedy und WalkToLog laufen
// unverändert (bis auf oracle.patch).
using System;
using System.Collections.Generic;
using System.Linq;
using AstroPM.NINA.Plugin.Models;

namespace NinaPm.Oracle {
    public sealed class OracleException : Exception {
        public string Code { get; }
        public OracleException(string code, string message) : base(message) { Code = code; }
    }

    public sealed record Excluded(string UnitId, string Reason);

    public sealed record OracleEntry(
        long AtS, string Cmd, string Unit = null, int? Panel = null, string Filter = null,
        string Line = null, bool? Bonus = null, bool? LastOfNight = null, long? UntilS = null);

    public sealed class OracleResult {
        public List<string> Rows { get; } = new();
        public List<Excluded> Excluded { get; } = new();
        public List<string> Prefiltered { get; } = new();
        public int FirstUsableSlot { get; set; } = -1;
        public int LastUsableSlot { get; set; } = -1;
        public string[] SlotAssignment { get; set; } = Array.Empty<string>();
        public string[] WalkSlotAssignment { get; set; } = Array.Empty<string>();
        public List<OracleEntry> Entries { get; } = new();
    }

    public static class GridAdapter {
        public static readonly DateTime Slot0 = new(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        private static readonly Dictionary<string, SortCriteria> SortKeys = new() {
            ["lowest_peak_altitude"] = SortCriteria.LowestPeakAltitude,
            ["setting_soonest"] = SortCriteria.SettingSoonest,
            ["most_remaining"] = SortCriteria.MostRemainingWork,
            ["constrained"] = SortCriteria.Constrained,
            ["most_moon_limited"] = SortCriteria.MostLaWork,
            ["mosaic_grouping"] = SortCriteria.MosaicGroup,
            ["card_order"] = SortCriteria.UserPriority,
        };

        private static bool[] Mask(List<int[]> ranges, int slots) {
            var mask = new bool[slots];
            foreach (var r in ranges)
                for (int s = Math.Max(0, r[0]); s <= Math.Min(slots - 1, r[1]); s++) mask[s] = true;
            return mask;
        }

        private static int? PanelUnitIndex(string unitId) {
            int at = unitId.LastIndexOf("/p", StringComparison.Ordinal);
            return at > 0 && int.TryParse(unitId[(at + 2)..], out var idx) ? idx : null;
        }

        public static OracleResult Run(GridInput g) {
            if (g.Mode != "compat")
                throw new OracleException("grid.mode", "Das Orakel rechnet nur mode = compat (allocation.md §11.1)");
            if (g.SlotS != 300 || g.Slots < 1 || g.MoonAltDeg.Length != g.Slots)
                throw new OracleException("grid.slot_size", "slotS = 300, ein Mondwert je Slot");
            if (g.StartAtS.HasValue)
                throw new OracleException("grid.replan_unsupported", "Neuplanung gibt es im Original nicht (A-11)");
            var chain = new List<SortCriteria>();
            foreach (var key in g.Settings.SortChain) {
                if (!SortKeys.TryGetValue(key, out var c))
                    throw new OracleException("grid.unsupported_sort_key", $"Sortierschlüssel {key} gibt es im Original nicht");
                chain.Add(c);
            }
            var moonDownChain = new List<SortCriteria> { SortCriteria.MostLaWork };
            moonDownChain.AddRange(chain.Where(c => c != SortCriteria.MostLaWork));

            OracleHooks.Masks.Clear();
            int n = g.Slots;
            var slots = Enumerable.Range(0, n).Select(s => new TimeSlot {
                UtcStart = Slot0.AddSeconds(s * 300.0),
                SunAltDeg = -30,
                MoonAltDeg = g.MoonAltDeg[s],
                MoonIllumPct = 100,
            }).ToList();

            // Mondprofile: nur die Restriktivität zählt; „Kein Mond“ über den Namen (TierClassifier).
            var profiles = new Dictionary<string, GridMoonProfile>();
            foreach (var p in g.MoonProfiles) {
                if (!p.MustBeDown && p.Id.Equals("No Moon", StringComparison.OrdinalIgnoreCase))
                    throw new OracleException("grid.profile_name", "„No Moon“ ist für mustBeDown reserviert");
                profiles[p.Id] = p;
            }

            // Projekte in Reihenfolge des ersten Auftretens (Id = MosaicGroup-Schlüssel).
            var projectIds = new List<string>();
            var unitsByProject = new Dictionary<string, List<GridUnit>>();
            foreach (var u in g.Units) {
                if (!unitsByProject.TryGetValue(u.ProjectId, out var list)) {
                    projectIds.Add(u.ProjectId);
                    unitsByProject[u.ProjectId] = list = new List<GridUnit>();
                }
                list.Add(u);
            }
            var lines = new Dictionary<string, ExposureSetData>();
            var targets = new Dictionary<string, ProjectTarget>();
            for (int pi = 0; pi < projectIds.Count; pi++) {
                var units = unitsByProject[projectIds[pi]];
                var first = units[0];
                var panels = units.SelectMany(u => u.Panels).OrderBy(p => p.Index).Select(p => new PanelData {
                    PanelIndex = p.Index,
                    Label = $"P{p.Index + 1}",
                    ExposureSets = p.Lines.Select(l => {
                        var es = new ExposureSetData {
                            Id = l.Id,
                            FilterName = l.Filter,
                            ExposureLengthSec = l.ExposureS,
                            PlannedCount = l.Planned,
                            AcceptedCount = l.Accepted,
                            Enabled = l.Enabled,
                            // Zeilen-ID im Log (Anzeigefeld, vom Algorithmus nicht gelesen).
                            ReadoutMode = l.Id,
                        };
                        if (l.MoonProfile != null) {
                            var mp = profiles[l.MoonProfile];
                            es.MoonAvoidanceProfile = new MoonAvoidanceProfileData {
                                Name = mp.MustBeDown ? "No Moon" : mp.Id,
                                MoonSeparationDeg = mp.DistanceDeg,
                                MaxMoonIlluminationPct = mp.MaxIllumPct,
                            };
                            var safe = Mask(l.Safe, n);
                            for (int s = 0; s < n; s++)
                                if (g.MoonAltDeg[s] > 0)
                                    OracleHooks.Masks[(l.Id, slots[s].UtcStart)] = !mp.MustBeDown && safe[s];
                        }
                        lines[l.Id] = es;
                        return es;
                    }).ToList(),
                }).ToList();
                targets[projectIds[pi]] = new ProjectTarget {
                    Id = pi,
                    ProjectName = projectIds[pi],
                    TargetName = projectIds[pi],
                    Panels = panels,
                    Constraints = new ConstraintsData {
                        Priority = first.Priority,
                        MinTimeOnTargetHrs = first.MinTimeOnTargetH,
                        MoonAvoidanceEnabled = false,
                    },
                };
            }

            var result = new OracleResult();
            var profilesOut = new List<TargetProfile>();
            var unitOfProfile = new List<GridUnit>();
            int overshoot = (int)g.Settings.OvershootPct;
            foreach (var u in g.Units) {
                var target = targets[u.ProjectId];
                var constraints = new ObservingConstraints {
                    MinTimeOnTargetHrs = target.Constraints.MinTimeOnTargetHrs,
                    MoonAvoidanceEnabled = false,
                };
                var usable = Mask(u.CanImage, n);
                int windowStart = Array.IndexOf(usable, true), windowEnd = Array.LastIndexOf(usable, true);

                // SessionScheduler.cs 296–304: längster nutzbarer Lauf < Mindestzeit → heute nicht.
                int longest = 0, cur = 0;
                foreach (var ok in usable) { cur = ok ? cur + 1 : 0; longest = Math.Max(longest, cur); }
                double usableHrs = windowStart >= 0 ? longest * 5.0 / 60.0 : 0;
                if (usableHrs < constraints.MinTimeOnTargetHrs) {
                    result.Excluded.Add(new Excluded(u.UnitId, "below_min_time"));
                    continue;
                }

                var allEs = target.Panels.SelectMany(p => p.ExposureSets).ToList();
                var (tiers, esToTier) = TierClassifier.ClassifyExposureSets(allEs, constraints);
                var tierSlotSafe = new bool[tiers.Length][];
                for (int t = 0; t < tiers.Length; t++) {
                    tierSlotSafe[t] = new bool[n];
                    if (tiers[t].TierIndex == 0) Array.Fill(tierSlotSafe[t], true);
                    else if (tiers[t].RequiresMoonDown)
                        for (int s = 0; s < n; s++) tierSlotSafe[t][s] = slots[s].MoonAltDeg <= 0;
                    else {
                        var rep = allEs.FirstOrDefault(es => esToTier.TryGetValue(es, out var et) && et == t);
                        for (int s = 0; s < n; s++)
                            tierSlotSafe[t][s] = slots[s].MoonAltDeg <= 0
                                || (rep != null && SessionScheduler.IsExposureSetMoonSafe(rep, slots[s], 0, constraints));
                    }
                }

                double Remaining(ExposureSetData es) =>
                    (double)SessionScheduler.EffectiveRemainingSubs(es, overshoot) * es.ExposureLengthSec;
                double projectWork = allEs.Sum(Remaining);

                // Transit: Fenster nur mit Arbeit und Überlappung mit der Nacht (ExoTransit.cs WindowForNight).
                DateTime? winStart = null, winEnd = null;
                if (u.Transit != null) {
                    long from = u.Transit.WindowS[0], to = u.Transit.WindowS[1];
                    if (projectWork > 0 && !(to <= 0 || from >= n * 300L)) {
                        winStart = Slot0.AddSeconds(from);
                        winEnd = Slot0.AddSeconds(to);
                    }
                    if (winStart == null) {
                        result.Excluded.Add(new Excluded(u.UnitId, "no_transit_window"));
                        continue;
                    }
                }

                int? panelPos = null;
                IEnumerable<ExposureSetData> unitEs = allEs;
                var panelIdx = PanelUnitIndex(u.UnitId);
                if (panelIdx.HasValue) {
                    panelPos = target.Panels.FindIndex(p => p.PanelIndex == panelIdx.Value);
                    unitEs = target.Panels[panelPos.Value].ExposureSets;
                }
                var tierSec = new double[tiers.Length];
                double laSec = 0, nonLaSec = 0;
                foreach (var es in unitEs) {
                    double rem = Remaining(es);
                    if (es.HasMoonAvoidance) laSec += rem; else nonLaSec += rem;
                    if (esToTier.TryGetValue(es, out var tierIdx)) tierSec[tierIdx] += rem;
                }
                // Panel-Einheiten ohne Arbeit entfallen (SessionScheduler.cs 369); Projekt-Einheiten nicht.
                if (panelIdx.HasValue && laSec + nonLaSec <= 0) {
                    result.Excluded.Add(new Excluded(u.UnitId, "no_work"));
                    continue;
                }

                profilesOut.Add(new TargetProfile {
                    Target = target,
                    Constraints = constraints,
                    AltitudePerSlot = usable.Select(ok => ok ? u.PeakAltDeg : 0).ToArray(),
                    MoonSepPerSlot = new double[n],
                    SlotUsable = usable,
                    SlotMoonOk = Enumerable.Repeat(true, n).ToArray(),
                    Tiers = tiers,
                    TierRemainingSec = tierSec,
                    TierSlotSafe = tierSlotSafe,
                    RemainingLunarFreeSec = laSec,
                    RemainingNonLunarSec = nonLaSec,
                    RemainingTotalSec = laSec + nonLaSec,
                    WindowStartSlot = windowStart,
                    WindowEndSlot = windowEnd,
                    FixedWindowStartUtc = winStart,
                    FixedWindowEndUtc = winEnd,
                    PanelIndex = panelPos,
                });
                unitOfProfile.Add(u);
            }
            result.Rows.AddRange(unitOfProfile.Select(u => u.UnitId));
            result.SlotAssignment = new string[n];
            result.WalkSlotAssignment = new string[n];
            if (profilesOut.Count == 0) return result;

            // TargetInstructionSet.cs 1048–1053: Priorität (0 = zuletzt), Projektname ohne
            // Groß-/Kleinschreibung, Panel, Position.
            var order = Enumerable.Range(0, profilesOut.Count)
                .OrderBy(i => profilesOut[i].Target.Priority == 0 ? int.MaxValue : profilesOut[i].Target.Priority)
                .ThenBy(i => profilesOut[i].Target.ProjectName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(i => profilesOut[i].PanelIndex ?? -1)
                .ThenBy(i => i)
                .ToList();
            var matrix = ScheduleEngine.BuildMatrix(slots, profilesOut, order);
            result.FirstUsableSlot = matrix.FirstUsableSlot;
            result.LastUsableSlot = matrix.LastUsableSlot;
            if (matrix.FirstUsableSlot < 0) return result;

            ScheduleEngine.ComputeOverlap(matrix);
            ScheduleEngine.OrganizeMoonBlocks(matrix);
            if (g.Settings.Strategy == "manual_priority")
                ScheduleEngine.PaintSlotsGreedy(matrix, order, g.Settings.BonusEnabled);
            else
                ScheduleEngine.PaintSlots(matrix, chain, moonDownChain, g.Settings.BonusEnabled);
            string UnitAt(int row) => row >= 0 ? unitOfProfile[row].UnitId : null;
            result.SlotAssignment = matrix.SlotAssignment.Select(UnitAt).ToArray();
            result.Prefiltered.AddRange(matrix.Rows.Where(r => r.PreFiltered).Select(r => UnitAt(r.RowIndex)));

            var state = new ScheduleSessionState();
            if (g.Settings.OvershootPct > 0) state.OvershootFraction = g.Settings.OvershootPct / 100.0;
            var dither = g.Settings.Dither;
            var fs = g.Settings.FilterSwitch;
            var log = ScheduleEngine.WalkToLog(matrix, state, TimeZoneInfo.Utc,
                dither.Enabled && dither.Every > 0, dither.Every,
                fs.Enabled && fs.Every > 0, fs.Every, chain,
                bonusEnabled: g.Settings.BonusEnabled,
                filterSwitchTolerance: fs.TolerancePct / 100.0);
            result.WalkSlotAssignment = matrix.SlotAssignment.Select(UnitAt).ToArray();

            // Log → Einträge (§11.2): Slew/Filter/Image/Bonus/Dither/Wait; Info/Start/End entfallen.
            var byDisplay = new Dictionary<string, int>();
            for (int i = 0; i < profilesOut.Count; i++)
                if (!byDisplay.TryAdd(profilesOut[i].DisplayName, i))
                    throw new OracleException("grid.display_name", $"Anzeigename doppelt: {profilesOut[i].DisplayName}");
            long nightEndS = (matrix.LastUsableSlot + 1) * 300L;
            int current = -1;
            foreach (var e in log) {
                long atS = (long)(e.UtcTime - Slot0).TotalSeconds;
                switch (e.Command) {
                    case "Slew": {
                        int arrow = e.Target.IndexOf(" → ", StringComparison.Ordinal);
                        if (arrow >= 0) {
                            var label = e.Target[(arrow + 3)..];
                            var panels = profilesOut[current].Target.Panels;
                            int pos = int.Parse(label[1..]) - 1;
                            result.Entries.Add(new OracleEntry(atS, "slew_center", Unit: UnitAt(current), Panel: panels[pos].PanelIndex));
                        } else {
                            current = byDisplay[e.Target];
                            var prof = profilesOut[current];
                            int? panel = prof.PanelIndex.HasValue ? prof.Target.Panels[prof.PanelIndex.Value].PanelIndex : null;
                            result.Entries.Add(new OracleEntry(atS, "slew_center", Unit: UnitAt(current), Panel: panel));
                        }
                        break;
                    }
                    case "Filter":
                        result.Entries.Add(new OracleEntry(atS, "filter", Filter: e.Filter));
                        break;
                    case "Image":
                    case "Bonus": {
                        var es = lines[e.ReadoutMode];
                        result.Entries.Add(new OracleEntry(atS, "expose", Line: es.Id, Bonus: e.Command == "Bonus",
                            LastOfNight: atS + (long)es.ExposureLengthSec > nightEndS));
                        break;
                    }
                    case "Dither":
                        result.Entries.Add(new OracleEntry(atS, "dither"));
                        break;
                    case "Wait":
                        result.Entries.Add(new OracleEntry(atS, "wait", UntilS: e.SlotIndex * 300L));
                        break;
                }
            }
            return result;
        }
    }
}
