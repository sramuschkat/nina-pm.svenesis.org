using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>DPAPI-Schutz des Sync-Tokens (SV-08): Rundreise, kein Klartext im Speicherwert, fremde Werte → null.</summary>
public sealed class TokenProtectorTests
{
    private readonly DpapiTokenProtector protector = new();

    [Fact]
    public void Rundreise_ohne_Klartext()
    {
        var token = "npm_" + new string('x', 40); // Testwert, kein Geheimnis
        var stored = protector.Protect(token);
        Assert.DoesNotContain("npm_", stored, StringComparison.Ordinal);
        Assert.Equal(token, protector.Unprotect(stored));
    }

    [Theory]
    [InlineData("")]
    [InlineData("kein-base64")]
    [InlineData("AAAAAAAA")]
    public void Unlesbare_Werte_ergeben_null(string stored) => Assert.Null(protector.Unprotect(stored));
}
