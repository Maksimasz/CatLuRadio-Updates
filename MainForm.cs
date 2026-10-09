using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using LibVLCSharp.Shared;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using YoutubeExplode;
using YoutubeExplode.Videos.Streams;

namespace CatLuRadio
{
    public partial class MainForm : Form
    {
        private WebView2 webView = null!;
        private readonly string dataPath;
        private JObject storeData = new();
        private readonly HttpClient httpClient;
        // Сериализация записи хранилища: без неё параллельные setStore падали
        // с "file is being used by another process" и изменения терялись.
        private readonly SemaphoreSlim storeLock = new(1, 1);
        private long storeSaveSeq;   // последний выданный номер сохранения
        private long storeSavedSeq;  // последний реально записанный на диск

        // ВАЖНО: имя хранилища намеренно отличается от store.json.
        // Старая версия приложения использует тот же каталог
        // %LocalAppData%\CatLuRadio\data и тот же файл store.json — писать туда
        // из этой версии значит затирать данные, которыми пользуются другие.
        private const string StoreFileName = "store_v2.json";

        // Файлы, доступ к которым страница получила через системный диалог
        // (импорт/экспорт). Всё остальное за пределами каталога данных
        // приложения для AppAPI недоступно — иначе XSS в странице превращался
        // бы в запись произвольного файла на диске.
        private readonly HashSet<string> approvedPaths = new(StringComparer.OrdinalIgnoreCase);
        private readonly LibVLC nativeVlc;
        private readonly MediaPlayer nativePlayer;
        private Media? nativeMedia;
        private Equalizer? nativeEqualizer;
        private TaskCompletionSource<bool>? nativeStart;
        // Дроссель событий позиции (nativeTime): TimeChanged сыплет десятки
        // событий в секунду — на UI-поток уходит не чаще раза в 250 мс.
        private long nativeTimeTick;
        private long lastSentTime = long.MinValue;
        private long lastSentLength = long.MinValue;
        // Резолвер YouTube (NuGet YoutubeExplode): списки плейлистов и прямые
        // аудио-потоки для очереди YouTube-плейлистов.
        private readonly YoutubeClient ytClient = new();
        private const string UpdatesApiUrl = "https://api.github.com/repos/Maksimasz/CatLuRadioNET/releases/latest";
        private const string UpdateAssetPrefix = "https://github.com/Maksimasz/CatLuRadioNET/releases/download/";

        private class ApiResponse
        {
            public bool Success { get; set; }
            public object? Data { get; set; }
            public string? Error { get; set; }
            public string? FilePath { get; set; }
            public string? Content { get; set; }
            public int? Status { get; set; }
        }

        public MainForm()
        {
            dataPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CatLuRadio", "data");

            Directory.CreateDirectory(dataPath);

            httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            httpClient.DefaultRequestHeaders.Add("User-Agent", "CatLuRadio/" + Application.ProductVersion);
            Core.Initialize(Path.Combine(AppContext.BaseDirectory, "libvlc", "win-x64"));
            // Фильтры audio-filter на уровне экземпляра LibVLC здесь НЕ работают:
            // SetEqualizer при каждом старте трека перезаписывает переменную
            // "audio-filter" на "equalizer", выкидывая из цепочки и gain, и
            // normvol (проверено: --audio-filter=gain --gain-value=2.0 не менял
            // громкость). Усиление делаем Preamp'ом внутри Equalizer — см.
            // SetNativeEqualizer.
            nativeVlc = new LibVLC("--no-video", "--network-caching=1000");
            nativePlayer = new MediaPlayer(nativeVlc);
            nativePlayer.Playing += (_, _) => nativeStart?.TrySetResult(true);
            nativePlayer.EncounteredError += (_, _) => { nativeStart?.TrySetResult(false); OnNativeError(); };
            // Конец текущего файла (не потока): страница решает, что делать —
            // для YouTube-очереди это сигнал перейти к следующему треку.
            nativePlayer.EndReached += (_, _) => OnNativeEnded();
            // Позиция внутри трека: страница рисует полосу перемотки YouTube.
            nativePlayer.TimeChanged += (_, _) => OnNativeTimeTick();
            LoadStore();
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            try
            {
                this.SuspendLayout();
                webView = new WebView2 { Dock = DockStyle.Fill };
                this.ClientSize = new Size(688, 688);
                this.MinimumSize = new Size(500, 500);
                this.Text = $"CatLu Radio NET v{Application.ProductVersion}";
                this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                this.StartPosition = FormStartPosition.CenterScreen;
                this.FormBorderStyle = FormBorderStyle.Sizable;
                this.Controls.Add(webView);
                InitializeWebView();
                this.ResumeLayout(false);
            }
            catch (Exception ex)
            {
                AppLog.Error("Ошибка инициализации формы", ex);
                MessageBox.Show("InitializeComponent error: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                this.ResumeLayout(false);
            }
        }

        private async void InitializeWebView()
        {
            try
            {
                var runtimeRoot = Path.Combine(AppContext.BaseDirectory, "WebView2Runtime");
                var fixedRuntime = Directory.Exists(runtimeRoot)
                    ? Directory.EnumerateDirectories(runtimeRoot).FirstOrDefault(folder => File.Exists(Path.Combine(folder, "msedgewebview2.exe")))
                    : null;
                AppLog.Info(fixedRuntime is null
                    ? "WebView2: используется встроенный в систему рантайм"
                    : "WebView2: фиксированный рантайм " + Path.GetFileName(fixedRuntime));
                // Автозапуск последней станции при старте: без этого флага Chromium
                // требует жеста пользователя до play(), и автостарт падает с
                // NotAllowedError («пользователь не взаимодействовал со страницей»).
                var envOptions = new CoreWebView2EnvironmentOptions
                {
                    AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required"
                };
                var env = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: fixedRuntime,
                    // Профиль тоже разделяем со старой версией: WebView2 блокирует
                    // userDataFolder на время работы, и без разделения вторая
                    // копия не смогла бы запуститься одновременно с первой.
                    userDataFolder: Path.Combine(dataPath, "WebView2-v2"),
                    options: envOptions);
                await webView.EnsureCoreWebView2Async(env);
                webView.CoreWebView2.Settings.IsWebMessageEnabled = true;
                webView.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = true;
                webView.CoreWebView2.Settings.IsScriptEnabled = true;
                webView.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                webView.WebMessageReceived += WebView_WebMessageReceived;
                // Страница обязана оставаться в нашем wwwroot: иначе любая ссылка
                // уводила бы окно приложения наружу вместе со всем AppAPI.
                webView.CoreWebView2.NavigationStarting += CoreWebView2_NavigationStarting;
                webView.CoreWebView2.NewWindowRequested += CoreWebView2_NewWindowRequested;
                string htmlPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
                if (File.Exists(htmlPath)) {
                    webView.CoreWebView2.Navigate("file://" + htmlPath.Replace("\\", "/"));
                } else {
                    AppLog.Error("Главный файл интерфейса не найден: " + htmlPath);
                    MessageBox.Show("HTML file not found:\n" + htmlPath, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            catch (Exception ex) {
                AppLog.Error("Ошибка инициализации WebView2", ex);
                MessageBox.Show("WebView2 initialization error: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void CoreWebView2_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsAppPage(e.Uri)) return;
            e.Cancel = true;
            AppLog.Warn("Заблокирована навигация страницы: " + e.Uri);
            // Ссылка без target="_blank" раньше просто уводила приложение с главной
            // страницы — теперь открывается во внешнем браузере.
            OpenInBrowser(e.Uri);
        }

        private void CoreWebView2_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // WebView2 по умолчанию открыл бы новое окно в этом же WebView —
            // то есть внешний ресурс получил бы прямой доступ к AppAPI.
            e.Handled = true;
            OpenInBrowser(e.Uri);
        }

        /// <summary>Страница лежит в нашем wwwroot (или это about:).</summary>
        private static bool IsAppPage(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed)) return false;
            if (!parsed.IsFile) return parsed.Scheme == "about";
            try
            {
                string wwwroot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"))
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;
                return Path.GetFullPath(parsed.LocalPath)
                    .StartsWith(wwwroot, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        private static void OpenInBrowser(string uri)
        {
            try
            {
                if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed)) return;
                if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return;
                Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception ex) { AppLog.Error("Не удалось открыть ссылку во внешнем браузере: " + uri, ex); }
        }

        private void LoadStore()
        {
            string storePath = Path.Combine(dataPath, StoreFileName);
            if (File.Exists(storePath)) {
                try { storeData = JObject.Parse(File.ReadAllText(storePath)); }
                catch (Exception ex)
                {
                    // Файл хранилища повреждён — начинаем с пустого, но пишем
                    // об этом в лог, иначе пользователь не поймёт, куда делись станции.
                    AppLog.Error("Файл хранилища повреждён, начинаю с пустого: " + storePath, ex);
                    storeData = new JObject();
                }
            } else { storeData = new JObject(); }
        }

        /// <summary>
        /// Снимок текущего состояния и запуск записи на диск.
        /// Снимок берётся здесь же, в UI-потоке: storeData мутируется только в нём,
        /// а Newtonsoft JObject не потокобезопасен при одновременных чтении и записи.
        /// </summary>
        private void RequestSaveStore()
        {
            long seq = Interlocked.Increment(ref storeSaveSeq);
            string snapshot = storeData.ToString(Formatting.None);
            _ = SaveStoreAsync(seq, snapshot);
        }

        private async Task SaveStoreAsync(long seq, string snapshot)
        {
            // Уже есть запись более нового состояния — эта стала бы откатом.
            if (seq <= Volatile.Read(ref storeSavedSeq)) return;

            string storePath = Path.Combine(dataPath, StoreFileName);
            await storeLock.WaitAsync();
            try
            {
                if (seq <= Volatile.Read(ref storeSavedSeq)) return;

                // Пишем во временный файл и подменяем: падение посреди записи
                // больше не оставляет обрезанный файл хранилища.
                string tempPath = storePath + ".tmp";
                await File.WriteAllTextAsync(tempPath, snapshot, Encoding.UTF8);
                File.Move(tempPath, storePath, overwrite: true);
                Volatile.Write(ref storeSavedSeq, seq);
            }
            catch (Exception ex)
            {
                // Задача выполняется без await: без этого catch исключение терялось бы
                // полностью (теперь ещё и ловится UnobservedTaskException в Program.cs).
                AppLog.Error("Не удалось сохранить хранилище " + storePath, ex);
            }
            finally
            {
                storeLock.Release();
            }
        }

        private void WebView_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            JObject? data = null;
            try
            {
                string message = e.TryGetWebMessageAsString();
                data = JObject.Parse(message);
                string action = data["action"]?.ToString() ?? "";
                string callbackId = data["callbackId"]?.ToString() ?? "";
                
                switch (action)
                {
                    case "getStore":
                        string key = data["key"]?.ToString() ?? "";
                        // Скалярные значения (например stationsVersion) у JValue
                        // ToString() отдаёт без кавычек — JSON.parse на странице
                        // падал и версия всегда читалась как null (лишний merge
                        // станций при каждом старте). Сериализуем как JSON.
                        SendCallback(callbackId, storeData[key] is null ? "null" : JsonConvert.SerializeObject(storeData[key]));
                        break;
                    case "setStore":
                        key = data["key"]?.ToString() ?? "";
                        storeData[key] = data["value"];
                        RequestSaveStore();
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "log":
                        // Диагностика со страницы: консоль WebView2 пользователю
                        // недоступна, а тайминги/таймауты воспроизведения нужны в
                        // app.log для поиска причин «долго подключается».
                        AppLog.Info("[page] " + (data["message"]?.ToString() ?? ""));
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "httpGet":
                        _ = HttpGet(data["url"]?.ToString() ?? "", callbackId);
                        break;
                    case "checkForUpdate":
                        _ = CheckForUpdate(callbackId);
                        break;
                    case "installUpdate":
                        _ = InstallUpdate(data["url"]?.ToString() ?? "", callbackId);
                        break;
                    case "checkStream":
                        _ = CheckStream(data["url"]?.ToString() ?? "", callbackId);
                        break;
                    case "resolveYoutubePlaylist":
                        _ = ResolveYoutubePlaylist(data["url"]?.ToString() ?? "", callbackId);
                        break;
                    case "resolveYoutubeTrack":
                        _ = ResolveYoutubeTrack(data["videoId"]?.ToString() ?? "", callbackId);
                        break;
                    case "playNative":
                        _ = PlayNative(data["url"]?.ToString() ?? "", data["volume"]?.Value<double>() ?? 0.5, callbackId);
                        break;
                    case "pauseNative":
                        nativePlayer.Pause();
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "resumeNative":
                        nativePlayer.Play();
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "stopNative":
                        StopNative();
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "seekNative":
                        SeekNative(data["ms"]?.Value<long>() ?? 0);
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "setNativeVolume":
                        nativePlayer.Volume = (int)Math.Round(Math.Clamp(data["volume"]?.Value<double>() ?? 0.5, 0, 1) * 100);
                        // Смена громкости на лету перестраивает цепочку вывода звука,
                        // иначе эквалайзер (в нём Preamp +6 дБ — громкость уровня
                        // YouTube) слетал: трек после любого движения ползунка
                        // начинал играть тихо, «как до фикса громкости», при
                        // нормальной громкости на старте. Повторное SetEqualizer
                        // заново навешивает ту же цепочку — звук возвращается.
                        if (nativeEqualizer is not null) nativePlayer.SetEqualizer(nativeEqualizer);
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "setNativeEqualizer":
                        SetNativeEqualizer(data["values"] as JArray, callbackId);
                        break;
                    case "showSaveDialog":
                        ShowSaveDialog(data["defaultPath"]?.ToString() ?? "file.json", callbackId);
                        break;
                    case "showOpenDialog":
                        ShowOpenDialog(callbackId);
                        break;
                    case "writeFile":
                        _ = WriteFile(data["path"]?.ToString() ?? "", data["content"]?.ToString() ?? "", callbackId);
                        break;
                    case "readFile":
                        _ = ReadFile(data["path"]?.ToString() ?? "", callbackId);
                        break;
                    case "setWindowSize":
                        SetWindowSize(data["width"]?.Value<int>() ?? Width, data["height"]?.Value<int>() ?? Height);
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "setWindowMinimumSize":
                        SetWindowMinimumSize(data["width"]?.Value<int>() ?? 0, data["height"]?.Value<int>() ?? 0);
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "setWindowResizable":
                        FormBorderStyle = data["resizable"]?.Value<bool>() == false ? FormBorderStyle.FixedSingle : FormBorderStyle.Sizable;
                        MaximizeBox = FormBorderStyle == FormBorderStyle.Sizable;
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "exitApp":
                        BeginInvoke(Close);
                        SendCallback(callbackId, new { success = true });
                        break;
                    case "setMiniPlayer":
                        SetMiniPlayer(data["enabled"]?.Value<bool>() == true);
                        SendCallback(callbackId, new { success = true });
                        break;
                    default:
                        // Раньше неизвестное действие молча игнорировалось: callback
                        // не отправлялся, и промис в странице висел навсегда.
                        AppLog.Warn($"Неизвестное действие из страницы: '{action}'");
                        SendCallback(callbackId, new { success = false, error = "Неизвестное действие: " + action });
                        break;
                }
            }
            catch (Exception ex)
            {
                // Раньше ошибка молча уходила в Console.WriteLine, которого в WinExe нет.
                AppLog.Error($"Ошибка обработки сообщения из страницы (action={data?["action"]})", ex);
            }
        }

        private void SetWindowSize(int width, int height) {
            WindowState = FormWindowState.Normal;
            ClientSize = new Size(Math.Max(width, MinimumSize.Width), Math.Max(height, MinimumSize.Height));
        }
        private void SetWindowMinimumSize(int width, int height) {
            MinimumSize = new Size(Math.Max(0, width), Math.Max(0, height));
        }
        private void SetMiniPlayer(bool enabled) {
            WindowState = FormWindowState.Normal;
            FormBorderStyle = enabled ? FormBorderStyle.FixedSingle : FormBorderStyle.Sizable;
            MaximizeBox = !enabled;
            MinimumSize = enabled ? Size.Empty : new Size(500, 500);
            Size = enabled ? new Size(600, 110) : new Size(688, 688);
        }
        private void SendCallback(string callbackId, object result) {
            if (InvokeRequired) { Invoke(() => SendCallback(callbackId, result)); return; }
            webView.CoreWebView2.PostWebMessageAsString(JsonConvert.SerializeObject(new { callbackId, resultRaw = result }));
        }
        private async Task HttpGet(string url, string callbackId) {
            try {
                string response = await httpClient.GetStringAsync(url);
                SendCallback(callbackId, new ApiResponse { Success = true, Data = response });
            } catch (Exception ex) { SendCallback(callbackId, new ApiResponse { Success = false, Error = ex.Message }); }
        }
        private async Task CheckForUpdate(string callbackId) {
            try {
                var release = JObject.Parse(await httpClient.GetStringAsync(UpdatesApiUrl));
                var tag = release["tag_name"]?.ToString().TrimStart('v', 'V') ?? "";
                var asset = release["assets"]?.FirstOrDefault(item => item?["name"]?.ToString().EndsWith(".exe", StringComparison.OrdinalIgnoreCase) == true);
                var url = asset?["browser_download_url"]?.ToString() ?? "";
                // Сравниваем именно версию сборки: она всегда чисто числовая (3.1.12.0),
                // тогда как ProductVersion (InformationalVersion) может быть
                // дополнен хешем коммита вида 3.1.12+abcdef и не парсится.
                var currentVersion = Assembly.GetExecutingAssembly().GetName().Version;
                var hasUpdate = Version.TryParse(tag, out var latest)
                    && currentVersion is not null
                    && latest > currentVersion;
                SendCallback(callbackId, new { success = true, hasUpdate, version = tag, url });
            } catch (Exception ex) { SendCallback(callbackId, new { success = false, error = ex.Message }); }
        }
        private async Task InstallUpdate(string url, string callbackId) {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !url.StartsWith(UpdateAssetPrefix, StringComparison.OrdinalIgnoreCase)) {
                SendCallback(callbackId, new { success = false, error = "Некорректная ссылка обновления" });
                return;
            }
            try {
                var installerPath = Path.Combine(Path.GetTempPath(), $"CatLuRadio-update-{Guid.NewGuid():N}.exe");
                await using (var source = await httpClient.GetStreamAsync(uri))
                await using (var target = File.Create(installerPath)) await source.CopyToAsync(target);
                Process.Start(new ProcessStartInfo(installerPath) { UseShellExecute = true });
                SendCallback(callbackId, new { success = true });
                BeginInvoke(Close);
            } catch (Exception ex) { SendCallback(callbackId, new { success = false, error = ex.Message }); }
        }
        private async Task CheckStream(string url, string callbackId) {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https")) {
                SendCallback(callbackId, new ApiResponse { Success = false, Error = "Некорректный URL" });
                return;
            }
            try {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                using var response = await httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                SendCallback(callbackId, new ApiResponse { Success = response.IsSuccessStatusCode, Status = (int)response.StatusCode });
            } catch (Exception ex) { SendCallback(callbackId, new ApiResponse { Success = false, Error = ex.Message }); }
        }
        private async Task PlayNative(string url, double volume, string callbackId) {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https")) {
                SendCallback(callbackId, new ApiResponse { Success = false, Error = "Некорректный URL" });
                return;
            }
            try {
                StopNative();
                nativePlayer.Volume = (int)Math.Round(Math.Clamp(volume, 0, 1) * 100);
                nativeMedia = new Media(nativeVlc, uri);
                nativeStart = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                if (!nativePlayer.Play(nativeMedia)) throw new InvalidOperationException("LibVLC не смог открыть поток.");
                var completed = await Task.WhenAny(nativeStart.Task, Task.Delay(TimeSpan.FromSeconds(10)));
                if (completed == nativeStart.Task && await nativeStart.Task) {
                    SendCallback(callbackId, new { success = true });
                    return;
                }
                StopNative();
                SendCallback(callbackId, new { success = false, error = "LibVLC не начал воспроизведение." });
            } catch (Exception ex) { StopNative(); SendCallback(callbackId, new { success = false, error = ex.Message }); }
        }
        private void StopNative() {
            nativeStart?.TrySetResult(false);
            nativeStart = null;
            nativePlayer.Stop();
            nativeMedia?.Dispose();
            nativeMedia = null;
        }

        // Трек доиграл естественно — сообщаем странице событием (без callbackId).
        // Обработчик вызывается из потока libvlc: только BeginInvoke, никаких
        // вызовов самого плеера из этого потока (классический deadlock VLC).
        private void OnNativeEnded() {
            // EndReached приходит с фонового потока libvlc, а свойство CoreWebView2
            // вне UI-потока само бросает InvalidOperationException ("can only be
            // accessed from the UI thread") — guard в тихий catch это глотал,
            // страница не получала nativeEnded и очередь YouTube замирала после
            // первого трека. Как и в SendCallback, сначала переезжаем на UI-поток.
            try {
                if (InvokeRequired) { BeginInvoke(OnNativeEnded); return; }
            } catch (Exception ex) {
                AppLog.Error("nativeEnded: BeginInvoke не прошёл", ex);
                return;
            }
            AppLog.Info("LibVLC: EndReached — двигаем очередь (nativeEnded)");
            try {
                if (!IsHandleCreated || webView?.CoreWebView2 is null) {
                    AppLog.Warn($"nativeEnded: веб-вью не готова (handle={IsHandleCreated}, webView={(webView is null ? "null" : "ok")})");
                    return;
                }
                webView.CoreWebView2.PostWebMessageAsString(
                    JsonConvert.SerializeObject(new { @event = "nativeEnded" }));
                AppLog.Info("nativeEnded: событие отправлено в страницу");
            } catch (Exception ex) {
                AppLog.Error("nativeEnded: не удалось отправить событие", ex);
            }
        }

        // Позиция внутри трека для полосы перемотки YouTube. TimeChanged
        // приходит с фонового потока libvlc и очень часто: дросселируем на
        // этом же потоке (не чаще, чем раз в 250 мс), дальше — BeginInvoke
        // на UI-поток. Как и nativeEnded: никаких вызовов плеера из потока
        // libvlc, чтение Time/Length только на UI-потоке.
        private void OnNativeTimeTick() {
            long now = Environment.TickCount64;
            if (now - Volatile.Read(ref nativeTimeTick) < 250) return;
            Volatile.Write(ref nativeTimeTick, now);
            try {
                if (!IsHandleCreated) return;
                if (InvokeRequired) { BeginInvoke(SendNativeTime); return; }
                SendNativeTime();
            } catch (Exception ex) {
                AppLog.Error("nativeTime: BeginInvoke не прошёл", ex);
            }
        }

        private void SendNativeTime() {
            try {
                if (!IsHandleCreated || webView?.CoreWebView2 is null) return;
                long time = nativePlayer.Time;    // мс; -1 когда медиа уже снято
                long length = nativePlayer.Length;
                // Дежавю не шлём: без этого страница получала бы по 4 события
                // в секунду даже на паузе.
                if (time == lastSentTime && length == lastSentLength) return;
                lastSentTime = time;
                lastSentLength = length;
                webView.CoreWebView2.PostWebMessageAsString(
                    JsonConvert.SerializeObject(new { @event = "nativeTime", time, length }));
            } catch (Exception ex) {
                AppLog.Error("nativeTime: не удалось отправить событие", ex);
            }
        }

        // Перемотка по запросу страницы (ms — новая позиция в миллисекундах).
        // Живые потоки (радио) длительности не имеют — Length <= 0, перемотка
        // для них бессмысленна и молча игнорируется.
        private void SeekNative(long ms) {
            try {
                long length = nativePlayer.Length;
                if (length <= 0) return;
                long target = Math.Clamp(ms, 0, length);
                nativePlayer.Time = target;
                // Не ждём следующего TimeChanged (дроссель до 250 мс):
                // сразу подтверждаем позицию, полоса прыгает мгновенно.
                lastSentTime = -1;
                SendNativeTime();
            } catch (Exception ex) {
                AppLog.Error("seekNative: перемотка не удалась", ex);
            }
        }

        // Поток умер посреди игры (обрыв сети, 403 от googlevideo): страница
        // должна узнать об этом событием — без него очередь молчит после обрыва,
        // а кнопка Play зовёт resumeNative на мёртвом медиа и ничего не делает.
        // Как и OnNativeEnded: только BeginInvoke, без вызовов плеера из
        // потока libvlc.
        private void OnNativeError() {
            // EncounteredError тоже приходит с потока libvlc: вне UI-потока
            // чтение CoreWebView2 бросает InvalidOperationException (см. OnNativeEnded),
            // поэтому сначала BeginInvoke, и только на UI-потоке — guard и отправка.
            AppLog.Warn("LibVLC: ошибка потока воспроизведения");
            try {
                if (InvokeRequired) { BeginInvoke(OnNativeError); return; }
                if (!IsHandleCreated || webView?.CoreWebView2 is null) return;
                webView.CoreWebView2.PostWebMessageAsString(
                    JsonConvert.SerializeObject(new { @event = "nativeError" }));
            } catch (Exception ex) {
                AppLog.Error("nativeError: не удалось отправить событие", ex);
            }
        }

        // Список треков YouTube-плейлиста (или одиночного видео) для добавления
        // в станции. Запрашивается один раз при импорте: сами ссылки на аудио
        // здесь не нужны — они истекают и резолвятся перед каждым треком.
        private async Task ResolveYoutubePlaylist(string url, string callbackId) {
            try {
                var (playlistId, videoId) = ParseYoutubeUrl(url);
                if (playlistId is null && videoId is null) {
                    SendCallback(callbackId, new { success = false, error = "Не похоже на ссылку YouTube" });
                    return;
                }

                string title = "", author = "", thumbnail = "";
                var tracks = new JArray();

                if (playlistId is not null) {
                    var playlist = await ytClient.Playlists.GetAsync(playlistId);
                    title = playlist.Title;
                    author = playlist.Author?.ChannelTitle ?? "";
                    await foreach (var video in ytClient.Playlists.GetVideosAsync(playlistId)) {
                        if (tracks.Count >= 200) break;
                        tracks.Add(TrackJson(video.Id.Value, video.Title, video.Author?.ChannelTitle, video.Duration));
                        if (thumbnail.Length == 0 && video.Thumbnails.Count > 0)
                            thumbnail = video.Thumbnails[^1].Url;
                    }
                } else {
                    var video = await ytClient.Videos.GetAsync(videoId!);
                    title = video.Title;
                    author = video.Author?.ChannelTitle ?? "";
                    if (video.Thumbnails.Count > 0) thumbnail = video.Thumbnails[^1].Url;
                    tracks.Add(TrackJson(video.Id.Value, video.Title, video.Author?.ChannelTitle, video.Duration));
                }

                if (tracks.Count == 0) {
                    SendCallback(callbackId, new { success = false, error = "Плейлист пуст" });
                    return;
                }
                SendCallback(callbackId, new { success = true, title, author, thumbnail, tracks });
            } catch (Exception ex) { SendCallback(callbackId, new { success = false, error = ex.Message }); }
        }

        // Прямая ссылка на аудио одного трека. Вызывается непосредственно перед
        // запуском: googlevideo URL живёт несколько часов и привязан к IP,
        // поэтому кешировать его бессмысленно.
        private async Task ResolveYoutubeTrack(string videoId, string callbackId) {
            if (string.IsNullOrWhiteSpace(videoId)) {
                SendCallback(callbackId, new { success = false, error = "Пустой идентификатор видео" });
                return;
            }
            try {
                var manifest = await ytClient.Videos.Streams.GetManifestAsync(videoId);
                var audio = manifest.GetAudioOnlyStreams().GetWithHighestBitrate();
                if (audio is null) {
                    SendCallback(callbackId, new { success = false, error = "Аудио-поток не найден" });
                    return;
                }
                SendCallback(callbackId, new { success = true, url = audio.Url, container = audio.Container.Name });
            } catch (Exception ex) { SendCallback(callbackId, new { success = false, error = ex.Message }); }
        }

        private static JObject TrackJson(string id, string title, string? channelTitle, TimeSpan? duration) {
            return new JObject {
                ["id"] = id,
                ["title"] = title,
                ["author"] = channelTitle ?? "",
                ["duration"] = (int)(duration ?? TimeSpan.Zero).TotalSeconds
            };
        }

        // Понимает основные формы ссылок: playlist?list=..., watch?v=...&list=...,
        // youtu.be/ID, shorts/ID, live/ID. Плейлист важнее одиночного видео:
        // watch?v=X&list=RD... — это «радио» вокруг видео X.
        private static (string? PlaylistId, string? VideoId) ParseYoutubeUrl(string url) {
            if (!Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var uri)) return (null, null);
            string? list = QueryParam(uri, "list");
            string? video = QueryParam(uri, "v");
            if (string.IsNullOrWhiteSpace(video)) {
                var segments = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
                if (segments.Length >= 2 && segments[0] is "shorts" or "embed" or "live" or "v") video = segments[1];
                else if (uri.Host.Contains("youtu.be", StringComparison.OrdinalIgnoreCase)) video = segments.FirstOrDefault();
            }
            return (
                string.IsNullOrWhiteSpace(list) ? null : list,
                string.IsNullOrWhiteSpace(video) ? null : video
            );
        }

        private static string? QueryParam(Uri uri, string name) {
            foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)) {
                var parts = pair.Split('=', 2);
                if (string.Equals(Uri.UnescapeDataString(parts[0]), name, StringComparison.OrdinalIgnoreCase))
                    return parts.Length > 1 ? Uri.UnescapeDataString(parts[1].Replace('+', ' ')) : "";
            }
            return null;
        }

        // Общее усиление воспроизведения YouTube в дБ. Ютубовская нормализация
        // поднимает тихие ролики примерно на +6 дБ: без этого ролик, который на
        // YouTube на 50% слайдера даёт привычную громкость, требовал бы в
        // нашем плеере 100%. Preamp эквалайзера — «global gain in dB (-20..20)»
        // и живёт внутри фильтра equalizer, поэтому SetEqualizer его не выкинет.
        private const float NativeGainDb = 6f;

        private void SetNativeEqualizer(JArray? values, string callbackId) {
            nativeEqualizer?.Dispose();
            nativeEqualizer = null;
            // Применяем эквалайзер ВСЕГДА (даже когда он выключен): раньше
            // ветка UnsetEqualizer гасила и общий gain, из-за чего громкость
            // прыгала в зависимости от состояния эквалайзера. Пустой эквалайзер
            // — ровные полосы + Preamp, т.е. звук тот же, громкость та же.
            nativeEqualizer = new Equalizer();
            nativeEqualizer.SetPreamp(NativeGainDb);
            if (values is not null) {
                for (uint index = 0; index < nativeEqualizer.BandCount && index < values.Count; index++) {
                    // Индексатор JArray принимает только int/string: uint давал
                    // ArgumentException ("Int32 array index expected") до SendCallback —
                    // страница висела 20 секунд на каждый запуск трека, и за это
                    // время у коротких треков успевало сработать nativeEnded,
                    // которое guard isSwitching молча отбрасывал.
                    nativeEqualizer.SetAmp(Math.Clamp(values[(int)index]?.Value<float>() ?? 0, -12, 12), index);
                }
            }
            var success = nativePlayer.SetEqualizer(nativeEqualizer);
            if (!success) { nativeEqualizer.Dispose(); nativeEqualizer = null; }
            SendCallback(callbackId, new { success });
        }
        private void ShowSaveDialog(string defaultPath, string callbackId) {
            using var dialog = new SaveFileDialog { FileName = Path.GetFileName(defaultPath), Filter = "JSON files|*.json|All files|*.*", Title = "Save file" };
            if (dialog.ShowDialog() == DialogResult.OK) {
                ApprovePath(dialog.FileName);
                SendCallback(callbackId, new ApiResponse { Success = true, FilePath = dialog.FileName });
            }
            else SendCallback(callbackId, new ApiResponse { Success = false });
        }
        private void ShowOpenDialog(string callbackId) {
            using var dialog = new OpenFileDialog { Filter = "JSON files|*.json|All files|*.*", Title = "Select file" };
            if (dialog.ShowDialog() == DialogResult.OK) {
                ApprovePath(dialog.FileName);
                SendCallback(callbackId, new ApiResponse { Success = true, Data = new[] { dialog.FileName } });
            }
            else SendCallback(callbackId, new ApiResponse { Success = false });
        }

        /// <summary>
        /// Разрешает доступ к файлу, который пользователь явно выбрал в системном
        /// диалоге (импорт/экспорт станций). Путь запоминается на время сессии.
        /// </summary>
        private void ApprovePath(string path) {
            try { approvedPaths.Add(Path.GetFullPath(path)); }
            catch (Exception ex) { AppLog.Warn("Не удалось запомнить путь из диалога: " + path, ex); }
        }

        /// <summary>
        /// Каталог данных приложения и пути, выбранные пользователем в диалоге.
        /// Всё остальное — отказ.
        /// </summary>
        private bool IsPathAllowed(string path) {
            if (string.IsNullOrWhiteSpace(path)) return false;
            string full;
            try { full = Path.GetFullPath(path); }
            catch { return false; }

            if (approvedPaths.Contains(full)) return true;

            string root = Path.GetFullPath(dataPath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            return full.StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        private async Task WriteFile(string path, string content, string callbackId) {
            if (!IsPathAllowed(path)) {
                AppLog.Warn("Отказ в записи файла из страницы: " + path);
                SendCallback(callbackId, new ApiResponse { Success = false, Error = "Файл за пределами каталога приложения: " + path });
                return;
            }
            try {
                await File.WriteAllTextAsync(path, content, Encoding.UTF8);
                SendCallback(callbackId, new ApiResponse { Success = true });
            } catch (Exception ex) { SendCallback(callbackId, new ApiResponse { Success = false, Error = ex.Message }); }
        }
        private async Task ReadFile(string path, string callbackId) {
            if (!IsPathAllowed(path)) {
                AppLog.Warn("Отказ в чтении файла из страницы: " + path);
                SendCallback(callbackId, new ApiResponse { Success = false, Error = "Файл за пределами каталога приложения: " + path });
                return;
            }
            try {
                string content = await File.ReadAllTextAsync(path, Encoding.UTF8);
                SendCallback(callbackId, new ApiResponse { Success = true, Content = content });
            } catch (Exception ex) { SendCallback(callbackId, new ApiResponse { Success = false, Error = ex.Message }); }
        }
        protected override void OnFormClosing(FormClosingEventArgs e) {
            base.OnFormClosing(e);
            // Ждём незавершённых записей (коротко: приложение закрывается),
            // иначе финальная запись могла бы конфликтовать с пишущейся задачей.
            bool locked = storeLock.Wait(TimeSpan.FromSeconds(2));
            try {
                string storePath = Path.Combine(dataPath, StoreFileName);
                File.WriteAllText(storePath + ".tmp", storeData.ToString(), Encoding.UTF8);
                File.Move(storePath + ".tmp", storePath, overwrite: true);
                // Все сохранения, выданные до этого момента, устарели.
                Volatile.Write(ref storeSavedSeq, Volatile.Read(ref storeSaveSeq));
            }
            catch (Exception ex) { AppLog.Error("Не удалось сохранить хранилище при выходе", ex); }
            finally { if (locked) storeLock.Release(); }
            httpClient.Dispose();
            StopNative();
            nativeEqualizer?.Dispose();
            nativePlayer.Dispose();
            nativeVlc.Dispose();
            webView.Dispose();
        }
    }
}
