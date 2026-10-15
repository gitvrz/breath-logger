# Creates "Breath Logger" shortcuts (Desktop + Start menu) that open the page in its own
# window, like an installed program: Chrome (or Edge) in app mode, no tabs, no address bar.
# Run it again after moving the BreathLogger folder. Usage: double-click
# "Creer le raccourci.bat" in this folder.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$page = Join-Path $root 'webapp\index.html'
$icon = Join-Path $PSScriptRoot 'breathlogger.ico'
if (-not (Test-Path $page)) { throw "Page not found: $page" }

# Web Serial (USB) only works in Chrome and Edge
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Neither Chrome nor Edge was found.' }

$url = ([System.Uri]$page).AbsoluteUri
$shell = New-Object -ComObject WScript.Shell
$places = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('Programs')   # Start menu: lets Windows search find it
)
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Breath Logger.lnk'))
  $lnk.TargetPath = $browser
  $lnk.Arguments = "--app=`"$url`""
  $lnk.WorkingDirectory = Split-Path -Parent $browser
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Breath Logger - respiratory recorder'
  $lnk.Save()
  Write-Host "Shortcut created: $(Join-Path $dir 'Breath Logger.lnk')"
}
Write-Host "Browser: $browser"
Write-Host "Page:    $url"
