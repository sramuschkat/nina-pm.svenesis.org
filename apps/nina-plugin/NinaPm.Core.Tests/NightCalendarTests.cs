using Newtonsoft.Json.Linq;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// <c>currentNight</c> (NT-01, night.md §1.1/§4) mit den Testvektoren, die auch <c>packages/shared</c> prüft
/// (<c>packages/shared/contracts/test-vectors/current-night.json</c>); dazu Nachladen der Tabelle und veraltete Session.
/// </summary>
public sealed class NightCalendarTests
{
    private static readonly JObject Vectors = Load();

    private static JObject Load()
    {
        var path = Path.Combine(ContractExamples.RepoRoot(), "packages", "shared", "contracts", "test-vectors", "current-night.json");
        // Zeitpunkte bleiben Zeichenketten (sonst deutet Newtonsoft sie als Ortszeit-DateTime, NT-05).
        using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(File.ReadAllText(path)))
        {
            DateParseHandling = Newtonsoft.Json.DateParseHandling.None,
        };
        return JObject.Load(reader);
    }

    private static IReadOnlyList<NightRow> Table(string name) =>
        ((JArray)Vectors["tables"]![name]!).Select(r => new NightRow(
            (string)r["night"]!,
            UtcText.Parse((string)r["noonStartUtc"]!),
            UtcText.Parse((string)r["noonEndUtc"]!),
            UtcText.Parse((string)r["nightWindowEndUtc"]!))).ToList();

    public static TheoryData<string, string, string, string?, string?> Cases()
    {
        var data = new TheoryData<string, string, string, string?, string?>();
        foreach (var c in (JArray)Vectors["cases"]!)
            data.Add((string)c["name"]!, (string)c["table"]!, (string)c["now"]!, (string?)c["expect"], (string?)c["error"]);
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Gemeinsame_Testvektoren(string name, string table, string now, string? expect, string? error)
    {
        var nights = Table(table);
        if (error is not null)
        {
            var ex = Assert.Throws<NightTableException>(() => NightCalendar.CurrentNight(nights, UtcText.Parse(now)));
            Assert.Equal(error, ex.Code);
        }
        else
        {
            Assert.True(expect == NightCalendar.CurrentNight(nights, UtcText.Parse(now)), name);
        }
    }

    [Fact]
    public void Pflichtfaelle_aus_night_md_sind_in_den_Vektoren()
    {
        var starfront = ((JArray)Vectors["cases"]!)
            .Where(c => (string)c["table"]! == "starfront0917")
            .Select(c => ((string)c["now"]!, (string)c["expect"]!))
            .ToList();
        Assert.Equal(
            [
                ("2026-09-18T07:00:00Z", "2026-09-17"),
                ("2026-09-18T12:59:59Z", "2026-09-17"),
                ("2026-09-18T13:00:00Z", "2026-09-18"),
                ("2026-09-18T14:00:00Z", "2026-09-18"),
                ("2026-09-18T18:00:00Z", "2026-09-18"),
            ],
            starfront);
    }

    private static IReadOnlyList<NightRow> Days(string firstNight, int count)
    {
        var first = DateOnly.Parse(firstNight);
        return Enumerable.Range(0, count).Select(i =>
        {
            var noon = new DateTimeOffset(first.AddDays(i).ToDateTime(new TimeOnly(17, 0)), TimeSpan.Zero);
            return new NightRow(first.AddDays(i).ToString("yyyy-MM-dd"), noon, noon.AddDays(1), noon.AddHours(20));
        }).ToList();
    }

    [Fact]
    public void Nachladen_bei_weniger_als_14_kuenftigen_Naechten()
    {
        var nights = Days("2026-09-17", 60);
        Assert.False(NightCalendar.NeedsReload(nights, UtcText.Parse("2026-09-18T07:00:00Z")));
        // Letzte Nacht 2026-11-15 (Mittag 17:00Z): am 01.11. 18:00Z liegen noch 14 Mittage voraus, am 02.11. 13.
        Assert.False(NightCalendar.NeedsReload(nights, UtcText.Parse("2026-11-01T18:00:00Z")));
        Assert.True(NightCalendar.NeedsReload(nights, UtcText.Parse("2026-11-02T18:00:00Z")));
    }

    [Fact]
    public void Session_veraltet_beim_Nachtwechsel_oder_ohne_Tabelle_zwei_Stunden_nach_Nachtende()
    {
        var nights = Table("starfront0917");
        Assert.False(NightCalendar.IsSessionStale("2026-09-17", nights, UtcText.Parse("2026-09-18T12:59:59Z"), null));
        Assert.True(NightCalendar.IsSessionStale("2026-09-17", nights, UtcText.Parse("2026-09-18T13:00:00Z"), null));

        var end = UtcText.Parse("2026-09-18T13:00:00Z");
        Assert.False(NightCalendar.IsSessionStale("2026-09-17", null, UtcText.Parse("2026-09-18T14:59:59Z"), end));
        Assert.True(NightCalendar.IsSessionStale("2026-09-17", null, UtcText.Parse("2026-09-18T15:00:00Z"), end));
        // Tabelle zu kurz → derselbe Rückfall.
        Assert.True(NightCalendar.IsSessionStale("2026-09-17", Table("onlyNight0917"), UtcText.Parse("2026-09-18T15:00:00Z"), end));
    }
}
