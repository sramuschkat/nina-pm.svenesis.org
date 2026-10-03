using System.Globalization;
using Newtonsoft.Json.Linq;

namespace NinaPm.Core.Sequence;

/// <summary>
/// Ein Knoten einer NINA-Sequenz, geräteneutral (AP-16h): kurzer Typname (<c>UnparkScope</c>, <c>SequentialContainer</c>,
/// <c>NightLoopCondition</c> …), Anzeigename, Bedingungen, Anweisungen, Trigger und einfache Eigenschaften
/// (<c>Amount</c>, <c>TrackingMode</c>). Der Adapter baut ihn aus der laufenden Sequenz, <see cref="SequenceFile"/> aus
/// einer gespeicherten Sequenzdatei.
/// </summary>
public sealed record SeqNode(
    string Type,
    string? Name = null,
    IReadOnlyList<SeqNode>? Conditions = null,
    IReadOnlyList<SeqNode>? Items = null,
    IReadOnlyList<SeqNode>? Triggers = null,
    IReadOnlyDictionary<string, string>? Props = null,
    bool Disabled = false)
{
    public IReadOnlyList<SeqNode> ConditionList => Conditions ?? [];
    public IReadOnlyList<SeqNode> ItemList => Items ?? [];
    public IReadOnlyList<SeqNode> TriggerList => Triggers ?? [];

    /// <summary>Alle Nachfahren (Anweisungen und Container) in Tiefensuche, ohne sich selbst.</summary>
    public IEnumerable<SeqNode> Descendants()
    {
        foreach (var i in ItemList)
        {
            yield return i;
            foreach (var d in i.Descendants()) yield return d;
        }
    }

    public bool HasCondition(string type) => ConditionList.Any(c => c.Type == type && !c.Disabled);

    public string? Prop(string key) => Props is not null && Props.TryGetValue(key, out var v) ? v : null;
}

/// <summary>Gespeicherte NINA-Sequenz (JSON mit <c>$type</c>, <c>$values</c>) → <see cref="SeqNode"/>.</summary>
public static class SequenceFile
{
    private static readonly string[] PropKeys = ["Amount", "TrackingMode"];

    public static SeqNode Parse(string json) => Node(JObject.Parse(json));

    private static SeqNode Node(JObject o)
    {
        var type = ((string?)o["$type"] ?? "").Split(',')[0].Split('.')[^1];
        var props = PropKeys.Where(k => o[k] is JValue).ToDictionary(k => k, k => Convert.ToString(((JValue)o[k]!).Value, CultureInfo.InvariantCulture) ?? "");
        return new SeqNode(type, (string?)o["Name"], List(o["Conditions"]), List(o["Items"]), List(o["Triggers"]), props,
            o["Status"] is JValue s && s.Type == JTokenType.Integer && (int)s == 4 /* DISABLED */);
    }

    private static List<SeqNode> List(JToken? token) =>
        token?["$values"] is JArray a ? [.. a.OfType<JObject>().Select(Node)] : [];
}

/// <summary>Eine Abweichung von der Sequenzvorlage: Prüfcode und Hinweis für Log und Optionsseite.</summary>
public sealed record TemplateDeviation(string Check, string Hint);

/// <summary>
/// <c>SequenceInspector</c> (execution.md §1 „Sequenzvorlage“, NT-44, H2, H3, M7, NT-23): prüft eine Sequenz gegen die
/// verbindliche Liste – Start-Bereich in der Reihenfolge Warten → Entparken → Kühlen/Autofokus, Zielcontainer mit
/// Nachtschleife (+ <em>Loop While Safe</em> mit Safety), Wiederherstellung als erste Anweisung, innerer Container „Blöcke“
/// mit <em>NINA-PM-Anweisungen</em>, Trigger <em>Meridian Flip</em> und <em>Autofokus nach Zeit</em> (<c>Amount =
/// afEveryMin</c>), kein Dither-Trigger, Sicherungscontainer mit <em>Loop While Unsafe</em> + Nachtschleife und
/// <em>NINA-PM Warten bis sicher oder Nachtende</em> als letzter Anweisung (nie <em>Wait until Safe</em>), Park- oder
/// Home-Variante, Ende-Bereich. Abweichungen sind Hinweise, kein Abbruch.
/// </summary>
public static class SequenceInspector
{
    private static readonly string[] WaitTypes = ["WaitForSunAltitude", "WaitForAltitude", "WaitForTime", "WaitUntilTime"];

    /// <param name="afEveryMin">Autofokus-Takt des Rigs (<c>null</c> = unbekannt, nur Vorhandensein prüfen).</param>
    public static IReadOnlyList<TemplateDeviation> Inspect(SeqNode root, double? afEveryMin = null)
    {
        var d = new List<TemplateDeviation>();
        void Add(string check, string hint) => d.Add(new TemplateDeviation(check, hint));
        var all = root.Descendants().Concat([root]).ToList();
        var active = all.Where(n => !n.Disabled).ToList();

        // ---- Start-Bereich (H3, NT-24) ----
        var start = root.ItemList.FirstOrDefault(n => n.Type == "StartAreaContainer");
        var startItems = start?.ItemList.Where(n => !n.Disabled).Select(n => n.Type).ToList() ?? [];
        int Index(string t) => startItems.IndexOf(t);
        var wait = startItems.FindIndex(t => WaitTypes.Contains(t));
        var unpark = Index("UnparkScope");
        if (wait < 0) Add("start_wait_missing", "Start: Warten auf Sonnenhöhe fehlt.");
        if (unpark >= 0 && wait > unpark) Add("start_unpark_before_wait", "Start: Entparken steht vor dem Warten – erst warten, dann entparken (H3).");
        if (Index("CoolCamera") < 0) Add("start_cool_missing", "Start: Kamera kühlen fehlt.");
        if (Index("RunAutofocus") < 0) Add("start_autofocus_missing", "Start: Autofokus vor dem ersten Ziel fehlt (NT-24).");
        foreach (var t in new[] { "CoolCamera", "RunAutofocus" })
            if (unpark >= 0 && Index(t) >= 0 && Index(t) < unpark) Add("start_order", $"Start: {t} steht vor dem Entparken.");

        // ---- Zielcontainer und „Blöcke“ ----
        var box = active.FirstOrDefault(n => n.Type == "NinaPmContainer");
        if (box is null)
        {
            Add("box_missing", "Keine NINA-PM-Anweisungen in der Sequenz.");
            return d;
        }
        var path = PathTo(root, box) ?? [];
        var safety = UsesSafety(root);
        // Vorlage (§1): Ziel-Bereich → äußere Schleife → „Ziel“ → „Blöcke“ → NINA-PM-Anweisungen. Positionen relativ zum
        // Ziel-Bereich, nicht über die Bedingungen – äußere Schleife und „Ziel“ tragen beide die Nachtschleife.
        var areaIndex = path.FindIndex(n => n.Type == "TargetAreaContainer");
        var below = path.Skip(areaIndex + 1).ToList();
        var ziel = below.Count >= 3 ? below[1] : null;
        var parent = path.Count >= 2 ? path[^2] : null;
        var bloecke = below.Count >= 4 && parent is not null && !ReferenceEquals(parent, ziel) && parent.HasCondition("NightLoopCondition")
            ? parent
            : null;
        if (bloecke is null)
            Add("bloecke_missing", "Die NINA-PM-Anweisungen gehören in einen Container „Blöcke“ mit NINA-PM Nachtschleife innerhalb von „Ziel“.");
        if (ziel is null || !ziel.HasCondition("NightLoopCondition"))
            Add("ziel_night_loop_missing", "Zielcontainer ohne Bedingung NINA-PM Nachtschleife.");
        if (safety && ziel is not null && !ziel.HasCondition("SafetyMonitorCondition"))
            Add("loop_while_safe_missing", "Zielcontainer ohne Loop While Safe.");
        if (ziel is not null && bloecke is not null)
        {
            var first = ziel.ItemList.FirstOrDefault(n => !n.Disabled);
            if (first is null || first.Type is not ("UnparkScope" or "SetTracking"))
                Add("restore_missing", "„Ziel“ beginnt nicht mit der Wiederherstellung (Unpark Scope bzw. Set Tracking).");
        }

        // ---- Trigger (M7, NT-23) ----
        var triggers = active.SelectMany(n => n.TriggerList).Where(t => !t.Disabled).ToList();
        if (!triggers.Any(t => t.Type == "MeridianFlipTrigger")) Add("flip_trigger_missing", "Trigger Meridian Flip fehlt.");
        var afTime = triggers.FirstOrDefault(t => t.Type == "AutofocusAfterTimeTrigger");
        if (afTime is null) Add("af_time_trigger_missing", "Trigger Autofokus nach Zeit fehlt (der Server plant dann ohne Autofokus, M7).");
        else if (afEveryMin is { } every && double.TryParse(afTime.Prop("Amount"), NumberStyles.Float, CultureInfo.InvariantCulture, out var amount)
            && Math.Abs(amount - every) > 0.5)
            Add("af_time_mismatch", $"Autofokus nach Zeit: {amount:0} min, das Rig plant mit {every:0} min.");
        if (triggers.Any(t => t.Type.Contains("Dither", StringComparison.OrdinalIgnoreCase)))
            Add("dither_trigger_present", "Dither-Trigger in der Sequenz – das Dithern steuert der Plan (NT-23).");

        // ---- Sicherung (H2) ----
        if (active.Any(n => n.Type == "WaitUntilSafe"))
            Add("wait_until_safe_used", "Wait until Safe wartet ohne Frist – NINA-PM Warten bis sicher oder Nachtende verwenden (H2).");
        if (safety)
        {
            var sicherung = active.FirstOrDefault(n => n.HasCondition("LoopWhileUnsafe"));
            if (sicherung is null)
            {
                Add("sicherung_missing", "Sicherungscontainer mit Loop While Unsafe fehlt.");
            }
            else
            {
                if (!sicherung.HasCondition("NightLoopCondition"))
                    Add("sicherung_night_loop_missing", "Sicherungscontainer ohne NINA-PM Nachtschleife.");
                var items = sicherung.ItemList.Where(n => !n.Disabled).ToList();
                if (items.Count == 0 || items[^1].Type != "SafetyWaitInstruction")
                    Add("safety_wait_not_last", "NINA-PM Warten bis sicher oder Nachtende muss die letzte Anweisung der Sicherung sein.");
                if (!items.Any(n => n.Type is "ParkScope" or "FindHome"))
                    Add("sicherung_secure_missing", "Sicherung: Park Scope bzw. Find Home fehlt.");
            }
        }

        // ---- Ende ----
        var end = root.ItemList.FirstOrDefault(n => n.Type == "EndAreaContainer")?.ItemList.Where(n => !n.Disabled).Select(n => n.Type).ToList() ?? [];
        if (!end.Contains("ParkScope") && !end.Contains("FindHome")) Add("end_secure_missing", "Ende: Park Scope bzw. Find Home fehlt.");
        if (!end.Contains("WarmCamera")) Add("end_warm_missing", "Ende: Kamera aufwärmen fehlt.");
        return d;
    }

    /// <summary>Sequenz enthält Safety-Bedingungen (für <c>safety_monitor_not_connected</c>).</summary>
    public static bool UsesSafety(SeqNode root) =>
        root.Descendants().Concat([root]).Any(n => !n.Disabled && (n.HasCondition("SafetyMonitorCondition") || n.HasCondition("LoopWhileUnsafe")));

    private static List<SeqNode>? PathTo(SeqNode from, SeqNode target)
    {
        if (ReferenceEquals(from, target)) return [from];
        foreach (var child in from.ItemList)
            if (PathTo(child, target) is { } p)
                return [from, .. p];
        return null;
    }
}
