# =====================================================================
#  일일업무보고 실행기 (Windows PowerShell 5.1 이상)
#
#  하는 일
#   1) 이 PC에 작은 웹서버를 띄우고 크롬으로 화면을 연다 (http://localhost:8787)
#   2) 화면의 저장·조회 요청을 Goodocs API로 대신 전달한다
#      - 토큰은 이 PC의 goodocs.config.json 에만 있고, 브라우저로는 보내지 않는다
#      - Goodocs 조회는 'GET + JSON 본문' 방식이라 브라우저가 직접 부를 수 없어서 이 중계가 필요하다
#
#  실행: start.bat 더블클릭  (또는  powershell -ExecutionPolicy Bypass -File start.ps1)
#  종료: 이 창에서 Ctrl+C 또는 창 닫기
#  관리자 권한 필요 없음 (이 PC 안에서만 접속 가능: 127.0.0.1)
# =====================================================================
param(
  [int]$Port = 0,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'

$ServerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ServerDir
$ConfigPath = Join-Path $ServerDir 'goodocs.config.json'

if (-not (Test-Path $ConfigPath)) {
  Write-Host ''
  Write-Host '[설정 없음] goodocs.config.json 파일이 없습니다.' -ForegroundColor Yellow
  Write-Host "  1) $ServerDir 폴더의 goodocs.config.example.json 을 복사해"
  Write-Host '     같은 폴더에 goodocs.config.json 으로 저장하세요.'
  Write-Host '  2) USER_ID(사번), DOC_ID(시트 ID), TOKEN_KEY 를 입력한 뒤 다시 실행하세요.'
  Read-Host '엔터를 누르면 닫힙니다'
  exit 1
}

$Config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($k in 'BASE_URL', 'USER_ID', 'DOC_ID', 'TOKEN_SOURCE', 'TOKEN_KEY') {
  if (-not $Config.$k) {
    Write-Host "[설정 오류] goodocs.config.json 의 $k 값이 비어 있습니다." -ForegroundColor Red
    Read-Host '엔터를 누르면 닫힙니다'
    exit 1
  }
}
if (-not $Port) { $Port = if ($Config.PORT) { [int]$Config.PORT } else { 8787 } }
$DocUrl = ($Config.BASE_URL.TrimEnd('/')) + '/' + $Config.DOC_ID
$Utf8 = New-Object System.Text.UTF8Encoding($false)

# ---------------------------------------------------------------------
#  Goodocs 호출
#  Windows PowerShell 5.1의 Invoke-WebRequest는 GET 요청에 본문을 실을 수 없어서
#  HTTP 요청을 직접 만들어 보낸다 (Goodocs 주소가 http:// 일 때)
# ---------------------------------------------------------------------
function Get-AuthJson([hashtable]$Extra) {
  $o = [ordered]@{
    USER_ID      = [string]$Config.USER_ID
    TOKEN_SOURCE = [string]$Config.TOKEN_SOURCE
    TOKEN_KEY    = [string]$Config.TOKEN_KEY
  }
  if ($Extra) { foreach ($k in $Extra.Keys) { $o[$k] = $Extra[$k] } }
  return ($o | ConvertTo-Json -Compress)
}

# 인증 정보 + ROW_DATA(브라우저가 보낸 JSON 그대로)
function Get-RowDataJson([string]$RowDataJson) {
  $auth = Get-AuthJson
  return $auth.Substring(0, $auth.Length - 1) + ',"ROW_DATA":' + $RowDataJson + '}'
}

function Find-Bytes([byte[]]$Data, [int]$From) {
  # \r\n\r\n 위치
  for ($i = $From; $i -le $Data.Length - 4; $i++) {
    if ($Data[$i] -eq 13 -and $Data[$i + 1] -eq 10 -and $Data[$i + 2] -eq 13 -and $Data[$i + 3] -eq 10) { return $i }
  }
  return -1
}

function Decode-Chunked([byte[]]$Data, [int]$Start) {
  $out = New-Object System.IO.MemoryStream
  $pos = $Start
  while ($pos -lt $Data.Length) {
    $lineEnd = $pos
    while ($lineEnd -lt $Data.Length - 1 -and -not ($Data[$lineEnd] -eq 13 -and $Data[$lineEnd + 1] -eq 10)) { $lineEnd++ }
    $sizeText = [System.Text.Encoding]::ASCII.GetString($Data, $pos, $lineEnd - $pos).Split(';')[0].Trim()
    if (-not $sizeText) { break }
    $size = [Convert]::ToInt32($sizeText, 16)
    if ($size -eq 0) { break }
    $out.Write($Data, $lineEnd + 2, $size)
    $pos = $lineEnd + 2 + $size + 2
  }
  return $out.ToArray()
}

function Invoke-Goodocs([string]$Method, [string]$Url, [string]$JsonBody) {
  $uri = New-Object System.Uri($Url)
  if ($uri.Scheme -ne 'http') {
    # https 주소: GET 이외에는 표준 명령으로 보낸다 (5.1에서 GET+본문은 https로 불가)
    if ($Method -eq 'GET') { throw 'Goodocs 주소가 https 입니다. Windows PowerShell 5.1에서는 조회(GET+본문)를 http 주소로만 보낼 수 있습니다.' }
    $r = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Url -ContentType 'application/json; charset=utf-8' -Body ($Utf8.GetBytes($JsonBody))
    return @{ Status = [int]$r.StatusCode; Body = $r.Content }
  }
  $bodyBytes = $Utf8.GetBytes($JsonBody)
  $hostHeader = if ($uri.IsDefaultPort) { $uri.Host } else { "$($uri.Host):$($uri.Port)" }
  $head = "$Method $($uri.PathAndQuery) HTTP/1.1`r`nHost: $hostHeader`r`nContent-Type: application/json; charset=utf-8`r`nAccept: application/json`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n`r`n"
  $tcp = New-Object System.Net.Sockets.TcpClient
  try {
    $tcp.ReceiveTimeout = 60000
    $tcp.SendTimeout = 60000
    $tcp.Connect($uri.Host, $uri.Port)
    $s = $tcp.GetStream()
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $s.Write($hb, 0, $hb.Length)
    $s.Write($bodyBytes, 0, $bodyBytes.Length)
    $s.Flush()
    $ms = New-Object System.IO.MemoryStream
    $buf = New-Object byte[] 65536
    while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n) }
    $data = $ms.ToArray()
  } finally { $tcp.Close() }

  $hEnd = Find-Bytes $data 0
  if ($hEnd -lt 0) { throw 'Goodocs 응답을 읽지 못했습니다.' }
  $headText = [System.Text.Encoding]::ASCII.GetString($data, 0, $hEnd)
  $status = [int](($headText -split "`r`n")[0].Split(' ')[1])
  if ($headText -match '(?im)^transfer-encoding:\s*chunked') {
    $bodyOut = Decode-Chunked $data ($hEnd + 4)
  } else {
    $bodyOut = New-Object byte[] ($data.Length - $hEnd - 4)
    [Array]::Copy($data, $hEnd + 4, $bodyOut, 0, $bodyOut.Length)
  }
  return @{ Status = $status; Body = $Utf8.GetString($bodyOut) }
}

# 전체 행 조회: ROW_INDEX 1부터 5000건씩, 빈 응답이 올 때까지 이어 붙인다 (Python read_all과 같은 방식)
function Read-AllRows {
  $parts = New-Object System.Collections.Generic.List[string]
  $index = 1
  for ($page = 0; $page -lt 400; $page++) {
    $r = Invoke-Goodocs 'GET' $DocUrl (Get-AuthJson @{ ROW_INDEX = $index })
    if ($r.Status -ge 400) { return $r }
    $t = $r.Body.Trim()
    if (-not $t.StartsWith('[')) {
      if ($page -eq 0) { return $r } # 배열이 아닌 형식이면 그대로 넘긴다 (화면 쪽에서 해석)
      break
    }
    $inner = $t.Substring(1, $t.Length - 2).Trim()
    if ($inner.Length -eq 0) { break }
    $parts.Add($inner)
    $index += 5000
  }
  return @{ Status = 200; Body = '[' + ($parts -join ',') + ']' }
}

# ---------------------------------------------------------------------
#  이 PC 안의 작은 웹서버
# ---------------------------------------------------------------------
$ContentTypes = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

function Send-Response($Stream, [int]$Status, [string]$ContentType, [byte[]]$Bytes) {
  $reason = switch ($Status) { 200 { 'OK' } 400 { 'Bad Request' } 403 { 'Forbidden' } 404 { 'Not Found' } 502 { 'Bad Gateway' } default { 'Status' } }
  $head = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($hb, 0, $hb.Length)
  if ($Bytes.Length) { $Stream.Write($Bytes, 0, $Bytes.Length) }
  $Stream.Flush()
}
function Send-Json($Stream, [int]$Status, [string]$Json) { Send-Response $Stream $Status 'application/json; charset=utf-8' ($Utf8.GetBytes($Json)) }
function Send-Error($Stream, [int]$Status, [string]$Message) {
  Send-Json $Stream $Status (@{ error = $Message } | ConvertTo-Json -Compress)
}

function Read-Request($Stream) {
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 65536
  $hEnd = -1
  while ($hEnd -lt 0) {
    $n = $Stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
    $all = $ms.ToArray()
    $hEnd = Find-Bytes $all ([Math]::Max(0, $all.Length - $n - 3))
    if ($ms.Length -gt 1MB) { return $null }
  }
  $headText = [System.Text.Encoding]::ASCII.GetString($all, 0, $hEnd)
  $lines = $headText -split "`r`n"
  $first = $lines[0].Split(' ')
  $len = 0
  foreach ($l in $lines) { if ($l -match '^(?i)content-length:\s*(\d+)') { $len = [int]$Matches[1] } }
  $body = New-Object System.IO.MemoryStream
  $start = $hEnd + 4
  if ($all.Length -gt $start) { $body.Write($all, $start, $all.Length - $start) }
  while ($body.Length -lt $len) {
    $n = $Stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $body.Write($buf, 0, $n)
  }
  $target = $first[1]
  $q = $target.IndexOf('?')
  $path = if ($q -ge 0) { $target.Substring(0, $q) } else { $target }
  return @{ Method = $first[0].ToUpper(); Path = [System.Uri]::UnescapeDataString($path); Body = $Utf8.GetString($body.ToArray()) }
}

function Handle-Api($Stream, $Req) {
  $p = $Req.Path
  if ($p -eq '/api/health') { return Send-Json $Stream 200 '{"ok":true}' }
  if ($p -eq '/api/rows' -and $Req.Method -eq 'GET') {
    $r = Read-AllRows
    return Send-Json $Stream $r.Status $r.Body
  }
  if ($p -eq '/api/rows' -and ($Req.Method -eq 'POST' -or $Req.Method -eq 'PUT')) {
    $raw = $Req.Body.Trim()
    if (-not $raw.StartsWith('{')) { return Send-Error $Stream 400 'ROW_DATA는 JSON 객체여야 합니다.' }
    $r = Invoke-Goodocs $Req.Method $DocUrl (Get-RowDataJson $raw)
    $out = if ($r.Body) { $r.Body } else { '{}' }
    return Send-Json $Stream $r.Status $out
  }
  if ($p -match '^/api/rows/([^/]+)$' -and $Req.Method -eq 'DELETE') {
    $rowId = [System.Uri]::EscapeDataString($Matches[1])
    $r = Invoke-Goodocs 'DELETE' ($DocUrl + '/' + $rowId) (Get-AuthJson)
    $out = if ($r.Body) { $r.Body } else { '{}' }
    return Send-Json $Stream $r.Status $out
  }
  Send-Error $Stream 404 '알 수 없는 API 경로입니다.'
}

function Handle-Static($Stream, $Req) {
  if ($Req.Method -ne 'GET') { return Send-Error $Stream 400 'GET만 허용됩니다.' }
  $rel = $Req.Path.TrimStart('/')
  if (-not $rel) { $rel = 'index.html' }
  $full = [System.IO.Path]::GetFullPath((Join-Path $AppDir $rel))
  $appRoot = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\', '/')
  $serverRoot = [System.IO.Path]::GetFullPath($ServerDir).TrimEnd('\', '/')
  # 앱 폴더 밖이나 server 폴더(토큰이 든 설정 파일)는 절대 내보내지 않는다
  if (-not $full.StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $full.StartsWith($serverRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return Send-Error $Stream 403 '접근할 수 없는 경로입니다.'
  }
  if (-not (Test-Path $full -PathType Leaf)) { return Send-Error $Stream 404 '파일이 없습니다.' }
  $ext = [System.IO.Path]::GetExtension($full).ToLower()
  $ctype = if ($ContentTypes.ContainsKey($ext)) { $ContentTypes[$ext] } else { 'application/octet-stream' }
  $bytes = [System.IO.File]::ReadAllBytes($full)
  if ($ext -eq '.html') {
    # 이 서버로 연 화면은 자동으로 Goodocs 저장소를 쓴다 (페이지의 APP_RUNTIME 표시 자리에 끼워 넣음)
    $html = $Utf8.GetString($bytes)
    $html = $html -replace '<!-- APP_RUNTIME:[^>]*-->', "<script>window.APP_RUNTIME = { store: 'goodocs', apiBase: '/api' };</script>"
    $bytes = $Utf8.GetBytes($html)
  }
  Send-Response $Stream 200 $ctype $bytes
}

# 비어 있는 포트를 찾아 연다 (8787부터 10개)
$listener = $null
for ($try = 0; $try -lt 10; $try++) {
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    break
  } catch { $listener = $null; $Port++ }
}
if (-not $listener) { Write-Host '[오류] 사용할 수 있는 포트를 찾지 못했습니다.' -ForegroundColor Red; exit 1 }

$AppUrl = "http://localhost:$Port/"
Write-Host ''
Write-Host '  일일업무보고 실행 중' -ForegroundColor Green
Write-Host "  화면 주소 : $AppUrl"
Write-Host "  Goodocs   : 시트 $($Config.DOC_ID) (사번 $($Config.USER_ID))"
Write-Host '  끝내려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $AppUrl }

try {
  while ($true) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 25; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 2000
      $client.SendTimeout = 60000
      $stream = $client.GetStream()
      $req = Read-Request $stream
      if ($req) {
        if ($req.Path.StartsWith('/api/')) {
          try { Handle-Api $stream $req }
          catch {
            Write-Host ("  [Goodocs 오류] {0} {1}: {2}" -f $req.Method, $req.Path, $_.Exception.Message) -ForegroundColor Red
            Send-Error $stream 502 ('Goodocs 연결 실패: ' + $_.Exception.Message)
          }
          Write-Host ("  {0:HH:mm:ss} {1} {2}" -f (Get-Date), $req.Method, $req.Path)
        } else {
          Handle-Static $stream $req
        }
      }
    } catch {
      # 브라우저가 미리 열어 둔 빈 연결 등은 조용히 닫는다
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
