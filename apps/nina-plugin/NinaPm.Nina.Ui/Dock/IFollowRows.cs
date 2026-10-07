using System.ComponentModel;

namespace NinaPm.Nina.Ui.Dock;

/// <summary>Protokoll-Fenster mit *Mitlaufen* (AP-53b): die Vorlage scrollt <see cref="CurrentRow"/> in den Blick, solange <see cref="Follow"/> gilt.</summary>
public interface IFollowRows : INotifyPropertyChanged
{
    bool Follow { get; }

    object? CurrentRow { get; }
}
