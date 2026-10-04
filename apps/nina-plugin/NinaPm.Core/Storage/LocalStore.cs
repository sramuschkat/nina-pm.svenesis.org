using Microsoft.Data.Sqlite;
using Newtonsoft.Json;
using NinaPm.Core.Flats;
using NinaPm.Core.Time;

namespace NinaPm.Core.Storage;

/// <summary>
/// Der eine lokale Speicher des Plugins (execution.md §8, TK 10.2): SQLite <c>ninapm.db</c> mit den Tabellen
/// <c>cache</c>, <c>outbox</c>, <c>sent_history</c>, <c>dead_letter</c>, <c>flat_combination_local</c>,
/// <c>flat_light_local</c>, <c>dark_flat_group_local</c> und <c>state</c>. Zeitpunkte als ISO-UTC-Strings mit <c>Z</c> (NT-05). Schema über <c>PRAGMA user_version</c> und
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
        // 2 – AP-50: gespeicherte Lights je Nacht (Kombinationsbildung am Nachtende) und Dark-Flat-Gruppen (NIN-15).
        """
        CREATE TABLE flat_light_local (
          night TEXT NOT NULL,
          key TEXT NOT NULL,
          payload TEXT NOT NULL,
          count INTEGER NOT NULL,
          first_seq INTEGER NOT NULL,
          PRIMARY KEY (night, key)
        );
        CREATE TABLE dark_flat_group_local (
          night TEXT NOT NULL,
          key TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          updated_utc TEXT NOT NULL,
          PRIMARY KEY (night, key)
        );
        """,
    ];

    public static int LatestVersion => Migrations.Length;

    private readonly SqliteConnection connection;
    private readonly IClock clock;

    /// <summary>
    /// Eine Verbindung für Sequenz und Heartbeat-Takt (AP-16e): <c>SqliteConnection</c> ist nicht threadsicher, jeder
    /// Zugriff läuft unter dieser Sperre (Transaktionen und Lesevorgänge als Ganzes; die Sperre ist wiedereintrittsfähig).
    /// </summary>
    private readonly object gate = new();

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
        lock (gate) MigrateLocked();
    }

    private void MigrateLocked()
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

    // ---- Flats (AP-50, execution.md §7) ----------------------------------------------------------------

    /// <summary>Gespeicherte Light-Aufnahme für die Flats der Nacht: Zähler je Kombination und Ziel, erste Reihenfolge bleibt.</summary>
    public void RecordFlatLight(string night, LightObservation light)
    {
        lock (gate)
        {
            using var tx = connection.BeginTransaction();
            using var existsCmd = Command("SELECT count FROM flat_light_local WHERE night = $night AND key = $key", tx,
                ("$night", night), ("$key", light.Key));
            if (existsCmd.ExecuteScalar() is null)
            {
                using var seqCmd = Command("SELECT COALESCE(MAX(first_seq), 0) + 1 FROM flat_light_local WHERE night = $night", tx, ("$night", night));
                var seq = Convert.ToInt64(seqCmd.ExecuteScalar());
                Execute("INSERT INTO flat_light_local (night, key, payload, count, first_seq) VALUES ($night, $key, $payload, $count, $seq)", tx,
                    ("$night", night), ("$key", light.Key), ("$payload", JsonConvert.SerializeObject(light with { FirstSeq = seq, Count = 0 })),
                    ("$count", light.Count), ("$seq", seq));
            }
            else
            {
                Execute("UPDATE flat_light_local SET count = count + $count WHERE night = $night AND key = $key", tx,
                    ("$night", night), ("$key", light.Key), ("$count", light.Count));
            }
            tx.Commit();
        }
    }

    public IReadOnlyList<LightObservation> FlatLights(string night)
    {
        lock (gate)
        {
            using var cmd = Command("SELECT payload, count, first_seq FROM flat_light_local WHERE night = $night ORDER BY first_seq", null, ("$night", night));
            using var r = cmd.ExecuteReader();
            var list = new List<LightObservation>();
            while (r.Read())
                list.Add(JsonConvert.DeserializeObject<LightObservation>(r.GetString(0))! with { Count = r.GetInt32(1), FirstSeq = r.GetInt64(2) });
            return list;
        }
    }

    public void SaveFlatCombination(string night, FlatCombination combination) =>
        Execute(
            "INSERT INTO flat_combination_local (night, combination, payload, status, flats_taken, dark_flats_taken, updated_utc) " +
            "VALUES ($night, $key, $payload, $status, $flats, $darks, $now) ON CONFLICT (night, combination) DO UPDATE SET " +
            "payload = excluded.payload, status = excluded.status, flats_taken = excluded.flats_taken, " +
            "dark_flats_taken = excluded.dark_flats_taken, updated_utc = excluded.updated_utc",
            null, ("$night", night), ("$key", combination.Key), ("$payload", JsonConvert.SerializeObject(combination)),
            ("$status", combination.Status.ToString().ToLowerInvariant()), ("$flats", combination.FlatsSaved),
            ("$darks", combination.DarkFlatsSaved), ("$now", UtcText.Format(clock.UtcNow)));

    public IReadOnlyList<FlatCombination> FlatCombinations(string night)
    {
        lock (gate)
        {
            using var cmd = Command("SELECT payload FROM flat_combination_local WHERE night = $night", null, ("$night", night));
            using var r = cmd.ExecuteReader();
            var list = new List<FlatCombination>();
            while (r.Read()) list.Add(JsonConvert.DeserializeObject<FlatCombination>(r.GetString(0))!);
            return list.OrderBy(c => c.Order).ToList();
        }
    }

    /// <summary>Nächte mit offenen Kombinationen außer <paramref name="exceptNight"/> (veraltete Session, §7).</summary>
    public IReadOnlyList<string> NightsWithOpenFlats(string? exceptNight)
    {
        lock (gate)
        {
            using var cmd = Command("SELECT DISTINCT night FROM flat_combination_local WHERE status IN ('pending', 'running') AND night <> $night ORDER BY night",
                null, ("$night", exceptNight ?? ""));
            using var r = cmd.ExecuteReader();
            var list = new List<string>();
            while (r.Read()) list.Add(r.GetString(0));
            return list;
        }
    }

    public void SaveDarkFlatGroup(string night, DarkFlatGroup group) =>
        Execute(
            "INSERT INTO dark_flat_group_local (night, key, payload, status, updated_utc) VALUES ($night, $key, $payload, $status, $now) " +
            "ON CONFLICT (night, key) DO UPDATE SET payload = excluded.payload, status = excluded.status, updated_utc = excluded.updated_utc",
            null, ("$night", night), ("$key", group.Key), ("$payload", JsonConvert.SerializeObject(group)),
            ("$status", group.Status.ToString().ToLowerInvariant()), ("$now", UtcText.Format(clock.UtcNow)));

    public IReadOnlyList<DarkFlatGroup> DarkFlatGroups(string night)
    {
        lock (gate)
        {
            using var cmd = Command("SELECT payload FROM dark_flat_group_local WHERE night = $night", null, ("$night", night));
            using var r = cmd.ExecuteReader();
            var list = new List<DarkFlatGroup>();
            while (r.Read()) list.Add(JsonConvert.DeserializeObject<DarkFlatGroup>(r.GetString(0))!);
            return list;
        }
    }

    // ---- cache ----------------------------------------------------------------------------------------

    public CacheEntry? GetCache(string key)
    {
        lock (gate) return GetCacheLocked(key);
    }

    private CacheEntry? GetCacheLocked(string key)
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

    // ---- outbox ---------------------------------------------------------------------------------------

    /// <summary>
    /// Meldung in die Outbox (FIFO je Session, execution.md §8). <paramref name="kind"/> aus <see cref="OutboxKinds"/>,
    /// <paramref name="payload"/> das JSON genau einer Meldung. Senden, Backoff und Dead-Letter folgen mit AP-16g.
    /// </summary>
    public long EnqueueOutbox(string kind, string payload, Guid? sessionId, Guid? nightPlanId)
    {
        var now = UtcText.Format(clock.UtcNow);
        return (long)Scalar(
            "INSERT INTO outbox (session_id, night_plan_id, kind, payload, created_utc, next_attempt_utc) " +
            "VALUES ($session, $plan, $kind, $payload, $now, $now) RETURNING id",
            ("$session", sessionId?.ToString()), ("$plan", nightPlanId?.ToString()), ("$kind", kind), ("$payload", payload), ("$now", now))!;
    }

    /// <summary>Noch nicht mit 2xx quittierte Meldungen einer Art in FIFO-Reihenfolge (Dead-Letter liegt getrennt).</summary>
    public IReadOnlyList<string> OutboxPayloads(string kind)
    {
        lock (gate) return OutboxPayloadsLocked(kind);
    }

    private List<string> OutboxPayloadsLocked(string kind)
    {
        using var cmd = Command("SELECT payload FROM outbox WHERE kind = $kind ORDER BY id", null, ("$kind", kind));
        using var r = cmd.ExecuteReader();
        var list = new List<string>();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }

    /// <summary>Die ältesten Einträge in FIFO-Reihenfolge (höchstens <paramref name="max"/>) zum Senden (AP-16e).</summary>
    public IReadOnlyList<OutboxEntry> OutboxPeek(int max)
    {
        lock (gate) return OutboxPeekLocked(max);
    }

    private List<OutboxEntry> OutboxPeekLocked(int max)
    {
        using var cmd = Command("SELECT id, kind, session_id, payload FROM outbox ORDER BY id LIMIT $max", null, ("$max", max));
        using var r = cmd.ExecuteReader();
        var list = new List<OutboxEntry>();
        while (r.Read())
            list.Add(new OutboxEntry(r.GetInt64(0), r.GetString(1), r.IsDBNull(2) ? null : Guid.Parse(r.GetString(2)), r.GetString(3)));
        return list;
    }

    /// <summary>Mit 2xx quittierte Einträge entfernen und in <c>sent_history</c> festhalten (eine Transaktion).</summary>
    public void OutboxAcknowledge(IReadOnlyList<OutboxEntry> entries)
    {
        lock (gate) OutboxAcknowledgeLocked(entries);
    }

    private void OutboxAcknowledgeLocked(IReadOnlyList<OutboxEntry> entries)
    {
        using var tx = connection.BeginTransaction();
        var now = UtcText.Format(clock.UtcNow);
        foreach (var e in entries)
        {
            Execute("INSERT INTO sent_history (kind, session_id, payload, sent_utc) VALUES ($kind, $session, $payload, $now)", tx,
                ("$kind", e.Kind), ("$session", e.SessionId?.ToString()), ("$payload", e.Payload), ("$now", now));
            Execute("DELETE FROM outbox WHERE id = $id", tx, ("$id", e.Id));
        }
        tx.Commit();
    }

    /// <summary>Anzahl noch nicht quittierter Meldungen (<c>outboxPending</c> im Abschluss-<c>PATCH</c>, NIN5-7).</summary>
    public int OutboxCount() => Convert.ToInt32(Scalar("SELECT COUNT(*) FROM outbox"));

    // ---- AP-16g: Backoff, Dead-Letter, Historie (execution.md §8) ------------------------------------------

    /// <summary>Wiederholungen und nächster Versuch des ältesten Eintrags (FIFO-Kopf); <c>null</c> bei leerer Outbox.</summary>
    public (int Attempts, DateTimeOffset NextAttemptUtc)? OutboxHead()
    {
        lock (gate)
        {
            using var cmd = Command("SELECT attempts, next_attempt_utc FROM outbox ORDER BY id LIMIT 1");
            using var r = cmd.ExecuteReader();
            return r.Read() ? (r.GetInt32(0), UtcText.Parse(r.GetString(1))) : null;
        }
    }

    /// <summary>Gescheiterte Einträge: Wiederholung zählen, nächster Versuch frühestens <paramref name="nextUtc"/>.</summary>
    public void OutboxRetryLater(IReadOnlyList<OutboxEntry> entries, DateTimeOffset nextUtc)
    {
        lock (gate)
        {
            using var tx = connection.BeginTransaction();
            foreach (var e in entries)
                Execute("UPDATE outbox SET attempts = attempts + 1, next_attempt_utc = $next WHERE id = $id", tx,
                    ("$next", UtcText.Format(nextUtc)), ("$id", e.Id));
            tx.Commit();
        }
    }

    /// <summary>Alle Einträge sofort wieder fällig (Rückkehr der Verbindung, neues Token).</summary>
    public void OutboxDueNow()
    {
        lock (gate) Execute("UPDATE outbox SET next_attempt_utc = $now", null, ("$now", UtcText.Format(clock.UtcNow)));
    }

    /// <summary>Einträge aus der Outbox ins Dead-Letter verschieben (Status, Code, Grund für die Anzeige im Plugin).</summary>
    public void OutboxDeadLetter(IReadOnlyList<OutboxEntry> entries, int? status, string? code, string reason)
    {
        lock (gate)
        {
            using var tx = connection.BeginTransaction();
            var now = UtcText.Format(clock.UtcNow);
            foreach (var e in entries)
            {
                Execute("INSERT INTO dead_letter (kind, session_id, payload, status, code, reason, created_utc) " +
                    "VALUES ($kind, $session, $payload, $status, $code, $reason, $now)", tx,
                    ("$kind", e.Kind), ("$session", e.SessionId?.ToString()), ("$payload", e.Payload), ("$status", status),
                    ("$code", code), ("$reason", reason), ("$now", now));
                Execute("DELETE FROM outbox WHERE id = $id", tx, ("$id", e.Id));
            }
            tx.Commit();
        }
    }

    /// <summary>Anzahl der Dead-Letter-Einträge (Heartbeat <c>deadLetters</c>, Anzeige im Plugin).</summary>
    public int DeadLetterCount() => Convert.ToInt32(Scalar("SELECT COUNT(*) FROM dead_letter"));

    /// <summary>Gründe der Dead-Letter-Einträge, neueste zuerst (Optionsseite).</summary>
    public IReadOnlyList<string> DeadLetterReasons(int max)
    {
        lock (gate)
        {
            using var cmd = Command("SELECT reason FROM dead_letter ORDER BY id DESC LIMIT $max", null, ("$max", max));
            using var r = cmd.ExecuteReader();
            var list = new List<string>();
            while (r.Read()) list.Add(r.GetString(0));
            return list;
        }
    }

    /// <summary>Eintrag vor alle anderen stellen (z. B. Session nachmelden nach <c>409 session.unknown</c>).</summary>
    public long EnqueueOutboxFront(string kind, string payload, Guid? sessionId, Guid? nightPlanId)
    {
        var now = UtcText.Format(clock.UtcNow);
        lock (gate)
        {
            var id = (long)Scalar("SELECT COALESCE(MIN(id), 1) - 1 FROM outbox")!;
            Execute("INSERT INTO outbox (id, session_id, night_plan_id, kind, payload, created_utc, next_attempt_utc) " +
                "VALUES ($id, $session, $plan, $kind, $payload, $now, $now)", null,
                ("$id", id), ("$session", sessionId?.ToString()), ("$plan", nightPlanId?.ToString()), ("$kind", kind),
                ("$payload", payload), ("$now", now));
            return id;
        }
    }

    /// <summary>Gesendete Meldungen älter als <paramref name="beforeUtc"/> aus <c>sent_history</c> löschen (14 Tage, §8).</summary>
    public int PruneSentHistory(DateTimeOffset beforeUtc)
    {
        lock (gate)
        {
            using var cmd = Command("DELETE FROM sent_history WHERE sent_utc < $before", null, ("$before", UtcText.Format(beforeUtc)));
            return cmd.ExecuteNonQuery();
        }
    }

    /// <summary>
    /// *Erneut hochladen ab Datum* (FA-NIN-13): gesendete Aufnahmen und Ereignisse ab <paramref name="sinceUtc"/> wieder in
    /// die Outbox stellen; der Server erkennt Wiederholungen an der ID (<c>duplicate</c>). Liefert die Anzahl.
    /// </summary>
    public int ReuploadSince(DateTimeOffset sinceUtc)
    {
        lock (gate)
        {
            var now = UtcText.Format(clock.UtcNow);
            using var cmd = Command(
                "INSERT INTO outbox (session_id, night_plan_id, kind, payload, created_utc, next_attempt_utc) " +
                "SELECT session_id, NULL, kind, payload, $now, $now FROM sent_history " +
                "WHERE sent_utc >= $since AND kind IN ('capture', 'event') ORDER BY id", null,
                ("$now", now), ("$since", UtcText.Format(sinceUtc)));
            return cmd.ExecuteNonQuery();
        }
    }

    // ---- intern ---------------------------------------------------------------------------------------

    internal IReadOnlyList<string> TableNames()
    {
        lock (gate) return TableNamesLocked();
    }

    private List<string> TableNamesLocked()
    {
        using var cmd = Command("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
        using var r = cmd.ExecuteReader();
        var names = new List<string>();
        while (r.Read()) names.Add(r.GetString(0));
        return names;
    }

    internal object? Scalar(string sql, params (string Name, object? Value)[] parameters)
    {
        lock (gate)
        {
            using var cmd = Command(sql, null, parameters);
            return cmd.ExecuteScalar();
        }
    }

    private void Execute(string sql, SqliteTransaction? tx = null, params (string Name, object? Value)[] parameters)
    {
        lock (gate)
        {
            using var cmd = Command(sql, tx, parameters);
            cmd.ExecuteNonQuery();
        }
    }

    private SqliteCommand Command(string sql, SqliteTransaction? tx = null, params (string Name, object? Value)[] parameters)
    {
        var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = tx;
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    public void Dispose()
    {
        lock (gate) connection.Dispose();
    }
}

/// <summary>Ein Eintrag der Outbox (FIFO über <see cref="Id"/>).</summary>
public sealed record OutboxEntry(long Id, string Kind, Guid? SessionId, string Payload);

/// <summary>Zwischengespeicherte Antwort (Bootstrap, Targets, letzter Plan) mit ETag und Zeitpunkt.</summary>
public sealed record CacheEntry(string Value, string? Etag, DateTimeOffset UpdatedUtc);

/// <summary>Arten der Outbox-Einträge (execution.md §8).</summary>
public static class OutboxKinds
{
    public const string Session = "session";
    public const string Capture = "capture";
    public const string Event = "event";
    public const string SessionPatch = "session_patch";
}

/// <summary>Schlüssel der Tabelle <c>state</c> (execution.md §8: Session, Plan, Blockindex, tonight).</summary>
public static class StateKeys
{
    public const string SessionId = "sessionId";
    public const string NightPlanId = "nightPlanId";
    public const string BlockIndex = "blockIndex";
    public const string Night = "night";
    public const string Tonight = "tonight";
    public const string TargetsEtag = "targetsEtag";
    public const string SettingsVersion = "settingsVersion";
    public const string PlanBlockedUntil = "planBlockedUntil";
    public const string DoneBlocks = "doneBlocks";

    /// <summary>Filterposition je NINA-Filtername beim letzten Flat-Lauf (Trained Flats, NT-39).</summary>
    public const string TrainedFlatPositions = "trainedFlatPositions";

    /// <summary>Anlage-Daten der aktuellen Session (JSON <c>NinaSessionCreate</c>) für das Nachmelden (§8, <c>session.unknown</c>).</summary>
    public const string SessionCreate = "sessionCreate";

    /// <summary>Abgeschlossene Session mit noch offenen Meldungen: <c>sessionId|endedAtUtc</c> (execution.md §8, NIN5-7).</summary>
    public const string CompletedSession = "completedSession";
}
