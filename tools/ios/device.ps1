param(
    [ValidateSet('install', 'test')][string]$Action = 'install',
    [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$SshHost = 'jhf-ios',
    [ValidatePattern('^[A-Za-z0-9-]+$')][string]$DeviceId = 'auto',
    [ValidateSet('dev.earlydreamer.jhfreader', 'dev.earlydreamer.jhfreader.envcheck')]
    [string]$BundleId = 'dev.earlydreamer.jhfreader',
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$Action = $Action.ToLowerInvariant()
$BundleId = $BundleId.ToLowerInvariant()
$OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$run = 'product-' + [Guid]::NewGuid().ToString('N')
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $env:LOCALAPPDATA "Codex/remote-ios/artifacts/$run" }
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$remote = '.local/share/jhf-ios/product-jobs/' + $run
function Check-Exit([string]$message) { if ($LASTEXITCODE -ne 0) { throw $message } }
Push-Location $project
try {
    # Includes local tracked changes and non-ignored new files; never needs a PR or push.
    $files = @(git ls-files --cached --others --exclude-standard | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    Check-Exit 'Cannot enumerate the local source.'
    [IO.File]::WriteAllLines((Join-Path $output 'files.txt'), $files, [Text.UTF8Encoding]::new($false))
    git bundle create (Join-Path $output 'source.bundle') HEAD
    Check-Exit 'Cannot create the source history bundle.'
    tar -czf (Join-Path $output 'source.tgz') -T (Join-Path $output 'files.txt')
    Check-Exit 'Cannot create the local source snapshot.'
    $bundleHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output 'source.bundle')).Hash.ToLowerInvariant()
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output 'source.tgz')).Hash.ToLowerInvariant()
    ssh -o BatchMode=yes $SshHost "mkdir -p $remote"
    Check-Exit 'Cannot create the remote job directory.'
    scp (Join-Path $output 'source.bundle') (Join-Path $output 'source.tgz') tools/ios/prepare-source.py "${SshHost}:$remote/"
    Check-Exit 'Cannot transfer the source snapshot.'
    ssh -o BatchMode=yes $SshHost "/usr/bin/python3 $remote/prepare-source.py $remote $bundleHash $sourceHash"
    Check-Exit 'Remote source verification failed.'
    ssh -o BatchMode=yes $SshHost ". ~/.local/share/jhf-ios/env.sh; cd $remote/app; npm ci > ../npm-ci.log 2>&1 && npm run ios:sync > ../ios-sync.log 2>&1 && /usr/bin/python3 tools/ios/queue-device-build.py . .. $DeviceId $Action $BundleId"
    Check-Exit 'Remote dependency setup or build dispatch failed; inspect the job logs.'
    Write-Output "Mac job: ~/$remote"
    $finished = $false
    for ($attempt = 0; $attempt -lt 900; $attempt++) {
        $state = ssh -o BatchMode=yes $SshHost "if test -f $remote/result.json; then cat $remote/result.json; fi"
        Check-Exit 'Cannot read the remote build status. The job may still be running.'
        if ($state) { $result = ($state -join "`n") | ConvertFrom-Json; $finished = $true; break }
        if ($attempt % 10 -eq 0) { Write-Output "iPhone $Action is still running; logs: ~/$remote/xcodebuild.log" }
        Start-Sleep -Seconds 2
    }
    if (-not $finished) { throw "Build wait timed out. Inspect ~/$remote before submitting another build." }
    scp "${SshHost}:$remote/*.log" "${SshHost}:$remote/*.json" $output
    Check-Exit 'Cannot retrieve the build logs and receipt.'
    ssh -o BatchMode=yes $SshHost "test ! -f $remote/launchd-label || launchctl bootout gui/`$(id -u)/`$(cat $remote/launchd-label)"
    Check-Exit 'Cannot unload the completed one-shot build job.'
    if ($result.exitCode -ne 0) { throw "iPhone $Action failed ($($result.exitCode)). See $output" }
    Get-Content -LiteralPath (Join-Path $output 'receipt.json')
    Write-Output "Build, signature, installation and launch logs: $output"
} finally { Pop-Location }
