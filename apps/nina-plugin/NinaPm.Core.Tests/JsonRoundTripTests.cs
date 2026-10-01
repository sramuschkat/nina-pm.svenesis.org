using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// JSON-Rundreise mit dem generierten Client (NT-05): Zeitpunkte in UTC mit <c>Z</c>, <c>night</c> bleibt
/// <c>YYYY-MM-DD</c>; Grundlage sind die Vertragsbeispiele aus <c>docs/contracts/nina/</c>.
/// </summary>
public sealed class JsonRoundTripTests
{
    private static readonly JsonSerializerSettings Settings = NinaJson.Settings();

    [Fact]
    public void Bootstrap_Beispiel_liest_Zeitpunkte_als_UTC_und_Naechte_als_Zeichenkette()
    {
        var b = JsonConvert.DeserializeObject<NinaBootstrap>(ContractExamples.Json("bootstrap.response"), Settings)!;
        Assert.Equal(TimeSpan.Zero, b.ServerTimeUtc.Offset);
        Assert.Equal("2026-09-17", b.Nights.First().Night);
        Assert.True(b.Nights.All(n => UtcText.IsNightKey(n.Night)));
        Assert.Equal(TimeSpan.Zero, b.Nights.First().NoonStartUtc.Offset);
    }

    [Fact]
    public void Bootstrap_Rundreise_schreibt_Z_und_Nacht_unveraendert()
    {
        var b = JsonConvert.DeserializeObject<NinaBootstrap>(ContractExamples.Json("bootstrap.response"), Settings)!;
        var json = Raw(JsonConvert.SerializeObject(b, Settings));
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$", (string)json["serverTimeUtc"]!);
        Assert.Equal("2026-09-17", (string)json["nights"]![0]!["night"]!);
        Assert.DoesNotContain("+00:00", json.ToString(Formatting.None));
    }

    /// <summary>Ohne Datumsdeutung lesen – sonst wandelt Newtonsoft Zeichenketten in Datumswerte um.</summary>
    private static JObject Raw(string json) =>
        JObject.Load(new JsonTextReader(new StringReader(json)) { DateParseHandling = DateParseHandling.None });

    [Fact]
    public void Zeitpunkt_mit_anderem_Offset_wird_als_UTC_geschrieben()
    {
        var at = new DateTimeOffset(2026, 9, 17, 20, 0, 0, TimeSpan.FromHours(-5));
        var json = JsonConvert.SerializeObject(new { at }, Settings);
        Assert.Equal("{\"at\":\"2026-09-18T01:00:00Z\"}", json);
    }

    [Fact]
    public void Plan_Antwort_und_Heartbeat_Antwort_lesen_sich_ohne_Fehler()
    {
        var plan = JsonConvert.DeserializeObject<NinaPlanResponse>(ContractExamples.Json("plan.response"), Settings)!;
        Assert.NotEmpty(plan.Blocks);
        var hb = JsonConvert.DeserializeObject<NinaHeartbeatResponse>(ContractExamples.Json("heartbeat.response"), Settings)!;
        Assert.Equal(TimeSpan.Zero, hb.ServerTimeUtc.Offset);
    }
}
