param(
    [Parameter(Mandatory=$true)][string]$Key,
    [string]$ProcessName,
    [int]$TimeoutSec = 15
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32SendKey {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
"@
Add-Type -AssemblyName System.Windows.Forms

# So preenchido quando o gatilho precisa saber QUAL janela mirar (disparado
# sozinho, sem vir logo depois de um passo "abrir" que ja deixou a janela
# certa em foreground -- ex: apertar F11 minutos depois de abrir o jogo,
# com o foco ja tendo ido pra outra coisa nesse meio tempo).
if ($ProcessName) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $proc = $null
    while ((Get-Date) -lt $deadline) {
        $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Select-Object -First 1
        if ($proc) { break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $proc) {
        Write-Output (@{ ok = $false; error = "janela nao encontrada pro processo '$ProcessName' em ${TimeoutSec}s" } | ConvertTo-Json -Compress)
        exit 0
    }
    [Win32SendKey]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 150
}

# MAXIMIZE/RESTORE nao sao teclas de verdade -- viram manipulacao de janela
# direto. Existe porque alguns apps (ex: emulador do Google Play Games, que
# roda jogo mobile numa janela de VM) simplesmente nao escutam F11 -- so
# respondem a manipulacao de janela do proprio Windows. ShowWindow(maximize)
# sozinho so MAXIMIZA (ainda sobra borda/titulo e a barra de tarefas) -- pra
# tela cheia de verdade (borda a borda, cobrindo ate a barra de tarefas) tem
# que tirar o estilo de janela (WS_CAPTION/WS_THICKFRAME) e esticar pro
# tamanho exato da tela, o mesmo truque que jogo/emulador sem fullscreen
# nativo costuma usar por baixo dos panos.
$normalized = $Key.ToUpper().Trim()
if ($normalized -eq 'MAXIMIZE' -or $normalized -eq 'RESTORE') {
    if (-not $ProcessName) {
        Write-Output (@{ ok = $false; error = 'MAXIMIZE/RESTORE precisa do campo "processo" preenchido pra saber qual janela mexer' } | ConvertTo-Json -Compress)
        exit 0
    }
    $GWL_STYLE = -16
    $WS_CAPTION = 0x00C00000
    $WS_THICKFRAME = 0x00040000
    $WS_MINIMIZEBOX = 0x00020000
    $WS_MAXIMIZEBOX = 0x00010000
    $WS_SYSMENU = 0x00080000
    $CHROME_BITS = $WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU
    $SWP_FRAMECHANGED = 0x0020
    $SM_CXSCREEN = 0
    $SM_CYSCREEN = 1

    $hwnd = $proc.MainWindowHandle
    $style = [Win32SendKey]::GetWindowLong($hwnd, $GWL_STYLE)

    if ($normalized -eq 'MAXIMIZE') {
        $screenW = [Win32SendKey]::GetSystemMetrics($SM_CXSCREEN)
        $screenH = [Win32SendKey]::GetSystemMetrics($SM_CYSCREEN)
        [Win32SendKey]::SetWindowLong($hwnd, $GWL_STYLE, ($style -band (-bnot $CHROME_BITS))) | Out-Null
        [Win32SendKey]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, $screenW, $screenH, $SWP_FRAMECHANGED) | Out-Null
    } else {
        [Win32SendKey]::SetWindowLong($hwnd, $GWL_STYLE, ($style -bor $CHROME_BITS)) | Out-Null
        [Win32SendKey]::SetWindowPos($hwnd, [IntPtr]::Zero, 100, 100, 1280, 800, $SWP_FRAMECHANGED) | Out-Null
    }
    Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
    exit 0
}

# Nomes amigaveis -> token do SendKeys (a sintaxe crua usa +^%~(){} com
# significado especial, melhor nao expor isso direto pro usuario).
$map = @{
    'F1' = '{F1}'; 'F2' = '{F2}'; 'F3' = '{F3}'; 'F4' = '{F4}'
    'F5' = '{F5}'; 'F6' = '{F6}'; 'F7' = '{F7}'; 'F8' = '{F8}'
    'F9' = '{F9}'; 'F10' = '{F10}'; 'F11' = '{F11}'; 'F12' = '{F12}'
    'ESC' = '{ESC}'; 'ESCAPE' = '{ESC}'
    'ENTER' = '{ENTER}'; 'TAB' = '{TAB}'; 'SPACE' = ' '
    'ALT+ENTER' = '%{ENTER}'; 'ALT+TAB' = '%{TAB}'
}

$sendKeysToken = if ($map.ContainsKey($normalized)) { $map[$normalized] } else { $Key }

try {
    # Sem -ProcessName, manda pra janela em foreground no momento -- so faz
    # sentido encadeado logo depois de um passo "abrir" (que ja chama
    # SetForegroundWindow) ou quando o usuario acabou de clicar na janela.
    [System.Windows.Forms.SendKeys]::SendWait($sendKeysToken)
    Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
