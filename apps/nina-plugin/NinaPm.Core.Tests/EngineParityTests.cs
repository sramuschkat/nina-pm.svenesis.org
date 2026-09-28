using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jint;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Paritätstest Node ↔ Jint (AP-08c; canonical-json.md; rules/engine.md Nr. 7), feste Fälle; die Pläne stehen in
/// <see cref="PlanParity"/>. Jint rechnet mit
/// <c>engine.iife.js</c> dieselben Werte wie Node – feste Testvektoren und ≥ 500 zufällige <c>PlanInput</c>,
/// die Jint mit <c>randomPlanInput(seed)</c> selbst erzeugt. Verglichen werden <c>inputHash</c> und
/// <c>outputHash</c>; zusätzlich hasht .NET die kanonische Zeichenkette mit <see cref="SHA256"/>, damit die
/// eigene SHA-256 der Engine und die Regel „UTF-8-Bytes einer ASCII-reinen Zeichenkette“ gegengeprüft sind.
/// </summary>
public class EngineParityTests
{
    private static readonly ThreadLocal<Engine> Js = new(EngineBundle.NewEngine);

    private static string Call(string script) => Js.Value!.Evaluate(script).AsString();

    [Fact]
    public void EngineVersionMatchesNode()
    {
        var jint = Call("NinaPmEngine.ENGINE_VERSION");
        Assert.Equal(EngineBundle.Expected.GetProperty("engineVersion").GetString(), jint);
    }

    public static IEnumerable<object[]> CanonicalCases() =>
        EngineBundle.Expected.GetProperty("canonical").EnumerateArray()
            .Select(c => new object[] { c.GetProperty("expr").GetString()!, c.GetRawText() });

    [Theory]
    [MemberData(nameof(CanonicalCases))]
    public void CanonicalJson(string expr, string expectedRaw)
    {
        var expected = JsonDocument.Parse(expectedRaw).RootElement;
        var actual = JsonDocument.Parse(Call($$"""
            (function () {
              try { return JSON.stringify({ json: NinaPmEngine.canonicalInputJson({{expr}}) }); }
              catch (e) { return JSON.stringify({ error: e.code || 'error' }); }
            })()
            """)).RootElement;
        if (expected.TryGetProperty("error", out var error))
            Assert.Equal(error.GetString(), actual.GetProperty("error").GetString());
        else
            Assert.Equal(expected.GetProperty("json").GetString(), actual.GetProperty("json").GetString());
    }

    public static IEnumerable<object[]> ShaCases() =>
        EngineBundle.Expected.GetProperty("sha").EnumerateArray()
            .Select(c => new object[] { c.GetProperty("text").GetString()!, c.GetProperty("hex").GetString()! });

    [Theory]
    [MemberData(nameof(ShaCases))]
    public void Sha256(string text, string hex)
    {
        Assert.Equal(hex, Call($"NinaPmEngine.sha256hex({JsonSerializer.Serialize(text)})"));
        Assert.Equal(hex, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant());
    }

    public static IEnumerable<object[]> QuantizeCases() =>
        EngineBundle.Expected.GetProperty("quantize").EnumerateArray()
            .Select(c => new object[] { c.GetProperty("x").GetRawText(), c.GetProperty("inv").GetRawText(), c.GetProperty("out").GetRawText() });

    [Theory]
    [MemberData(nameof(QuantizeCases))]
    public void Quantize(string x, string inv, string expected) =>
        Assert.Equal(expected, Call($"JSON.stringify(NinaPmEngine.q({x}, {inv}))"));

    [Fact]
    public void AtLeast500RandomPlans() =>
        Assert.True(EngineBundle.Expected.GetProperty("plans").GetArrayLength() >= 500,
            "Paritätstest braucht ≥ 500 zufällige PlanInput (rules/engine.md Nr. 7)");
}
