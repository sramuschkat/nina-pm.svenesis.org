using System.Globalization;
using NINA.Core.Enum;
using NINA.Sequencer;
using NINA.Sequencer.Container;
using NinaPm.Core.Sequence;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// Laufende NINA-Sequenz → <see cref="SeqNode"/> für den <see cref="SequenceInspector"/> (execution.md §1, AP-16h):
/// vom Container über <c>Parent</c> bis zur Wurzel, dann Anweisungen, Bedingungen und Trigger über die Snapshots;
/// kurzer Typname wie in der Sequenzdatei (<c>$type</c>), <c>Amount</c>/<c>TrackingMode</c> per Reflection (Enums als
/// Zahl wie in der gespeicherten Datei), <c>DISABLED</c> → <see cref="SeqNode.Disabled"/>.
/// </summary>
internal static class SequenceTree
{
    private static readonly string[] PropKeys = ["Amount", "TrackingMode"];

    public static SeqNode? FromAncestors(ISequenceContainer? start)
    {
        if (start is null) return null;
        var root = start;
        while (root.Parent is not null) root = root.Parent;
        return Node(root);
    }

    public static SeqNode Node(ISequenceEntity e)
    {
        var props = new Dictionary<string, string>();
        foreach (var key in PropKeys)
        {
            var value = e.GetType().GetProperty(key)?.GetValue(e);
            if (value is not null)
                props[key] = value is Enum ? Convert.ToInt32(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture)
                    : Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
        }
        var disabled = e.Status == SequenceEntityStatus.DISABLED;
        return e is SequenceContainer c
            ? new SeqNode(e.GetType().Name, e.Name, [.. c.GetConditionsSnapshot().Select(Node)], [.. c.GetItemsSnapshot().Select(Node)],
                [.. c.GetTriggersSnapshot().Select(Node)], props, disabled)
            : new SeqNode(e.GetType().Name, e.Name, Props: props, Disabled: disabled);
    }
}
