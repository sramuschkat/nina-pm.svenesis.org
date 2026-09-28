using System.ComponentModel.Composition;
using NINA.Plugin;
using NINA.Plugin.Interfaces;

namespace NinaPm.Probe;

/// <summary>Plugin-Manifest (MEF-Export wie im NINA-3-Template); Metadaten stehen in der Projektdatei.</summary>
[Export(typeof(IPluginManifest))]
public sealed class ProbePlugin : PluginBase
{
}
