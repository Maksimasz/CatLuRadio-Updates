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
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CatLuRadio
{
    public partial class MainForm : Form
    {
        private WebView2 webView = null!;
        private readonly string dataPath;
        private JObject storeData = new();
        private readonly HttpClient httpClient;
        private readonly LibVLC nativeVlc;
        private readonly MediaPlayer nativePlayer;
        private Media? nativeMedia;
        private Equalizer? nativeEqualizer;
        private TaskCompletionSource<bool>? nativeStart;
        private const string UpdatesApiUrl = "https://api.github.com/repos/Maksimasz/CatLuRadio-Updates/releases/latest";
        private const string UpdateAssetPrefix = "https://github.com/Maksimasz/CatLuRadio-Updates/releases/download/";

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
            httpClient.DefaultRequestHeaders.Add("User-Agent", "CatLuRadio/3.1.7");
            Core.Initialize(Path.Combine(AppContext.BaseDirectory, "libvlc", "win-x64"));
            nativeVlc = new LibVLC("--no-video", "--network-caching=1000");
            nativePlayer = new MediaPlayer(nativeVlc);
            nativePlayer.Playing += (_, _) => nativeStart?.TrySetResult(true);
            nativePlayer.EncounteredError += (_, _) => nativeStart?.TrySetResult(false);
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
                this.Text = $"CatLu Radio v{Application.ProductVersion}";
                this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                this.StartPosition = FormStartPosition.CenterScreen;
                this.FormBorderStyle = FormBorderStyle.Sizable;
                this.Controls.Add(webView);
                InitializeWebView();
                this.ResumeLayout(false);
            }
            catch (Exception ex)
            {
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
                var env = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: fixedRuntime,
                    userDataFolder: Path.Combine(dataPath, "WebView2"));
                await webView.EnsureCoreWebView2Async(env);
                webView.CoreWebView2.Settings.IsWebMessageEnabled = true;
                webView.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = true;
                webView.CoreWebView2.Settings.IsScriptEnabled = true;
                webView.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                webView.WebMessageReceived += WebView_WebMessageReceived;
                string htmlPath = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
                if (File.Exists(htmlPath)) {
                    webView.CoreWebView2.Navigate("file://" + htmlPath.Replace("\\", "/"));
                } else {
                    MessageBox.Show("HTML file not found:\n" + htmlPath, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            catch (Exception ex) {
                MessageBox.Show("WebView2 initialization error: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void LoadStore()
        {
            string storePath = Path.Combine(dataPath, "store.json");
            if (File.Exists(storePath)) {
                try { storeData = JObject.Parse(File.ReadAllText(storePath)); }
                catch { storeData = new JObject(); }
            } else { storeData = new JObject(); }
        }

        private async Task SaveStoreAsync()
        {
            string storePath = Path.Combine(dataPath, "store.json");
            await File.WriteAllTextAsync(storePath, storeData.ToString());
        }

        private void WebView_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string message = e.TryGetWebMessageAsString();
                var data = JObject.Parse(message);
                string action = data["action"]?.ToString() ?? "";
                string callbackId = data["callbackId"]?.ToString() ?? "";
                
                switch (action)
                {
                    case "getStore":
                        string key = data["key"]?.ToString() ?? "";
                        SendCallback(callbackId, storeData[key]?.ToString() ?? "null");
                        break;
                    case "setStore":
                        key = data["key"]?.ToString() ?? "";
                        storeData[key] = data["value"];
                        _ = SaveStoreAsync();
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
                    case "setNativeVolume":
                        nativePlayer.Volume = (int)Math.Round(Math.Clamp(data["volume"]?.Value<double>() ?? 0.5, 0, 1) * 100);
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
                }
            }
            catch (Exception ex) { Console.WriteLine("Message processing error: " + ex.Message); }
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
                var hasUpdate = Version.TryParse(tag, out var latest) && Version.TryParse(Application.ProductVersion, out var current) && latest > current;
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
        private void SetNativeEqualizer(JArray? values, string callbackId) {
            nativeEqualizer?.Dispose();
            nativeEqualizer = null;
            if (values is null || values.Count == 0) {
                nativePlayer.UnsetEqualizer();
                SendCallback(callbackId, new { success = true });
                return;
            }
            nativeEqualizer = new Equalizer();
            for (uint index = 0; index < nativeEqualizer.BandCount && index < values.Count; index++) {
                nativeEqualizer.SetAmp(Math.Clamp(values[index]?.Value<float>() ?? 0, -12, 12), index);
            }
            var success = nativePlayer.SetEqualizer(nativeEqualizer);
            if (!success) { nativeEqualizer.Dispose(); nativeEqualizer = null; }
            SendCallback(callbackId, new { success });
        }
        private void ShowSaveDialog(string defaultPath, string callbackId) {
            using var dialog = new SaveFileDialog { FileName = Path.GetFileName(defaultPath), Filter = "JSON files|*.json|All files|*.*", Title = "Save file" };
            if (dialog.ShowDialog() == DialogResult.OK) SendCallback(callbackId, new ApiResponse { Success = true, FilePath = dialog.FileName });
            else SendCallback(callbackId, new ApiResponse { Success = false });
        }
        private void ShowOpenDialog(string callbackId) {
            using var dialog = new OpenFileDialog { Filter = "JSON files|*.json|All files|*.*", Title = "Select file" };
            if (dialog.ShowDialog() == DialogResult.OK) SendCallback(callbackId, new ApiResponse { Success = true, Data = new[] { dialog.FileName } });
            else SendCallback(callbackId, new ApiResponse { Success = false });
        }
        private async Task WriteFile(string path, string content, string callbackId) {
            try {
                await File.WriteAllTextAsync(path, content, Encoding.UTF8);
                SendCallback(callbackId, new ApiResponse { Success = true });
            } catch (Exception ex) { SendCallback(callbackId, new ApiResponse { Success = false, Error = ex.Message }); }
        }
        private async Task ReadFile(string path, string callbackId) {
            try {
                string content = await File.ReadAllTextAsync(path, Encoding.UTF8);
                SendCallback(callbackId, new ApiResponse { Success = true, Content = content });
            } catch (Exception ex) { SendCallback(callbackId, new ApiResponse { Success = false, Error = ex.Message }); }
        }
        protected override void OnFormClosing(FormClosingEventArgs e) {
            base.OnFormClosing(e);
            try { File.WriteAllText(Path.Combine(dataPath, "store.json"), storeData.ToString()); }
            catch { }
            httpClient.Dispose();
            StopNative();
            nativeEqualizer?.Dispose();
            nativePlayer.Dispose();
            nativeVlc.Dispose();
            webView.Dispose();
        }
    }
}
