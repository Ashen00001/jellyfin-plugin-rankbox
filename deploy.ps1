# Builds RankBox and installs it into the local Jellyfin, then restarts Jellyfin (tray app).
#   .\deploy.ps1            build + install + restart
#   .\deploy.ps1 -NoRestart build + install only
param([switch]$NoRestart)
$ErrorActionPreference = 'Stop'

$root    = $PSScriptRoot
$proj    = Join-Path $root 'Jellyfin.Plugin.RankBox'
$dotnet  = Join-Path $env:USERPROFILE '.dotnet\dotnet.exe'
$plugins = 'D:\Jellyfin\plugins'
$version = [regex]::Match((Get-Content (Join-Path $proj 'Jellyfin.Plugin.RankBox.csproj') -Raw), '<AssemblyVersion>([^<]+)<').Groups[1].Value
if (-not $version) { throw 'could not read AssemblyVersion from the csproj' }
$dest    = Join-Path $plugins "RankBox_$version"

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
& $dotnet build $proj -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

# a running Jellyfin locks the old DLL, so stop it before copying
$tray = Get-Process Jellyfin.Windows.Tray -ErrorAction SilentlyContinue
if (-not $NoRestart) {
    Stop-Process -Name Jellyfin.Windows.Tray -Force -ErrorAction SilentlyContinue
    Stop-Process -Name jellyfin -Force -ErrorAction SilentlyContinue
    Start-Sleep 4
}

# older RankBox versions go to the Recycle Bin so Jellyfin only loads one
Add-Type -AssemblyName Microsoft.VisualBasic
Get-ChildItem $plugins -Directory -Filter 'RankBox_*' | Where-Object FullName -ne $dest | ForEach-Object {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($_.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
    "recycled old $($_.Name)"
}
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $proj "bin\Release\net10.0\Jellyfin.Plugin.RankBox.dll") $dest -Force

$meta = [ordered]@{
    category    = 'General'
    changelog   = ''
    description = 'Rank your shows and movies by comparing them head to head.'
    guid        = '022bcb7f-e929-4aa7-80d9-b63080a92b36'
    name        = 'RankBox'
    overview    = 'Pairwise ranking with drag-to-reorder and txt/md/csv/json export.'
    owner       = 'Jack'
    targetAbi   = '12.1.0.0'
    timestamp   = (Get-Date).ToUniversalTime().ToString('o')
    version     = $version
    status      = 'Active'
    autoUpdate  = $false
    imagePath   = ''
    assemblies  = @()
}
$meta | ConvertTo-Json | Set-Content (Join-Path $dest 'meta.json') -Encoding UTF8
"installed to $dest"

if (-not $NoRestart) {
    # start detached so it survives this shell
    Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{
        CommandLine      = '"C:\Program Files\Jellyfin\Server\jellyfin-windows-tray\Jellyfin.Windows.Tray.exe"'
        CurrentDirectory = 'C:\Program Files\Jellyfin\Server\jellyfin-windows-tray'
    } | Out-Null
    $t0 = Get-Date
    do { Start-Sleep 3; try { $v = (Invoke-RestMethod 'http://localhost:8096/System/Info/Public' -TimeoutSec 5).Version } catch { $v = $null } }
    until ($v -or ((Get-Date) - $t0).TotalSeconds -gt 180)
    "Jellyfin $v is back up"
}
