using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CatLuRadio
{
    /// <summary>
    /// Резолвер YouTube на yt-dlp.exe — замена NuGet-пакета YouTubeExplode
    /// (убран 2026-10-09: у неё сплошные 403 Forbidden на каждый резолв,
    /// «Не удалось воспроизвести плейлист» — см. app.log; yt-dlp на том же
    /// канале отдаёт и список, и прямую ссылку за ~3 с, проверено живыми
    /// замерами на плейлисте пользователя).
    ///
    /// Исполнительный файл ищем по порядку:
    ///  1) рядом с приложением — установщик кладёт yt-dlp.exe в каталог программы;
    ///  2) в %LocalAppData%\CatLuRadio — сюда приложение скачивает его само
    ///     (сборка из исходников, где файла нет в git);
    ///  3) в PATH — yt-dlp мог поставить сам пользователь;
    /// иначе (один раз) скачиваем официальный релиз с github.com/yt-dlp/yt-dlp.
    ///
    /// Все вызовы: скрытое окно, UTF-8, чтение stdout/stderr параллельно
    /// (иначе переполнение буфера вешает процесс), таймаут с убийством.
    /// </summary>
    internal static class YtDlp
    {
        private const string DownloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
        private static readonly SemaphoreSlim DownloadGate = new(1, 1);
        private static string? cachedPath;

        internal static string DataDir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CatLuRadio");

        /// <summary>Путь к yt-dlp.exe или null, если нигде не найден.</summary>
        private static string? Locate()
        {
            if (cachedPath is not null && File.Exists(cachedPath)) return cachedPath;
            var candidates = new[]
            {
                Path.Combine(AppContext.BaseDirectory, "yt-dlp.exe"),
                Path.Combine(DataDir, "yt-dlp.exe"),
            };
            foreach (var candidate in candidates)
                if (File.Exists(candidate)) return cachedPath = candidate;
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator))
            {
                try
                {
                    var candidate = Path.Combine(dir.Trim(), "yt-dlp.exe");
                    if (File.Exists(candidate)) return cachedPath = candidate;
                }
                catch { /* мусорный сегмент PATH не должен ронять поиск */ }
            }
            return null;
        }

        /// <summary>
        /// Путь к yt-dlp.exe; при отсутствии — скачивание в каталог данных
        /// (один раз, с защитой от параллельных вызовов).
        /// </summary>
        internal static async Task<string?> EnsureAsync()
        {
            var found = Locate();
            if (found is not null) return found;

            await DownloadGate.WaitAsync().ConfigureAwait(false);
            try
            {
                found = Locate(); // могли скачать, пока ждали замок
                if (found is not null) return found;

                Directory.CreateDirectory(DataDir);
                string target = Path.Combine(DataDir, "yt-dlp.exe");
                string temp = target + ".part";
                AppLog.Info("yt-dlp: не найден, скачиваю " + DownloadUrl);
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
                await using (var source = await http.GetStreamAsync(DownloadUrl).ConfigureAwait(false))
                await using (var sink = File.Create(temp))
                {
                    await source.CopyToAsync(sink).ConfigureAwait(false);
                }
                File.Move(temp, target, overwrite: true);
                AppLog.Info($"yt-dlp: скачан в {target} ({new FileInfo(target).Length} байт)");
                return Locate();
            }
            catch (Exception ex)
            {
                AppLog.Error("yt-dlp: скачивание не удалось", ex);
                return null;
            }
            finally { DownloadGate.Release(); }
        }

        /// <summary>
        /// Запуск yt-dlp с аргументами. При успехе — (stdout, null), иначе
        /// (null, причина): первая строка stderr с «ERROR:» (это же видит
        /// пользователь в toast) либо текст таймаута/сбоя.
        /// </summary>
        internal static async Task<(string? Stdout, string? Error)> RunAsync(string[] args, int timeoutMs)
        {
            var exe = await EnsureAsync().ConfigureAwait(false);
            if (exe is null)
                return (null, "yt-dlp.exe не найден и скачать его не удалось — проверьте интернет");

            var stopwatch = Stopwatch.StartNew();
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = exe,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                foreach (var arg in args) psi.ArgumentList.Add(arg);
                using var process = Process.Start(psi)
                    ?? throw new InvalidOperationException("Не удалось запустить yt-dlp");

                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();
                if (!await Task.Run(() => process.WaitForExit(timeoutMs)).ConfigureAwait(false))
                {
                    try { process.Kill(entireProcessTree: true); } catch { /* уже завершился */ }
                    // Гасим задачи чтения, чтобы убитый процесс не оставил
                    // ненаблюдаемые исключения в логе.
                    try { await Task.WhenAll(stdoutTask, stderrTask).ConfigureAwait(false); } catch { }
                    AppLog.Warn($"yt-dlp: таймаут {timeoutMs} мс ({args.FirstOrDefault()})");
                    return (null, "yt-dlp: превышено время ожидания ответа");
                }

                string stdout = await stdoutTask.ConfigureAwait(false);
                string stderr = await stderrTask.ConfigureAwait(false);
                stopwatch.Stop();
                if (process.ExitCode != 0)
                {
                    AppLog.Warn($"yt-dlp: exit {process.ExitCode} за {stopwatch.ElapsedMilliseconds} мс: {ErrorLine(stderr) ?? stderr.Trim().Truncate(300)}");
                    return (null, ErrorLine(stderr) ?? $"yt-dlp завершился с кодом {process.ExitCode}");
                }
                AppLog.Info($"yt-dlp: {stopwatch.ElapsedMilliseconds} мс, exit 0 ({args.FirstOrDefault()})");
                return (stdout, null);
            }
            catch (Exception ex)
            {
                AppLog.Error("yt-dlp: сбой запуска", ex);
                return (null, ex.Message);
            }
        }

        /// <summary>Первый значимый вывод ошибки: строка с «ERROR:» либо первая непустая, до 300 символов.</summary>
        private static string? ErrorLine(string? text)
        {
            var lines = (text ?? "")
                .Split('\n')
                .Select(line => line.Trim())
                .Where(line => line.Length > 0)
                .ToArray();
            var chosen = lines.FirstOrDefault(line => line.Contains("ERROR:", StringComparison.Ordinal))
                ?? lines.FirstOrDefault();
            if (chosen is null) return null;
            return chosen.Length > 300 ? chosen[..300] : chosen;
        }
    }

    internal static class StringClipExtensions
    {
        /// <summary>Обрезка до n символов без исключений (для логов).</summary>
        public static string Truncate(this string value, int n) =>
            string.IsNullOrEmpty(value) || value.Length <= n ? value : value[..n];
    }
}
