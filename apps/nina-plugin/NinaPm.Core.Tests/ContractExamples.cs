using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace NinaPm.Core.Tests;

/// <summary>
/// Beispiele aus <c>docs/contracts/nina/</c> mit ergänzten Kurz-IDs (<c>a91f…</c> → feste UUID, <c>sha256:9c1e…</c> →
/// gültiger Hash), Ersetzung wie in <c>tools/nina-test-server/src/examples.ts</c>.
/// </summary>
public static class ContractExamples
{
    public static string Dir => Path.Combine(RepoRoot(), "docs", "contracts", "nina");

    public static string Json(string name)
    {
        using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(File.ReadAllText(Path.Combine(Dir, $"{name}.example.json"))))
        {
            DateParseHandling = Newtonsoft.Json.DateParseHandling.None,
        };
        var token = JToken.Load(reader);
        Expand(token);
        return token.ToString();
    }

    private static void Expand(JToken token)
    {
        foreach (var value in token.SelectTokens("$..*").OfType<JValue>().Where(v => v.Type == JTokenType.String).ToList())
        {
            var text = (string)value!;
            if (!text.EndsWith('…')) continue;
            if (text.StartsWith("sha256:", StringComparison.Ordinal)) value.Value = "sha256:" + new string('0', 64);
            else value.Value = UuidFor(text).ToString();
        }
    }

    /// <summary>
    /// Feste UUID (v4-Form) wie <c>uuidFor</c> in <c>tools/nina-test-server/src/examples.ts</c>: Versions- und
    /// Variantenbits im Hex-Text gesetzt. <c>new Guid(byte[])</c> legte die ersten drei Gruppen in umgekehrter
    /// Bytefolge ab – die Bits landeten an der falschen Stelle und zod lehnte die ID ab.
    /// </summary>
    private static Guid UuidFor(string shortId)
    {
        var h = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(shortId))).ToLowerInvariant();
        var variant = ((Convert.ToInt32(h[16].ToString(), 16) & 0x3) | 0x8).ToString("x");
        return Guid.Parse($"{h[..8]}-{h[8..12]}-4{h[13..16]}-{variant}{h[17..20]}-{h[20..32]}");
    }

    public static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) return dir.FullName;
        throw new DirectoryNotFoundException("Repository-Wurzel (pnpm-workspace.yaml) nicht gefunden");
    }
}
