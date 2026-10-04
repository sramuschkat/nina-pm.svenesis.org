using System.Windows.Input;

namespace NinaPm.Nina;

/// <summary>
/// Einfacher asynchroner Befehl für die Optionsseite; während des eigenen Laufs gesperrt und zusätzlich, solange
/// <paramref name="blocked"/> wahr ist (gemeinsame Sperre mehrerer Knöpfe, z. B. während einer Simulation).
/// </summary>
internal sealed class RelayCommand(Func<Task> run, Func<bool>? blocked = null) : ICommand
{
    private bool running;

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => !running && !(blocked?.Invoke() ?? false);

    /// <summary>Sperrzustand neu abfragen lassen (nach einer Änderung von <paramref name="blocked"/>).</summary>
    public void Requery() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);

    public async void Execute(object? parameter)
    {
        if (!CanExecute(parameter)) return;
        running = true;
        CanExecuteChanged?.Invoke(this, EventArgs.Empty);
        try
        {
            await run();
        }
        finally
        {
            running = false;
            CanExecuteChanged?.Invoke(this, EventArgs.Empty);
        }
    }
}
