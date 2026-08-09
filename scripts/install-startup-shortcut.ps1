# Alternativa ao Task Scheduler que NAO precisa de admin -- coloca um atalho
# na pasta de Inicializacao do Windows (roda sozinho no login do usuario).
$projectDir = Split-Path -Parent $PSScriptRoot
$startupFolder = [Environment]::GetFolderPath('Startup')
$linkPath = Join-Path $startupFolder 'RigDeckServer.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = "`"$projectDir\run-hidden.vbs`""
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = 'Sobe o servidor RigDeck no login'
$shortcut.Save()

"Atalho criado em: $linkPath"
