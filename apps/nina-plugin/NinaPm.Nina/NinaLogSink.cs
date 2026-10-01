using NINA.Core.Utility;
using NinaPm.Core.Logging;

namespace NinaPm.Nina;

/// <summary>Log-Zeilen des Kerns in NINAs Log (FA-NIN-19): Präfix <c>NINA-PM |</c> hinter NINAs eigenen Spalten.</summary>
internal sealed class NinaLogSink : ILogSink
{
    public static readonly NinaLogSink Instance = new();

    public void Info(string line) => Logger.Info(line);

    public void Warning(string line) => Logger.Warning(line);

    public void Error(string line) => Logger.Error(line);
}
