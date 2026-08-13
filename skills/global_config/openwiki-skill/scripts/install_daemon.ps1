# install_daemon.ps1 - Windows Scheduled Task Setup for OpenWiki Daemon (Gemma 4 API)

$UserHome = [System.Environment]::GetFolderPath('UserProfile')
$ScriptPath = "$UserHome\.gemini\config\skills\openwiki-skill\scripts\openwiki_daemon.py"
$DaemonLogDir = "$UserHome\.openwiki"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Installing OpenWiki Background Daemon (Windows Task Scheduler)" -ForegroundColor Cyan
Write-Host " Using Gemma 4 Direct API (no agy spawning)" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. Resolve script path
if (-not (Test-Path $ScriptPath)) {
    $ScriptPath = "$PSScriptRoot\openwiki_daemon.py"
    if (-not (Test-Path $ScriptPath)) {
        Write-Error "Error: Cannot find openwiki_daemon.py"
        exit 1
    }
}

# 2. Install Python dependency
Write-Host "Installing google-genai SDK..." -ForegroundColor Yellow
try {
    pip install --quiet google-genai 2>$null
} catch {
    Write-Host "Warning: pip install failed. Install google-genai manually." -ForegroundColor Yellow
}

# 3. Resolve API key
$GeminiKey = $env:GEMINI_API_KEY
if ([string]::IsNullOrWhiteSpace($GeminiKey)) {
    Write-Host ""
    $GeminiKey = Read-Host "Enter your Gemini API key (or press Enter to skip)"
}

if (-not [string]::IsNullOrWhiteSpace($GeminiKey)) {
    Write-Host "Verifying API key..." -ForegroundColor Yellow
    $VerifyScript = Join-Path $PSScriptRoot "verify_api_key.py"
    $VerifyOutput = & python $VerifyScript 2>&1
    $VerifyCode = $LASTEXITCODE
    if ($VerifyCode -eq 0 -and ($VerifyOutput -match "VERIFIED_OK")) {
        Write-Host " -> API key verified." -ForegroundColor Green
        [System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", $GeminiKey, "User")
    } else {
        Write-Host " -> WARNING: API key verification failed (with retry + TLS fallback)." -ForegroundColor Yellow
        $VerifyOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Write-Host "    The daemon will run in collect-only mode until a valid key is set." -ForegroundColor Yellow
        $GeminiKey = ""
    }
} else {
    Write-Host "No API key provided. Daemon will run in collect-only mode." -ForegroundColor Yellow
}

# 4. Ensure log directory
if (-not (Test-Path $DaemonLogDir)) {
    New-Item -ItemType Directory -Force -Path $DaemonLogDir | Out-Null
}

# 5. Build scheduled task action with API key in environment
$EnvSetup = ""
if (-not [string]::IsNullOrWhiteSpace($GeminiKey)) {
    $EnvSetup = "`$env:GEMINI_API_KEY='$GeminiKey'; "
}

$DaemonCommand = "& { $EnvSetup python '$ScriptPath' --one-shot }"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"$DaemonCommand`""

# 6. Trigger: every 2 hours via repetition
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "00:00" -RepetitionInterval (New-TimeSpan -Hours 2)).Repetition

# 7. Settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# 8. Register (per-user task; no admin required). Only report success if the task really registered.
$TaskName = "BDB_OpenWiki_Daemon"
Write-Host "Registering task '$TaskName'..." -ForegroundColor Yellow

$Registered = $false
try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "BDB OpenWiki Daemon - Gemma 4 API documentation generator" -Force -ErrorAction Stop | Out-Null
    $Registered = $true
} catch {
    Write-Warning "Scheduled task registration failed ($($_.Exception.Message))."
    # Fallback: per-user Startup folder .cmd that starts the daemon at logon (no admin needed).
    $StartupDir = [System.Environment]::GetFolderPath('Startup')
    if (-not (Test-Path $StartupDir)) { New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null }
    $DaemonCmdPath = Join-Path $StartupDir "BDB_OpenWiki_Daemon.cmd"
    Set-Content -Path $DaemonCmdPath -Value "@echo off`r`npowershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$DaemonCommand`"" -Encoding ASCII
    Write-Host " -> Created startup entry: $DaemonCmdPath" -ForegroundColor Green
}

if ($Registered) {
    Write-Host " -> Success! OpenWiki daemon installed (runs every 2 hours)." -ForegroundColor Green
    Write-Host " -> Logs: $DaemonLogDir\daemon.log" -ForegroundColor Green
    Write-Host " -> Projects config: $DaemonLogDir\projects.json" -ForegroundColor Green
    try {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        Write-Host " -> Initial run launched." -ForegroundColor Green
    } catch {
        Write-Warning "Could not start task immediately: $($_.Exception.Message)"
    }
}

Write-Host "=========================================================" -ForegroundColor Cyan
