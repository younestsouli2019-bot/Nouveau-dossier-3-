using System.Text.Json;
using EdrBrain.Models;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EdrBrain.Storage;

/// <summary>
/// SQLite-backed persistent storage for events, graph, alerts, and state.
/// Uses WAL mode, batch inserts, and connection pooling for production throughput.
///
/// Schema is initialized idempotently on first use.
/// All database operations use a single shared connection with proper locking.
/// </summary>
public sealed class StateManager : IStateManager
{
    private readonly ILogger<StateManager> _logger;
    private readonly EdrOptions _options;
    private readonly SqliteConnection _conn;
    private readonly object _lock = new();
    private bool _schemaInitialized;

    public StateManager(ILogger<StateManager> logger, IOptions<EdrOptions> options)
    {
        _logger = logger;
        _options = options.Value;

        // Ensure directory exists
        var dir = Path.GetDirectoryName(_options.DatabasePath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        var connString = $"Data Source={_options.DatabasePath};Mode=ReadWriteCreate;";
        _conn = new SqliteConnection(connString);
        _conn.Open();

        ConfigurePragmas();
    }

    // ── Schema Initialization ──────────────────────────────────

    public async Task InitializeSchemaAsync(CancellationToken ct = default)
    {
        if (_schemaInitialized) return;

        lock (_lock)
        {
            if (_schemaInitialized) return;

            ExecuteScript(@"
                CREATE TABLE IF NOT EXISTS config (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT(datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_uid   TEXT UNIQUE NOT NULL,
                    timestamp   TEXT NOT NULL,
                    host        TEXT NOT NULL DEFAULT '',
                    user_sid    TEXT,
                    user_name   TEXT,
                    action      TEXT NOT NULL,
                    proc_name   TEXT NOT NULL,
                    proc_pid    INTEGER NOT NULL,
                    proc_cmdline TEXT,
                    proc_hash   TEXT,
                    proc_signed  INTEGER DEFAULT 0,
                    parent_pid  INTEGER,
                    parent_name TEXT,
                    target      TEXT,
                    raw_xml     TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_events_ts     ON events(timestamp);
                CREATE INDEX IF NOT EXISTS idx_events_action ON events(action);
                CREATE INDEX IF NOT EXISTS idx_events_pid    ON events(proc_pid);
                CREATE INDEX IF NOT EXISTS idx_events_hash   ON events(proc_hash);
                CREATE INDEX IF NOT EXISTS idx_events_uid    ON events(event_uid);

                CREATE TABLE IF NOT EXISTS graph_nodes (
                    pid        INTEGER PRIMARY KEY,
                    name       TEXT NOT NULL,
                    cmdline    TEXT,
                    hash       TEXT,
                    signed     INTEGER DEFAULT 0,
                    parent_pid INTEGER,
                    start_time TEXT NOT NULL,
                    end_time   TEXT,
                    risk_score INTEGER DEFAULT 0,
                    is_root    INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS graph_edges (
                    parent_pid  INTEGER NOT NULL,
                    child_pid   INTEGER NOT NULL,
                    edge_type   TEXT DEFAULT 'spawned',
                    observed_at TEXT NOT NULL,
                    PRIMARY KEY (parent_pid, child_pid)
                );

                CREATE TABLE IF NOT EXISTS attack_chains (
                    chain_id    INTEGER PRIMARY KEY AUTOINCREMENT,
                    root_pid    INTEGER NOT NULL,
                    score       INTEGER NOT NULL,
                    tactics     TEXT,
                    techniques  TEXT,
                    detected_at TEXT NOT NULL,
                    response    TEXT,
                    responded_at TEXT
                );

                CREATE TABLE IF NOT EXISTS chain_members (
                    chain_id  INTEGER NOT NULL,
                    pid       INTEGER NOT NULL,
                    hop_order INTEGER NOT NULL,
                    PRIMARY KEY (chain_id, pid)
                );

                CREATE TABLE IF NOT EXISTS allowlist (
                    id       INTEGER PRIMARY KEY AUTOINCREMENT,
                    type     TEXT NOT NULL,
                    value    TEXT NOT NULL,
                    reason   TEXT,
                    added_by TEXT,
                    added_at TEXT NOT NULL DEFAULT(datetime('now')),
                    expires_at TEXT
                );

                CREATE TABLE IF NOT EXISTS tamper_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    check_type  TEXT NOT NULL,
                    expected    TEXT,
                    observed    TEXT,
                    detected_at TEXT NOT NULL DEFAULT(datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS alerts (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp  TEXT NOT NULL,
                    rule_id    TEXT NOT NULL,
                    rule_title TEXT NOT NULL,
                    level      TEXT NOT NULL DEFAULT 'medium',
                    score      INTEGER NOT NULL,
                    host       TEXT NOT NULL,
                    root_pid   INTEGER NOT NULL,
                    root_proc  TEXT NOT NULL,
                    cmdline    TEXT,
                    tactics    TEXT,
                    techniques TEXT,
                    response   TEXT DEFAULT 'none',
                    status     TEXT DEFAULT 'new'
                );

                CREATE INDEX IF NOT EXISTS idx_alerts_ts     ON alerts(timestamp);
                CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
            ");

            _schemaInitialized = true;
            _logger.LogInformation("Database schema initialized at {Path}", _options.DatabasePath);
        }
    }

    // ── State ──────────────────────────────────────────────────

    public DateTime GetLastReadTime()
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            cmd.CommandText = "SELECT value FROM config WHERE key = 'LastRead'";
            var val = cmd.ExecuteScalar() as string;
            return val != null ? DateTime.Parse(val) : DateTime.UtcNow.AddMinutes(-5);
        }
    }

    public void SetLastReadTime(DateTime time)
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            cmd.CommandText = "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('LastRead', $time, datetime('now'))";
            cmd.Parameters.AddWithValue("$time", time.ToString("O"));
            cmd.ExecuteNonQuery();
        }
    }

    // ── Event Persistence ──────────────────────────────────────

    public async Task InsertEventsBatchAsync(IEnumerable<NormalizedEvent> events, CancellationToken ct = default)
    {
        var batch = events.ToList();
        if (batch.Count == 0) return;

        lock (_lock)
        {
            using var tx = _conn.BeginTransaction();
            try
            {
                foreach (var chunk in batch.Chunk(_options.BatchInsertSize))
                {
                    using var cmd = _conn.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = @"
                        INSERT OR IGNORE INTO events
                            (event_uid, timestamp, host, user_sid, user_name, action,
                             proc_name, proc_pid, proc_cmdline, proc_hash, proc_signed,
                             parent_pid, parent_name, target, raw_xml)
                        VALUES
                            ($uid, $ts, $host, $sid, $user, $action,
                             $pname, $pid, $cmdline, $hash, $signed,
                             $ppid, $parent, $target, $xml)";

                    cmd.Parameters.AddWithValue("$uid", "");
                    cmd.Parameters.AddWithValue("$ts", "");
                    cmd.Parameters.AddWithValue("$host", "");
                    cmd.Parameters.AddWithValue("$sid", "");
                    cmd.Parameters.AddWithValue("$user", "");
                    cmd.Parameters.AddWithValue("$action", "");
                    cmd.Parameters.AddWithValue("$pname", "");
                    cmd.Parameters.AddWithValue("$pid", 0);
                    cmd.Parameters.AddWithValue("$cmdline", "");
                    cmd.Parameters.AddWithValue("$hash", "");
                    cmd.Parameters.AddWithValue("$signed", 0);
                    cmd.Parameters.AddWithValue("$ppid", (object?)DBNull.Value);
                    cmd.Parameters.AddWithValue("$parent", "");
                    cmd.Parameters.AddWithValue("$target", "");
                    cmd.Parameters.AddWithValue("$xml", "");

                    foreach (var e in chunk)
                    {
                        cmd.Parameters["$uid"]!.Value = e.EventUid;
                        cmd.Parameters["$ts"]!.Value = e.Timestamp.ToString("O");
                        cmd.Parameters["$host"]!.Value = e.Host;
                        cmd.Parameters["$sid"]!.Value = e.UserSid ?? (object)DBNull.Value;
                        cmd.Parameters["$user"]!.Value = e.UserName ?? (object)DBNull.Value;
                        cmd.Parameters["$action"]!.Value = e.ActionType.ToString();
                        cmd.Parameters["$pname"]!.Value = e.ProcessName;
                        cmd.Parameters["$pid"]!.Value = e.ProcessId;
                        cmd.Parameters["$cmdline"]!.Value = e.CommandLine ?? (object)DBNull.Value;
                        cmd.Parameters["$hash"]!.Value = e.ProcessHash ?? (object)DBNull.Value;
                        cmd.Parameters["$signed"]!.Value = (int)e.Signature;
                        cmd.Parameters["$ppid"]!.Value = e.ParentProcessId.HasValue ? e.ParentProcessId.Value : DBNull.Value;
                        cmd.Parameters["$parent"]!.Value = e.ParentProcessName ?? (object)DBNull.Value;
                        cmd.Parameters["$target"]!.Value = e.Target ?? (object)DBNull.Value;
                        cmd.Parameters["$xml"]!.Value = e.RawXml ?? (object)DBNull.Value;
                        cmd.ExecuteNonQuery();
                    }
                }

                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    public IEnumerable<NormalizedEvent> QueryEvents(DateTime from, DateTime to, string? actionFilter = null)
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            var sql = "SELECT * FROM events WHERE timestamp >= $from AND timestamp <= $to";
            if (!string.IsNullOrEmpty(actionFilter))
                sql += " AND action = $action";
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("$from", from.ToString("O"));
            cmd.Parameters.AddWithValue("$to", to.ToString("O"));
            if (!string.IsNullOrEmpty(actionFilter))
                cmd.Parameters.AddWithValue("$action", actionFilter);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                yield return ReadEventFromReader(reader);
            }
        }
    }

    public async Task PruneOldEventsAsync(int retentionDays, CancellationToken ct = default)
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            cmd.CommandText = "DELETE FROM events WHERE timestamp < datetime('now', $days || ' days')";
            cmd.Parameters.AddWithValue("$days", -retentionDays);
            var deleted = cmd.ExecuteNonQuery();
            _logger.LogInformation("Pruned {Count} events older than {Days} days", deleted, retentionDays);
        }
    }

    // ── Graph Persistence ──────────────────────────────────────

    public async Task SaveGraphNodesAsync(IEnumerable<ProcessNode> nodes, CancellationToken ct = default)
    {
        lock (_lock)
        {
            using var tx = _conn.BeginTransaction();
            try
            {
                using var cmd = _conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = @"
                    INSERT OR REPLACE INTO graph_nodes
                        (pid, name, cmdline, hash, signed, parent_pid, start_time, end_time, risk_score, is_root)
                    VALUES
                        ($pid, $name, $cmdline, $hash, $signed, $ppid, $start, $end, $score, $root)";

                cmd.Parameters.AddWithValue("$pid", 0);
                cmd.Parameters.AddWithValue("$name", "");
                cmd.Parameters.AddWithValue("$cmdline", "");
                cmd.Parameters.AddWithValue("$hash", "");
                cmd.Parameters.AddWithValue("$signed", 0);
                cmd.Parameters.AddWithValue("$ppid", (object?)DBNull.Value);
                cmd.Parameters.AddWithValue("$start", "");
                cmd.Parameters.AddWithValue("$end", (object?)DBNull.Value);
                cmd.Parameters.AddWithValue("$score", 0);
                cmd.Parameters.AddWithValue("$root", 0);

                foreach (var n in nodes)
                {
                    cmd.Parameters["$pid"]!.Value = n.Pid;
                    cmd.Parameters["$name"]!.Value = n.Name;
                    cmd.Parameters["$cmdline"]!.Value = n.CommandLine ?? (object)DBNull.Value;
                    cmd.Parameters["$hash"]!.Value = n.Hash ?? (object)DBNull.Value;
                    cmd.Parameters["$signed"]!.Value = (int)n.Signature;
                    cmd.Parameters["$ppid"]!.Value = n.ParentPid.HasValue ? n.ParentPid.Value : DBNull.Value;
                    cmd.Parameters["$start"]!.Value = n.StartTime.ToString("O");
                    cmd.Parameters["$end"]!.Value = n.EndTime.HasValue ? n.EndTime.Value.ToString("O") : DBNull.Value;
                    cmd.Parameters["$score"]!.Value = n.RiskScore;
                    cmd.Parameters["$root"]!.Value = n.IsSuspiciousRoot ? 1 : 0;
                    cmd.ExecuteNonQuery();
                }

                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    public IEnumerable<ProcessNode> LoadActiveNodes()
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM graph_nodes WHERE end_time IS NULL ORDER BY start_time";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                yield return new ProcessNode
                {
                    Pid = reader.GetInt32(reader.GetOrdinal("pid")),
                    Name = reader.GetString(reader.GetOrdinal("name")),
                    CommandLine = reader.IsDBNull(reader.GetOrdinal("cmdline")) ? "" : reader.GetString(reader.GetOrdinal("cmdline")),
                    Hash = reader.IsDBNull(reader.GetOrdinal("hash")) ? "" : reader.GetString(reader.GetOrdinal("hash")),
                    Signature = (SignatureStatus)reader.GetInt32(reader.GetOrdinal("signed")),
                    ParentPid = reader.IsDBNull(reader.GetOrdinal("parent_pid")) ? null : reader.GetInt32(reader.GetOrdinal("parent_pid")),
                    StartTime = DateTime.Parse(reader.GetString(reader.GetOrdinal("start_time"))),
                    EndTime = reader.IsDBNull(reader.GetOrdinal("end_time")) ? null : DateTime.Parse(reader.GetString(reader.GetOrdinal("end_time"))),
                    RiskScore = reader.GetInt32(reader.GetOrdinal("risk_score")),
                    IsSuspiciousRoot = reader.GetInt32(reader.GetOrdinal("is_root")) == 1,
                };
            }
        }
    }

    // ── Attack Chain Persistence ───────────────────────────────

    public async Task SaveAttackChainAsync(AttackChain chain, CancellationToken ct = default)
    {
        lock (_lock)
        {
            using var tx = _conn.BeginTransaction();
            try
            {
                using var cmd = _conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = @"
                    INSERT INTO attack_chains
                        (root_pid, score, tactics, techniques, detected_at, response, responded_at)
                    VALUES
                        ($root, $score, $tactics, $techniques, $detected, $response, $responded)";
                cmd.Parameters.AddWithValue("$root", chain.RootPid);
                cmd.Parameters.AddWithValue("$score", chain.Score);
                cmd.Parameters.AddWithValue("$tactics", JsonSerializer.Serialize(chain.Tactics));
                cmd.Parameters.AddWithValue("$techniques", JsonSerializer.Serialize(chain.Techniques));
                cmd.Parameters.AddWithValue("$detected", chain.DetectedAt.ToString("O"));
                cmd.Parameters.AddWithValue("$response", chain.Response);
                cmd.Parameters.AddWithValue("$responded", chain.RespondedAt.HasValue ? chain.RespondedAt.Value.ToString("O") : DBNull.Value);
                cmd.ExecuteNonQuery();

                using var idCmd = _conn.CreateCommand();
                idCmd.Transaction = tx;
                idCmd.CommandText = "SELECT last_insert_rowid()";
                var chainId = (long)idCmd.ExecuteScalar()!;

                using var memberCmd = _conn.CreateCommand();
                memberCmd.Transaction = tx;
                memberCmd.CommandText = "INSERT INTO chain_members (chain_id, pid, hop_order) VALUES ($cid, $pid, $hop)";
                memberCmd.Parameters.AddWithValue("$cid", chainId);
                memberCmd.Parameters.AddWithValue("$pid", 0);
                memberCmd.Parameters.AddWithValue("$hop", 0);

                for (int i = 0; i < chain.Members.Count; i++)
                {
                    memberCmd.Parameters["$pid"]!.Value = chain.Members[i].Pid;
                    memberCmd.Parameters["$hop"]!.Value = i;
                    memberCmd.ExecuteNonQuery();
                }

                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }

    // ── Alert Persistence ──────────────────────────────────────

    public async Task SaveAlertAsync(Alert alert, CancellationToken ct = default)
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            cmd.CommandText = @"
                INSERT INTO alerts
                    (timestamp, rule_id, rule_title, level, score, host,
                     root_pid, root_proc, cmdline, tactics, techniques, response, status)
                VALUES
                    ($ts, $ruleId, $ruleTitle, $level, $score, $host,
                     $rootPid, $rootProc, $cmdline, $tactics, $techniques, $response, $status)";
            cmd.Parameters.AddWithValue("$ts", alert.Timestamp.ToString("O"));
            cmd.Parameters.AddWithValue("$ruleId", alert.RuleId);
            cmd.Parameters.AddWithValue("$ruleTitle", alert.RuleTitle);
            cmd.Parameters.AddWithValue("$level", alert.Level);
            cmd.Parameters.AddWithValue("$score", alert.Score);
            cmd.Parameters.AddWithValue("$host", alert.Host);
            cmd.Parameters.AddWithValue("$rootPid", alert.RootPid);
            cmd.Parameters.AddWithValue("$rootProc", alert.RootProcessName);
            cmd.Parameters.AddWithValue("$cmdline", alert.CommandLine ?? (object)DBNull.Value);
            cmd.Parameters.AddWithValue("$tactics", JsonSerializer.Serialize(alert.Tactics));
            cmd.Parameters.AddWithValue("$techniques", JsonSerializer.Serialize(alert.Techniques));
            cmd.Parameters.AddWithValue("$response", alert.Response);
            cmd.Parameters.AddWithValue("$status", alert.Status);
            cmd.ExecuteNonQuery();
        }
    }

    // ── Database Info ──────────────────────────────────────────

    public long GetDatabaseSizeBytes()
    {
        try { return new FileInfo(_options.DatabasePath).Length; }
        catch { return 0; }
    }

    public long GetEventCount()
    {
        lock (_lock)
        {
            using var cmd = _conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM events";
            return (long)cmd.ExecuteScalar()!;
        }
    }

    // ── Internal ───────────────────────────────────────────────

    private void ConfigurePragmas()
    {
        using var cmd = _conn.CreateCommand();
        cmd.CommandText = $"""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            PRAGMA cache_size=-{_options.CacheSizeMb * 1000};
            PRAGMA busy_timeout=5000;
            PRAGMA temp_store=MEMORY;
        """;
        cmd.ExecuteNonQuery();
    }

    private void ExecuteScript(string sql)
    {
        using var cmd = _conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static NormalizedEvent ReadEventFromReader(SqliteDataReader reader) => new()
    {
        Id = reader.GetInt64(reader.GetOrdinal("id")),
        EventUid = reader.GetString(reader.GetOrdinal("event_uid")),
        Timestamp = DateTime.Parse(reader.GetString(reader.GetOrdinal("timestamp"))),
        Host = reader.IsDBNull(reader.GetOrdinal("host")) ? "" : reader.GetString(reader.GetOrdinal("host")),
        UserSid = reader.IsDBNull(reader.GetOrdinal("user_sid")) ? "" : reader.GetString(reader.GetOrdinal("user_sid")),
        UserName = reader.IsDBNull(reader.GetOrdinal("user_name")) ? "" : reader.GetString(reader.GetOrdinal("user_name")),
        ActionType = Enum.Parse<SysmonAction>(reader.GetString(reader.GetOrdinal("action"))),
        ProcessName = reader.GetString(reader.GetOrdinal("proc_name")),
        ProcessId = reader.GetInt32(reader.GetOrdinal("proc_pid")),
        CommandLine = reader.IsDBNull(reader.GetOrdinal("proc_cmdline")) ? "" : reader.GetString(reader.GetOrdinal("proc_cmdline")),
        ProcessHash = reader.IsDBNull(reader.GetOrdinal("proc_hash")) ? "" : reader.GetString(reader.GetOrdinal("proc_hash")),
        Signature = (SignatureStatus)reader.GetInt32(reader.GetOrdinal("proc_signed")),
        ParentProcessId = reader.IsDBNull(reader.GetOrdinal("parent_pid")) ? null : reader.GetInt32(reader.GetOrdinal("parent_pid")),
        ParentProcessName = reader.IsDBNull(reader.GetOrdinal("parent_name")) ? "" : reader.GetString(reader.GetOrdinal("parent_name")),
        Target = reader.IsDBNull(reader.GetOrdinal("target")) ? "" : reader.GetString(reader.GetOrdinal("target")),
    };

    public void Dispose()
    {
        _conn.Close();
        _conn.Dispose();
    }
}
