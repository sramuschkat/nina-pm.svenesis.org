using Newtonsoft.Json;
using NINA.Core.Model;
using NINA.Sequencer.SequenceItem;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// Platzhalter-Kind, damit NINA den Container nicht als leer überspringt (execution.md §2). Nicht exportiert, beim
/// Speichern entfernt und beim Laden wiederhergestellt. Muster nach dem Astro-PM-Plugin (MIT),
/// <c>Instructions/AstroPMChildItems.cs</c> <c>AstroPMPlaceholderItem</c>, Commit 5dd621d.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class PlaceholderItem : SequenceItem
{
    public override Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token) => Task.CompletedTask;

    public override object Clone() => new PlaceholderItem();

    public override string ToString() => "NINA-PM Platzhalter";
}
