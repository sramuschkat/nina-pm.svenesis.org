using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Plugin-Manifest (ADR-S2b): NINA liest die Plugin-ID aus dem Guid-Attribut, Name/Autor/Beschreibung aus den
/// Assembly-Attributen; MinimumApplicationVersion = NinaVersion. Die Optionsseite liegt unter <c>NINA-PM_Options</c>.
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class ManifestTests
{
    private static readonly Assembly Plugin = typeof(NinaPmPlugin).Assembly;

    private static string? Meta(string key) =>
        Plugin.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == key)?.Value;

    [Fact]
    public void Guid_und_Identifier_stimmen_ueberein()
    {
        var guid = Plugin.GetCustomAttribute<GuidAttribute>()?.Value;
        Assert.NotNull(guid);
        Assert.Equal(guid, Meta("Identifier"));
    }

    [Fact]
    public void Name_Autor_und_Mindestversion()
    {
        Assert.Equal("NINA-PM", Plugin.GetCustomAttribute<AssemblyTitleAttribute>()?.Title);
        Assert.Equal("Svenesis", Plugin.GetCustomAttribute<AssemblyCompanyAttribute>()?.Company);
        Assert.False(string.IsNullOrWhiteSpace(Plugin.GetCustomAttribute<AssemblyDescriptionAttribute>()?.Description));
        Assert.Matches(@"^3\.\d+\.\d+\.\d+$", Meta("MinimumApplicationVersion"));
        Assert.DoesNotContain("Astro PM", Meta("Description") ?? "", StringComparison.OrdinalIgnoreCase);
        // Logo aus der Web-App (apps/web/public/nina-plugin-logo.png), nie von www.svenesis.org (Regel 6).
        Assert.Equal("https://nina-pm.svenesis.org/nina-plugin-logo.png", Meta("FeaturedImageURL"));
    }

    [Fact]
    public void Plugin_Version_ohne_Build_Metadaten() =>
        Assert.Matches(@"^\d+\.\d+\.\d+", NinaPmPlugin.PluginVersion);

    [Fact]
    public void Optionsvorlage_unter_dem_Plugin_Namen() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        Assert.IsType<DataTemplate>(resources["NINA-PM_Options"]);
    });
}

/// <summary>
/// Tests mit WPF-Objekten laufen nacheinander: gleichzeitige WPF-Initialisierung auf mehreren STA-Threads kann sich
/// gegenseitig blockieren.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class WpfCollection
{
    public const string Name = "WPF";
}

/// <summary>XAML braucht einen STA-Thread; xUnit läuft im MTA.</summary>
internal static class Sta
{
    public static void Run(Action action)
    {
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try { action(); }
            catch (Exception ex) { error = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error is not null) throw new Xunit.Sdk.XunitException($"STA: {error}");
    }
}
