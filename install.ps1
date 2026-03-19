$ErrorActionPreference = "Stop"

$RepoOwner = "chrlsio"
$RepoName = "agent-skills"
$Repo = "$RepoOwner/$RepoName"
$ReleaseTag = "v0.1.0"

function Write-Log {
  param([string]$Message)
  Write-Host "[AgentSkills installer] $Message"
}

function Resolve-Arch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -match "ARM64") { return "arm64" }
  if ($arch -match "AMD64|X86_64") { return "x64" }
  throw "Unsupported architecture: $arch"
}

function Select-AssetUrl {
  param(
    [array]$Assets,
    [string]$Arch
  )

  $candidates = $Assets | Where-Object { $_.browser_download_url -match "\.exe($|\?)|\.msi($|\?)" }
  if (-not $candidates) {
    throw "No Windows installable assets (.exe/.msi) found."
  }

  if ($Arch -eq "arm64") {
    $archCandidates = $candidates | Where-Object { $_.name -match "arm64|aarch64" }
  } else {
    $archCandidates = $candidates | Where-Object { $_.name -match "x64|x86_64|amd64" }
  }

  if (-not $archCandidates) {
    if ($Arch -eq "arm64") {
      Write-Log "No native Windows ARM64 asset found; falling back to x64 installer."
    }
    $archCandidates = $candidates
  }

  $exe = $archCandidates | Where-Object { $_.name -match "\.exe($|\?)" } | Select-Object -First 1
  if ($exe) { return $exe.browser_download_url }

  $msi = $archCandidates | Where-Object { $_.name -match "\.msi($|\?)" } | Select-Object -First 1
  if ($msi) { return $msi.browser_download_url }

  throw "Unable to select a Windows installer asset."
}

$apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$ReleaseTag"
Write-Log "Fetching release metadata from $apiUrl"
$headers = @{
  "Accept" = "application/vnd.github+json"
  "User-Agent" = "agentskills-installer"
}
if ($env:GITHUB_TOKEN) {
  $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
}
$release = Invoke-RestMethod -Uri $apiUrl -Method Get -Headers $headers

if (-not $release.assets -or $release.assets.Count -eq 0) {
  throw "No downloadable assets found in this release."
}

$arch = Resolve-Arch
$assetUrl = Select-AssetUrl -Assets $release.assets -Arch $arch
$fileName = [System.IO.Path]::GetFileName($assetUrl)
$tmpPath = Join-Path $env:TEMP $fileName

Write-Log "Detected platform: windows/$arch"
Write-Log "Selected asset: $assetUrl"

Write-Log "Downloading asset to $tmpPath"
Invoke-WebRequest -Uri $assetUrl -OutFile $tmpPath

if ($tmpPath -match "\.exe($|\?)") {
  Write-Log "Running NSIS installer silently"
  $proc = Start-Process -FilePath $tmpPath -ArgumentList "/S" -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "Installer exited with code $($proc.ExitCode)"
  }
} elseif ($tmpPath -match "\.msi($|\?)") {
  Write-Log "Running MSI installer silently"
  $args = "/i `"$tmpPath`" /qn /norestart"
  $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "MSI installer exited with code $($proc.ExitCode)"
  }
} else {
  throw "Unsupported installer format: $tmpPath"
}

Write-Log "Installation complete."
