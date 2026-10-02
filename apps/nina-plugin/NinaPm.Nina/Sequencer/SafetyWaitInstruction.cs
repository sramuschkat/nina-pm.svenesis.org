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
/// schließt es die Nacht ohne Wiederaufnahme ab (<c>PATCH completed</c>, Nachtschleife falsch). Ohne verbundenen
/// Monitor kein Warten.
/// </summary>
[ExportMetadata("Name", "NINA-PM Wait until Safe or Night End")]
[ExportMetadata("Description", "Waits until the safety monitor reports safe, at most until the night end; then closes the NINA-PM night.")]
[ExportMetadata("Icon", "ShieldSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceItem))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class SafetyWaitInstruction : SequenceItem
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(10);
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
        while (true)
        {
            var runtime = NinaPmRuntime.Current;
            var info = safetyMonitor.GetInfo();
            var nightEnd = runtime?.Runner.NightEndUtc() ?? DateTimeOffset.MaxValue;
            switch (Interruption.SafetyWaitStep(clock.UtcNow, nightEnd, info.Connected, info.IsSafe))
            {
                case SafetyWaitResult.NotConnected:
                    runtime?.Log.Warning("WARNING", ("code", "safety_monitor_not_connected"));
                    return;
                case SafetyWaitResult.Safe:
                    return;
                case SafetyWaitResult.CloseNight:
                    if (runtime is not null) await runtime.Runner.CloseNightUnsafeAsync(token);
                    return;
                default:
                    progress?.Report(new ApplicationStatus { Source = "NINA-PM", Status = "Waiting until safe or night end" });
                    await Task.Delay(Tick, token);
                    break;
            }
        }
    }

    public override string ToString() => "NINA-PM Wait until Safe or Night End";
}
