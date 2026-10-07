using System.ComponentModel.Composition;
using System.Windows;
using NinaPm.Nina.Sequencer;
using NinaPm.Nina.Ui.Options;
using NinaPm.Nina.Ui.Sequencer;

namespace NinaPm.Nina;

/// <summary>
/// Exportiert die Vorlagen aus NinaPm.Nina.Ui (Regel 13: XAML nur dort) aus der Plugin-Assembly, damit NINA sie mit
/// dem Manifest zusammen lädt: Optionsseite <c>NINA-PM_Options</c>, die Ansichten der Sequenz-Bausteine und die Fenster
/// im Imaging-Reiter (<c>NinaPm.Nina.Dock.*VM_Dockable</c>).
/// Eingebunden statt abgeleitet: WPF lädt das XAML einer Klasse nicht über eine Unterklasse aus einer anderen Assembly
/// (<c>LoadComponent</c> bricht ab). Weil NinaPm.Nina.Ui die Typen dieser Assembly nicht kennt, tragen die Ansichten
/// dort Schlüssel; hier werden sie den Typen zugeordnet (<see cref="DataTemplateKey"/>), wie NINA sie sucht.
/// </summary>
[Export(typeof(ResourceDictionary))]
public sealed class NinaPmResources : ResourceDictionary
{
    /// <summary>Schlüssel in NinaPm.Nina.Ui → Typ des Sequenz-Bausteins.</summary>
    internal static readonly IReadOnlyDictionary<string, Type> TemplateTypes = new Dictionary<string, Type>
    {
        ["NinaPm.Container"] = typeof(NinaPmContainer),
        ["NinaPm.NightLoopCondition"] = typeof(NightLoopCondition),
        ["NinaPm.SafetyWait"] = typeof(SafetyWaitInstruction),
        ["NinaPm.BeforeExposureTrigger"] = typeof(BeforeExposureTrigger),
        ["NinaPm.AfterExposureTrigger"] = typeof(AfterExposureTrigger),
        ["NinaPm.BeforeTargetChangeTrigger"] = typeof(BeforeTargetChangeTrigger),
        ["NinaPm.AfterTargetChangeTrigger"] = typeof(AfterTargetChangeTrigger),
        ["NinaPm.RefreshTargets"] = typeof(RefreshTargetsInstruction),
        ["NinaPm.DayLoopCondition"] = typeof(DayLoopCondition),
        ["NinaPm.WaitForTime"] = typeof(WaitForTimeInstruction),
    };

    public NinaPmResources()
    {
        MergedDictionaries.Add(new OptionsTemplates());
        // Fenster im Imaging-Reiter (AP-53b): Schlüssel "<Typ>_Dockable", wie NINA sie sucht.
        MergedDictionaries.Add(new NinaPm.Nina.Ui.Dock.DockTemplates());
        var sequencer = new SequencerTemplates();
        MergedDictionaries.Add(sequencer);
        foreach (var (key, type) in TemplateTypes)
            this[new DataTemplateKey(type)] = sequencer[key];
    }
}
