using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Storage;

namespace NinaPm.Core.Planning;

/// <summary>
/// Lokales Protokoll der Nacht für <c>tonight</c> (allocation.md §5.3, execution.md §3.2): vergangene Blöcke,
/// belichtete Sekunden je Einheit, Filterzyklus, Flips und aktuelle Einheit. Liegt als JSON in <c>state.tonight</c>
/// (execution.md §8) und überlebt so einen Neustart (NT-18). <c>lastAutofocusUtc</c> kommt nicht von hier, sondern
/// aus NINAs Autofokus-Historie (Adapter, NT-24, M7).
/// </summary>
public sealed class TonightLog
{
    [JsonProperty("pastBlocks")] private readonly List<PastBlocks> pastBlocks = [];
    [JsonProperty("exposedSecByUnit")] private readonly SortedDictionary<string, double> exposedSecByUnit = new(StringComparer.Ordinal);
    [JsonProperty("filterCycle")] private readonly List<FilterCycle> filterCycle = [];
    [JsonProperty("flipDoneByPanel")] private readonly SortedDictionary<string, bool> flipDoneByPanel = new(StringComparer.Ordinal);
    [JsonProperty("currentUnitId")] private string? currentUnitId;

    /// <summary>
    /// Einheiten-ID (allocation.md §5.3, ENG5-14): <c>"&lt;projectId&gt;"</c> bei Einzelfeldern,
    /// <c>"&lt;projectId&gt;/p&lt;index&gt;"</c> bei Panel-Einheiten (Mosaik mit mehr als einem Panel und
    /// <c>mosaicPanelsIndependent</c>). <c>index</c> ist <c>panel.index</c>, nicht die Panel-UUID.
    /// </summary>
    public static string UnitId(Guid projectId, int panelIndex, int panelCount, bool mosaicPanelsIndependent) =>
        panelCount > 1 && mosaicPanelsIndependent ? $"{projectId}/p{panelIndex}" : projectId.ToString();

    /// <summary>In dieser Nacht lief schon ein Block (<see cref="RefreshCause.IdleAhead"/>).</summary>
    [JsonIgnore]
    public bool HasPastBlocks => pastBlocks.Count > 0;

    /// <summary>Block hat begonnen: aktuelle Einheit setzen.</summary>
    public void BlockStarted(string unitId) => currentUnitId = unitId;

    /// <summary>Block ist beendet (auch abgebrochen): Zeitraum als <c>pastBlocks</c>-Eintrag.</summary>
    public void BlockFinished(string unitId, DateTimeOffset fromUtc, DateTimeOffset toUtc)
    {
        if (toUtc > fromUtc) pastBlocks.Add(new PastBlocks { UnitId = unitId, FromUtc = fromUtc, ToUtc = toUtc });
    }

    /// <summary>
    /// Gespeicherte Light-Aufnahme: Sekunden der Einheit und Filterzyklus fortschreiben (gleiche Zeile → Zähler + 1,
    /// andere Zeile → neu bei 1).
    /// </summary>
    public void ExposureSaved(string unitId, Guid lineId, double exposureS)
    {
        exposedSecByUnit[unitId] = (exposedSecByUnit.TryGetValue(unitId, out var s) ? s : 0) + exposureS;
        var line = lineId.ToString();
        var cycle = filterCycle.FirstOrDefault(c => c.UnitId == unitId);
        if (cycle is null) filterCycle.Add(new FilterCycle { UnitId = unitId, LineId = line, SubsOnLine = 1 });
        else if (cycle.LineId == line) cycle.SubsOnLine++;
        else
        {
            cycle.LineId = line;
            cycle.SubsOnLine = 1;
        }
    }

    public void FlipDone(string unitId) => flipDoneByPanel[unitId] = true;

    /// <summary>
    /// <c>tonight</c> für <c>POST /plan</c>. Beim Erstplan (<c>reason: initial</c> ohne <c>startAtUtc</c>) nur
    /// <c>lastAutofocusUtc</c> (allocation.md §5.3, NT-24, M7).
    /// </summary>
    public Tonight ToContract(DateTimeOffset? lastAutofocusUtc, bool initial) =>
        initial
            ? new Tonight { LastAutofocusUtc = lastAutofocusUtc }
            : new Tonight
            {
                PastBlocks = [.. pastBlocks],
                ExposedSecByUnit = new Dictionary<string, double>(exposedSecByUnit),
                LastAutofocusUtc = lastAutofocusUtc,
                FilterCycle = [.. filterCycle.OrderBy(c => c.UnitId, StringComparer.Ordinal)],
                FlipDoneByPanel = new Dictionary<string, bool>(flipDoneByPanel),
                CurrentUnitId = currentUnitId,
            };

    // ---- Persistenz (state.tonight) -------------------------------------------------------------------

    public static TonightLog Load(LocalStore store)
    {
        var json = store.GetState(StateKeys.Tonight);
        return json is null ? new TonightLog() : JsonConvert.DeserializeObject<TonightLog>(json, NinaJson.Settings()) ?? new TonightLog();
    }

    public void Save(LocalStore store) => store.SetState(StateKeys.Tonight, JsonConvert.SerializeObject(this, NinaJson.Settings()));

    /// <summary>Neue Nacht oder veraltete Session (execution.md §2): Protokoll verwerfen.</summary>
    public static void Clear(LocalStore store) => store.SetState(StateKeys.Tonight, null);
}
