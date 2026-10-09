using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace CatLuRadio
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        // Имя объекта ядра привязано к каталогу данных: копия с другим
        // каталогом (тестовая сборка) не считается «вторым экземпляром».
        // '\' в имени задаёт пространство ядра, поэтому спецсимволы пути
        // заменяем на '_'.
        private static string SingleInstanceName()
        {
            string dataRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CatLuRadio");
            return @"Local\CatLuRadioNET_" + dataRoot.Replace('\\', '_').Replace(':', '_');
        }

        // Найденная вторая копия лишь выводит первое окно на первый план —
        // пользователь не должен получить два плеера с общим хранилищем.
        private static void FocusExistingInstance()
        {
            try
            {
                foreach (Process process in Process.GetProcessesByName("CatLuRadio"))
                {
                    if (process.Id == Environment.ProcessId || process.MainWindowHandle == IntPtr.Zero) continue;
                    ShowWindow(process.MainWindowHandle, 9); // SW_RESTORE
                    SetForegroundWindow(process.MainWindowHandle);
                    break;
                }
            }
            catch { /* фокус не критичен для запуска */ }
        }

        [STAThread]
        static void Main()
        {
            // Один живой экземпляр на каталог данных: две копии затирают
            // станции друг друга общими записями store и играют одновременно
            // (биения громкости). Вторая копия лишь активирует первое окно.
            // Ссылка переживает Application.Run через GC.KeepAlive ниже —
            // иначе mutex может быть собран до выхода и «второй» стартует.
            var singleInstanceMutex = new Mutex(true, SingleInstanceName(), out bool isFirstInstance);
            if (!isFirstInstance)
            {
                FocusExistingInstance();
                return;
            }

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
                    "CatLu Radio NET", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            GC.KeepAlive(singleInstanceMutex);
            AppLog.Info("Завершение приложения");
        }
    }
}
