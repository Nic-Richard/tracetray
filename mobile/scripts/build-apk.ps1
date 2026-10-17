param(
    [string]$NodeExecutable = 'node',
    [string]$Architectures = 'arm64-v8a,x86_64'
)

$ErrorActionPreference = 'Stop'
$mobileRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command $NodeExecutable -ErrorAction Stop).Source
$nodeMajor = [int](& $nodePath -p 'process.versions.node.split(/\./)[0]')
if ($nodeMajor -notin @(22, 24, 26)) { throw 'Use Node 22, 24 or 26. Pass -NodeExecutable if it is not on PATH.' }
if ($Architectures -notmatch '^(arm64-v8a|x86_64)(,(arm64-v8a|x86_64))*$') { throw 'Choose arm64-v8a, x86_64 or both.' }

$sdkPath = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$jdkPath = $env:JAVA_HOME
if (!$jdkPath) {
    $jdkPath = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft' -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^jdk-21\.' } | Select-Object -First 1).FullName
}
if (!$jdkPath) { throw 'Install JDK 21 or set JAVA_HOME.' }
if (!(Test-Path -LiteralPath $sdkPath)) { throw 'Install the Android SDK or set ANDROID_HOME.' }

$savedPath = $env:PATH
$savedJava = $env:JAVA_HOME
$savedAndroid = $env:ANDROID_HOME
Push-Location $mobileRoot
try {
    $env:PATH = "$(Split-Path -Parent $nodePath);$savedPath"
    $env:JAVA_HOME = $jdkPath
    $env:ANDROID_HOME = $sdkPath
    $ErrorActionPreference = 'Continue'
    & $nodePath '..\node_modules\expo\bin\cli' prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }

    $localProperties = @("sdk.dir=$($sdkPath -replace '\\', '/' -replace ':', '\:')")
    $cmakePath = Join-Path $sdkPath 'cmake\3.31.6'
    if (Test-Path -LiteralPath $cmakePath) { $localProperties += "cmake.dir=$($cmakePath -replace '\\', '/' -replace ':', '\:')" }
    Set-Content -LiteralPath 'android\local.properties' -Value $localProperties -Encoding ascii

    & '.\android\gradlew.bat' -p android :app:assembleDebug "-PreactNativeArchitectures=$Architectures" --max-workers=4 --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    Write-Host (Join-Path $mobileRoot 'android\app\build\outputs\apk\debug\app-debug.apk')
} finally {
    $env:PATH = $savedPath
    $env:JAVA_HOME = $savedJava
    $env:ANDROID_HOME = $savedAndroid
    Pop-Location
}
