using System.ComponentModel.Composition;
using System.Windows;

namespace NinaPm.Probe;

/// <summary>Vorlagen für NINAs Sequenz-Editor; Export als ResourceDictionary wie im NINA-3-Template.</summary>
[Export(typeof(ResourceDictionary))]
public partial class ProbeTemplates : ResourceDictionary
{
    public ProbeTemplates()
    {
        InitializeComponent();
    }
}
