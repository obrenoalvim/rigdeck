param(
    [Parameter(Mandatory = $true)][ValidateSet('master', 'mic', 'session')] [string]$Target,
    [int]$ProcessId = 0,
    [string]$Volume = '',
    [string]$Muted = ''
)

. "$PSScriptRoot\audio-lib.ps1"

try {
    $volParam = if ($Volume -ne '') { [Nullable[int]][int]$Volume } else { $null }
    $mutedParam = if ($Muted -ne '') { [Nullable[bool]][bool]::Parse($Muted) } else { $null }
    Set-AudioVolume -Target $Target -ProcessId $ProcessId -Volume $volParam -Muted $mutedParam
    Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
