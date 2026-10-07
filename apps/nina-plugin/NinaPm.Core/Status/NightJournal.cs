using Newtonsoft.Json;
using NinaPm.Core.Storage;

namespace NinaPm.Core.Status;

/// <summary>Arten der Einträge im Nachtjournal (execution.md §10).</summary>
public static class JournalKinds
{
    /// <summary>Neuer bzw. weiter genutzter Plan (Plan-ID, Revision, Grund).</summary>
    public const string Plan = "plan";
    public const string BlockStart = "block_start";

    /// <summary>Block beendet (Grund, Zahl der Belichtungen); <c>error</c>, <c>interrupted</c>, <c>user_skip</c> eingeschlossen.</summary>
    public const string BlockEnd = "block_end";

    /// <summary>Block ohne Start übersprungen (Vorprüfung, Filter, Zentrieren …).</summary>
    public const string BlockSkipped = "block_skipped";

    /// <summary>Light-Aufnahme mit Ergebnis <c>saved</c>, <c>failed</c> oder <c>aborted</c>.</summary>
    public const string Capture = "capture";

    /// <summary>Belichtung zeitgeführt übersprungen (<c>SKIPPED_TIMEAWARE</c>).</summary>
    public const string Skipped = "skipped";
    public const string Flip = "flip";
    public const string SafetyPause = "safety_pause";
    public const string SafetyResume = "safety_resume";
    public const string FlatsStart = "flats_start";
    public const string FlatsEnd = "flats_end";
}

/// <summary>Daten eines Journaleintrags; je Art nur die passenden Felder, der Rest bleibt leer.</summary>
public sealed record JournalData
{
    [JsonProperty("planId")] public Guid? PlanId { get; init; }
    [JsonProperty("revision")] public int? Revision { get; init; }
    [JsonProperty("blockId")] public Guid? BlockId { get; init; }
    [JsonProperty("projectId")] public Guid? ProjectId { get; init; }
    [JsonProperty("panelId")] public Guid? PanelId { get; init; }
    [JsonProperty("title")] public string? Title { get; init; }
    [JsonProperty("transit")] public bool? Transit { get; init; }
    [JsonProperty("reason")] public string? Reason { get; init; }
    [JsonProperty("exposures")] public int? Exposures { get; init; }
    [JsonProperty("seq")] public int? Seq { get; init; }
    [JsonProperty("filter")] public string? Filter { get; init; }
    [JsonProperty("exposureS")] public double? ExposureS { get; init; }
    [JsonProperty("gain")] public int? Gain { get; init; }
    [JsonProperty("offset")] public int? Offset { get; init; }
    [JsonProperty("binning")] public int? Binning { get; init; }
    [JsonProperty("readout")] public string? Readout { get; init; }
    [JsonProperty("rotationDeg")] public double? RotationDeg { get; init; }
    [JsonProperty("raDeg")] public double? RaDeg { get; init; }
    [JsonProperty("decDeg")] public double? DecDeg { get; init; }

    /// <summary>Aufnahme: <c>saved</c>, <c>failed</c>, <c>aborted</c>.</summary>
    [JsonProperty("result")] public string? Result { get; init; }

    /// <summary>Beginn der Belichtung (Aufnahme) – der Eintrag selbst steht beim Speichern.</summary>
    [JsonProperty("startUtc")] public DateTimeOffset? StartUtc { get; init; }
    [JsonProperty("durationS")] public double? DurationS { get; init; }
}

/// <summary>Eintrag des Nachtjournals; <see cref="Id"/> steigt je Eintrag.</summary>
public sealed record JournalEntry(long Id, DateTimeOffset AtUtc, string Kind, JournalData Data);

/// <summary>
/// Nachtjournal (AP-53b, execution.md §10): was das Plugin in einer Nacht getan hat – Planwechsel, Blockstart und -ende,
/// übersprungene Blöcke und Belichtungen, Aufnahmen, Flip, Safety-Pausen und Flats –, unabhängig von Session und
/// Verbindung in <c>journal_local</c> von <c>ninapm.db</c>. Die Fenster im Imaging-Reiter zeichnen daraus das Erledigte;
/// der gespeicherte Plan liefert nur noch das Kommende (er hält den letzten Plan, der nach einer Neuplanung bei „jetzt“
/// beginnt). Es bleiben die jüngsten <see cref="KeepNights"/> Nächte.
/// </summary>
public sealed class NightJournal(LocalStore store)
{
    public const int KeepNights = 3;

    private static readonly JsonSerializerSettings Settings = new()
    {
        NullValueHandling = NullValueHandling.Ignore,
        DateParseHandling = DateParseHandling.DateTimeOffset,
    };

    public long Append(string? night, DateTimeOffset atUtc, string kind, JournalData data)
    {
        if (string.IsNullOrEmpty(night)) return 0;
        if (kind == JournalKinds.Plan) store.PruneJournal(KeepNights);
        return store.AppendJournal(night, atUtc, kind, JsonConvert.SerializeObject(data, Settings));
    }

    public IReadOnlyList<JournalEntry> Read(string night) =>
        [.. store.Journal(night).Select(e => new JournalEntry(e.Id, e.AtUtc, e.Kind,
            JsonConvert.DeserializeObject<JournalData>(e.Payload, Settings) ?? new JournalData()))];

    public long Head(string night) => store.JournalHead(night);
}
