using System.ComponentModel.Composition;
using Newtonsoft.Json;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.Trigger;

namespace NinaPm.Nina.Sequencer;

// Portiert aus dem Astro-PM-NINA-Plugin (MIT), Instructions/AstroPMExposureTriggers.cs, Commit 5dd621d
// (AstroPMBeforeTargetTrigger/AstroPMAfterTargetTrigger); Hinweis in THIRD_PARTY_NOTICES.md.

/// <summary>
/// Trigger-Set <em>NINA-PM vor Zielwechsel</em> (FA-NIN-16, execution.md §4.1 Nr. 6): frei befüllbare Anweisungsbox,
/// die je Block nach Slew/Zentrieren/Rotieren und vor dem Guiding läuft. NINA löst sie nie selbst aus
/// (<c>ShouldTrigger</c> immer falsch); der Container ruft <see cref="FireAsync"/> über den Vorfahren-Walk auf, auch aus
/// den globalen Triggern. Koordinatenabhängige Anweisungen darin erhalten das aktuelle Ziel (<see cref="CoordinatesInjector"/>).
/// </summary>
[ExportMetadata("Name", "NINA-PM Before Target Change")]
[ExportMetadata("Description", "Runs the contained instructions on each new NINA-PM target, after slew and centering, before guiding")]
[ExportMetadata("Icon", "SlewToRaDecSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceTrigger))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class BeforeTargetChangeTrigger : SequenceTrigger
{
    [ImportingConstructor]
    public BeforeTargetChangeTrigger()
    {
    }

    private BeforeTargetChangeTrigger(BeforeTargetChangeTrigger cloneMe) : this()
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

    public override bool ShouldTriggerAfter(ISequenceItem previousItem, ISequenceItem nextItem) => false;

    internal Task FireAsync(IProgress<ApplicationStatus> progress, CancellationToken token) =>
        TargetChangeBox.FireAsync(TriggerRunner, Parent, "vor dem Zielwechsel", progress, token);

    public override Task Execute(ISequenceContainer context, IProgress<ApplicationStatus> progress, CancellationToken token) => Task.CompletedTask;

    public override object Clone() => new BeforeTargetChangeTrigger(this);

    public override string ToString() => "NINA-PM Before Target Change";
}

/// <summary>Trigger-Set <em>NINA-PM nach Zielwechsel</em> (FA-NIN-16, §4.1 Nr. 7): wie <see cref="BeforeTargetChangeTrigger"/>, nach dem Block.</summary>
[ExportMetadata("Name", "NINA-PM After Target Change")]
[ExportMetadata("Description", "Runs the contained instructions after each NINA-PM target block")]
[ExportMetadata("Icon", "SlewToRaDecSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceTrigger))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class AfterTargetChangeTrigger : SequenceTrigger
{
    [ImportingConstructor]
    public AfterTargetChangeTrigger()
    {
    }

    private AfterTargetChangeTrigger(AfterTargetChangeTrigger cloneMe) : this()
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

    public override bool ShouldTriggerAfter(ISequenceItem previousItem, ISequenceItem nextItem) => false;

    internal Task FireAsync(IProgress<ApplicationStatus> progress, CancellationToken token) =>
        TargetChangeBox.FireAsync(TriggerRunner, Parent, "nach dem Zielwechsel", progress, token);

    public override Task Execute(ISequenceContainer context, IProgress<ApplicationStatus> progress, CancellationToken token) => Task.CompletedTask;

    public override object Clone() => new AfterTargetChangeTrigger(this);

    public override string ToString() => "NINA-PM After Target Change";
}

internal static class TargetChangeBox
{
    /// <summary>
    /// Box ausführen, falls befüllt: an den Elterncontainer hängen und den Fortschritt zurücksetzen – <c>Run</c> direkt
    /// (nicht über NINAs <c>SequenceTrigger.Run</c>) setzt ihn sonst nicht zurück, und ab dem zweiten Block liefe nichts.
    /// </summary>
    public static async Task FireAsync(SequentialContainer runner, ISequenceContainer? parent, string what,
        IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        if (runner.GetItemsSnapshot().Count == 0) return;
        Logger.Info($"NINA-PM: Trigger-Set {what}");
        if (parent is not null) runner.AttachNewParent(parent);
        runner.ResetProgress();
        await runner.Run(progress, token);
    }
}
