using Newtonsoft.Json;
using NINA.Core.Model;
using NINA.Sequencer.SequenceItem;

namespace NinaPm.Probe;

/// <summary>
/// Platzhalter-Kind, damit NINA den Container nicht als leer überspringt (execution.md §2). Nicht exportiert,
/// beim Speichern entfernt und beim Laden wiederhergestellt.
/// Muster nach Astro-PM-Plugin (MIT), Instructions/AstroPMChildItems.cs `AstroPMPlaceholderItem`, Commit 5dd621d.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class ProbePlaceholderItem : SequenceItem
{
    public override Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token) => Task.CompletedTask;

    public override object Clone() => new ProbePlaceholderItem();

    public override string ToString() => "NINA-PM Probe Platzhalter";
}
