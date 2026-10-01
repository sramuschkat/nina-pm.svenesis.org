using System.Net;
using System.Text;
using NinaPm.Core.Api;
using NinaPm.Core.Logging;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// *Verbindung testen* gegen eine Attrappe (P-04): Kopfzeilen, Anzeige Mandant/Rig/Standort, falsches Token →
/// <c>API status=401</c>, Testbetrieb nur mit <c>X-NPM-Test: 1</c>. Das Token erscheint in keiner Log-Zeile (SV-08).
/// </summary>
public sealed class NinaApiTests
{
    private const string Token = "npm_test";

    [Fact]
    public async Task Erfolg_zeigt_Mandant_Rig_und_Standortabstand()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, ContractExamples.Json("bootstrap.response"), test: true));
        var sink = new ListSink();
        using var api = new NinaApi(new Uri("http://localhost:8787/api"), Token, "0.1.0", handler);

        var r = await api.TestConnectionAsync(new NinaPmLog(sink), (31.5471, -99.3823), CancellationToken.None);

        Assert.True(r.Ok);
        Assert.NotNull(r.TenantName);
        Assert.NotNull(r.RigName);
        Assert.True(r.SiteDistanceKm < 0.1);
        Assert.True(r.TestServer);
        var req = Assert.Single(handler.Requests);
        Assert.Equal("http://localhost:8787/api/nina/v1/bootstrap", req.RequestUri!.ToString());
        Assert.Equal("Bearer npm_test", req.Headers.Authorization!.ToString());
        Assert.Equal("0.1.0", req.Headers.GetValues(NinaApi.PluginVersionHeader).Single());
        Assert.Matches(@"^\d+\.\d+\.\d+", req.Headers.GetValues(NinaApi.EngineVersionHeader).Single());
        Assert.Equal(["I NINA-PM | API status=200 call=bootstrap"], sink.Lines);
    }

    [Fact]
    public async Task Falsches_Token_ergibt_401_und_Code_ohne_Token_im_Log()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.Unauthorized,
            """{"type":"about:blank","title":"Token ungültig","status":401,"code":"nina.token_invalid"}""", problem: true));
        var sink = new ListSink();
        using var api = new NinaApi(new Uri("http://localhost:8787/api"), Token, "0.1.0", handler);

        var r = await api.TestConnectionAsync(new NinaPmLog(sink), null, CancellationToken.None);

        Assert.False(r.Ok);
        Assert.True(r.TokenInvalid);
        Assert.Equal("nina.token_invalid", r.Code);
        Assert.Equal(["W NINA-PM | API status=401 code=nina.token_invalid call=bootstrap"], sink.Lines);
        Assert.DoesNotContain(sink.Lines, l => l.Contains(Token, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Prod_ohne_Testkopf_ist_kein_Testserver()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, ContractExamples.Json("bootstrap.response"), test: false));
        using var api = new NinaApi(new Uri("https://nina-pm.svenesis.org/api"), Token, "0.1.0", handler);
        var r = await api.TestConnectionAsync(new NinaPmLog(new ListSink()), null, CancellationToken.None);
        Assert.True(r.Ok);
        Assert.False(r.TestServer);
        Assert.Null(r.SiteDistanceKm);
        Assert.Equal("https://nina-pm.svenesis.org/api/nina/v1/bootstrap", handler.Requests.Single().RequestUri!.ToString());
    }

    [Fact]
    public async Task Netzfehler_ergibt_Status_0()
    {
        var handler = new StubHandler(_ => throw new HttpRequestException("Verbindung abgelehnt"));
        var sink = new ListSink();
        using var api = new NinaApi(new Uri("http://localhost:1/api"), Token, "0.1.0", handler);
        var r = await api.TestConnectionAsync(new NinaPmLog(sink), null, CancellationToken.None);
        Assert.Equal(0, r.Status);
        Assert.Equal("network", r.Code);
        Assert.Contains("W NINA-PM | API status=0 code=network call=bootstrap", sink.Lines);
    }

    [Theory]
    [InlineData("""{"code":"tenant.locked"}""", "tenant.locked")]
    [InlineData("kein json", null)]
    [InlineData("", null)]
    public void ProblemCode(string body, string? code) => Assert.Equal(code, NinaApi.ProblemCode(body));

    private static HttpResponseMessage Json(HttpStatusCode status, string body, bool test = false, bool problem = false)
    {
        var response = new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, problem ? "application/problem+json" : "application/json"),
        };
        if (test) response.Headers.Add(NinaApi.TestHeader, "1");
        return response;
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(respond(request));
        }
    }
}
