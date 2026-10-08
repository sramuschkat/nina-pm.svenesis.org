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

    /// <summary>
    /// Aktive Anweisungen in Ausführungsreihenfolge (Tiefensuche), auch in Unter-Containern; abgeschaltete samt Inhalt
    /// zählen nicht. Für Start- und Ende-Bereich (Rig-Nacht 06./07.10.2026: Svens Ende-Bereich ist ein einziger
    /// Unter-Container, die Prüfung der obersten Ebene meldete <c>end_secure_missing</c> trotz <em>Find Home</em>).
    /// </summary>
    public static IEnumerable<SeqNode> Flatten(IEnumerable<SeqNode> items)
    {
        foreach (var i in items)
        {
            if (i.Disabled) continue;
            yield return i;
            foreach (var d in Flatten(i.ItemList)) yield return d;
        }
    }

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
/// <para>„Mehrere Nächte“ (AP-52): Liegt die äußere Schleife in einem Container mit <em>NINA-PM Tagesschleife</em>, gelten
/// dessen Anweisungen **vor** der äußeren Schleife als Start (erst <em>NINA-PM Warten auf Zeit</em>, dann Entparken, H3)
/// und die **danach** zusammen mit dem Ende-Bereich als Ende (Parken jeden Morgen); die Lage von „Ziel“ und „Blöcke“
/// zählt dann ab der Tagesschleife.</para>
/// </summary>
public static class SequenceInspector
{
    private static readonly string[] WaitTypes = ["WaitForSunAltitude", "WaitForAltitude", "WaitForTime", "WaitUntilTime", "WaitForTimeInstruction"];

    /// <param name="afEveryMin">Autofokus-Takt des Rigs (<c>null</c> = unbekannt, nur Vorhandensein prüfen).</param>
    public static IReadOnlyList<TemplateDeviation> Inspect(SeqNode root, double? afEveryMin = null)
    {
        var d = new List<TemplateDeviation>();
        void Add(string check, string hint) => d.Add(new TemplateDeviation(check, hint));
        var all = root.Descendants().Concat([root]).ToList();
        var active = all.Where(n => !n.Disabled).ToList();

        var box = active.FirstOrDefault(n => n.Type == "NinaPmContainer");
        var path = box is null ? [] : PathTo(root, box) ?? [];
        // Tagesschleife (AP-52): Container auf dem Weg zu den NINA-PM-Anweisungen mit der Bedingung DayLoopCondition.
        var dayIndex = path.FindIndex(n => n.HasCondition("DayLoopCondition"));
        var day = dayIndex >= 0 && dayIndex + 1 < path.Count ? path[dayIndex] : null;
        var dayItems = day?.ItemList.Where(n => !n.Disabled).ToList() ?? [];
        var nightAt = day is null ? -1 : dayItems.FindIndex(n => ReferenceEquals(n, path[dayIndex + 1]));

        // ---- Start-Bereich (H3, NT-24) ----
        var start = root.ItemList.FirstOrDefault(n => n.Type == "StartAreaContainer");
        var startItems = day is not null && nightAt >= 0
            ? SeqNode.Flatten(dayItems.Take(nightAt)).Select(n => n.Type).ToList()
            : SeqNode.Flatten(start?.ItemList ?? []).Select(n => n.Type).ToList();
        int Index(string t) => startItems.IndexOf(t);
        var wait = startItems.FindIndex(t => WaitTypes.Contains(t));
        var unpark = Index("UnparkScope");
        if (wait < 0) Add("start_wait_missing", "Start: Wait for Sun Altitude missing.");
        if (unpark >= 0 && wait > unpark) Add("start_unpark_before_wait", "Start: Unpark comes before the wait – wait first, then unpark (H3).");
        if (Index("CoolCamera") < 0) Add("start_cool_missing", "Start: Cool Camera missing.");
        foreach (var t in new[] { "CoolCamera", "RunAutofocus" })
            if (unpark >= 0 && Index(t) >= 0 && Index(t) < unpark) Add("start_order", $"Start: {t} comes before unparking.");

        // ---- Zielcontainer und „Blöcke“ ----
        const string afMissing = "Start: autofocus before the first target missing (NT-24).";
        if (box is null)
        {
            if (Index("RunAutofocus") < 0) Add("start_autofocus_missing", afMissing);
            Add("box_missing", "No NINA-PM Instructions in the sequence.");
            return d;
        }
        var safety = UsesSafety(root);
        // Vorlage (§1): Ziel-Bereich → äußere Schleife → „Ziel“ → „Blöcke“ → NINA-PM-Anweisungen. Positionen relativ zum
        // Ziel-Bereich, nicht über die Bedingungen – äußere Schleife und „Ziel“ tragen beide die Nachtschleife.
        var areaIndex = day is not null ? dayIndex : path.FindIndex(n => n.Type == "TargetAreaContainer");
        var below = path.Skip(areaIndex + 1).ToList();
        var target = below.Count >= 3 ? below[1] : null;
        var parent = path.Count >= 2 ? path[^2] : null;
        var blocks = below.Count >= 4 && parent is not null && !ReferenceEquals(parent, target) && parent.HasCondition("NightLoopCondition")
            ? parent
            : null;
        // Autofokus vor dem ersten Ziel (NT-24): im Start-Bereich oder im Wiederherstellungsteil von „Ziel“ vor „Blöcke“
        // (AP-68) – z. B. erst nach Dach und Abdeckung auf, die im Start-Bereich noch zu sind (Starfront-Sequenz 08.10.2026).
        var restore = target is not null && below.Count >= 3
            ? SeqNode.Flatten(target.ItemList.Where(n => !n.Disabled).TakeWhile(n => !ReferenceEquals(n, below[2]))).Select(n => n.Type)
            : [];
        if (Index("RunAutofocus") < 0 && !restore.Contains("RunAutofocus")) Add("start_autofocus_missing", afMissing);
        if (blocks is null)
            Add("blocks_container_missing", "NINA-PM Instructions belong in a container \"Blöcke\" (blocks) with NINA-PM Night Loop inside \"Ziel\" (target).");
        if (target is null || !target.HasCondition("NightLoopCondition"))
            Add("target_night_loop_missing", "Target container without condition NINA-PM Night Loop.");
        if (safety && target is not null && !target.HasCondition("SafetyMonitorCondition"))
            Add("loop_while_safe_missing", "Target container without Loop While Safe.");
        if (target is not null && blocks is not null)
        {
            var first = target.ItemList.FirstOrDefault(n => !n.Disabled);
            if (first is null || first.Type is not ("UnparkScope" or "SetTracking"))
                Add("restore_missing", "Target container does not start with the restore step (Unpark Scope or Set Tracking).");
        }

        // ---- Trigger (M7, NT-23) ----
        var triggers = active.SelectMany(n => n.TriggerList).Where(t => !t.Disabled).ToList();
        if (!triggers.Any(t => t.Type == "MeridianFlipTrigger")) Add("flip_trigger_missing", "Trigger Meridian Flip missing.");
        var afTime = triggers.FirstOrDefault(t => t.Type == "AutofocusAfterTimeTrigger");
        if (afTime is null) Add("af_time_trigger_missing", "Trigger Autofocus After Time missing (the server then plans without autofocus, M7).");
        else if (afEveryMin is { } every && double.TryParse(afTime.Prop("Amount"), NumberStyles.Float, CultureInfo.InvariantCulture, out var amount)
            && Math.Abs(amount - every) > 0.5)
            Add("af_time_mismatch", $"Autofocus After Time: {amount:0} min, the rig plans with {every:0} min.");
        if (triggers.Any(t => t.Type.Contains("Dither", StringComparison.OrdinalIgnoreCase)))
            Add("dither_trigger_present", "Dither trigger in the sequence – the plan controls dithering (NT-23).");

        // ---- Sicherung (H2) ----
        if (active.Any(n => n.Type == "WaitUntilSafe"))
            Add("wait_until_safe_used", "Wait until Safe waits without a deadline – use NINA-PM Wait until Safe or Night End (H2).");
        if (safety)
        {
            var secure = active.FirstOrDefault(n => n.HasCondition("LoopWhileUnsafe"));
            if (secure is null)
            {
                Add("secure_container_missing", "Secure container with Loop While Unsafe missing.");
            }
            else
            {
                if (!secure.HasCondition("NightLoopCondition"))
                    Add("secure_night_loop_missing", "Secure container without NINA-PM Night Loop.");
                var items = secure.ItemList.Where(n => !n.Disabled).ToList();
                if (items.Count == 0 || items[^1].Type != "SafetyWaitInstruction")
                    Add("safety_wait_not_last", "NINA-PM Wait until Safe or Night End must be the last instruction of the secure container.");
                if (!items.Any(n => n.Type is "ParkScope" or "FindHome"))
                    Add("secure_park_missing", "Secure container: Park Scope or Find Home missing.");
            }
        }

        // ---- Ende ----
        var end = SeqNode.Flatten(root.ItemList.FirstOrDefault(n => n.Type == "EndAreaContainer")?.ItemList ?? []).Select(n => n.Type).ToList();
        if (day is not null && nightAt >= 0) end = [.. SeqNode.Flatten(dayItems.Skip(nightAt + 1)).Select(n => n.Type), .. end];
        if (!end.Contains("ParkScope") && !end.Contains("FindHome")) Add("end_secure_missing", "End: Park Scope or Find Home missing.");
        if (!end.Contains("WarmCamera")) Add("end_warm_missing", "End: Warm Camera missing.");
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
