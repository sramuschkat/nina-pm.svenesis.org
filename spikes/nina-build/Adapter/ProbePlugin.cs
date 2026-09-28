using System.ComponentModel.Composition;
using NINA.Plugin;
using NINA.Plugin.Interfaces;

namespace NinaBuild.Adapter;

/// <summary>Plugin-Manifest wie im NINA-3-Template (MEF-Export).</summary>
[Export(typeof(IPluginManifest))]
public sealed class ProbePlugin : PluginBase
{
}
