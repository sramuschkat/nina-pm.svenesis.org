namespace NinaPm.Nina.Ui.Dock;

/// <summary>
/// Fensterbreite an das ViewModel melden (AP-53b): die Plangrafik wird in Pixeln aufgebaut und passt sich so der Breite des
/// angedockten Fensters an; schmal (unter <see cref="NarrowWidth"/>) stapelt sich die Statuszeile. NinaPm.Nina.Ui kennt die
/// ViewModels nicht, darum diese Schnittstelle.
/// </summary>
public interface IDockSizeSink
{
    public const double NarrowWidth = 500;

    void DockWidth(double width);
}
