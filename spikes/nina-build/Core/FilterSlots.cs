namespace NinaBuild.Core;

/// <summary>Filterrad-Plätze: NINA zählt ab 0, NINA-PM ab 1 (execution.md §4.4).</summary>
public static class FilterSlots
{
    public static int FromNina(int ninaPosition) => ninaPosition + 1;

    public static int ToNina(int slot) => slot - 1;
}
