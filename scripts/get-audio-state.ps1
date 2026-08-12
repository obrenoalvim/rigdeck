. "$PSScriptRoot\audio-lib.ps1"

try {
    $state = Get-AudioState
    Write-Output (@{ ok = $true; master = $state.master; mic = $state.mic; sessions = $state.sessions } | ConvertTo-Json -Compress -Depth 5)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
