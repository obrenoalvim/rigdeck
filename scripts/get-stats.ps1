$os = Get-CimInstance Win32_OperatingSystem
$totalMemKB = $os.TotalVisibleMemorySize
$freeMemKB = $os.FreePhysicalMemory
$usedMemPct = [math]::Round((($totalMemKB - $freeMemKB) / $totalMemKB) * 100, 1)
$usedMemGB = [math]::Round(($totalMemKB - $freeMemKB) / 1MB, 1)
$totalMemGB = [math]::Round($totalMemKB / 1MB, 1)

$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty LoadPercentage)

[PSCustomObject]@{
    cpuPercent = $cpu
    ramPercent = $usedMemPct
    ramUsedGB  = $usedMemGB
    ramTotalGB = $totalMemGB
} | ConvertTo-Json -Compress
