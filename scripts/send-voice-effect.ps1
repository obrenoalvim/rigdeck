# Controla o Clownfish Voice Changer (freeware mais usado pra mudar voz em
# tempo real no Windows -- mais comum que Voicemod pq e system-wide e 100%
# gratis, achado via pesquisa) pela API dele: WM_COPYDATA numa janela oculta
# de classe "CLOWNFISHVOICECHANGER". Mesmo padrao ja usado em move-window.ps1
# (FindWindow + SendMessage via user32.dll), so que aqui manda uma string
# "comando|arg1|arg2" em vez de so posicionar janela.
# Protocolo documentado em https://clownfish-translator.com/voicechanger/#clownfishAPI
# (comandos: 0 tocar som, 1 TTS, 2 liga/desliga, 3 setar efeito de voz —
# 3|13|<pitch> pro pitch customizado —, 4 sound FX, 5 volume, 6 VST).
# Nao instala o Clownfish sozinho (mesma regra do EQ): so detecta se ta
# rodando; se nao tiver, quem chamou mostra link de download.
param(
    [int]$Command,
    [string]$Arg1,
    [string]$Arg2,
    [switch]$DetectOnly
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class ClownfishApi {
    [StructLayout(LayoutKind.Sequential)]
    public struct COPYDATASTRUCT {
        public IntPtr dwData;
        public int cbData;
        public IntPtr lpData;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, ref COPYDATASTRUCT lParam);

    const uint WM_COPYDATA = 0x004A;

    public static IntPtr FindClownfish() {
        return FindWindowEx(IntPtr.Zero, IntPtr.Zero, "CLOWNFISHVOICECHANGER", null);
    }

    public static void Send(string message) {
        var hWnd = FindClownfish();
        if (hWnd == IntPtr.Zero) throw new Exception("Clownfish Voice Changer nao esta rodando");

        byte[] bytes = Encoding.UTF8.GetBytes(message + "\0");
        IntPtr ptr = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            var cds = new COPYDATASTRUCT {
                dwData = new IntPtr(42),
                cbData = bytes.Length,
                lpData = ptr
            };
            SendMessage(hWnd, WM_COPYDATA, IntPtr.Zero, ref cds);
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
    }
}
"@ -ErrorAction Stop

try {
    if ($DetectOnly) {
        $running = [ClownfishApi]::FindClownfish() -ne [IntPtr]::Zero
        Write-Output (@{ ok = $running } | ConvertTo-Json -Compress)
        exit 0
    }

    $parts = @("$Command")
    if ($PSBoundParameters.ContainsKey('Arg1')) { $parts += $Arg1 }
    if ($PSBoundParameters.ContainsKey('Arg2')) { $parts += $Arg2 }
    [ClownfishApi]::Send($parts -join '|')
    Write-Output (@{ ok = $true } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
