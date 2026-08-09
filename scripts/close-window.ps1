param(
    [Parameter(Mandatory=$true)][int64]$Hwnd
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32CloseWindow {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@

$h = [IntPtr]$Hwnd
if (-not [Win32CloseWindow]::IsWindow($h)) {
    Write-Output (@{ ok = $false; error = 'janela ja nao existe mais' } | ConvertTo-Json -Compress)
    exit 0
}

# WM_CLOSE -- fecha só essa janela (equivale a clicar no X), nao mata o
# processo do navegador nem as outras janelas/abas que ele tiver aberto.
$WM_CLOSE = 0x0010
[Win32CloseWindow]::PostMessage($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output (@{ ok = $true; note = 'fechou so a janela (WM_CLOSE)' } | ConvertTo-Json -Compress)
