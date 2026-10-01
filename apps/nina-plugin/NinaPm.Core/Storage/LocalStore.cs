using Microsoft.Data.Sqlite;
using NinaPm.Core.Time;

namespace NinaPm.Core.Storage;

/// <summary>
/// Der eine lokale Speicher des Plugins (execution.md §8, TK 10.2): SQLite <c>ninapm.db</c> mit den Tabellen
/// <c>cache</c>, <c>outbox</c>, <c>sent_history</c>, <c>dead_letter</c>, <c>flat_combination_local</c> und
/// <c>state</c>. Zeitpunkte als ISO-UTC-Strings mit <c>Z</c> (NT-05). Schema über <c>PRAGMA user_version</c> und
/// eine Liste nur anfügender Migrationen – eine ausgelieferte Migration wird nie geändert.
/// </summary>
public sealed class LocalStore : IDisposable
{
    /// <summary>Migrationen in Reihenfolge; Index + 1 = Schemaversion.</summary>
    internal static readonly string[] Migrations =
    [
        // 1 – AP-16a: Grundtabellen nach execution.md §8.
        """
        CREATE TABLE cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          etag TEXT,
          updated_utc TEXT NOT NULL
        );
        CREATE TABLE outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          night_plan_id TEXT,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_utc TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_utc TEXT NOT NULL
        );
        CREATE INDEX outbox_session ON outbox (session_id, id);
        CREATE TABLE sent_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          session_id TEXT,
          payload TEXT NOT NULL,
          sent_utc TEXT NOT NULL
        );
        CREATE INDEX sent_history_sent ON sent_history (sent_utc);
        CREATE TABLE dead_letter (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          session_id TEXT,
          payload TEXT NOT NULL,
          status INTEGER,
          code TEXT,
          reason TEXT NOT NULL,
          created_utc TEXT NOT NULL
        );
        CREATE TABLE flat_combination_local (
          night TEXT NOT NULL,
          combination TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          flats_taken INTEGER NOT NULL DEFAULT 0,
          dark_flats_taken INTEGER NOT NULL DEFAULT 0,
          updated_utc TEXT NOT NULL,
          PRIMARY KEY (night, combination)
        );
        CREATE TABLE state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_utc TEXT NOT NULL
        );
        """,
    ];

    public static int LatestVersion => Migrations.Length;

    private readonly SqliteConnection connection;
    private readonly IClock clock;

    private LocalStore(SqliteConnection connection, IClock clock)
    {
        this.connection = connection;
        this.clock = clock;
    }

    /// <summary><c>%LOCALAPPDATA%\NINA\Plugins\Svenesis.NinaPm\ninapm.db</c> (TK 10.2).</summary>
    public static string DefaultPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NINA", "Plugins", "Svenesis.NinaPm", "ninapm.db");

    /// <summary>Öffnet (und legt an) und bringt das Schema auf den neuesten Stand.</summary>
    public static LocalStore Open(string path, IClock clock)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString());
        connection.Open();
        var store = new LocalStore(connection, clock);
        try
        {
            store.Execute("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
            store.Migrate();
            return store;
        }
        catch
        {
            // Unter Windows bliebe die Datei sonst gesperrt (z. B. bei einer neueren Schemaversion).
            store.Dispose();
            throw;
        }
    }

    public int SchemaVersion => Convert.ToInt32(Scalar("PRAGMA user_version"));

    /// <summary>Wendet alle fehlenden Migrationen an, jede in einer eigenen Transaktion.</summary>
    public void Migrate()
    {
        var version = SchemaVersion;
        if (version > LatestVersion)
            throw new InvalidOperationException(
                $"ninapm.db hat Schemaversion {version}, dieses Plugin kennt höchstens {LatestVersion} – neueres Plugin installiert gewesen?");
        for (var v = version; v < LatestVersion; v++)
        {
            using var tx = connection.BeginTransaction();
            Execute(Migrations[v], tx);
            Execute($"PRAGMA user_version = {v + 1}", tx);
            tx.Commit();
        }
    }

    // ---- state ----------------------------------------------------------------------------------------

    public string? GetState(string key) =>
        Scalar("SELECT value FROM state WHERE key = $key", ("$key", key)) as string;

    public void SetState(string key, string? value)
    {
        if (value is null)
            Execute("DELETE FROM state WHERE key = $key", null, ("$key", key));
        else
            Execute(
                "INSERT INTO state (key, value, updated_utc) VALUES ($key, $value, $now) " +
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc",
                null, ("$key", key), ("$value", value), ("$now", UtcText.Format(clock.UtcNow)));
    }

    // ---- cache ----------------------------------------------------------------------------------------

    public CacheEntry? GetCache(string key)
    {
        using var cmd = Command("SELECT value, etag, updated_utc FROM cache WHERE key = $key", null, ("$key", key));
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new CacheEntry(r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1), UtcText.Parse(r.GetString(2)));
    }

    public void PutCache(string key, string value, string? etag) =>
        Execute(
            "INSERT INTO cache (key, value, etag, updated_utc) VALUES ($key, $value, $etag, $now) " +
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value, etag = excluded.etag, updated_utc = excluded.updated_utc",
            null, ("$key", key), ("$value", value), ("$etag", etag), ("$now", UtcText.Format(clock.UtcNow)));

    // ---- intern ---------------------------------------------------------------------------------------

    internal IReadOnlyList<string> TableNames()
    {
        using var cmd = Command("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
        using var r = cmd.ExecuteReader();
        var names = new List<string>();
        while (r.Read()) names.Add(r.GetString(0));
        return names;
    }

    internal object? Scalar(string sql, params (string Name, object? Value)[] parameters)
    {
        using var cmd = Command(sql, null, parameters);
        return cmd.ExecuteScalar();
    }

    private void Execute(string sql, SqliteTransaction? tx = null, params (string Name, object? Value)[] parameters)
    {
        using var cmd = Command(sql, tx, parameters);
        cmd.ExecuteNonQuery();
    }

    private SqliteCommand Command(string sql, SqliteTransaction? tx = null, params (string Name, object? Value)[] parameters)
    {
        var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = tx;
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    public void Dispose() => connection.Dispose();
}

/// <summary>Zwischengespeicherte Antwort (Bootstrap, Targets, letzter Plan) mit ETag und Zeitpunkt.</summary>
public sealed record CacheEntry(string Value, string? Etag, DateTimeOffset UpdatedUtc);

/// <summary>Schlüssel der Tabelle <c>state</c> (execution.md §8: Session, Plan, Blockindex, tonight).</summary>
public static class StateKeys
{
    public const string SessionId = "sessionId";
    public const string NightPlanId = "nightPlanId";
    public const string BlockIndex = "blockIndex";
    public const string Night = "night";
    public const string Tonight = "tonight";
}
