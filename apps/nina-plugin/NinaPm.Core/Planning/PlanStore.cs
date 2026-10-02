using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Storage;

namespace NinaPm.Core.Planning;

/// <summary>Gespeicherter Server-Plan mit dem Stand, nach dem er gebaut wurde (ETag, <c>settingsVersion</c>).</summary>
public sealed record StoredPlan(
    [property: JsonProperty("night")] string Night,
    [property: JsonProperty("targetsEtag")] string? TargetsEtag,
    [property: JsonProperty("settingsVersion")] int SettingsVersion,
    [property: JsonProperty("plan")] NinaPlanResponse Plan);

/// <summary>
/// Gespeicherter Plan (execution.md §8, Entscheidung Sven 01.10.2026): jeder Server-Plan liegt mit seiner Nacht in
/// <c>cache.plan</c> von <c>ninapm.db</c>. Ohne Verbindung und nach einem Neustart arbeitet das Plugin ihn weiter ab;
/// er gilt nur für seine eigene Nacht (<c>night</c> = <c>currentNight</c>). Das Plugin plant nie selbst.
/// </summary>
public static class PlanStore
{
    public const string CacheKey = "plan";

    public static void Save(LocalStore store, StoredPlan plan)
    {
        store.PutCache(CacheKey, JsonConvert.SerializeObject(plan, NinaJson.Settings()), plan.TargetsEtag);
        store.SetState(StateKeys.NightPlanId, plan.Plan.NightPlanId.ToString());
        store.SetState(StateKeys.Night, plan.Night);
    }

    /// <summary>Gespeicherter Plan der Nacht <paramref name="night"/>; ein Plan einer anderen Nacht zählt nicht.</summary>
    public static StoredPlan? Load(LocalStore store, string night)
    {
        var entry = store.GetCache(CacheKey);
        if (entry is null) return null;
        var plan = JsonConvert.DeserializeObject<StoredPlan>(entry.Value, NinaJson.Settings());
        return plan?.Night == night ? plan : null;
    }

    /// <summary>
    /// Blockindex nach der Uhr (NT-18): erster Block mit <c>endUtc &gt; now</c>, ab dem der gespeicherte Plan nach einem
    /// Neustart oder Ausfall weiterläuft; -1, wenn alle Blöcke vorbei sind.
    /// </summary>
    public static int ResumeIndex(StoredPlan plan, DateTimeOffset now) => ReplanPolicy.NextBlockIndex(plan.Plan.Blocks, now);
}
