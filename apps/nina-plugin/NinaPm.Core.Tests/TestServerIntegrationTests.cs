using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// ApiClient gegen <c>tools/nina-test-server</c> (AP-16a, Szenario <c>one-night</c>): der Server prüft jede Anfrage
/// mit den zod-Verträgen aus <c>packages/shared</c> – weicht die Serialisierung des generierten Clients vom Vertrag
/// ab, antwortet er <c>422 validation.failed</c>. Läuft nur mit <c>NINA_TEST_SERVER_URL</c> (z. B.
/// <c>http://127.0.0.1:8787/api</c>); im CI startet <c>plugin.yml</c> den Server dafür, lokal:
/// <c>pnpm nina-test-server --scenario one-night</c>.
/// </summary>
[Trait("Category", "TestServer")]
public sealed class TestServerIntegrationTests
{
    private static readonly string? Url = Environment.GetEnvironmentVariable("NINA_TEST_SERVER_URL");

    private static NinaApi Api(string token = "npm_test") => new(new Uri(Url!), token, "0.1.0");

    private static T Example<T>(string name) =>
        JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    [Fact]
    public async Task Verbindung_testen_erkennt_den_Test_Server()
    {
        if (Url is null) return;
        var sink = new ListSink();
        using var api = Api();

        var r = await api.TestConnectionAsync(new NinaPmLog(sink), (31.5471, -99.3823), CancellationToken.None);

        Assert.True(r.Ok);
        Assert.True(r.TestServer);
        Assert.Equal("Test-Server", r.TenantName);
        Assert.Equal("Test-Rig", r.RigName);
        Assert.Equal("Starfront (Test)", r.SiteName);
        Assert.True(r.SiteDistanceKm < 0.1);
        Assert.Equal(["I NINA-PM | API status=200 call=bootstrap"], sink.Lines);
    }

    [Fact]
    public async Task Falsches_Token_ergibt_401_nina_token_invalid()
    {
        if (Url is null) return;
        var sink = new ListSink();
        using var api = Api("npm_falsch");

        var r = await api.TestConnectionAsync(new NinaPmLog(sink), null, CancellationToken.None);

        Assert.False(r.Ok);
        Assert.Equal(401, r.Status);
        Assert.Equal("nina.token_invalid", r.Code);
    }

    [Fact]
    public async Task Nacht_mit_Plan_Session_Meldungen_und_Heartbeat_besteht_die_Vertraege()
    {
        if (Url is null) return;
        using var api = Api();
        var client = api.Client;

        var bootstrap = await client.ApiNinaV1BootstrapAsync();
        var now = bootstrap.ServerTimeUtc;
        var night = bootstrap.Nights.First(n => n.NoonStartUtc <= now && now < n.NoonEndUtc).Night;
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", night);

        var targets = await client.ApiNinaV1TargetsAsync(null);
        Assert.Equal(2, targets.Projects.Count);

        var planRequest = Example<NinaPlanRequest>("plan.request");
        planRequest.Night = night;
        planRequest.StartAtUtc = null;
        var plan = await client.ApiNinaV1PlanAsync(planRequest);
        Assert.Equal(night, plan.Night);
        Assert.Equal(2, plan.Blocks.Count);

        var create = Example<NinaSessionCreate>("session.create.request");
        create.Id = Guid.NewGuid();
        create.Night = night;
        create.NightPlanId = plan.NightPlanId;
        var created = await client.ApiNinaV1SessionsPostAsync(create);
        Assert.Equal(create.Id, created.SessionId);
        Assert.NotNull(created.Lease.UntilUtc);

        var captures = Example<NinaCaptureBatch>("captures.request");
        foreach (var c in captures.Captures) c.Id = Guid.NewGuid();
        var first = await client.ApiNinaV1SessionsCapturesAsync(create.Id, captures);
        var again = await client.ApiNinaV1SessionsCapturesAsync(create.Id, captures);
        Assert.All(first.Results, r => Assert.Equal(ResultsStatus.Accepted, r.Status));
        Assert.All(again.Results, r => Assert.Equal(ResultsStatus.Duplicate, r.Status));

        var events = Example<NinaEventBatch>("events.request");
        foreach (var e in events.Events) e.Id = Guid.NewGuid();
        var accepted = await client.ApiNinaV1SessionsEventsAsync(create.Id, events);
        Assert.Equal(events.Events.Count, accepted.Accepted);

        var heartbeat = Example<NinaHeartbeat>("heartbeat.request");
        heartbeat.SessionId = create.Id;
        var hb = await client.ApiNinaV1HeartbeatAsync(heartbeat);
        Assert.False(hb.Lease!.LeaseLost);
        Assert.True(api.LastResponseWasTestServer);

        // targetsEtag aus dem Heartbeat → unveränderte Ziele: 304 (NIN-6, AP-16b fragt so ab).
        var notModified = await Assert.ThrowsAsync<NinaApiException>(() => client.ApiNinaV1TargetsAsync(hb.TargetsEtag));
        Assert.Equal(304, notModified.StatusCode);

        var patch = Example<NinaSessionPatch>("session.patch.request");
        patch.OutboxPending = 0;
        var done = await client.ApiNinaV1SessionsPatchAsync(create.Id, patch);
        Assert.Equal(NinaSessionPatchedStatus.Completed, done.Status);
    }
}
