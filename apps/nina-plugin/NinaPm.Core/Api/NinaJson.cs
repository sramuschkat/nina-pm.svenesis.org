using System.Globalization;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

namespace NinaPm.Core.Api
{
    /// <summary>
    /// JSON der NINA-API (NT-05): Zeitpunkte in UTC mit <c>Z</c>, Nacht-Schlüssel bleiben Zeichenketten. Newtonsoft
    /// würde <c>"2026-09-17"</c> beim Lesen sonst als Datum deuten (<c>DateParseHandling</c>) und Zeitpunkte mit
    /// <c>+00:00</c> schreiben – beides schließt diese Einstellung aus.
    /// <para>
    /// Pflichtfelder, die <c>null</c> sein dürfen (<c>gain</c>, <c>offset</c>, <c>readoutMode</c>,
    /// <c>sequenceTriggers.autofocusAfterTimeMin</c> …), müssen im JSON stehen: der Client wird dafür mit
    /// <c>requiredPropertiesMustBeDefined</c> erzeugt (vorher fehlten sie, der Server antwortete <c>422</c> – gefunden
    /// im kopflosen Nachtlauf). Gelesen wird trotzdem nachsichtig (<see cref="LenientRequired"/>): die OpenAPI fasst die
    /// Zeilen von Deep-Sky- und Exoplaneten-Projekten zu einem Schema zusammen, Exoplaneten-Zeilen haben kein
    /// <c>order</c>/<c>enabled</c>/<c>counts</c>.
    /// </para>
    /// </summary>
    public static class NinaJson
    {
        private static readonly LenientRequired Resolver = new();

        /// <summary>
        /// <c>Required</c> der erzeugten Klassen nicht erzwingen (weder beim Lesen noch beim Schreiben); welche Felder
        /// <c>null</c> mitschreiben, bestimmt weiter <c>NullValueHandling</c> je Feld.
        /// </summary>
        private sealed class LenientRequired : DefaultContractResolver
        {
            protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization)
            {
                var property = base.CreateProperty(member, memberSerialization);
                property.Required = Required.Default;
                return property;
            }
        }

        public static void Configure(JsonSerializerSettings settings)
        {
            settings.ContractResolver = Resolver;
            settings.DateParseHandling = DateParseHandling.None;
            settings.DateTimeZoneHandling = DateTimeZoneHandling.Utc;
            settings.Converters.Add(new IsoDateTimeConverter
            {
                DateTimeFormat = "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'",
                DateTimeStyles = DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                Culture = CultureInfo.InvariantCulture,
            });
        }

        public static JsonSerializerSettings Settings()
        {
            var settings = new JsonSerializerSettings();
            Configure(settings);
            return settings;
        }
    }
}

namespace NinaPm.Core.Api.Generated
{
    public partial class NinaApiClient
    {
        static partial void UpdateJsonSerializerSettings(JsonSerializerSettings settings) =>
            NinaPm.Core.Api.NinaJson.Configure(settings);

        /// <summary>ETag der letzten Antwort (<c>GET /targets</c>, NT-19); NSwag reicht Kopfzeilen sonst nicht durch.</summary>
        public string? LastEtag { get; private set; }

        partial void ProcessResponse(System.Net.Http.HttpClient client, System.Net.Http.HttpResponseMessage response) =>
            LastEtag = response.Headers.ETag?.ToString();
    }
}
