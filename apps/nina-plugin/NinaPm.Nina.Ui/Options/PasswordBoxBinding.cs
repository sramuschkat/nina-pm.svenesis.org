using System.Windows;
using System.Windows.Controls;

namespace NinaPm.Nina.Ui.Options;

/// <summary>
/// Bindung für <see cref="PasswordBox.Password"/> (WPF bietet keine): <c>Attach="True"</c> meldet Eingaben an die
/// gebundene Eigenschaft <c>Password</c>, Änderungen der Eigenschaft (Leeren nach dem Speichern) gehen zurück in die
/// Box. Eigener Schalter, weil sich die gebundene Eigenschaft beim Öffnen nicht ändert (leer bleibt leer) und ein
/// Anmelden im Änderungs-Rückruf deshalb nie geschähe. Der Klartext bleibt nur im Speicher (SV-08).
/// </summary>
public static class PasswordBoxBinding
{
    public static readonly DependencyProperty PasswordProperty = DependencyProperty.RegisterAttached(
        "Password", typeof(string), typeof(PasswordBoxBinding),
        new FrameworkPropertyMetadata("", FrameworkPropertyMetadataOptions.BindsTwoWayByDefault, OnPasswordChanged));

    public static readonly DependencyProperty AttachProperty = DependencyProperty.RegisterAttached(
        "Attach", typeof(bool), typeof(PasswordBoxBinding), new PropertyMetadata(false, OnAttachChanged));

    public static string GetPassword(DependencyObject d) => (string)d.GetValue(PasswordProperty);

    public static void SetPassword(DependencyObject d, string value) => d.SetValue(PasswordProperty, value);

    public static bool GetAttach(DependencyObject d) => (bool)d.GetValue(AttachProperty);

    public static void SetAttach(DependencyObject d, bool value) => d.SetValue(AttachProperty, value);

    private static void OnAttachChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not PasswordBox box) return;
        box.PasswordChanged -= OnBoxPasswordChanged;
        if (e.NewValue is true) box.PasswordChanged += OnBoxPasswordChanged;
    }

    private static void OnBoxPasswordChanged(object sender, RoutedEventArgs e)
    {
        var box = (PasswordBox)sender;
        if (GetPassword(box) != box.Password) SetPassword(box, box.Password);
    }

    private static void OnPasswordChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not PasswordBox box) return;
        var text = e.NewValue as string ?? "";
        if (box.Password != text) box.Password = text;
    }
}
