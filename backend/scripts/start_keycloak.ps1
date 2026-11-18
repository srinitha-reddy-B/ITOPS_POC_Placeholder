# Starts the local Keycloak for the Crystal Clean Service Hub demo (http://localhost:8080).
#   powershell -ExecutionPolicy Bypass -File scripts\start_keycloak.ps1      (from backend\)
#
# Keycloak and a portable Java 21 live in %USERPROFILE%\crystal-clean-keycloak (outside OneDrive).
# The admin password is generated once and kept in backend\.env as KEYCLOAK_ADMIN_PASSWORD (git-ignored).
$ErrorActionPreference = "Stop"
$root = Join-Path $env:USERPROFILE "crystal-clean-keycloak"
$kc = Get-ChildItem $root -Directory -Filter "keycloak-*" | Sort-Object Name -Descending | Select-Object -First 1
$java = Get-ChildItem (Join-Path $root "java") -Directory | Select-Object -First 1
if (-not $kc -or -not $java) { throw "Keycloak or Java not found in $root. See docs\CRYSTAL_CLEAN_DEMO.md." }

$envFile = Join-Path $PSScriptRoot "..\.env"
$text = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { "" }
if ($text -match "(?m)^KEYCLOAK_ADMIN_PASSWORD=(.+)$") {
  $pw = $Matches[1].Trim()
} else {
  $bytes = New-Object byte[] 18; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pw = "Kc-" + ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
  Add-Content -Path $envFile -Value "`n# Local Keycloak admin (scripts\start_keycloak.ps1)`nKEYCLOAK_ADMIN_PASSWORD=$pw" -Encoding utf8
  Write-Host "Generated a local Keycloak admin password and saved it in backend\.env (KEYCLOAK_ADMIN_PASSWORD)."
}

$env:JAVA_HOME = $java.FullName
$env:KC_BOOTSTRAP_ADMIN_USERNAME = "admin"
$env:KC_BOOTSTRAP_ADMIN_PASSWORD = $pw
Write-Host "Starting $($kc.Name) on http://localhost:8080 (admin user: admin) ..."
# --proxy-headers xforwarded: sign-ins record the handheld's branch IP (X-Forwarded-For) instead of 127.0.0.1
& (Join-Path $kc.FullName "bin\kc.bat") start-dev --http-port 8080 --proxy-headers xforwarded
