using NinaPm.Core.Reporting;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Relativer Bildpfad (AP-72b): ohne Laufwerk und Benutzername, sonst nur der Dateiname.</summary>
public class ImagePathsTests
{
    [Theory]
    [InlineData(@"C:\Users\astro\Dropbox\NINA", @"C:\Users\astro\Dropbox\NINA\2026-10-09\LDN1228-LRGB\LIGHT\a.fits.fz", "2026-10-09/LDN1228-LRGB/LIGHT/a.fits.fz")]
    [InlineData(@"C:\Users\astro\Dropbox\NINA\", @"c:\users\astro\dropbox\nina\x\b.fits", "x/b.fits")]
    [InlineData(@"D:\Bilder", @"C:\Users\astro\Documents\N.I.N.A\c.fits", "c.fits")]
    [InlineData(null, @"C:\Users\astro\d.fits", "d.fits")]
    [InlineData(@"C:\NINA", @"C:\NINA2\e.fits", "e.fits")]
    [InlineData(@"C:\NINA", null, null)]
    public void Relativ_zum_Bildordner(string? root, string? full, string? expected) =>
        Assert.Equal(expected, ImagePaths.Relative(root, full));
}
