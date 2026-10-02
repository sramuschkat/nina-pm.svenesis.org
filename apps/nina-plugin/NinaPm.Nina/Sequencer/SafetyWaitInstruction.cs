using System.ComponentModel.Composition;
using Newtonsoft.Json;
using NINA.Core.Model;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Sequencer.SequenceItem;
using NinaPm.Core.Execution;
using NinaPm.Core.Time;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// <em>NINA-PM Warten bis sicher oder Nachtende</em> (execution.md §1, §4.6, H2): ersetzt im Sicherungscontainer NINAs
/// <em>Wait until Safe</em>, das ohne Frist wartet. Wartet im 10-s-Takt, bis der Safety-Monitor verbunden und sicher ist
/// oder das Nachtende (<c>darknessEndUtc ?? sessionEndUtc</c>, ohne Plan das Nachtfensterende) erreicht ist; am Nachtende
/// schließt es die Nacht ohne Wiederaufnahme ab (<c>PATCH completed</c>, Nachtschleife falsch). Ein getrennter Monitor
/// zählt wie unsicher (Warnung <c>safety_monitor_not_connected</c> einmal je Wartephase) – sonst parkte und entparkte
/// NINA im Takt, weil <em>Loop While Unsafe</em> den getrennten Monitor für unsicher hält (P-25-Lauf 02.10.2026). Ohne
/// eingerichtetes NINA-PM (keine Laufzeit, kein Nachtende bekannt) kein Warten.
/// </summary>
[ExportMetadata("Name", "NINA-PM Wait until Safe or Night End")]
[ExportMetadata("Description", "Waits until the safety monitor reports safe, at most until the night end; then closes the NINA-PM night.")]
[ExportMetadata("Icon", "ShieldSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceItem))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class SafetyWaitInstruction : SequenceItem
{
    private readonly ISafetyMonitorMediator safetyMonitor;
    private readonly IClock clock = SystemClock.Instance;

    [ImportingConstructor]
    public SafetyWaitInstruction(ISafetyMonitorMediator safetyMonitor)
    {
        this.safetyMonitor = safetyMonitor;
    }

    public override object Clone()
    {
        var clone = new SafetyWaitInstruction(safetyMonitor);
        clone.CopyMetaData(this);
        return clone;
    }

    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var runtime = NinaPmRuntime.Current;
        // Ohne Laufzeit kein Nachtende – nicht unbefristet warten (die Nachtschleife hält dann ohnehin an).
        if (runtime is null) return;
        await SafetyWait.RunAsync(runtime.Runner, runtime.Log, clock,
            () =>
            {
                var info = safetyMonitor.GetInfo();
                return (info.Connected, info.IsSafe);
            },
            (tick, t) =>
            {
                progress?.Report(new ApplicationStatus { Source = "NINA-PM", Status = "Waiting until safe or night end" });
                return Task.Delay(tick, t);
            },
            token);
    }

    public override string ToString() => "NINA-PM Wait until Safe or Night End";
}
