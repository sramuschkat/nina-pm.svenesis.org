// Grid-Format (docs/contracts/golden-plans/README.md, grid.schema.json) als System.Text.Json-DTOs.
// Nur die Felder, die das Original kennt; Produktivfelder (Overheads, Flip, Panel-Masken, tonight)
// werden im Kompatibilitätsmodus nicht gelesen (allocation.md §11.1).
using System.Collections.Generic;

namespace NinaPm.Oracle {
    public sealed class GridFile {
        public GridInput Input { get; set; }
    }

    public sealed class GridInput {
        public string Mode { get; set; } = "";
        public int SlotS { get; set; }
        public int Slots { get; set; }
        public long? StartAtS { get; set; }
        public double[] MoonAltDeg { get; set; } = System.Array.Empty<double>();
        public GridSettings Settings { get; set; } = new();
        public List<GridMoonProfile> MoonProfiles { get; set; } = new();
        public List<GridUnit> Units { get; set; } = new();
    }

    public sealed class GridSettings {
        public string Strategy { get; set; } = "proportional";
        public List<string> SortChain { get; set; } = new();
        public bool BonusEnabled { get; set; }
        public double OvershootPct { get; set; }
        public bool MosaicPanelsIndependent { get; set; }
        public GridEvery Dither { get; set; } = new();
        public GridFilterSwitch FilterSwitch { get; set; } = new();
    }

    public sealed class GridEvery {
        public bool Enabled { get; set; }
        public int Every { get; set; }
    }

    public sealed class GridFilterSwitch {
        public bool Enabled { get; set; }
        public int Every { get; set; }
        public double TolerancePct { get; set; }
    }

    public sealed class GridMoonProfile {
        public string Id { get; set; } = "";
        public double DistanceDeg { get; set; }
        public double MaxIllumPct { get; set; }
        public bool MustBeDown { get; set; }
    }

    public sealed class GridUnit {
        public string UnitId { get; set; } = "";
        public string ProjectId { get; set; } = "";
        public int Priority { get; set; }
        public double MinTimeOnTargetH { get; set; }
        public double PeakAltDeg { get; set; }
        public List<int[]> CanImage { get; set; } = new();
        public GridTransit Transit { get; set; }
        public List<GridPanel> Panels { get; set; } = new();
    }

    public sealed class GridTransit {
        public long[] WindowS { get; set; } = System.Array.Empty<long>();
        public string LineId { get; set; } = "";
        public long LockedAtS { get; set; }
    }

    public sealed class GridPanel {
        public int Index { get; set; }
        public List<GridLine> Lines { get; set; } = new();
    }

    public sealed class GridLine {
        public string Id { get; set; } = "";
        public string Filter { get; set; } = "";
        public int ExposureS { get; set; }
        public int Planned { get; set; }
        public int Accepted { get; set; }
        public bool Enabled { get; set; }
        public string MoonProfile { get; set; }
        public List<int[]> Safe { get; set; } = new();
    }
}
