using Microsoft.Data.Sqlite;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>LocalStore (execution.md §8): Migration, Tabellen, Zeitpunkte als ISO-UTC-Strings.</summary>
public sealed class LocalStoreTests : IDisposable
{
    private readonly string dir = Directory.CreateTempSubdirectory("ninapm-store-").FullName;
    private readonly FixedClock clock = new(new DateTimeOffset(2026, 9, 18, 1, 13, 5, TimeSpan.Zero));

    private string DbPath => Path.Combine(dir, "sub", "ninapm.db");

    [Fact]
    public void Neue_Datei_bekommt_alle_Tabellen_und_die_neueste_Version()
    {
        using var store = LocalStore.Open(DbPath, clock);
        Assert.Equal(LocalStore.LatestVersion, store.SchemaVersion);
        Assert.Equal(
            ["cache", "dark_flat_group_local", "dead_letter", "flat_combination_local", "flat_light_local", "outbox", "sent_history", "state"],
            store.TableNames());
    }

    [Fact]
    public void Erneutes_Oeffnen_migriert_nicht_doppelt_und_behaelt_Daten()
    {
        using (var store = LocalStore.Open(DbPath, clock)) store.SetState(StateKeys.Night, "2026-09-17");
        using var again = LocalStore.Open(DbPath, clock);
        Assert.Equal(LocalStore.LatestVersion, again.SchemaVersion);
        Assert.Equal("2026-09-17", again.GetState(StateKeys.Night));
    }

    [Fact]
    public void Aeltere_Datei_ohne_Schema_wird_nachgezogen()
    {
        // Version 0: Datei existiert, aber ohne Tabellen (z. B. abgebrochene Erstanlage).
        Directory.CreateDirectory(Path.GetDirectoryName(DbPath)!);
        using (var raw = new SqliteConnection($"Data Source={DbPath};Pooling=False"))
        {
            raw.Open();
            using var cmd = raw.CreateCommand();
            cmd.CommandText = "CREATE TABLE foreign_table (x INTEGER)";
            cmd.ExecuteNonQuery();
        }
        using var store = LocalStore.Open(DbPath, clock);
        Assert.Equal(LocalStore.LatestVersion, store.SchemaVersion);
        Assert.Contains("outbox", store.TableNames());
    }

    [Fact]
    public void Neuere_Datei_als_das_Plugin_bricht_ab()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(DbPath)!);
        using (var raw = new SqliteConnection($"Data Source={DbPath};Pooling=False"))
        {
            raw.Open();
            using var cmd = raw.CreateCommand();
            cmd.CommandText = $"PRAGMA user_version = {LocalStore.LatestVersion + 1}";
            cmd.ExecuteNonQuery();
        }
        var ex = Assert.Throws<InvalidOperationException>(() => LocalStore.Open(DbPath, clock));
        Assert.Contains("schema version", ex.Message);
    }

    [Fact]
    public void State_und_Cache_speichern_Zeitpunkte_als_ISO_UTC_mit_Z()
    {
        using var store = LocalStore.Open(DbPath, clock);
        store.SetState(StateKeys.SessionId, "0192a1b2-0000-7000-8000-000000000001");
        store.PutCache("bootstrap", "{\"a\":1}", "\"etag-1\"");
        clock.Advance(TimeSpan.FromMinutes(5));
        store.PutCache("bootstrap", "{\"a\":2}", "\"etag-2\"");

        Assert.Equal("2026-09-18T01:13:05.000Z", store.Scalar("SELECT updated_utc FROM state WHERE key = 'sessionId'"));
        Assert.Equal("2026-09-18T01:18:05.000Z", store.Scalar("SELECT updated_utc FROM cache WHERE key = 'bootstrap'"));
        var cached = store.GetCache("bootstrap");
        Assert.NotNull(cached);
        Assert.Equal("{\"a\":2}", cached.Value);
        Assert.Equal("\"etag-2\"", cached.Etag);
        Assert.Equal(TimeSpan.Zero, cached.UpdatedUtc.Offset);
        Assert.Null(store.GetCache("targets"));

        store.SetState(StateKeys.SessionId, null);
        Assert.Null(store.GetState(StateKeys.SessionId));
    }

    public void Dispose() => Directory.Delete(dir, recursive: true);
}
