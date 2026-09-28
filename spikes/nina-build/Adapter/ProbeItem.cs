using System;
using System.ComponentModel.Composition;
using System.Threading;
using System.Threading.Tasks;
using NINA.Core.Model;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Sequencer.SequenceItem;
using NINA.WPF.Base.Interfaces.Mediator;
using NinaBuild.Core;
using Newtonsoft.Json;

namespace NinaBuild.Adapter;

/// <summary>
/// Sequenz-Element gegen die NINA-Typen aus NuGet: Erbe von <see cref="SequenceItem"/>, Filterrad-Mediator aus
/// NINA.Equipment, Status-Mediator aus NINA.WPF.Base (dessen Signaturen WPF-Typen tragen).
/// </summary>
[ExportMetadata("Name", "NINA-PM Build-Probe")]
[ExportMetadata("Description", "AP-S2c")]
[ExportMetadata("Icon", "")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceItem))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class ProbeItem : SequenceItem
{
    private readonly IFilterWheelMediator filterWheel;
    private readonly IApplicationStatusMediator status;

    [ImportingConstructor]
    public ProbeItem(IFilterWheelMediator filterWheel, IApplicationStatusMediator status)
    {
        this.filterWheel = filterWheel;
        this.status = status;
    }

    public override object Clone() => new ProbeItem(filterWheel, status);

    public override Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var position = filterWheel.GetInfo().SelectedFilter?.Position ?? 0;
        var slot = FilterSlots.FromNina(position);
        status.StatusUpdate(new ApplicationStatus { Source = "NINA-PM", Status = $"Platz {slot}" });
        return Task.CompletedTask;
    }
}
