using System.ComponentModel.Composition;
using System.Windows;
using NinaPm.Nina.Sequencer;
using NinaPm.Nina.Ui.Options;
using NinaPm.Nina.Ui.Sequencer;

namespace NinaPm.Nina;

/// <summary>
/// Exportiert die Vorlagen aus NinaPm.Nina.Ui (Regel 13: XAML nur dort) aus der Plugin-Assembly, damit NINA sie mit
/// dem Manifest zusammen lädt: Optionsseite <c>NINA-PM_Options</c> und die Ansichten der Sequenz-Bausteine.
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
    };

    public NinaPmResources()
    {
        MergedDictionaries.Add(new OptionsTemplates());
        var sequencer = new SequencerTemplates();
        MergedDictionaries.Add(sequencer);
        foreach (var (key, type) in TemplateTypes)
            this[new DataTemplateKey(type)] = sequencer[key];
    }
}
