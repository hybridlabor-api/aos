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
    # verify_api_key.py reads GEMINI_API_KEY from its own process environment.
    # A key typed at the Read-Host prompt above exists only in $GeminiKey, so it
    # has to be published to this process before python is started - otherwise
    # the child sees nothing and every interactively entered key fails the check
    # and is discarded below.
    $env:GEMINI_API_KEY = $GeminiKey
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

# 5. Build the daemon command.
# The API key is deliberately NOT embedded. Step 3 already persisted it as a
# User environment variable, and every process started at logon - the scheduled
# task as well as the Startup-folder fallback - inherits it. Embedding it would
# write the key in clear text into the .cmd under
# %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\, readable by any
# process in the user context and routinely swept up by backups and sync folders.
$DaemonCommand = "& { python '$ScriptPath' --one-shot }"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"$DaemonCommand`""

# 6. Trigger: every 2 hours via repetition
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "00:00" -RepetitionInterval (New-TimeSpan -Hours 2)).Repetition

# 7. Settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# 8. Fallback: per-user Startup .cmd. It is NOT equivalent to the scheduled
# task - it runs the daemon once per logon instead of every 2 hours - so say so.
function Install-StartupFallback {
    param(
        [string]$Command,
        [string]$Reason
    )

    $StartupDir = [System.Environment]::GetFolderPath('Startup')
    if (-not (Test-Path $StartupDir)) { New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null }
    $DaemonCmdPath = Join-Path $StartupDir "BDB_OpenWiki_Daemon.cmd"
    Set-Content -Path $DaemonCmdPath -Value "@echo off`r`npowershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$Command`"" -Encoding ASCII

    Write-Host ""
    Write-Host " -> FALLBACK USED: no scheduled task was created." -ForegroundColor Yellow
    Write-Host "    Reason: $Reason" -ForegroundColor Yellow
    Write-Host "    Created startup entry instead: $DaemonCmdPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    This is NOT the same as the scheduled task:" -ForegroundColor Yellow
    Write-Host "      * scheduled task -> runs every 2 hours" -ForegroundColor Yellow
    Write-Host "      * startup entry   -> runs ONCE per logon (--one-shot)" -ForegroundColor Yellow
    Write-Host "    Documentation is refreshed only when you log in, or when you run" -ForegroundColor Yellow
    Write-Host "    the daemon manually:" -ForegroundColor Yellow
    Write-Host "      python `"$ScriptPath`" --one-shot" -ForegroundColor DarkGray
    Write-Host "    To get the 2-hour schedule, re-run this installer from an elevated" -ForegroundColor Yellow
    Write-Host "    PowerShell (Run as administrator)." -ForegroundColor Yellow
}

# 9. Pre-flight: check up front whether a scheduled task can be registered at all.
$TaskName = "BDB_OpenWiki_Daemon"

$IsElevated = $false
try {
    $CurrentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $CurrentPrincipal = New-Object System.Security.Principal.WindowsPrincipal($CurrentIdentity)
    $IsElevated = $CurrentPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {
    $IsElevated = $false
}

$BlockReason = ""
if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    $BlockReason = "the ScheduledTasks module is not available on this system"
} else {
    $ScheduleService = Get-Service -Name "Schedule" -ErrorAction SilentlyContinue
    if ($null -eq $ScheduleService) {
        $BlockReason = "the Task Scheduler service is not present"
    } elseif ($ScheduleService.Status -ne "Running") {
        $BlockReason = "the Task Scheduler service is not running (status: $($ScheduleService.Status))"
    }
}

# 10. Register (per-user task). Only report success if the task really registered.
$Registered = $false
if ($BlockReason -ne "") {
    Install-StartupFallback -Command $DaemonCommand -Reason $BlockReason
} else {
    if (-not $IsElevated) {
        Write-Host "Running without administrator rights." -ForegroundColor DarkGray
        Write-Host " -> A per-user task usually registers fine; if this system denies it," -ForegroundColor DarkGray
        Write-Host "    a logon-only startup entry is used instead." -ForegroundColor DarkGray
    }
    Write-Host "Registering task '$TaskName'..." -ForegroundColor Yellow
    try {
        Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "BDB OpenWiki Daemon - Gemma 4 API documentation generator" -Force -ErrorAction Stop | Out-Null
        $Registered = $true
    } catch {
        $FailureMessage = $_.Exception.Message
        Write-Warning "Scheduled task registration failed ($FailureMessage)."
        $Reason = "scheduled task registration failed: $FailureMessage"
        if (-not $IsElevated) {
            $Reason = "$Reason (administrator rights are likely required on this system)"
        }
        Install-StartupFallback -Command $DaemonCommand -Reason $Reason
    }
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
} else {
    Write-Host " -> Logs: $DaemonLogDir\daemon.log" -ForegroundColor Yellow
    Write-Host " -> Projects config: $DaemonLogDir\projects.json" -ForegroundColor Yellow
}

if (-not [string]::IsNullOrWhiteSpace($GeminiKey)) {
    Write-Host " -> API key stored as the GEMINI_API_KEY user environment variable" -ForegroundColor Green
    Write-Host "    (not embedded in the task or the startup file)." -ForegroundColor Green
}

Write-Host "=========================================================" -ForegroundColor Cyan

# 11. Exit code tells the caller which of the two paths was taken, so it cannot
# report a periodic schedule when only the logon-only fallback exists.
#   0  -> scheduled task registered, daemon runs every 2 hours
#   10 -> startup fallback, daemon runs once per logon
#   other -> the install did not complete
if ($Registered) {
    exit 0
}
exit 10
