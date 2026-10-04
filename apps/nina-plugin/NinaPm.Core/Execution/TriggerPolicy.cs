using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Execution;

/// <summary>Was die Transit-Beobachtung erlaubt (<c>targets</c> → <c>exoplanet.observation</c>, FA-EXO-23).</summary>
public sealed record TransitTriggerContext(bool AllowAutofocus, bool AllowRecenter);

/// <summary>
/// Welche NINA-Trigger der eigene Trigger-Walk aufruft (execution.md §4.3 und §5, NT-23, NIN-12). Maßgeblich ist der
/// Typname (ohne Groß-/Kleinschreibung), damit auch Trigger fremder Plugins erfasst werden:
/// <list type="bullet">
/// <item>Dither-Trigger immer unterdrückt – gedithert wird nur nach Plan.</item>
/// <item>Im Transit: Autofokus (Typname enthält <c>autofocus</c>) und <c>CenterAfterDriftTrigger</c> nur, wenn die
/// Beobachtung es erlaubt; Meridian-Flip läuft immer (Montierungsschutz).</item>
/// <item>Im Transit: eigene Trigger-Sets vor/nach jeder Belichtung, die eine Autofokus-Anweisung enthalten, werden
/// übersprungen (sofern Autofokus nicht erlaubt ist).</item>
/// </list>
/// </summary>
public static class TriggerPolicy
{
    /// <summary>Transit-Kontext des Blocks; <c>null</c> für reguläre Blöcke oder ohne Beobachtung in <c>targets</c>.</summary>
    public static TransitTriggerContext? ForBlock(Blocks block, NinaTargets? targets)
    {
        if (block.Kind != BlocksKind.Transit) return null;
        var observation = targets?.Projects.FirstOrDefault(p => p.Id == block.ProjectId)?.Exoplanet?.Observation;
        // Ohne Beobachtung (Ziele noch nicht geladen): die strenge Vorgabe – weder Autofokus noch Nachzentrieren.
        return new TransitTriggerContext(observation?.AllowAutofocus ?? false, observation?.AllowRecenter ?? false);
    }

    /// <summary>Trigger mit diesem Typnamen nicht aufrufen.</summary>
    public static bool Suppressed(string typeName, TransitTriggerContext? transit)
    {
        if (Has(typeName, "dither")) return true;
        if (transit is null) return false;
        if (!transit.AllowAutofocus && Has(typeName, "autofocus")) return true;
        return !transit.AllowRecenter && string.Equals(typeName, "CenterAfterDriftTrigger", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Eigenes Trigger-Set (Box) im Transit überspringen: enthält eine Autofokus-Anweisung (Typnamen der Inhalte).</summary>
    public static bool SuppressedBox(IEnumerable<string> itemTypeNames, TransitTriggerContext? transit) =>
        transit is { AllowAutofocus: false } && itemTypeNames.Any(n => Has(n, "autofocus"));

    private static bool Has(string typeName, string part) => typeName.Contains(part, StringComparison.OrdinalIgnoreCase);
}
