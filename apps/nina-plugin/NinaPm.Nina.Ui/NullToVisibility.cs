using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace NinaPm.Nina.Ui;

/// <summary><c>null</c> → <c>Collapsed</c>, sonst <c>Visible</c>; mit <see cref="Invert"/> umgekehrt (Live-Status vor dem Einrichten).</summary>
public sealed class NullToVisibility : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        (value is null) ^ Invert ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
