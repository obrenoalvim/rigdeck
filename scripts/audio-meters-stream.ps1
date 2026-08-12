# Processo residente (nao 1-por-chamada como os outros scripts de audio) --
# VU meter ao vivo precisa de leituras a cada ~150ms, e o custo de subir um
# powershell.exe novo por leitura (150-300ms so de spawn) inviabiliza isso.
# Fica vivo lendo peak level em loop e imprimindo uma linha JSON por vez;
# quem chamou (Node) mata o processo quando ninguem mais precisa do stream.
#
# Se o processo Node morrer sem dar tempo de matar esse filho (crash, ou
# "taskkill /F" -- confirmado na pratica: sobrou um orfao rodando de uma
# sessao de teste anterior), o Windows nao mata processo filho sozinho
# quando o pai morre. Guarda-chuva: confere a cada iteracao se o PID do pai
# ainda existe, se nao existir mais o processo se mata sozinho.
. "$PSScriptRoot\audio-lib.ps1"

$parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId

while ($true) {
    if ($parentPid -and -not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {
        exit 0
    }
    try {
        $masterPeak = [AudioLib.Core]::GetMasterPeak()
        # Isolado num try proprio -- maquina sem microfone nao pode derrubar
        # a leitura de master/sessions junto (senao um tick sem mic vira erro
        # geral e perde tudo, nao so o pico do mic).
        $micPeak = try { [AudioLib.Core]::GetMicPeak() } catch { 0 }
        $sessionPeaks = [AudioLib.Core]::GetSessionPeaks() | ForEach-Object {
            [PSCustomObject]@{ pid = $_.Pid; peak = [math]::Round($_.Peak, 3) }
        }
        [PSCustomObject]@{
            master   = [math]::Round($masterPeak, 3)
            mic      = [math]::Round($micPeak, 3)
            sessions = @($sessionPeaks)
        } | ConvertTo-Json -Compress -Depth 4
    } catch {
        [PSCustomObject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    Start-Sleep -Milliseconds 150
}
