# Сплошная проверка потоков радиостанций CatLuRadio.
#
# Для каждого URL делает короткий GET (первые 2 КБ), фиксирует HTTP-статус,
# Content-Type и признак HLS (#EXTM3U), после чего выносит вердикт о том,
# какой движок потянет станцию при включённом кроссфейде (браузер — основной,
# LibVLC — запасной после ошибки и только для http://):
#
#   web       - браузер воспроизведёт: <audio> или HLS (hls.js)
#   web-risk  - формат неизвестен, браузер может не декодировать
#   html      - по URL отдаётся страница, а не поток: веб упадёт
#   native    - прямой http://-поток: страница https его не возьмёт,
#               в приложении после ошибки он уходит в LibVLC
#   dead      - HTTP >= 400, таймаут или сетевая ошибка
#
# Источник станций: store_v2.json приложения (если есть), иначе wwwroot/stations.js.
# Отчёт пишется в tools/stations-report.json (UTF-8), таблица — на экран (ASCII).

param(
    [int]$TimeoutSec = 8,
    [string]$ReportPath = (Join-Path $PSScriptRoot 'stations-report.json')
)

$ErrorActionPreference = 'Stop'

function Get-StationList {
    $store = Join-Path $env:LOCALAPPDATA 'CatLuRadio\data\store_v2.json'
    if (Test-Path $store) {
        $data = Get-Content $store -Raw -Encoding UTF8 | ConvertFrom-Json
        $list = @($data.stations) | Where-Object { $_.url } |
            ForEach-Object { [pscustomobject]@{ name = $_.name; url = $_.url; source = $_.source } }
        if ($list.Count -gt 0) { return , $list }
    }

    $js = Join-Path (Split-Path $PSScriptRoot -Parent) 'wwwroot\stations.js'
    $text = Get-Content $js -Raw -Encoding UTF8
    $list = [regex]::Matches($text, '"title":\s*"(?<name>[^"]*)"[\s\S]*?"url":\s*"(?<url>[^"]*)"') |
        ForEach-Object { [pscustomobject]@{ name = $_.Groups['name'].Value; url = $_.Groups['url'].Value; source = '' } }
    return , $list
}

function Test-Stream {
    param([string]$Url)

    $result = [ordered]@{
        status       = 0
        contentType  = ''
        finalUrl     = ''
        hls          = $false
        error        = ''
    }

    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Method = 'GET'
        $req.Timeout = $TimeoutSec * 1000
        $req.ReadWriteTimeout = $TimeoutSec * 1000
        $req.AllowAutoRedirect = $true
        $req.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
        $req.AddRange(0, 2047)

        $resp = $req.GetResponse()
        $result.status = [int]$resp.StatusCode
        $result.contentType = [string]$resp.ContentType
        $result.finalUrl = $resp.ResponseUri.AbsoluteUri

        $stream = $resp.GetResponseStream()
        $buf = New-Object byte[] 512
        $read = $stream.Read($buf, 0, $buf.Length)
        if ($read -gt 0) {
            $head = [System.Text.Encoding]::ASCII.GetString($buf, 0, $read)
            $result.hls = $head.StartsWith('#EXTM3U')
        }
        $resp.Close()
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $result.status = [int]$_.Exception.Response.StatusCode
            $result.contentType = [string]$_.Exception.Response.ContentType
        } else {
            $result.error = $_.Exception.Message
        }
    } catch {
        $result.error = $_.Exception.Message
    }

    return [pscustomobject]$result
}

function Get-Verdict {
    param($Probe, [string]$Url)

    if ($Probe.error -or $Probe.status -ge 400 -or $Probe.status -eq 0) { return 'dead' }
    if ($Probe.hls) { return 'web' }
    $ct = $Probe.contentType.ToLowerInvariant()
    if ($ct -match 'mpegurl') { return 'web' }
    if ($ct.StartsWith('audio/') -or $ct -match 'application/ogg') { return 'web' }
    if ($ct -match 'text/html') { return 'html' }
    if ($ct -eq '' -or $ct -match 'octet-stream|binary|unknown') { return 'web-risk' }
    return 'web-risk'
}

$stations = Get-StationList
$report = @()

foreach ($st in $stations) {
    # Приложение оборачивает http://-потоки Radijo-stotys.lt в HTTPS-прокси
    # (api-adapter.js, resolvePortalStation) — пробуем уже обёрнутый URL.
    $url = $st.url
    $proxied = $st.source -eq 'Radijo-stotys.lt' -and $url.StartsWith('http://')
    if ($proxied) { $url = "https://a.tunzilla.com/$url" }

    $probe = Test-Stream -Url $url
    $verdict = Get-Verdict -Probe $probe -Url $url

    # Прямой http://-поток страница https в браузере не возьмёт — в приложении
    # такие станции после ошибки уходят в LibVLC (renderer.js, запасной запуск).
    if (-not $proxied -and $st.url.StartsWith('http://')) { $verdict = 'native' }

    $report += [pscustomobject]@{
        name         = $st.name
        url          = $st.url
        effectiveUrl = $url
        verdict      = $verdict
        status       = $probe.status
        contentType  = $probe.contentType
        hls          = $probe.hls
        finalUrl     = $probe.finalUrl
        error        = $probe.error
    }
}

$json = $report | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($ReportPath, $json, [Text.UTF8Encoding]::new($false))

$groups = $report | Group-Object verdict | Sort-Object Name
foreach ($g in $groups) { '{0,-8} {1,3}' -f $g.Name, $g.Count }
Write-Output ('total    ' + $report.Count)
Write-Output ('report   ' + $ReportPath)
