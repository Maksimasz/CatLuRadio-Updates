using System;
using System.Windows.Forms;

namespace CatLuRadio
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();

            // Без этих обработчиков любое необработанное исключение превращалось
            // в стандартный диалог Windows и мгновенную смерть приложения —
            // причём пользователь не видел, что произошло, а в лог ничего не попадало.
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, e) =>
            {
                AppLog.Error("Необработанное исключение UI-потока", e.Exception);
                MessageBox.Show(
                    "Произошла ошибка:\n" + e.Exception.Message +
                    "\n\nПодробности: " + AppLog.CurrentPath,
                    "CatLu Radio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            {
                AppLog.Error("Необработанное исключение домена", e.ExceptionObject as Exception);
            };
            TaskScheduler.UnobservedTaskException += (_, e) =>
            {
                // Иначе fire-and-forget задачи (например, SaveStoreAsync) теряли
                // свои исключения без следа.
                AppLog.Error("Исключение ненаблюдаемой задачи", e.Exception);
                e.SetObserved();
            };

            AppLog.Info("Запуск приложения " + Application.ProductVersion);
            Application.Run(new MainForm());
            AppLog.Info("Завершение приложения");
        }
    }
}
