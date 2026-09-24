// Vergleichsorakel (AP-13a, specs/engine/allocation.md §11.2): rechnet Grids mit dem C#-Original
// des Astro-PM-NINA-Plugins und schreibt je Grid <out>/<name>.oracle.json.
// Aufruf: AstroPmOracle --out <ordner> <grid.json|ordner>...   (Exit 2, wenn ein Grid ungültig war)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace NinaPm.Oracle {
    public static class Program {
        public const string SourceCommit = "5dd621dea015634242259ca1220a428cf339446a";

        private static readonly JsonSerializerOptions ReadOptions = new() {
            // camelCase, Groß-/Kleinschreibung beachten: `slotS` und `slots` sind verschiedene Felder.
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            ReadCommentHandling = JsonCommentHandling.Disallow,
        };

        public static int Main(string[] args) {
            string outDir = null;
            var inputs = new List<string>();
            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "--out" && i + 1 < args.Length) outDir = args[++i];
                else inputs.Add(args[i]);
            }
            if (outDir == null || inputs.Count == 0) {
                Console.Error.WriteLine("Aufruf: AstroPmOracle --out <ordner> <grid.json|ordner>...");
                return 64;
            }
            Directory.CreateDirectory(outDir);
            var files = inputs
                .SelectMany(p => Directory.Exists(p) ? Directory.GetFiles(p, "*.json") : new[] { p })
                .Where(f => !f.EndsWith(".oracle.json", StringComparison.Ordinal))
                .OrderBy(f => f, StringComparer.Ordinal)
                .ToList();
            int failed = 0;
            foreach (var file in files) {
                var name = Path.GetFileNameWithoutExtension(file);
                var target = Path.Combine(outDir, $"{name}.oracle.json");
                try {
                    var result = GridAdapter.Run(ReadGrid(File.ReadAllText(file)));
                    File.WriteAllText(target, Render(result), new UTF8Encoding(false));
                } catch (OracleException e) {
                    failed++;
                    File.WriteAllText(target, RenderError(e.Code, e.Message), new UTF8Encoding(false));
                    Console.Error.WriteLine($"{name}: {e.Code} – {e.Message}");
                } catch (Exception e) {
                    // Absturz im Original oder Adapter: als Befund festhalten, übrige Grids weiterrechnen.
                    failed++;
                    File.WriteAllText(target, RenderError("oracle.exception", e.ToString()), new UTF8Encoding(false));
                    Console.Error.WriteLine($"{name}: {e.GetType().Name} – {e.Message}");
                }
            }
            Console.WriteLine($"Orakel {SourceCommit[..7]}: {files.Count - failed}/{files.Count} Grids gerechnet → {outDir}");
            return failed > 0 ? 2 : 0;
        }

        /// <summary>Soll-Plan-Datei (mit <c>input</c>) oder reines Grid.</summary>
        private static GridInput ReadGrid(string json) {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("input", out var input)
                ? input.Deserialize<GridInput>(ReadOptions)
                : doc.RootElement.Deserialize<GridInput>(ReadOptions);
        }

        private static JsonWriterOptions WriterOptions => new() { Indented = true };

        private static string RenderError(string code, string message) {
            using var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms, WriterOptions)) {
                w.WriteStartObject();
                w.WriteString("source", SourceCommit);
                w.WriteStartObject("error");
                w.WriteString("code", code);
                w.WriteString("message", message);
                w.WriteEndObject();
                w.WriteEndObject();
            }
            return Encoding.UTF8.GetString(ms.ToArray()) + "\n";
        }

        private static void WriteNullableStrings(Utf8JsonWriter w, string name, IEnumerable<string> values) {
            w.WriteStartArray(name);
            foreach (var v in values) {
                if (v == null) w.WriteNullValue(); else w.WriteStringValue(v);
            }
            w.WriteEndArray();
        }

        private static string Render(OracleResult r) {
            using var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms, WriterOptions)) {
                w.WriteStartObject();
                w.WriteString("source", SourceCommit);
                WriteNullableStrings(w, "rows", r.Rows);
                w.WriteStartArray("excluded");
                foreach (var e in r.Excluded) {
                    w.WriteStartObject();
                    w.WriteString("unitId", e.UnitId);
                    w.WriteString("reason", e.Reason);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
                WriteNullableStrings(w, "prefiltered", r.Prefiltered);
                w.WriteNumber("firstUsableSlot", r.FirstUsableSlot);
                w.WriteNumber("lastUsableSlot", r.LastUsableSlot);
                WriteNullableStrings(w, "slotAssignment", r.SlotAssignment);
                WriteNullableStrings(w, "walkSlotAssignment", r.WalkSlotAssignment);
                w.WriteStartArray("entries");
                foreach (var e in r.Entries) {
                    w.WriteStartObject();
                    w.WriteNumber("atS", e.AtS);
                    w.WriteString("cmd", e.Cmd);
                    if (e.Cmd == "slew_center") {
                        w.WriteString("unit", e.Unit);
                        if (e.Panel.HasValue) w.WriteNumber("panel", e.Panel.Value); else w.WriteNull("panel");
                    }
                    if (e.Filter != null) w.WriteString("filter", e.Filter);
                    if (e.Line != null) {
                        w.WriteString("line", e.Line);
                        w.WriteBoolean("bonus", e.Bonus == true);
                        w.WriteBoolean("lastOfNight", e.LastOfNight == true);
                    }
                    if (e.UntilS.HasValue) w.WriteNumber("untilS", e.UntilS.Value);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
                w.WriteEndObject();
            }
            return Encoding.UTF8.GetString(ms.ToArray()) + "\n";
        }
    }
}
