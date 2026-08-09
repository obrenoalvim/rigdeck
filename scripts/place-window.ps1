param(
    [Parameter(Mandatory=$true)][string]$ProcessName,
    [Parameter(Mandatory=$true)][int]$X,
    [Parameter(Mandatory=$true)][int]$Y,
    [Parameter(Mandatory=$true)][int]$Width,
    [Parameter(Mandatory=$true)][int]$Height,
    [switch]$Fullscreen,
    [int]$TimeoutSec = 60,
    [int]$NoWindowGraceSec = 5
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Window {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$noWindowDeadline = $null
$proc = $null
while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
        Select-Object -First 1
    if ($proc) { break }

    # Processo existe mas sem janela visivel (ex: script AutoHotkey rodando
    # em segundo plano, sem GUI) -- espera um tempo curto (nao os
    # $TimeoutSec inteiros, que sao pra dar tempo de um app LENTO abrir a
    # janela dele) e, se continuar sem janela, devolve o PID mesmo assim
    # pra pelo menos o "segurar-pra-fechar" funcionar, so sem posicionar.
    $anyProc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($anyProc) {
        if (-not $noWindowDeadline) { $noWindowDeadline = (Get-Date).AddSeconds($NoWindowGraceSec) }
        if ((Get-Date) -ge $noWindowDeadline) {
            Write-Output (@{
                ok = $true
                pid = $anyProc.Id
                note = "processo '$ProcessName' rodando sem janela visivel -- posicionamento pulado, PID capturado pro hold-to-close"
            } | ConvertTo-Json -Compress)
            exit 0
        }
    }
    Start-Sleep -Milliseconds 500
}

if (-not $proc) {
    Write-Output (@{ ok = $false; error = "window not found for process '$ProcessName' within ${TimeoutSec}s" } | ConvertTo-Json -Compress)
    exit 0
}

$hwnd = $proc.MainWindowHandle
$SWP_NOSIZE = 0x0001
$SW_RESTORE = 9
$SW_MAXIMIZE = 3

# Move primeiro sem redimensionar, depois maximiza -- o Windows maximiza
# no monitor onde a janela ja esta, entao mover antes garante o monitor certo.
[Win32Window]::ShowWindow($hwnd, $SW_RESTORE) | Out-Null
[Win32Window]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, 0, 0, $SWP_NOSIZE) | Out-Null

if ($Fullscreen) {
    [Win32Window]::ShowWindow($hwnd, $SW_MAXIMIZE) | Out-Null
} else {
    [Win32Window]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0) | Out-Null
}
[Win32Window]::SetForegroundWindow($hwnd) | Out-Null

Write-Output (@{ ok = $true; pid = $proc.Id } | ConvertTo-Json -Compress)
