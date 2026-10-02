using System.ComponentModel.Composition;
using Newtonsoft.Json;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.Trigger;

namespace NinaPm.Nina.Sequencer;

// Portiert aus dem Astro-PM-NINA-Plugin (MIT), Instructions/AstroPMExposureTriggers.cs, Commit 5dd621d
// (AstroPMBeforeExposureTrigger/AstroPMAfterExposureTrigger); Hinweis in THIRD_PARTY_NOTICES.md.

/// <summary>
/// Trigger-Set <em>NINA-PM vor jeder Belichtung</em> (FA-NIN-16, execution.md §1): eine frei befüllbare Anweisungsbox,
/// die vor jeder Plugin-Belichtung läuft. Ausgelöst über den eigenen Trigger-Walk (§4.3): <c>nextItem</c> ist die
/// interne Belichtung. In NINAs normalem Ablauf ist <c>nextItem</c> nie eine Plugin-Belichtung – der Trigger feuert
/// dort nicht. Im Transit überspringt der Walk Boxen mit Autofokus (§5, AP-44).
/// </summary>
[ExportMetadata("Name", "NINA-PM Before Each Exposure")]
[ExportMetadata("Description", "Runs the contained instructions before each NINA-PM exposure")]
[ExportMetadata("Icon", "CameraSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceTrigger))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class BeforeExposureTrigger : SequenceTrigger
{
    [ImportingConstructor]
    public BeforeExposureTrigger()
    {
    }

    private BeforeExposureTrigger(BeforeExposureTrigger cloneMe) : this()
    {
        CopyMetaData(cloneMe);
        TriggerRunner = (SequentialContainer)cloneMe.TriggerRunner.Clone();
        TriggerRunner.AttachNewParent(Parent);
    }

    public override void AfterParentChanged()
    {
        base.AfterParentChanged();
        ExposureTriggerBox.Reattach(TriggerRunner, Parent);
    }

    public override bool ShouldTrigger(ISequenceItem previousItem, ISequenceItem nextItem) => nextItem is TakeExposureItem;

    public override bool ShouldTriggerAfter(ISequenceItem previousItem, ISequenceItem nextItem) => false;

    public override async Task Execute(ISequenceContainer context, IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        Logger.Info("NINA-PM: Trigger-Set vor der Belichtung");
        TriggerRunner.AttachNewParent(context);
        await TriggerRunner.Run(progress, token);
    }

    public override object Clone() => new BeforeExposureTrigger(this);

    public override string ToString() => "NINA-PM Before Each Exposure";
}

/// <summary>Trigger-Set <em>NINA-PM nach jeder Belichtung</em> (FA-NIN-16): wie <see cref="BeforeExposureTrigger"/>, nach der Belichtung.</summary>
[ExportMetadata("Name", "NINA-PM After Each Exposure")]
[ExportMetadata("Description", "Runs the contained instructions after each NINA-PM exposure")]
[ExportMetadata("Icon", "CameraSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceTrigger))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class AfterExposureTrigger : SequenceTrigger
{
    [ImportingConstructor]
    public AfterExposureTrigger()
    {
    }

    private AfterExposureTrigger(AfterExposureTrigger cloneMe) : this()
    {
        CopyMetaData(cloneMe);
        TriggerRunner = (SequentialContainer)cloneMe.TriggerRunner.Clone();
        TriggerRunner.AttachNewParent(Parent);
    }

    public override void AfterParentChanged()
    {
        base.AfterParentChanged();
        ExposureTriggerBox.Reattach(TriggerRunner, Parent);
    }

    public override bool ShouldTrigger(ISequenceItem previousItem, ISequenceItem nextItem) => false;

    public override bool ShouldTriggerAfter(ISequenceItem previousItem, ISequenceItem nextItem) => previousItem is TakeExposureItem;

    public override async Task Execute(ISequenceContainer context, IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        Logger.Info("NINA-PM: Trigger-Set nach der Belichtung");
        TriggerRunner.AttachNewParent(context);
        await TriggerRunner.Run(progress, token);
    }

    public override object Clone() => new AfterExposureTrigger(this);

    public override string ToString() => "NINA-PM After Each Exposure";
}

/// <summary>Anweisungsbox nach einem Elternwechsel neu verankern (wie das Original).</summary>
internal static class ExposureTriggerBox
{
    public static void Reattach(SequentialContainer runner, ISequenceContainer? parent)
    {
        foreach (var item in runner.Items)
            if (item.Parent is null) item.AttachNewParent(runner);
        runner.AttachNewParent(parent);
        foreach (var item in runner.Items)
            item.AfterParentChanged();
    }
}
