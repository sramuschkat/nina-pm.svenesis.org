using System.Windows;

namespace NinaPm.Nina.Ui.Sequencer;

/// <summary>Ansichten der Sequenz-Bausteine; NinaPm.Nina ordnet sie den Typen zu (NinaPmResources).</summary>
public sealed partial class SequencerTemplates : ResourceDictionary
{
    public SequencerTemplates()
    {
        InitializeComponent();
        // Knopf-Stile (Style="{DynamicResource NinaPm.Button…}"), gemeinsam mit der jeweils anderen Vorlage.
        MergedDictionaries.Add(new ButtonStyles());
    }
}
