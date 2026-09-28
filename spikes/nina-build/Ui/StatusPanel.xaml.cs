using System.Windows.Controls;

namespace NinaBuild.Ui;

public partial class StatusPanel : UserControl
{
    public StatusPanel()
    {
        InitializeComponent();
        Label.Text = "NINA-PM";
    }
}
