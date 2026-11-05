# End-to-end test: builds RankBox, boots a SECOND, throwaway Jellyfin (own data/config/cache dirs under .e2e/, own port),
# seeds it through its HTTP API, installs the plugin, and drives Jellyfin's web UI with Playwright.
# It never touches the Jellyfin you normally run: it only reads the install dir for the binaries.
#
#   .\scripts\e2e.ps1                run everything, clean up afterwards
#   .\scripts\e2e.ps1 -Keep          leave .e2e/ (data, media, creds) in place
#   .\scripts\e2e.ps1 -SkipBuild     reuse the last build
#
# Environment (all optional):
#   JELLYFIN_DIR         folder holding jellyfin.exe + jellyfin-web (default: Program Files\Jellyfin\Server, then PATH)
#   DOTNET               dotnet executable (default: ~\.dotnet\dotnet.exe, then PATH)
#   RANKBOX_E2E_PORT     port for the throwaway server (default 8097, never 8096)
#   RANKBOX_E2E_FT_DIR   folder with an unpacked File Transformation plugin; when set it is installed and used for real,
#                        otherwise the browser applies the same two edits to index.html / config.json itself
param([switch]$Keep, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root   = Split-Path $PSScriptRoot -Parent
$proj   = Join-Path $root 'Jellyfin.Plugin.RankBox'
$e2eSrc = Join-Path $root 'e2e'
$sand   = Join-Path $root '.e2e'
$art    = Join-Path $sand 'artifacts'
$port   = if ($env:RANKBOX_E2E_PORT) { [int]$env:RANKBOX_E2E_PORT } else { 8097 }
$base   = "http://127.0.0.1:$port"
$script:server = $null
$script:checks = 0
$verdict = $null

function Step($m) { Write-Host "[e2e] $m" }
function Fail($m) { throw "E2E: $m" }

function Find-Jellyfin {
    $cands = @($env:JELLYFIN_DIR, (Join-Path $env:ProgramFiles 'Jellyfin\Server')) | Where-Object { $_ }
    $cmd = Get-Command jellyfin.exe -ErrorAction SilentlyContinue
    if ($cmd) { $cands += Split-Path $cmd.Source }
    foreach ($c in $cands) { if (Test-Path (Join-Path $c 'jellyfin.exe')) { return $c } }
    Fail 'jellyfin.exe not found (set JELLYFIN_DIR)'
}
function Find-Dotnet {
    foreach ($c in @($env:DOTNET, (Join-Path $env:USERPROFILE '.dotnet\dotnet.exe'))) { if ($c -and (Test-Path $c)) { return $c } }
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    Fail 'dotnet not found (set DOTNET)'
}

function New-Secret { $b = New-Object byte[] 24; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); ([Convert]::ToBase64String($b) -replace '[+/=]', '').Substring(0, 24) + 'aA1' }

function Call($method, $path, $body = $null, $token = $null, [int]$timeout = 60) {
    $auth = 'MediaBrowser Client="rankbox-e2e", Device="e2e", DeviceId="rankbox-e2e", Version="1.0"'
    if ($token) { $auth += ", Token=`"$token`"" }
    $a = @{ Uri = "$base$path"; Method = $method; Headers = @{ Authorization = $auth }; UseBasicParsing = $true; TimeoutSec = $timeout }
    if ($null -ne $body) { $a.Body = ($body | ConvertTo-Json -Depth 8); $a.ContentType = 'application/json' }
    for ($try = 0; ; $try++) {
        try { return Invoke-RestMethod @a } catch {
            $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            # 503 = still starting; 0 = connection dropped while the server was busy booting
            if (($code -ne 503 -and $code -ne 0) -or $try -ge 30) { throw }
            Start-Sleep 2
        }
    }
}

function Start-Server($jfDir) {
    $q = { param($p) '"' + $p + '"' }
    $args = @('-d', (& $q (Join-Path $sand 'data')), '-C', (& $q (Join-Path $sand 'cache')), '-c', (& $q (Join-Path $sand 'config')), '-l', (& $q (Join-Path $sand 'log')),
        '-w', (& $q (Join-Path $jfDir 'jellyfin-web')), '--nonetchange')
    $script:server = Start-Process -FilePath (Join-Path $jfDir 'jellyfin.exe') -ArgumentList $args -WorkingDirectory $jfDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $sand 'stdout.log') -RedirectStandardError (Join-Path $sand 'stderr.log')
    $t0 = Get-Date
    while ($true) {
        if ($script:server.HasExited) { Fail "test Jellyfin exited early: $((Get-Content (Join-Path $sand stderr.log) -TotalCount 1 -ErrorAction SilentlyContinue))" }
        try { $r = Invoke-RestMethod "$base/System/Info/Public" -TimeoutSec 3 -UseBasicParsing; if ($r.Version) { break } } catch { }
        if (((Get-Date) - $t0).TotalSeconds -gt 180) { Fail 'test Jellyfin did not come up in 180s' }
        Start-Sleep 2
    }
}
function Stop-Server {
    if ($script:server -and -not $script:server.HasExited) {
        # only the process we started, by PID (the normal Jellyfin is never matched by name)
        & taskkill.exe /T /F /PID $script:server.Id *> $null
        $script:server.WaitForExit(15000) | Out-Null
    }
    $script:server = $null
}

try {
    if ($port -eq 8096) { Fail 'port 8096 is reserved for the real Jellyfin' }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { Fail "port $port is already in use" }
    $jf = Find-Jellyfin
    $dotnet = Find-Dotnet
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
    Step "using Jellyfin binaries from $jf"

    # 1. build (same steps as deploy.ps1, minus the install)
    if (-not $SkipBuild) {
        Step 'building web app + plugin'
        Push-Location (Join-Path $root 'web')
        try {
            if (-not (Test-Path node_modules)) { npm ci --no-fund --no-audit | Out-Null; if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed' } }
            npm run test --silent | Out-Null; if ($LASTEXITCODE -ne 0) { Fail 'engine tests failed' }
            npm run build --silent | Out-Null; if ($LASTEXITCODE -ne 0) { Fail 'web build failed' }
        } finally { Pop-Location }
        & $dotnet build $proj -c Release --nologo -v q "-p:JellyfinDir=$jf" | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'plugin build failed' }
    }
    $dll = Join-Path $proj 'bin\Release\net10.0\Jellyfin.Plugin.RankBox.dll'
    if (-not (Test-Path $dll)) { Fail 'plugin DLL missing' }
    $version = [regex]::Match((Get-Content (Join-Path $proj 'Jellyfin.Plugin.RankBox.csproj') -Raw), '<AssemblyVersion>([^<]+)<').Groups[1].Value

    # 2. fresh sandbox
    if (Test-Path $sand) { Remove-Item $sand -Recurse -Force }
    foreach ($d in 'data', 'cache', 'config', 'log', 'media\shows', 'media\movies', 'artifacts') { New-Item -ItemType Directory -Force (Join-Path $sand $d) | Out-Null }
    # own port, loopback only, no discovery / UPnP
    @"
<?xml version="1.0" encoding="utf-8"?>
<NetworkConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BaseUrl />
  <EnableHttps>false</EnableHttps>
  <RequireHttps>false</RequireHttps>
  <InternalHttpPort>$port</InternalHttpPort>
  <InternalHttpsPort>$($port + 1000)</InternalHttpsPort>
  <PublicHttpPort>$port</PublicHttpPort>
  <PublicHttpsPort>$($port + 1000)</PublicHttpsPort>
  <AutoDiscovery>false</AutoDiscovery>
  <EnableUPnP>false</EnableUPnP>
  <EnableIPv4>true</EnableIPv4>
  <EnableIPv6>false</EnableIPv6>
  <EnableRemoteAccess>false</EnableRemoteAccess>
  <LocalNetworkAddresses>
    <string>127.0.0.1</string>
  </LocalNetworkAddresses>
</NetworkConfiguration>
"@ | Set-Content (Join-Path $sand 'config\network.xml') -Encoding UTF8

    # 3. fake library: tiny real clips when the bundled ffmpeg is there, empty files otherwise
    Step 'generating fake media'
    $ffmpeg = Join-Path $jf 'ffmpeg.exe'
    function New-Clip($path) {
        New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
        if (Test-Path $ffmpeg) {
            & $ffmpeg -v error -y -f lavfi -i 'color=c=black:s=64x64:d=1:r=5' -f lavfi -i 'anullsrc=r=8000:cl=mono' -shortest -c:v libx264 -preset ultrafast -c:a aac $path | Out-Null
        }
        if (-not (Test-Path $path) -or (Get-Item $path).Length -eq 0) { Set-Content $path 'rankbox e2e placeholder' }
    }
    $shows = @('Alpha Saga (2019)', 'Bravo Station (2020)', 'Charlie Harbor (2021)', 'Delta Drift (2022)')
    $movies = @('Echo Valley (2018)', 'Foxtrot Line (2017)', 'Golf Summit (2016)')
    foreach ($s in $shows) { $n = $s -replace ' \(\d+\)$', ''; foreach ($e in 1, 2) { New-Clip (Join-Path $sand ("media\shows\$s\Season 01\{0} S01E0{1}.mp4" -f $n, $e)) } }
    foreach ($m in $movies) { New-Clip (Join-Path $sand "media\movies\$m\$m.mp4") }

    # 4. first boot + startup wizard over HTTP
    Step "starting test Jellyfin on $base"
    Start-Server $jf
    $creds = [ordered]@{
        admin = [ordered]@{ name = 'e2e-admin'; password = New-Secret }
        user  = [ordered]@{ name = 'e2e-user'; password = New-Secret }
    }
    $creds | ConvertTo-Json | Set-Content (Join-Path $sand 'creds.json') -Encoding UTF8

    Step 'running the startup wizard'
    $pub = Call GET '/System/Info/Public'
    if ($pub.StartupWizardCompleted) { Fail 'fresh server claims the wizard is already done' }
    Call POST '/Startup/Configuration' @{ UICulture = 'en-US'; MetadataCountryCode = 'US'; PreferredMetadataLanguage = 'en' } | Out-Null
    Call GET '/Startup/User' | Out-Null
    Call POST '/Startup/User' @{ Name = $creds.admin.name; Password = $creds.admin.password } | Out-Null
    Call POST '/Startup/RemoteAccess' @{ EnableRemoteAccess = $false; EnableAutomaticPortMapping = $false } | Out-Null
    Call POST '/Startup/Complete' | Out-Null
    $adm = Call POST '/Users/AuthenticateByName' @{ Username = $creds.admin.name; Pw = $creds.admin.password }
    $at = $adm.AccessToken

    Call POST '/Users/New' @{ Name = $creds.user.name; Password = $creds.user.password } $at | Out-Null

    # offline libraries: no metadata providers, so the fake names stay as they are
    $opts = @{ EnableInternetProviders = $false; EnableRealtimeMonitor = $false; AutomaticRefreshIntervalDays = 0; SaveLocalMetadata = $false; PathInfos = @() }
    foreach ($lib in @(@{ n = 'Shows'; t = 'tvshows'; p = 'media\shows' }, @{ n = 'Movies'; t = 'movies'; p = 'media\movies' })) {
        $o = $opts.Clone(); $o.PathInfos = @(@{ Path = (Join-Path $sand $lib.p) })
        Call POST ("/Library/VirtualFolders?name=$($lib.n)&collectionType=$($lib.t)&refreshLibrary=false") @{ LibraryOptions = $o } $at | Out-Null
    }
    Step 'scanning the fake library'
    Call POST '/Library/Refresh' $null $at | Out-Null
    $want = @{ Series = $shows.Count; Movie = $movies.Count; Episode = $shows.Count * 2 }
    $t0 = Get-Date
    do {
        Start-Sleep 3
        $have = @{}
        foreach ($k in $want.Keys) { $have[$k] = (Call GET "/Items?Recursive=true&IncludeItemTypes=$k&Limit=1" $null $at).TotalRecordCount }
        $done = -not ($want.Keys | Where-Object { $have[$_] -lt $want[$_] })
    } until ($done -or ((Get-Date) - $t0).TotalSeconds -gt 150)
    if (-not $done) { Fail ("fake media did not turn into library items: " + (($have.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)/$($want[$_.Key])" }) -join ', ')) }
    Step ("library has $($have.Series) shows, $($have.Movie) movies, $($have.Episode) episodes")

    # the test user has watched everything, at spread-out dates
    $u = Call POST '/Users/AuthenticateByName' @{ Username = $creds.user.name; Pw = $creds.user.password }
    $items = (Call GET "/Items?Recursive=true&IncludeItemTypes=Episode,Movie&Fields=Path" $null $u.AccessToken).Items
    $i = 0
    foreach ($it in $items) {
        $d = (Get-Date).ToUniversalTime().AddDays(-45 * (1 + $i)).ToString('yyyy-MM-ddTHH:mm:ssZ'); $i++
        Call POST ("/Users/$($u.User.Id)/PlayedItems/$($it.Id)?datePlayed=$d") $null $u.AccessToken | Out-Null
    }

    # 5. install the plugin, restart
    Step 'stopping server to install the plugin'
    Stop-Server
    $pdir = Join-Path $sand "data\plugins\RankBox_$version"
    New-Item -ItemType Directory -Force $pdir | Out-Null
    Copy-Item $dll $pdir -Force
    [ordered]@{ category = 'General'; changelog = ''; description = 'e2e'; guid = '022bcb7f-e929-4aa7-80d9-b63080a92b36'; name = 'RankBox'; overview = 'e2e'
        owner = 'e2e'; targetAbi = '12.1.0.0'; timestamp = (Get-Date).ToUniversalTime().ToString('o'); version = $version; status = 'Active'; autoUpdate = $false; imagePath = ''; assemblies = @() } |
        ConvertTo-Json | Set-Content (Join-Path $pdir 'meta.json') -Encoding UTF8
    $ft = $false
    if ($env:RANKBOX_E2E_FT_DIR) {
        if (-not (Test-Path $env:RANKBOX_E2E_FT_DIR)) { Fail 'RANKBOX_E2E_FT_DIR does not exist' }
        Copy-Item $env:RANKBOX_E2E_FT_DIR (Join-Path $sand 'data\plugins\FileTransformation') -Recurse -Force
        $ft = $true
    }
    Step 'restarting with RankBox installed'
    Start-Server $jf
    $plug = (Call GET '/Plugins' $null $at) | Where-Object { $_.Name -eq 'RankBox' }
    if (-not $plug) { Fail 'RankBox is not in the test server plugin list after restart' }
    if ($plug.Status -ne 'Active') { Fail "RankBox plugin status is $($plug.Status)" }
    Step "RankBox $($plug.Version) is Active"

    # 6. browser tests
    $pw = Join-Path $e2eSrc 'node_modules\playwright'
    if (-not (Test-Path $pw)) { Step 'installing Playwright (e2e/)'; Push-Location $e2eSrc; try { npm ci --no-fund --no-audit | Out-Null; if ($LASTEXITCODE -ne 0) { npm install --no-fund --no-audit | Out-Null } } finally { Pop-Location }; if ($LASTEXITCODE -ne 0) { Fail 'npm install in e2e/ failed' } }
    Push-Location $e2eSrc
    try {
        # browser download only happens when the cache lacks this Playwright's chromium
        npx playwright install chromium | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'playwright install chromium failed' }
        $env:E2E_BASE = $base
        $env:E2E_CREDS = Join-Path $sand 'creds.json'
        $env:E2E_ARTIFACTS = $art
        $env:E2E_INJECT = if ($ft) { '0' } else { '1' }
        Step ('running Playwright' + $(if ($ft) { ' (real File Transformation)' } else { ' (File Transformation emulated in the browser)' }))
        node run.mjs
        $code = $LASTEXITCODE
    } finally { Pop-Location }
    if (-not (Test-Path (Join-Path $art 'result.json'))) { Fail "the browser test crashed before reporting (exit $code)" }
    $res = Get-Content (Join-Path $art 'result.json') -Raw | ConvertFrom-Json
    $script:checks = [int]$res.checks
    if ($code -ne 0 -or -not $res.passed) { Fail ([string]$res.reason) }
    $verdict = "VERIFY rankbox-e2e PASS checks=$($script:checks)"
} catch {
    $msg = ($_.Exception.Message -replace '^E2E: ', '') -replace '\s+', ' '
    $verdict = "VERIFY rankbox-e2e FAIL $msg"
} finally {
    try { Stop-Server } catch { }
    try {
        if ($verdict -like '*FAIL*' -and (Test-Path (Join-Path $sand 'log'))) {
            New-Item -ItemType Directory -Force $art | Out-Null
            Copy-Item (Join-Path $sand 'log') (Join-Path $art 'server-log') -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (-not $Keep -and (Test-Path $sand)) {
            Get-ChildItem $sand -Force | Where-Object Name -ne 'artifacts' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}
Write-Output $verdict
if ($verdict -like '*PASS*') { exit 0 } else { exit 1 }
