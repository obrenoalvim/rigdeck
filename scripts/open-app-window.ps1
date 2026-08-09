param(
    [Parameter(Mandatory=$true)][string]$BrowserExe,
    [Parameter(Mandatory=$true)][string]$Url,
    [Parameter(Mandatory=$true)][int]$X,
    [Parameter(Mandatory=$true)][int]$Y,
    [Parameter(Mandatory=$true)][int]$Width,
    [Parameter(Mandatory=$true)][int]$Height,
    [switch]$Fullscreen,
    [int]$TimeoutSec = 30
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class Win32AppWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);

    public static List<IntPtr> WindowsForProcessIds(HashSet<int> pids) {
        var result = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) {
                int ownerPid;
                GetWindowThreadProcessId(hWnd, out ownerPid);
                if (pids.Contains(ownerPid)) result.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@

$procName = [System.IO.Path]::GetFileNameWithoutExtension($BrowserExe)

function Get-BrowserWindows {
    $procIds = New-Object 'System.Collections.Generic.HashSet[int]'
    Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { [void]$procIds.Add($_.Id) }
    if ($procIds.Count -eq 0) { return @() }
    return [Win32AppWindow]::WindowsForProcessIds($procIds)
}

# --app=<url> abre uma janela dedicada (sem abas/barra), mas se o navegador
# ja tiver um processo rodando ele reaproveita esse MESMO processo pra
# janela nova -- entao nao da pra identificar "a janela que abriu agora" so
# pelo PID. Process.MainWindowHandle do .NET tambem nao ajuda aqui: so
# devolve UMA janela por processo (e o Windows pode trocar qual e "a
# principal" a qualquer momento). Em vez disso, lista TODAS as HWND
# visiveis com titulo dos processos do navegador antes de abrir e depois
# pega a que apareceu de novo -- isso identifica exatamente essa janela,
# nao importa quantas outras o mesmo processo ja tenha abertas.
$before = New-Object 'System.Collections.Generic.HashSet[IntPtr]'
Get-BrowserWindows | ForEach-Object { [void]$before.Add($_) }

Start-Process -FilePath $BrowserExe -ArgumentList "--app=$Url"

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
    $newWindow = Get-BrowserWindows | Where-Object { -not $before.Contains($_) } | Select-Object -First 1
    if ($newWindow) { $hwnd = $newWindow; break }
    Start-Sleep -Milliseconds 300
}

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output (@{ ok = $false; error = "janela nova nao apareceu pro processo '$procName' em ${TimeoutSec}s" } | ConvertTo-Json -Compress)
    exit 0
}

$SWP_NOSIZE = 0x0001
$SW_RESTORE = 9
$SW_MAXIMIZE = 3

# Move primeiro sem redimensionar, depois maximiza -- o Windows maximiza
# no monitor onde a janela ja esta, entao mover antes garante o monitor certo.
[Win32AppWindow]::ShowWindow($hwnd, $SW_RESTORE) | Out-Null
[Win32AppWindow]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, 0, 0, $SWP_NOSIZE) | Out-Null

if ($Fullscreen) {
    [Win32AppWindow]::ShowWindow($hwnd, $SW_MAXIMIZE) | Out-Null
} else {
    [Win32AppWindow]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0) | Out-Null
}
[Win32AppWindow]::SetForegroundWindow($hwnd) | Out-Null

Write-Output (@{ ok = $true; hwnd = $hwnd.ToInt64() } | ConvertTo-Json -Compress)
