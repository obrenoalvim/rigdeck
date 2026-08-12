# Le a sessao de midia ativa do Windows (SMTC -- a mesma API que alimenta o
# widget "now playing" nativo do Win+K / teclas de midia do teclado), pra
# saber O QUE esta tocando (titulo/artista/app), nao so mandar play/pause as
# cegas. WinRT nao tem "await" em PowerShell 5.1 -- o helper AsTask abaixo e
# o jeito padrao de esperar um IAsyncOperation<T> de forma sincrona.
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await-WinRtOperation($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(8000) | Out-Null
    return $netTask.Result
}

try {
    $mgrOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $mgr = Await-WinRtOperation $mgrOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $session = $mgr.GetCurrentSession()
    if (-not $session) {
        Write-Output (@{ ok = $true; playing = $false } | ConvertTo-Json -Compress)
        exit 0
    }

    $propsOp = $session.TryGetMediaPropertiesAsync()
    $props = Await-WinRtOperation $propsOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $playbackInfo = $session.GetPlaybackInfo()
    $isPlaying = $playbackInfo.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing

    Write-Output (@{
        ok = $true
        playing = $isPlaying
        title = $props.Title
        artist = $props.Artist
        app = $session.SourceAppUserModelId
    } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
