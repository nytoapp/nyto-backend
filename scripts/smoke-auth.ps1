# Manual smoke test for the auth endpoints. Run against a dev instance that has
# OTP_TEST_DESTINATIONS configured, e.g.:
#   $env:PORT="3100"; $env:OTP_TEST_DESTINATIONS="+919876543210:123456"; npx tsx src/index.ts
#   powershell -File scripts/smoke-auth.ps1 -BaseUrl http://127.0.0.1:3100

param(
  [string]$BaseUrl = "http://127.0.0.1:3100",
  [string]$Phone = "+919876543210",
  [string]$Code = "123456"
)

$ErrorActionPreference = "Continue"

function Send-Json($Method, $Path, $Body) {
  $uri = "$BaseUrl$Path"
  try {
    $json = if ($Body) { $Body | ConvertTo-Json -Compress } else { "{}" }
    $res = Invoke-WebRequest -Uri $uri -Method $Method -ContentType "application/json" -Body $json -UseBasicParsing
    return [pscustomobject]@{ Status = $res.StatusCode; Body = ($res.Content | ConvertFrom-Json) }
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $body = $null
    if ($_.ErrorDetails.Message) { $body = $_.ErrorDetails.Message | ConvertFrom-Json }
    return [pscustomobject]@{ Status = $status; Body = $body }
  }
}

function Get-Json($Path, $Token) {
  try {
    $headers = @{ Authorization = "Bearer $Token" }
    $res = Invoke-WebRequest -Uri "$BaseUrl$Path" -Method GET -Headers $headers -UseBasicParsing
    return [pscustomobject]@{ Status = $res.StatusCode; Body = ($res.Content | ConvertFrom-Json) }
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    return [pscustomobject]@{ Status = $status; Body = $null }
  }
}

function Check($Name, $Condition, $Detail) {
  if ($Condition) { Write-Host "  PASS  $Name" -ForegroundColor Green }
  else { Write-Host "  FAIL  $Name -> $Detail" -ForegroundColor Red }
}

Write-Host "`n== Phone OTP ==" -ForegroundColor Cyan

$r = Send-Json POST "/auth/phone/otp/request" @{ phone = $Phone }
Check "request returns 200" ($r.Status -eq 200) $r.Status
Check "response masks the number" ($r.Body.maskedPhone -and $r.Body.phone -eq $Phone) $r.Body.maskedPhone
Check "no code is ever returned" (-not ($r.Body.PSObject.Properties.Name -contains "devOtp")) "devOtp leaked"
Check "resend cooldown advertised" ($r.Body.resendAfterSeconds -gt 0) $r.Body.resendAfterSeconds

$dup = Send-Json POST "/auth/phone/otp/request" @{ phone = $Phone }
Check "immediate resend is throttled (429)" ($dup.Status -eq 429) $dup.Status

$bad = Send-Json POST "/auth/phone/otp/verify" @{ phone = $Phone; code = "999999" }
Check "wrong code rejected (401)" ($bad.Status -eq 401) $bad.Status
Check "error mentions remaining tries" ($bad.Body.error -match "left") $bad.Body.error

$short = Send-Json POST "/auth/phone/otp/request" @{ phone = "+91987654321" }
Check "invalid number rejected (400)" ($short.Status -eq 400) $short.Status

$ok = Send-Json POST "/auth/phone/otp/verify" @{ phone = $Phone; code = $Code }
Check "correct code authenticates (200)" ($ok.Status -eq 200) $ok.Status
Check "access token issued" ([bool]$ok.Body.accessToken) "missing"
Check "refresh token issued" ([bool]$ok.Body.refreshToken) "missing"
Check "user has the verified phone" ($ok.Body.user.phone -eq $Phone) $ok.Body.user.phone
Check "no provider ids leaked" (-not ($ok.Body.user.PSObject.Properties.Name -contains "googleId")) "leak"

$replay = Send-Json POST "/auth/phone/otp/verify" @{ phone = $Phone; code = $Code }
Check "code cannot be replayed" ($replay.Status -eq 401) $replay.Status

Write-Host "`n== Session ==" -ForegroundColor Cyan

$access = $ok.Body.accessToken
$refresh = $ok.Body.refreshToken

$me = Get-Json "/auth/me" $access
Check "access token authorizes /auth/me" ($me.Status -eq 200) $me.Status

$anon = Get-Json "/auth/me" "not-a-token"
Check "garbage token rejected (401)" ($anon.Status -eq 401) $anon.Status

$rot = Send-Json POST "/auth/refresh" @{ refreshToken = $refresh }
Check "refresh rotates (200)" ($rot.Status -eq 200) $rot.Status
Check "new refresh token differs" ($rot.Body.refreshToken -ne $refresh) "not rotated"

$reuse = Send-Json POST "/auth/refresh" @{ refreshToken = $refresh }
Check "reusing old refresh token rejected (401)" ($reuse.Status -eq 401) $reuse.Status

$afterTheft = Get-Json "/auth/me" $rot.Body.accessToken
Check "reuse revoked the rotated session too" ($afterTheft.Status -eq 401) $afterTheft.Status

Write-Host "`n== Providers ==" -ForegroundColor Cyan

$fb = Send-Json POST "/auth/facebook" @{ accessToken = ("x" * 40) }
Check "facebook reports unconfigured or invalid, never 200" ($fb.Status -ne 200) $fb.Status

$g = Send-Json POST "/auth/google" @{ idToken = ("x" * 40) }
Check "google rejects a forged token" ($g.Status -ne 200) $g.Status

$empty = Send-Json POST "/auth/google" @{ idToken = "short" }
Check "provider input validated (400)" ($empty.Status -eq 400) $empty.Status

Write-Host "`n== Legacy surface removed ==" -ForegroundColor Cyan
foreach ($path in @("/auth/register", "/auth/otp/request", "/auth/otp/verify")) {
  $legacy = Send-Json POST $path @{ phone = $Phone }
  Check "$path is gone (404)" ($legacy.Status -eq 404) $legacy.Status
}

Write-Host ""
