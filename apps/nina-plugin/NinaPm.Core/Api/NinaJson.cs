using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace NinaPm.Core.Api
{
    /// <summary>
    /// JSON der NINA-API (NT-05): Zeitpunkte in UTC mit <c>Z</c>, Nacht-Schlüssel bleiben Zeichenketten. Newtonsoft
    /// würde <c>"2026-09-17"</c> beim Lesen sonst als Datum deuten (<c>DateParseHandling</c>) und Zeitpunkte mit
    /// <c>+00:00</c> schreiben – beides schließt diese Einstellung aus.
    /// </summary>
    public static class NinaJson
    {
        public static void Configure(JsonSerializerSettings settings)
        {
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
    }
}
