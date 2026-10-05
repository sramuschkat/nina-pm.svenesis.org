using System.ComponentModel.Composition;
using Newtonsoft.Json;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Sequencer.SequenceItem;

namespace NinaPm.Nina.Sequencer;

// Muster nach dem Astro-PM-NINA-Plugin (MIT), Instructions/RefreshCloudTargets.cs, Commit 5dd621d;
// Hinweis in THIRD_PARTY_NOTICES.md.

/// <summary>
/// <em>NINA-PM Ziele aktualisieren</em> (FA-NIN-08, FA-NIN-26 R1): lädt Rig-Einstellungen (Bootstrap) und Ziele in den
/// Cache, z. B. am Sequenzbeginn. Offline-Modus: kein Abruf. Ohne eingerichtetes NINA-PM nur ein Hinweis – die Sequenz
/// läuft weiter; Fehler entscheiden wie sonst beim Planaufbau (§8).
/// </summary>
[ExportMetadata("Name", "NINA-PM Update Targets")]
[ExportMetadata("Description", "Loads the rig settings and the delivered targets from NINA-PM into the local cache")]
[ExportMetadata("Icon", "NinaPmSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceItem))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class RefreshTargetsInstruction : SequenceItem
{
    private string statusText = "";

    [ImportingConstructor]
    public RefreshTargetsInstruction()
    {
    }

    /// <summary>Ergebnis des letzten Laufs für die Ansicht.</summary>
    public string StatusText
    {
        get => statusText;
        private set
        {
            statusText = value;
            RaisePropertyChanged();
        }
    }

    public override object Clone()
    {
        var clone = new RefreshTargetsInstruction();
        clone.CopyMetaData(this);
        return clone;
    }

    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var runtime = NinaPmRuntime.Current;
        if (runtime is null)
        {
            StatusText = Ui.Texts.NotConfigured;
            Logger.Warning("NINA-PM: Refresh Targets – server URL or sync token missing");
            return;
        }
        progress?.Report(new ApplicationStatus { Source = "NINA-PM", Status = "Updating targets" });
        var r = await runtime.Runner.RefreshAsync(token);
        StatusText = Ui.Texts.TargetsRefreshed(r.Projects, r.Offline);
        Logger.Info($"NINA-PM: targets refreshed ({r.Projects}, offline={r.Offline})");
    }

    public override string ToString() => "NINA-PM Update Targets";
}
