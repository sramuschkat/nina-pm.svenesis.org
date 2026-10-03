using NINA.Astrometry;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem.Platesolving;
using NINA.Sequencer.SequenceItem.Telescope;

namespace NinaPm.Nina.Sequencer;

// Portiert aus dem Astro-PM-NINA-Plugin (MIT), Instructions/CoordinatesInjector.cs, Commit 5dd621d;
// Hinweis in THIRD_PARTY_NOTICES.md.

/// <summary>
/// Koordinaten des aktuellen Blocks in koordinatenabhängige NINA-Anweisungen (<em>Center</em>, <em>Center and
/// Rotate</em>, <em>Slew to Ra/Dec</em>) der Trigger-Sets schreiben, auch in verschachtelten Containern (FA-NIN-16):
/// Sie erben sonst vom nächsten statischen Ziel-Container, den es beim planbasierten Container nicht gibt.
/// </summary>
internal static class CoordinatesInjector
{
    public static void Inject(ISequenceContainer? container, InputCoordinates coordinates)
    {
        if (container is null) return;
        foreach (var item in container.Items)
        {
            // CenterAndRotate vor Center prüfen – es erbt von Center.
            switch (item)
            {
                case CenterAndRotate rotate:
                    rotate.Coordinates = coordinates.Clone();
                    rotate.Inherited = true;
                    rotate.SequenceBlockInitialize();
                    break;
                case Center center:
                    center.Coordinates = coordinates.Clone();
                    center.Inherited = true;
                    center.SequenceBlockInitialize();
                    break;
                case SlewScopeToRaDec slew:
                    slew.Coordinates = coordinates.Clone();
                    slew.Inherited = true;
                    slew.SequenceBlockInitialize();
                    break;
            }
            if (item is ISequenceContainer sub) Inject(sub, coordinates);
        }
    }
}
