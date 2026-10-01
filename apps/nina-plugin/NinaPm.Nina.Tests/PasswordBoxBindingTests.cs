using System.ComponentModel;
using System.Windows.Controls;
using System.Windows.Data;
using NinaPm.Nina.Ui.Options;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Token-Eingabe der Optionsseite (P-04): Tippen in die PasswordBox erreicht die gebundene Eigenschaft, auch wenn
/// diese beim Öffnen leer ist und leer bleibt; Leeren nach dem Speichern leert die Box.
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class PasswordBoxBindingTests
{
    private sealed class Holder : INotifyPropertyChanged
    {
        private string value = "";

        public event PropertyChangedEventHandler? PropertyChanged;

        public string Value
        {
            get => value;
            set
            {
                this.value = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Value)));
            }
        }
    }

    private static (PasswordBox Box, Holder Holder) Bound()
    {
        var holder = new Holder();
        var box = new PasswordBox();
        PasswordBoxBinding.SetAttach(box, true);
        box.SetBinding(PasswordBoxBinding.PasswordProperty, new Binding(nameof(Holder.Value)) { Source = holder, Mode = BindingMode.TwoWay });
        return (box, holder);
    }

    [Fact]
    public void Eingabe_erreicht_die_leere_Eigenschaft() => Sta.Run(() =>
    {
        var (box, holder) = Bound();
        box.Password = "npm_test";
        Assert.Equal("npm_test", holder.Value);
    });

    [Fact]
    public void Leeren_der_Eigenschaft_leert_die_Box() => Sta.Run(() =>
    {
        var (box, holder) = Bound();
        box.Password = "npm_test";
        holder.Value = "";
        Assert.Equal("", box.Password);
    });

    [Fact]
    public void Ohne_Attach_keine_Meldung() => Sta.Run(() =>
    {
        var holder = new Holder();
        var box = new PasswordBox();
        box.SetBinding(PasswordBoxBinding.PasswordProperty, new Binding(nameof(Holder.Value)) { Source = holder, Mode = BindingMode.TwoWay });
        box.Password = "npm_test";
        Assert.Equal("", holder.Value);
    });
}
