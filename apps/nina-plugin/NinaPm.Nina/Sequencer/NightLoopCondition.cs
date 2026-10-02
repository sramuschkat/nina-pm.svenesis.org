using System.ComponentModel.Composition;
using Newtonsoft.Json;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Conditions;
using NINA.Sequencer.SequenceItem;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// <em>NINA-PM Nachtschleife</em> (execution.md §1/§2, NT-11): wahr, solange ein Block läuft, Flats ausstehen oder die
/// Nacht nicht beendet ist (auch vor dem ersten Block und bei leerem Plan); falsch erst nach dem Abschluss im Aufruf
/// davor bzw. nach dem Nachtabschluss durch <em>Warten bis sicher oder Nachtende</em> (H2), oder bei einem nicht
/// behebbaren gesperrten Zustand im nächsten Aufruf ohne laufenden Block (NIN5-2). Ohne Verbindungsdaten falsch.
/// Muster nach dem Astro-PM-Plugin (MIT), <c>Instructions/AstroPMLoopCondition.cs</c>, Commit 5dd621d.
/// </summary>
[ExportMetadata("Name", "NINA-PM Night Loop")]
[ExportMetadata("Description", "True while the NINA-PM night is running; false after the night end (then NINA runs the end area).")]
[ExportMetadata("Icon", "LoopSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceCondition))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class NightLoopCondition : SequenceCondition
{
    private readonly IProfileService profile;

    [ImportingConstructor]
    public NightLoopCondition(IProfileService profile)
    {
        this.profile = profile;
    }

    public override object Clone()
    {
        var clone = new NightLoopCondition(profile);
        clone.CopyMetaData(this);
        return clone;
    }

    public override bool Check(ISequenceItem previousItem, ISequenceItem nextItem) =>
        NinaPmRuntime.Current?.Runner.HasBlocksRemaining ?? NinaPmRuntime.IsConfigured(profile);

    public override string ToString() => "NINA-PM Night Loop";
}
