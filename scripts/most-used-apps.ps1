# Le o UserAssist do registro -- o Windows guarda ali quantas vezes e quando
# cada app foi executado via Explorer/Menu Iniciar. Nomes vem ofuscados em
# ROT13 (decodifica so letras, resto passa direto) e o contador fica dentro
# do valor binario de cada entrada.

function Decode-Rot13($s) {
    -join ($s.ToCharArray() | ForEach-Object {
        $c = $_
        if ($c -cmatch '[a-z]') { [char]((([int]$c - 97 + 13) % 26) + 97) }
        elseif ($c -cmatch '[A-Z]') { [char]((([int]$c - 65 + 13) % 26) + 65) }
        else { $c }
    })
}

$base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist'
$results = @()

Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
    $countKey = Join-Path $_.PSPath 'Count'
    if (-not (Test-Path $countKey)) { return }
    $item = Get-Item $countKey
    foreach ($valueName in $item.Property) {
        if ($valueName -match '^UEME_CTLSESSION$') { continue }
        $data = (Get-ItemProperty -Path $countKey -Name $valueName).$valueName
        if (-not $data -or $data.Length -lt 16) { continue }
        $name = Decode-Rot13 $valueName
        if ($name -notmatch '\.(exe|lnk)$') { continue }
        $runCount = [BitConverter]::ToUInt32($data, 4)
        if ($runCount -eq 0 -or $runCount -gt 100000) { continue }
        $lastRunFiletime = [BitConverter]::ToInt64($data, 60)
        $lastRun = if ($lastRunFiletime -gt 0) { [DateTime]::FromFileTime($lastRunFiletime) } else { $null }
        $results += [PSCustomObject]@{
            name     = $name
            runCount = $runCount
            lastRun  = $lastRun
        }
    }
}

$results | Sort-Object runCount -Descending | Select-Object -First 40 | ConvertTo-Json -Compress
