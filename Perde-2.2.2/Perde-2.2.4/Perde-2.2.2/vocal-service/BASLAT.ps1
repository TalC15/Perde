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
    if ($CheckOnly) { Write-Host 'OK: Python, ses bilesenleri ve Node.js hazir.'; exit 0 }
    & $venvPython (Join-Path $serviceRoot 'launch.py')
    exit $LASTEXITCODE
} catch {
    Write-Host ('Baslatilamadi: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
