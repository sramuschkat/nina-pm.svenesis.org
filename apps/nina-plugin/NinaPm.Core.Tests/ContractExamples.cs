using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace NinaPm.Core.Tests;

/// <summary>
/// Beispiele aus <c>docs/contracts/nina/</c> mit ergänzten Kurz-IDs (<c>a91f…</c> → feste UUID, <c>sha256:9c1e…</c> →
/// gültiger Hash) – dieselbe Regel wie <c>packages/shared/test/nina-contracts.test.ts</c>.
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

    private static Guid UuidFor(string shortId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(shortId));
        hash[6] = (byte)((hash[6] & 0x0F) | 0x40);
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
        return new Guid(hash.AsSpan(0, 16));
    }

    public static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) return dir.FullName;
        throw new DirectoryNotFoundException("Repository-Wurzel (pnpm-workspace.yaml) nicht gefunden");
    }
}
