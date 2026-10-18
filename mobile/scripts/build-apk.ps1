param(
    [string]$NodeExecutable = 'node',
    [string]$Architectures = 'arm64-v8a,x86_64',
    [switch]$Standalone
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
$savedApi = $env:EXPO_PUBLIC_API_URL
Push-Location $mobileRoot
try {
    $env:PATH = "$(Split-Path -Parent $nodePath);$savedPath"
    $env:JAVA_HOME = $jdkPath
    $env:ANDROID_HOME = $sdkPath
    if ($Standalone) { $env:EXPO_PUBLIC_API_URL = 'https://tracetray.com' }
    $ErrorActionPreference = 'Continue'
    & $nodePath 'scripts/build-surfaces.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Shared surface build failed.' }
    & $nodePath '..\node_modules\expo\bin\cli' prebuild --platform android --no-install --no-clean
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
    if ($Standalone -and [IO.File]::ReadAllText((Join-Path $mobileRoot 'android\app\build.gradle')) -notmatch '(?s)release\s*\{[^}]*signingConfig signingConfigs\.debug') {
        throw 'Standalone QA builds require the generated debug signing configuration.'
    }

    $localProperties = @("sdk.dir=$($sdkPath -replace '\\', '/' -replace ':', '\:')")
    $cmakePath = Join-Path $sdkPath 'cmake\3.31.6'
    if (Test-Path -LiteralPath $cmakePath) { $localProperties += "cmake.dir=$($cmakePath -replace '\\', '/' -replace ':', '\:')" }
    Set-Content -LiteralPath 'android\local.properties' -Value $localProperties -Encoding ascii

    $variant = if ($Standalone) { 'release' } else { 'debug' }
    $assembleTask = if ($Standalone) { ':app:assembleRelease' } else { ':app:assembleDebug' }
    & '.\android\gradlew.bat' -p android $assembleTask "-PreactNativeArchitectures=$Architectures" --max-workers=4 --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    if ($Standalone) { Write-Host 'Standalone QA APK uses the generated debug key. Do not upload it to Play.' }
    Write-Host (Join-Path $mobileRoot "android\app\build\outputs\apk\$variant\app-$variant.apk")
} finally {
    $env:PATH = $savedPath
    $env:JAVA_HOME = $savedJava
    $env:ANDROID_HOME = $savedAndroid
    $env:EXPO_PUBLIC_API_URL = $savedApi
    Pop-Location
}
