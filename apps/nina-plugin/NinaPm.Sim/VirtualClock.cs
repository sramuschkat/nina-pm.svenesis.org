using NinaPm.Core.Time;

namespace NinaPm.Sim;

/// <summary>
/// Virtuelle Uhr des kopflosen Nachtlaufs: die Zeit springt, Zeitgeber (Heartbeat, Schritte des Laufs) laufen in
/// zeitlicher Reihenfolge, während jemand die Uhr vorstellt (<see cref="AdvanceToAsync"/>). Es treibt immer nur einer:
/// die laufende Sequenz oder – ohne Sequenz – die Hauptschleife.
/// </summary>
public sealed class VirtualClock(DateTimeOffset start) : IClock
{
    private readonly object gate = new();
    private readonly List<Timer> timers = [];
    private long seq;

    public DateTimeOffset UtcNow { get; private set; } = start.ToUniversalTime();

    public sealed class Timer
    {
        internal DateTimeOffset Due;
        internal long Seq;
        internal Func<Task> Callback = () => Task.CompletedTask;
        internal TimeSpan? Every;
        public bool Cancelled { get; set; }
    }

    public Timer At(DateTimeOffset due, Func<Task> callback, TimeSpan? every = null)
    {
        lock (gate)
        {
            var t = new Timer { Due = due, Seq = ++seq, Callback = callback, Every = every };
            timers.Add(t);
            return t;
        }
    }

    public DateTimeOffset? NextDue()
    {
        lock (gate) return timers.Where(t => !t.Cancelled).Select(t => (DateTimeOffset?)t.Due).Min();
    }

    /// <summary>
    /// Uhr bis <paramref name="target"/> vorstellen, fällige Zeitgeber unterwegs ausführen. Wirft, sobald
    /// <paramref name="token"/> abgebrochen ist (die Zeit bleibt dann beim auslösenden Zeitgeber stehen); kehrt früh
    /// zurück, wenn <paramref name="stop"/> nach einem Zeitgeber wahr ist.
    /// </summary>
    public async Task AdvanceToAsync(DateTimeOffset target, CancellationToken token, Func<bool>? stop = null)
    {
        while (true)
        {
            token.ThrowIfCancellationRequested();
            Timer? next;
            lock (gate)
            {
                timers.RemoveAll(t => t.Cancelled);
                next = timers.Where(t => t.Due <= target).OrderBy(t => t.Due).ThenBy(t => t.Seq).FirstOrDefault();
                if (next is not null)
                {
                    if (next.Due > UtcNow) UtcNow = next.Due;
                    if (next.Every is { } every) next.Due += every;
                    else timers.Remove(next);
                }
            }
            if (next is null) break;
            await next.Callback().ConfigureAwait(false);
            if (stop?.Invoke() == true) return;
        }
        token.ThrowIfCancellationRequested();
        if (target > UtcNow) UtcNow = target;
    }
}
