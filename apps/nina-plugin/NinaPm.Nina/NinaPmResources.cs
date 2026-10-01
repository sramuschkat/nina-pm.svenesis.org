using System.ComponentModel.Composition;
using System.Windows;
using NinaPm.Nina.Ui.Options;

namespace NinaPm.Nina;

/// <summary>
/// Exportiert die Vorlagen aus NinaPm.Nina.Ui (Regel 13: XAML nur dort) aus der Plugin-Assembly, damit NINA sie mit
/// dem Manifest zusammen lädt (Optionsseite <c>NINA-PM_Options</c>).
/// </summary>
[Export(typeof(ResourceDictionary))]
public sealed class NinaPmResources : OptionsTemplates
{
}
