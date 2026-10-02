using System;
using System.IO;
using System.Text;

namespace CatLuRadio
{
    /// <summary>
    /// Простой файловый логгер.
    /// Console.WriteLine в WinExe-приложении никуда не выводится — ошибки терялись
    /// молча. Теперь всё пишется в %LocalAppData%\CatLuRadio\logs\app.log
    /// с ротацией, чтобы лог не рос бесконечно.
    /// </summary>
    internal static class AppLog
    {
        private static readonly object Sync = new();
        private static readonly string LogDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CatLuRadio", "logs");
        private static readonly string LogFile = Path.Combine(LogDir, "app.log");

        private const long MaxBytes = 1024 * 1024; // 1 МБ — дальше ротируем

        public static string CurrentPath => LogFile;

        public static void Info(string message) => Write("INFO ", message, null);

        public static void Error(string message, Exception? ex = null) => Write("ERROR", message, ex);

        public static void Warn(string message, Exception? ex = null) => Write("WARN ", message, ex);

        private static void Write(string level, string message, Exception? ex)
        {
            // Логгер не имеет права ронять приложение — проглатываем свои же ошибки.
            try
            {
                lock (Sync)
                {
                    Directory.CreateDirectory(LogDir);
                    RotateIfNeeded();

                    var sb = new StringBuilder();
                    sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"))
                      .Append(" [").Append(level).Append("] ")
                      .Append(message);

                    if (ex is not null)
                    {
                        sb.Append(" | ").Append(ex.GetType().Name).Append(": ").Append(ex.Message);
                        if (ex.StackTrace is not null)
                        {
                            sb.AppendLine().Append(ex.StackTrace);
                        }
                    }

                    File.AppendAllText(LogFile, sb.AppendLine().ToString(), Encoding.UTF8);
                }
            }
            catch
            {
                // Игнорируем: падение записи лога не должно мешать работе.
            }
        }

        private static void RotateIfNeeded()
        {
            var info = new FileInfo(LogFile);
            if (!info.Exists || info.Length < MaxBytes) return;

            var previous = Path.Combine(LogDir, "app.prev.log");
            if (File.Exists(previous)) File.Delete(previous);
            File.Move(LogFile, previous);
        }
    }
}
