param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'

$repoUrl = if ($env:BYTEBRIDGE_REPO) { $env:BYTEBRIDGE_REPO } else { 'https://github.com/Amool-kk/ByteBridge.git' }
$branch = if ($env:BYTEBRIDGE_BRANCH) { $env:BYTEBRIDGE_BRANCH } else { 'build' }
$installDir = Join-Path $env:LOCALAPPDATA 'ByteBridge\app'

$port = $null
for ($i = 0; $i -lt $CliArgs.Count; $i++) {
  if ($CliArgs[$i] -eq '--port' -and $i + 1 -lt $CliArgs.Count) {
    $port = $CliArgs[$i + 1]
    $i++
  }
}

function Confirm-Yes([string]$Message) {
  $answer = Read-Host "$Message [y/N]"
  return $answer -match '^[Yy]$'
}

function Get-NodeMajor {
  try {
    $major = & node -p "process.versions.node.split('.')[0]" 2>$null
    return [int]$major
  } catch {
    return 0
  }
}

function Ensure-Repo {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required. Install Git for Windows and retry.'
  }

  $parent = Split-Path $installDir -Parent
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  if (-not (Test-Path (Join-Path $installDir '.git'))) {
    Write-Host "Installing ByteBridge into: $installDir"
    & git clone --depth 1 --branch $branch $repoUrl $installDir
    return
  }

  if (Confirm-Yes "Check for updates and sync to $branch?") {
    try {
      & git -C $installDir fetch origin $branch
      & git -C $installDir checkout $branch 2>$null
      & git -C $installDir reset --hard "origin/$branch"
    } catch {
      Write-Host 'Update check failed; starting current local copy.'
    }
  }
}

function Ensure-Node {
  $major = Get-NodeMajor
  if ($major -ge 18) {
    return
  }

  if (-not (Confirm-Yes 'Node.js 18+ is required. Install now?')) {
    throw 'Node.js 18+ is required to run ByteBridge.'
  }

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      & winget install --id CoreyButler.NVMforWindows -e --accept-package-agreements --accept-source-agreements
    } catch {
      Write-Host 'Unable to install nvm-windows via winget.'
    }
  }

  if (Get-Command nvm -ErrorAction SilentlyContinue) {
    try {
      & nvm install lts
      & nvm use lts
    } catch {
      Write-Host 'nvm-windows install/use failed, trying Node LTS directly.'
    }
  }

  if ((Get-NodeMajor) -lt 18 -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    try {
      & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
    } catch {
      Write-Host 'Unable to install Node.js LTS via winget.'
    }
  }

  if ((Get-NodeMajor) -lt 18) {
    throw 'Node.js install failed. Install Node.js 18+ manually from https://nodejs.org and retry.'
  }
}

try {
  Ensure-Repo
  Set-Location $installDir

  Ensure-Node

  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm is missing. Reinstall Node.js and retry.'
  }

  if (-not (Test-Path (Join-Path $installDir 'node_modules'))) {
    Write-Host 'Installing runtime dependencies...'
    & npm ci --omit=dev
  }

  Write-Host "Starting ByteBridge from $installDir"
  if ($port) {
    $env:PORT = $port
  }

  & node server.js
} catch {
  Write-Error $_
  exit 1
}
