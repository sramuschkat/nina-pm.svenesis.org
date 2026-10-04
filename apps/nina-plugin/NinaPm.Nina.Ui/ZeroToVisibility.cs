using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace NinaPm.Nina.Ui;

/// <summary>Anzahl 0 → <c>Visible</c>, sonst <c>Collapsed</c> (Hinweis „Anweisungen hierher ziehen …“ in leeren Flat-Boxen).</summary>
public sealed class ZeroToVisibility : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is 0 ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
