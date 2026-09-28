using System.Text.Json;
using Jint;

namespace NinaPm.Core.Tests;

/// <summary>
/// Lädt <c>packages/engine/build/engine.iife.js</c> in Jint (AP-08c, TK 10.4) und die von Node erzeugte
/// Erwartungsdatei <c>parity-expected.json</c>. Beide entstehen mit <c>pnpm engine:bundle</c> und
/// <c>pnpm engine:parity</c>; der Pfad lässt sich mit <c>NINA_PM_ENGINE_BUILD</c> überschreiben.
/// Jint-Engines sind nicht threadsicher: jeder Aufrufer bekommt über <see cref="NewEngine"/> seine eigene.
/// </summary>
public static class EngineBundle
{
    private static readonly Lazy<string> BuildDir = new(FindBuildDir);
    private static readonly Lazy<string> Code = new(() => Read("engine.iife.js"));
    private static readonly Lazy<JsonDocument> ExpectedDoc = new(() => JsonDocument.Parse(Read("parity-expected.json")));

    public static JsonElement Expected => ExpectedDoc.Value.RootElement;

    /// <summary>Neue Jint-Engine mit geladenem Bundle (global <c>NinaPmEngine</c>).</summary>
    public static Engine NewEngine()
    {
        var engine = new Engine(options => options.Strict());
        engine.Execute(Code.Value);
        return engine;
    }

    private static string Read(string name)
    {
        var path = Path.Combine(BuildDir.Value, name);
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"{path} fehlt – vorher `pnpm engine:bundle && pnpm engine:parity` im Repository ausführen.", path);
        return File.ReadAllText(path);
    }

    private static string FindBuildDir()
    {
        var fromEnv = Environment.GetEnvironmentVariable("NINA_PM_ENGINE_BUILD");
        if (!string.IsNullOrEmpty(fromEnv)) return fromEnv;
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
                return Path.Combine(dir.FullName, "packages", "engine", "build");
        throw new DirectoryNotFoundException("Repository-Wurzel (pnpm-workspace.yaml) nicht gefunden.");
    }
}
