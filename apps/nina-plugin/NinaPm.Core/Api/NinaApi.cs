using System.Net;
using System.Net.Http.Headers;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Options;
using NinaPm.Core.Time;

namespace NinaPm.Core.Api;

/// <summary>
/// Zugang zur NINA-API (TK 7.6): generierter Client (NSwag) plus Kopfzeilen <c>Authorization: Bearer npm_…</c>,
/// <c>X-NPM-Plugin-Version</c> und <c>X-NPM-Engine-Version</c>. Merkt sich, ob die Gegenstelle <c>X-NPM-Test: 1</c>
/// sendet (NIN-17). Das Token steht nur im Kopf der Anfrage, nie im Log (SV-08).
/// </summary>
public sealed class NinaApi : IDisposable
{
    public const string PluginVersionHeader = "X-NPM-Plugin-Version";
    public const string EngineVersionHeader = "X-NPM-Engine-Version";
    public const string TestHeader = "X-NPM-Test";

    private readonly HttpClient http;
    private readonly TestHeaderHandler testHeader;

    public NinaApi(Uri apiBase, string token, string pluginVersion, HttpMessageHandler? inner = null, TimeSpan? timeout = null)
    {
        testHeader = new TestHeaderHandler { InnerHandler = inner ?? new HttpClientHandler() };
        http = new HttpClient(testHeader) { Timeout = timeout ?? TimeSpan.FromSeconds(30) };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        http.DefaultRequestHeaders.Add(PluginVersionHeader, pluginVersion);
        http.DefaultRequestHeaders.Add(EngineVersionHeader, EngineVersionInfo.Version);
        // Antworttext lesen, damit Problem Details auch bei dokumentierten Fehlern (401, 403, 409) verfügbar sind.
        Client = new NinaApiClient(http) { BaseUrl = Origin(apiBase), ReadResponseAsString = true };
    }

    /// <summary>Generierter Client; Pfade beginnen mit <c>/api/nina/v1</c>.</summary>
    public NinaApiClient Client { get; }

    /// <summary>Hat die letzte Antwort <c>X-NPM-Test: 1</c> getragen? (Testbetrieb, NIN-17 Bedingung c)</summary>
    public bool LastResponseWasTestServer => testHeader.LastWasTest;

    /// <summary>
    /// Die Optionen nennen die API mit <c>/api</c> am Ende (<c>https://nina-pm.svenesis.org/api</c>,
    /// <c>http://localhost:8787/api</c>); die Pfade der OpenAPI tragen <c>/api</c> selbst.
    /// </summary>
    public static string Origin(Uri apiBase)
    {
        var text = apiBase.ToString().TrimEnd('/');
        return text.EndsWith("/api", StringComparison.OrdinalIgnoreCase) ? text[..^4] : text;
    }

    /// <summary>
    /// *Verbindung testen* (FA-NIN-01, P-04): <c>GET /bootstrap</c>, Ergebnis mit Mandant, Rig und Standort-Abgleich.
    /// Fehler werden zu Status und Code aus <c>errors.json</c>; Ereignis <c>API status=… code=…</c>.
    /// </summary>
    public async Task<ConnectionResult> TestConnectionAsync(NinaPmLog log, (double LatDeg, double LonDeg)? profileLocation, CancellationToken token)
    {
        try
        {
            var b = await Client.ApiNinaV1BootstrapAsync(token).ConfigureAwait(false);
            log.Event("API", ("status", 200), ("call", "bootstrap"));
            double? distanceKm = profileLocation is { } p
                ? Geo.DistanceKm(p.LatDeg, p.LonDeg, b.Rig.Site.LatDeg, b.Rig.Site.LonDeg)
                : null;
            return new ConnectionResult(
                Ok: true,
                Status: 200,
                Code: null,
                TenantName: b.Tenant.Name,
                InstanceName: b.Instance.Name,
                RigName: b.Rig.Name,
                SiteName: b.Rig.Site.Name,
                SiteDistanceKm: distanceKm,
                ServerTimeUtc: b.ServerTimeUtc,
                TestServer: LastResponseWasTestServer,
                Bootstrap: b);
        }
        catch (NinaApiException ex)
        {
            var code = ProblemCode(ex.Response);
            log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", "bootstrap"));
            return ConnectionResult.Failed(ex.StatusCode, code);
        }
        catch (HttpRequestException ex)
        {
            log.Warning("API", ("status", 0), ("code", "network"), ("call", "bootstrap"));
            log.Note($"Verbindung fehlgeschlagen: {ex.Message}");
            return ConnectionResult.Failed(0, "network");
        }
        catch (TaskCanceledException) when (!token.IsCancellationRequested)
        {
            log.Warning("API", ("status", 0), ("code", "timeout"), ("call", "bootstrap"));
            return ConnectionResult.Failed(0, "timeout");
        }
    }

    /// <summary>Code aus einer Problem-Details-Antwort (<c>application/problem+json</c>, rules/api.md).</summary>
    public static string? ProblemCode(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            return JObject.Parse(body).Value<string>("code");
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public void Dispose() => http.Dispose();

    private sealed class TestHeaderHandler : DelegatingHandler
    {
        public bool LastWasTest { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
            LastWasTest = response.Headers.TryGetValues(TestHeader, out var values) && values.Contains("1");
            return response;
        }
    }
}

/// <summary>Ergebnis von *Verbindung testen*; <see cref="Code"/> aus <c>errors.json</c> bzw. <c>network</c>/<c>timeout</c>.</summary>
public sealed record ConnectionResult(
    bool Ok,
    int Status,
    string? Code,
    string? TenantName,
    string? InstanceName,
    string? RigName,
    string? SiteName,
    double? SiteDistanceKm,
    DateTimeOffset? ServerTimeUtc,
    bool TestServer,
    NinaBootstrap? Bootstrap = null)
{
    public static ConnectionResult Failed(int status, string? code) =>
        new(false, status, code, null, null, null, null, null, null, false);

    /// <summary>Token widerrufen oder unbekannt (P-04: „ungültig“).</summary>
    public bool TokenInvalid => Status == (int)HttpStatusCode.Unauthorized;
}

/// <summary>Großkreisabstand für den Standort-Abgleich (FA-NIN-03: Warnung ab ~10 km).</summary>
public static class Geo
{
    public const double SiteWarnKm = 10;

    public static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double r = 6371.0;
        double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
