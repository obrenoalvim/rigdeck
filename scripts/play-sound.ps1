param(
    [Parameter(Mandatory=$true)][string]$Path
)

# ponytail: so .wav (System.Media.SoundPlayer, builtin no .NET, zero
# flakiness). Tocar mp3 sem dependencia externa exige MediaPlayer do WPF
# (System.Windows.Media), que precisa de um message pump rodando pra
# funcionar direito em script -- testado, e flaky (toca cortado ou nao toca
# nada dependendo da versao do Windows). Upgrade se precisar de mp3: trocar
# por MediaPlayer + loop de Application.DoEvents ate NaturalDuration.
#
# ponytail: toca sempre no dispositivo PADRAO do sistema, sem trocar nada --
# uma versao anterior tentava trocar o padrao pro CABLE Input (VB-Cable)
# temporariamente pra sair "misturado na voz" automatico, mas testado ao vivo
# com gravacao/call rodando junto: trocar o padrao (mesmo por 1-2s) bagunca
# outros apps sensiveis a evento de "dispositivo mudou" (mutam ou perdem o
# audio ate reconectar sozinhos). Pra sair misturado na voz sem esse
# problema, o dispositivo padrao do Windows tem que ser o CABLE Input o
# tempo todo (nao so durante o efeito) -- setup manual e estavel em vez de
# troca dinamica por clique.
try {
    if (-not (Test-Path $Path)) {
        Write-Output (@{ ok = $false; error = 'arquivo nao encontrado' } | ConvertTo-Json -Compress)
        exit 0
    }
    if ($Path -notmatch '\.wav$') {
        Write-Output (@{ ok = $false; error = 'so .wav e suportado por enquanto' } | ConvertTo-Json -Compress)
        exit 0
    }
    $player = New-Object System.Media.SoundPlayer $Path
    $player.PlaySync()
    Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
