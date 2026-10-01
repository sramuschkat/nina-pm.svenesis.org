using System.Windows.Input;

namespace NinaPm.Nina;

/// <summary>Einfacher asynchroner Befehl für die Optionsseite; während des Laufs gesperrt.</summary>
internal sealed class RelayCommand(Func<Task> run) : ICommand
{
    private bool running;

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => !running;

    public async void Execute(object? parameter)
    {
        if (running) return;
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
