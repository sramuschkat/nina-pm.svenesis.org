using Newtonsoft.Json.Linq;
using NinaPm.Core.Sequence;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// SequenceInspector gegen die Sequenzvorlage (execution.md §1, NT-44; AP-16h): die mitgelieferten Beispielsequenzen
/// ergeben keinen Hinweis, jede der Abweichungen aus dem Brief genau ihren Hinweis.
/// </summary>
public sealed class SequenceInspectorTests
{
    private static string SamplePath(string file) =>
        Path.Combine(ContractExamples.RepoRoot(), "apps", "nina-plugin", "NinaPm.Nina", "Samples", file);

    private static JObject Sample(string file) => JObject.Parse(File.ReadAllText(SamplePath(file)));

    private static IEnumerable<JObject> All(JToken t) => (t is JContainer c ? c.DescendantsAndSelf() : [t]).OfType<JObject>().Where(o => o["$type"] is not null);

    private static JObject Find(JToken root, string type, string? name = null) =>
        All(root).First(o => ((string)o["$type"]!).Contains(type, StringComparison.Ordinal) && (name is null || (string?)o["Name"] == name));

    private static JArray Values(JObject container, string list) => (JArray)container[list]!["$values"]!;

    private static List<string> Checks(JObject seq, double? afEveryMin = 60) =>
        [.. SequenceInspector.Inspect(SequenceFile.Parse(seq.ToString()), afEveryMin).Select(d => d.Check)];

    [Theory]
    [InlineData("one-night-safety.json")]
    [InlineData("one-night.json")]
    [InlineData("multi-night.json")]
    public void Mitgelieferte_Beispielsequenzen_ohne_Hinweis(string file) => Assert.Empty(Checks(Sample(file)));

    public static TheoryData<string, Action<JObject>> Abweichungen() => new()
    {
        { "loop_while_safe_missing", s => Values(Find(s, "SequentialContainer", "Ziel"), "Conditions").First(c => ((string)c["$type"]!).Contains("SafetyMonitorCondition", StringComparison.Ordinal)).Remove() },
        { "dither_trigger_present", s => Values(Find(s, "SequentialContainer", "Ziel"), "Triggers").Add(JObject.Parse("""{"$type":"NINA.Sequencer.Trigger.Guider.DitherAfterExposures, NINA.Sequencer","AfterExposures":1}""")) },
        { "start_autofocus_missing", s => Find(s, "RunAutofocus").Remove() },
        { "start_unpark_before_wait", s =>
            {
                var items = Values(Find(s, "StartAreaContainer"), "Items");
                var unpark = items.First(i => ((string)i["$type"]!).Contains("UnparkScope", StringComparison.Ordinal));
                unpark.Remove();
                items.Insert(0, unpark);
            } },
        { "wait_until_safe_used", s => Find(s, "SafetyWaitInstruction")["$type"] = "NINA.Sequencer.SequenceItem.Utility.WaitUntilSafe, NINA.Sequencer" },
        { "af_time_trigger_missing", s => Find(s, "AutofocusAfterTimeTrigger").Remove() },
        { "af_time_mismatch", s => Find(s, "AutofocusAfterTimeTrigger")["Amount"] = 30.0 },
        { "blocks_container_missing", s =>
            {
                var target = Find(s, "SequentialContainer", "Ziel");
                var box = Find(s, "NinaPmContainer");
                box.Remove();
                Values(target, "Items").Clear();
                Values(target, "Items").Add(box);
            } },
        { "safety_wait_not_last", s => Values(Find(s, "SequentialContainer", "Sicherung"), "Items").Add(JObject.Parse("""{"$type":"NINA.Sequencer.SequenceItem.Telescope.UnparkScope, NINA.Sequencer"}""")) },
        { "restore_missing", s => Find(s, "SequentialContainer", "Ziel")["Items"]!["$values"]![0]!.Remove() },
    };

    [Theory]
    [MemberData(nameof(Abweichungen))]
    public void Abweichung_ergibt_ihren_Hinweis(string check, Action<JObject> change)
    {
        var s = Sample("one-night-safety.json");
        change(s);
        Assert.Contains(check, Checks(s));
    }

    [Fact]
    public void Mehrere_Naechte_Start_und_Ende_in_der_Tagesschleife()
    {
        // Start: erst NINA-PM Warten auf Zeit, dann Entparken (H3) – in der Tagesschleife, nicht im Start-Bereich.
        var s = Sample("multi-night.json");
        var day = Find(s, "SequentialContainer", "NINA-PM Tage");
        var items = Values(day, "Items");
        var wait = items.First(i => ((string)i["$type"]!).Contains("WaitForTimeInstruction", StringComparison.Ordinal));
        wait.Remove();
        items.Insert(1, wait);
        Assert.Equal(["start_unpark_before_wait"], Checks(s));

        // Ohne Parken am Morgen in der Tagesschleife genügt der Ende-Bereich (Parken nach der letzten Nacht).
        s = Sample("multi-night.json");
        foreach (var park in Values(Find(s, "SequentialContainer", "NINA-PM Tage"), "Items")
                     .Where(i => ((string)i["$type"]!).Contains("ParkScope", StringComparison.Ordinal)).ToList())
            park.Remove();
        Assert.Empty(Checks(s));
        Values(Find(s, "EndAreaContainer"), "Items").Clear();
        Assert.Contains("end_secure_missing", Checks(s));
    }

    [Fact]
    public void Safety_Bedingungen_werden_erkannt_ohne_Safety_nicht()
    {
        Assert.True(SequenceInspector.UsesSafety(SequenceFile.Parse(Sample("one-night-safety.json").ToString())));
        Assert.False(SequenceInspector.UsesSafety(SequenceFile.Parse(Sample("one-night.json").ToString())));
    }

    [Fact]
    public void Ohne_bekannten_Autofokus_Takt_nur_Vorhandensein()
    {
        var s = Sample("one-night.json");
        Find(s, "AutofocusAfterTimeTrigger")["Amount"] = 30.0;
        Assert.DoesNotContain("af_time_mismatch", Checks(s, afEveryMin: null));
    }
}
