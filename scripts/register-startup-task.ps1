$projectDir = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$projectDir\run-hidden.vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "RigDeckServer" -Action $action -Trigger $trigger -Settings $settings -Description "Sobe o servidor RigDeck no logon (precisa rodar como admin)" -Force
