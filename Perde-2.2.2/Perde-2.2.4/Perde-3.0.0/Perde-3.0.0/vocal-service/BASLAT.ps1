param([switch]$SkipInstall, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
try {
    $serviceRoot = $PSScriptRoot
    $venvPython = Join-Path $serviceRoot '.venv\Scripts\python.exe'
    $modelRoot = Join-Path $serviceRoot '.models'
    # Optional machine-local configuration; excluded from release packages.
    $environmentFile = Join-Path $serviceRoot '.runtime\environment.json'
    if (Test-Path -LiteralPath $environmentFile) {
        $environmentConfig = Get-Content -LiteralPath $environmentFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if (Test-Path -LiteralPath $environmentConfig.python -PathType Leaf) {
            $venvPython = $environmentConfig.python
            $modelRoot = $environmentConfig.models
        }
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js 22 veya ustu gerekli. nodejs.org uzerinden kurup BASLAT.cmd dosyasini tekrar ac.'
    }
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 veya ustu gerekli.' }
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        if ($SkipInstall -or $CheckOnly) { throw 'Ses ortami kurulu degil. Kurulum icin BASLAT.cmd dosyasini normal ac.' }
        if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
            throw 'Python 3.12 gerekli. python.org uzerinden Python Launcher ile kurup BASLAT.cmd dosyasini tekrar ac.'
        }
        Write-Host 'Ilk kullanim: ses ortami kuruluyor. Internet baglantisi gerekli; bu adim biraz surebilir.'
        & py -3.12 -m venv (Join-Path $serviceRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 ortami olusturulamadi.' }
    }
    $env:PYTHONUTF8 = '1'
    $env:TORCH_HOME = $modelRoot
    $probe = 'import demucs, torch, torchaudio, soundfile, imageio_ffmpeg, yt_dlp'
    & $venvPython -c $probe
    if ($LASTEXITCODE -ne 0) {
        if ($SkipInstall -or $CheckOnly) { throw 'Ses bilesenleri eksik. Onarmak icin BASLAT.cmd dosyasini normal ac.' }
        Write-Host 'Eksik ses bilesenleri kuruluyor...'
        & $venvPython -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
        if ($LASTEXITCODE -ne 0) { throw 'PyTorch kurulamadi. Internet baglantisini kontrol edip tekrar dene.' }
        & $venvPython -m pip install -r (Join-Path $serviceRoot 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Ses bilesenleri kurulamadi. Internet baglantisini kontrol edip tekrar dene.' }
        & $venvPython -c $probe
        if ($LASTEXITCODE -ne 0) { throw 'Ses bilesenleri dogrulanamadi.' }
    }
    # Fast engine: MDX-Net on the graphics card (DirectML). Optional; without it
    # the service separates with Demucs on the processor.
    # Its failures only print a notice, so native stderr must not stop the script.
    $ErrorActionPreference = 'Continue'
    $gpuProbe = "import onnxruntime as o, sys; sys.exit(0 if 'DmlExecutionProvider' in o.get_available_providers() else 1)"
    & $venvPython -c $gpuProbe 2>$null
    if ($LASTEXITCODE -ne 0 -and -not ($SkipInstall -or $CheckOnly)) {
        Write-Host 'Ekran karti ile hizli ses ayirma bileseni kuruluyor...'
        & $venvPython -m pip uninstall -y onnxruntime 2>$null | Out-Null
        & $venvPython -m pip install onnxruntime-directml==1.24.4
        & $venvPython -c $gpuProbe 2>$null
    }
    $fastEngine = $LASTEXITCODE -eq 0
    if ($fastEngine -and -not $CheckOnly) {
        & $venvPython (Join-Path $serviceRoot 'setup_mdx.py') $modelRoot
        $fastEngine = $LASTEXITCODE -eq 0
    }
    $ErrorActionPreference = 'Stop'
    if (-not $fastEngine) {
        Write-Host 'Hizli (ekran karti) motoru kullanilamiyor; ses islemciyle ayrilacak. Daha uzun surer.' -ForegroundColor Yellow
    }
    if ($CheckOnly) { Write-Host 'OK: Python, ses bilesenleri ve Node.js hazir.'; exit 0 }
    & $venvPython (Join-Path $serviceRoot 'launch.py')
    exit $LASTEXITCODE
} catch {
    Write-Host ('Baslatilamadi: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
