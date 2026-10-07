using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;

namespace NinaPm.Nina.Ui.Dock;

/// <summary>
/// Vorlagen der Fenster im Imaging-Reiter (AP-53b): NINA sucht sie unter <c>&lt;voller Typname des ViewModels&gt;_Dockable</c>;
/// NinaPm.Nina bindet das Wörterbuch per MEF ein (NinaPmResources). Hier nur Ansichtslogik: Fensterbreite melden
/// (<see cref="IDockSizeSink"/>) und beim Mitlaufen die laufende Zeile in den Blick scrollen (<see cref="IFollowRows"/>).
/// </summary>
public sealed partial class DockTemplates : ResourceDictionary
{
    public DockTemplates()
    {
        InitializeComponent();
        MergedDictionaries.Add(new ButtonStyles());
    }

    private void OnDockSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: IDockSizeSink sink } && e.WidthChanged) sink.DockWidth(e.NewSize.Width);
    }

    private void OnDockLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: IDockSizeSink sink } element && element.ActualWidth > 0) sink.DockWidth(element.ActualWidth);
    }

    private void OnLogLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is not DataGrid grid || grid.DataContext is not IFollowRows rows) return;
        PropertyChangedEventHandler handler = (_, args) =>
        {
            if (args.PropertyName != nameof(IFollowRows.CurrentRow) || !rows.Follow || rows.CurrentRow is not { } current) return;
            grid.Dispatcher.BeginInvoke(() =>
            {
                grid.UpdateLayout();
                grid.ScrollIntoView(current);
            });
        };
        rows.PropertyChanged += handler;
        grid.Unloaded += (_, _) => rows.PropertyChanged -= handler;
        if (rows.Follow && rows.CurrentRow is { } first) grid.ScrollIntoView(first);
    }
}
