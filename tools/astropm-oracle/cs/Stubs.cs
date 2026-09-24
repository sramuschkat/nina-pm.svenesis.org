// Ersatztypen für die Originalquellen des Astro-PM-NINA-Plugins (Commit 5dd621d), die sonst NINA
// bräuchten (specs/engine/allocation.md §11.2, Patch-Punkte 1–3). Kein Code aus dem Original.
using System;
using System.Collections.Generic;

namespace NINA.Core.Utility {
    /// <summary>Patch-Punkt 1: NINAs Logger – Ausgaben werden verworfen.</summary>
    public static class Logger {
        public static void Info(string message) { }
        public static void Warning(string message) { }
        public static void Debug(string message) { }
        public static void Error(string message) { }
    }
}

namespace AstroPM.NINA.Plugin.Models {
    /// <summary>Patch-Punkt 2: leeres Horizontprofil (kein Horizont, FA-STO-02).</summary>
    public class HorizonProfile {
        public double AltitudeAt(double azimuthDeg) => 0;
    }
}

namespace NinaPm.Oracle {
    /// <summary>
    /// Patch-Punkt 3: Mond-oben-Sicherheit je Zeile und Slot aus dem Grid. Der Patch in
    /// <c>SessionScheduler.IsExposureSetMoonSafe</c> fragt hier nach „Mond ≤ 0° → sicher“ nach.
    /// </summary>
    public static class OracleHooks {
        public static readonly Dictionary<(string LineId, DateTime SlotUtc), bool> Masks = new();
    }
}
