using NinaPm.Core.Logging;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Log-Grammatik (FA-NIN-19, ops/plugin-test-protocol.md).</summary>
public sealed class LogGrammarTests
{
    [Fact]
    public void Werte_ohne_Leerzeichen_bleiben_offen_sonst_in_Anfuehrungszeichen()
    {
        var line = NinaPmLog.Line("CAPTURE", ("id", "0192a1b2"), ("result", "saved"), ("file", "NGC 281_Ha_0023.fits"));
        Assert.Equal("NINA-PM | CAPTURE id=0192a1b2 result=saved file=\"NGC 281_Ha_0023.fits\"", line);
    }

    [Fact]
    public void Zeitpunkte_Zahlen_und_null()
    {
        var at = new DateTimeOffset(2026, 9, 18, 4, 33, 57, 400, TimeSpan.Zero);
        var line = NinaPmLog.Line("FLIP", ("pierBefore", "west"), ("pierAfter", "east"), ("durationS", 228.04), ("atUtc", at), ("code", null));
        Assert.Equal("NINA-PM | FLIP pierBefore=west pierAfter=east durationS=228 atUtc=2026-09-18T04:33:57Z", line);
    }

    [Fact]
    public void Anfuehrungszeichen_und_Gleichheitszeichen_werden_maskiert()
    {
        Assert.Equal("NINA-PM | READOUT mode=set name=\"High \\\"Gain\\\" Mode\" index=0",
            NinaPmLog.Line("READOUT", ("mode", "set"), ("name", "High \"Gain\" Mode"), ("index", 0)));
        Assert.Equal("NINA-PM | TARGETS etag=\"a=b\"", NinaPmLog.Line("TARGETS", ("etag", "a=b")));
    }

    [Theory]
    [InlineData("capture")]
    [InlineData("API call")]
    [InlineData("")]
    public void Ereignisname_nur_in_Grossbuchstaben(string name) =>
        Assert.Throws<ArgumentException>(() => NinaPmLog.Line(name));

    [Fact]
    public void Senke_bekommt_Stufe_passend()
    {
        var sink = new ListSink();
        var log = new NinaPmLog(sink);
        log.Event("API", ("status", 200));
        log.Warning("API", ("status", 401), ("code", "nina.token_invalid"));
        Assert.Equal(["I NINA-PM | API status=200", "W NINA-PM | API status=401 code=nina.token_invalid"], sink.Lines);
    }
}

public sealed class ListSink : ILogSink
{
    public List<string> Lines { get; } = [];
    public void Info(string line) => Lines.Add($"I {line}");
    public void Warning(string line) => Lines.Add($"W {line}");
    public void Error(string line) => Lines.Add($"E {line}");
}
