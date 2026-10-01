using System.Windows;
using System.Windows.Controls;

namespace NinaPm.Nina.Ui.Options;

/// <summary>
/// Bindung für <see cref="PasswordBox.Password"/> (WPF bietet keine): schreibt Eingaben in die gebundene Eigenschaft.
/// Das Plugin leert die Eigenschaft nach dem Speichern; der Klartext bleibt nur im Speicher (SV-08).
/// </summary>
public static class PasswordBoxBinding
{
    public static readonly DependencyProperty PasswordProperty = DependencyProperty.RegisterAttached(
        "Password", typeof(string), typeof(PasswordBoxBinding),
        new FrameworkPropertyMetadata("", FrameworkPropertyMetadataOptions.BindsTwoWayByDefault, OnPasswordChanged));

    private static readonly DependencyProperty AttachedProperty = DependencyProperty.RegisterAttached(
        "Attached", typeof(bool), typeof(PasswordBoxBinding), new PropertyMetadata(false));

    public static string GetPassword(DependencyObject d) => (string)d.GetValue(PasswordProperty);

    public static void SetPassword(DependencyObject d, string value) => d.SetValue(PasswordProperty, value);

    private static void OnPasswordChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not PasswordBox box) return;
        if (!(bool)box.GetValue(AttachedProperty))
        {
            box.SetValue(AttachedProperty, true);
            box.PasswordChanged += (_, _) => SetPassword(box, box.Password);
        }
        var text = e.NewValue as string ?? "";
        if (box.Password != text) box.Password = text;
    }
}
