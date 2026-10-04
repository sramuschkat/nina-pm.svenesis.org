using System.Windows;

namespace NinaPm.Nina.Ui.Options;

/// <summary>Vorlagen der Optionsseite; NinaPm.Nina bindet sie per MEF ein (NinaPmResources, MergedDictionaries).</summary>
public sealed partial class OptionsTemplates : ResourceDictionary
{
    public OptionsTemplates()
    {
        InitializeComponent();
        // Knopf-Stile (Style="{DynamicResource NinaPm.Button…}"), gemeinsam mit der jeweils anderen Vorlage.
        MergedDictionaries.Add(new ButtonStyles());
    }
}
