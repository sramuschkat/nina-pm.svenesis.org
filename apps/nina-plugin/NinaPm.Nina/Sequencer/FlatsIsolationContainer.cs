using NINA.Astrometry;
using NINA.Sequencer.Container;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// Container ohne Parent für die Flat-Boxen (execution.md §7): NINAs Ablauf prüft Trigger am laufenden Container und an
/// allen Vorfahren – hier endet die Kette, kein Sequenz-Trigger läuft während der Flats (Restore Guiding startete PHD2
/// sonst mitten in den Flats neu). Mit <see cref="IDeepSkyObjectContainer"/>, damit <c>$$TARGETNAME$$</c> greift.
/// Muster nach dem Astro-PM-Plugin (MIT), <c>Instructions/TargetInstructionSet.cs</c> (<c>FlatsIsolationContainer</c>), Commit 5dd621d.
/// </summary>
internal sealed class FlatsIsolationContainer : SequentialContainer, IDeepSkyObjectContainer
{
    private InputTarget target = new(Angle.ByDegree(0), Angle.ByDegree(0), null);

    public InputTarget Target
    {
        get => target;
        set
        {
            target = value;
            RaisePropertyChanged();
        }
    }

    public NighttimeData NighttimeData { get; set; } = null!;
}
