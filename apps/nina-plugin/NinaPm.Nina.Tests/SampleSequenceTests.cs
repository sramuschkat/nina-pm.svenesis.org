using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using NinaPm.Nina.Sequencer;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Beispielsequenzen gegen NINAs echte Typen (FA-NIN-25, AP-16h): jeder <c>$type</c> löst sich in NINA 3.2 bzw. im
/// Plugin auf, jede Eigenschaft gibt es am Typ. Ersetzt das Laden in NINA nicht ganz, fängt aber Tipp- und
/// Strukturfehler einer Skript-Bearbeitung (AP-16h) ab, bevor jemand die Datei in NINA öffnet.
/// </summary>
public sealed class SampleSequenceTests
{
    private static readonly string[] Meta = ["$id", "$type", "$ref", "$values"];

    internal static string Samples()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "apps", "nina-plugin", "NinaPm.Nina", "Samples")))
            dir = dir.Parent;
        return Path.Combine(dir?.FullName ?? throw new DirectoryNotFoundException("Repo-Wurzel"), "apps", "nina-plugin", "NinaPm.Nina", "Samples");
    }

    private static Type? Resolve(string name) =>
        Type.GetType(name, an => an.Name == "NinaPm.Nina" ? typeof(NinaPmContainer).Assembly : Assembly.Load(an), null, false);

    private static bool HasProperty(Type type, string name)
    {
        for (var t = type; t is not null; t = t.BaseType)
            if (t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly) is not null)
                return true;
        return false;
    }

    [Theory]
    [InlineData("one-night-safety.json")]
    [InlineData("one-night.json")]
    public void Alle_Typen_und_Eigenschaften_gibt_es_in_NINA(string file)
    {
        var root = JObject.Parse(File.ReadAllText(Path.Combine(Samples(), file)));
        var problems = new List<string>();
        foreach (var o in root.DescendantsAndSelf().OfType<JObject>().Where(o => o["$type"] is not null))
        {
            var name = (string)o["$type"]!;
            if (Resolve(name) is not { } type)
            {
                problems.Add($"Typ fehlt: {name}");
                continue;
            }
            if (o["$values"] is not null) continue; // Sammlung
            foreach (var p in o.Properties().Where(p => !Meta.Contains(p.Name) && !HasProperty(type, p.Name)))
                problems.Add($"{type.Name}.{p.Name} fehlt");
        }
        Assert.Empty(problems);
    }
}
