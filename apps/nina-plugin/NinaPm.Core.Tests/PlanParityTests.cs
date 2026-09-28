using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jint;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Plan-Teil des Paritätstests (<see cref="EngineParityTests"/>): je Seed erzeugt Jint die Eingabe mit
/// <c>randomPlanInput</c>, plant mit <c>planNight</c> und vergleicht die Hashes mit Node. Jint braucht etwa
/// 0,3 s je Plan; die Seeds sind deshalb auf vier Klassen verteilt, die xUnit parallel ausführt, jede Klasse
/// mit eigener Jint-Engine je Thread.
/// </summary>
public static class PlanParity
{
    public const int Shards = 4;

    private static readonly ThreadLocal<Engine> Js = new(EngineBundle.NewEngine);

    public static IEnumerable<object[]> Seeds(int shard) =>
        EngineBundle.Expected.GetProperty("plans").EnumerateArray()
            .Where((_, i) => i % Shards == shard)
            .Select(p => new object[] { p.GetProperty("seed").GetInt32(), p.GetRawText() });

    public static void Check(int seed, string expectedRaw)
    {
        var expected = JsonDocument.Parse(expectedRaw).RootElement;
        var actual = JsonDocument.Parse(Js.Value!.Evaluate($$"""
            (function () {
              var input = NinaPmEngine.randomPlanInput({{seed}});
              try {
                var plan = NinaPmEngine.planNight(input);
                return JSON.stringify({ inputHash: plan.inputHash, outputHash: plan.outputHash,
                  canonical: NinaPmEngine.canonicalInputJson(input) });
              } catch (e) { return JSON.stringify({ error: e.code || 'error' }); }
            })()
            """).AsString()).RootElement;

        if (expected.TryGetProperty("error", out var error))
        {
            Assert.Equal(error.GetString(), actual.GetProperty("error").GetString());
            return;
        }
        Assert.False(actual.TryGetProperty("error", out var jintError), $"Seed {seed}: Jint-Fehler {jintError}");
        Assert.Equal(expected.GetProperty("inputHash").GetString(), actual.GetProperty("inputHash").GetString());
        Assert.Equal(expected.GetProperty("outputHash").GetString(), actual.GetProperty("outputHash").GetString());

        // Gegenprobe mit .NET: inputHash = sha256 über die UTF-8-Bytes der ASCII-reinen kanonischen Zeichenkette.
        var canonical = actual.GetProperty("canonical").GetString()!;
        Assert.All(canonical, ch => Assert.True(ch <= '\u007f', $"Seed {seed}: Nicht-ASCII in kanonischer Form"));
        var net = "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
        Assert.Equal(expected.GetProperty("inputHash").GetString(), net);
    }
}

public class PlanParityShard0
{
    public static IEnumerable<object[]> Seeds() => PlanParity.Seeds(0);

    [Theory]
    [MemberData(nameof(Seeds))]
    public void PlanNightHashes(int seed, string expected) => PlanParity.Check(seed, expected);
}

public class PlanParityShard1
{
    public static IEnumerable<object[]> Seeds() => PlanParity.Seeds(1);

    [Theory]
    [MemberData(nameof(Seeds))]
    public void PlanNightHashes(int seed, string expected) => PlanParity.Check(seed, expected);
}

public class PlanParityShard2
{
    public static IEnumerable<object[]> Seeds() => PlanParity.Seeds(2);

    [Theory]
    [MemberData(nameof(Seeds))]
    public void PlanNightHashes(int seed, string expected) => PlanParity.Check(seed, expected);
}

public class PlanParityShard3
{
    public static IEnumerable<object[]> Seeds() => PlanParity.Seeds(3);

    [Theory]
    [MemberData(nameof(Seeds))]
    public void PlanNightHashes(int seed, string expected) => PlanParity.Check(seed, expected);
}
