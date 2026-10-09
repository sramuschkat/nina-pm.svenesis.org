using NinaPm.Core.Targets;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Lesbare ASCII-Namen für Ordner, Dateien und FITS-Kopf (AP-71).</summary>
public class AsciiNameTests
{
    [Theory]
    [InlineData("IC 5146 – Cocoon Nebula", "IC 5146 - Cocoon Nebula")]
    [InlineData("M 31 — P2", "M 31 - P2")]
    [InlineData("Größe Ärger Öl Übel", "Groesse Aerger Oel Uebel")]
    [InlineData("Barnard’s Loop", "Barnard's Loop")]
    [InlineData("Café Nébuleuse", "Cafe Nebuleuse")]
    [InlineData("α Cyg", "alf Cyg")]
    [InlineData("μ Cep", "mu. Cep")]
    [InlineData("Sh2-132 (Löwe)", "Sh2-132 (Loewe)")]
    [InlineData("M 42 ★", "M 42 _")]
    [InlineData("NGC 7000", "NGC 7000")]
    public void Wandelt_lesbar_in_ASCII(string name, string expected) => Assert.Equal(expected, AsciiName.Of(name));

    [Fact]
    public void Ergebnis_ist_reines_ASCII_und_bleibt_bei_NINAs_Umwandlung_gleich()
    {
        var ascii = AsciiName.Of("Ωmega – Ünïcødé…\u00A0Test");
        Assert.All(ascii, c => Assert.True(c < 0x80));
        Assert.Equal(ascii, System.Text.Encoding.ASCII.GetString(System.Text.Encoding.ASCII.GetBytes(ascii)));
    }
}
