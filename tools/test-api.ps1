# NapCat 独立部署最小验证脚本
# 用法示例：
#   只读验证（不改动任何群设置，先跑这个）：
#     .\test-api.ps1 -Token "你的Token"
#   实际设置头衔（真实操作！账号必须是群主，成员必须在群里）：
#     .\test-api.ps1 -Token "你的Token" -GroupId 123456 -UserId 654321 -Title "测试头衔"
#   清除头衔：-Title 传空字符串 ""
param(
    [Parameter(Mandatory = $true)]
    [string]$Token,

    [int]$Port = 3000,

    # 只读模式下可不填；设置头衔时必填
    [string]$GroupId = "",

    [string]$UserId = "",

    # 空字符串表示清除头衔
    [string]$Title = "",

    # 显式要求执行写操作，防止误触发
    [switch]$ApplyTitle
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base = "http://127.0.0.1:$Port"
$headers = @{ Authorization = "Bearer $Token" }

function Invoke-NapCat {
    param([string]$Path, [object]$Body)
    $json = $Body | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    try {
        $resp = Invoke-RestMethod -Uri "$base$Path" -Method Post -Headers $headers `
            -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 15
        return $resp
    } catch {
        $detail = ""
        try { $detail = $_.ErrorDetails.Message } catch {}
        throw "请求 $Path 失败：$($_.Exception.Message) $detail"
    }
}

# ---------- 第 1 步：连通性 + 版本 ----------
Write-Host "== 1/3 连接 NapCat（get_version_info / get_login_info）==" -ForegroundColor Cyan
$version = Invoke-NapCat -Path "/get_version_info" -Body @{}
Write-Host ("NapCat 版本: {0}  协议版本: {1}" -f $version.data.version, $version.data.protocol_version)

$login = Invoke-NapCat -Path "/get_login_info" -Body @{}
Write-Host ("当前登录账号: {0}  昵称: {1}" -f $login.data.user_id, $login.data.nickname)

# ---------- 第 2 步：成员可写校验（读操作，确认参数正确）----------
if ($GroupId -and $UserId) {
    Write-Host "== 2/3 校验目标成员（get_group_member_info）==" -ForegroundColor Cyan
    $member = Invoke-NapCat -Path "/get_group_member_info" -Body @{
        group_id = "$GroupId"; user_id = "$UserId"
    }
    Write-Host ("成员: {0}  群名片: {1}  当前头衔: [{2}]  角色: {3}" -f `
        $member.data.user_id, $member.data.card, $member.data.title, $member.data.role)
    Write-Host ("机器人自身角色: 见上一步；注意：专属头衔仅群主可设置，目标必须是本群成员")
} else {
    Write-Host "== 2/3 跳过成员校验（未提供 GroupId/UserId）==" -ForegroundColor Yellow
}

# ---------- 第 3 步：设置头衔 ----------
if ($ApplyTitle) {
    if (-not $GroupId -or -not $UserId) {
        throw "执行写操作必须同时提供 -GroupId 和 -UserId"
    }
    Write-Host "== 3/3 设置专属头衔（set_group_special_title）==" -ForegroundColor Cyan
    if ($Title -eq "") {
        Write-Host "Title 为空字符串：本次将【清除】该成员的专属头衔"
    } else {
        Write-Host ("本次将把成员 {0} 的头衔设置为: [{1}]" -f $UserId, $Title)
        $confirm = Read-Host "确认执行请输入 YES"
        if ($confirm -ne "YES") { throw "用户取消，未做任何修改" }
    }
    $resp = Invoke-NapCat -Path "/set_group_special_title" -Body @{
        group_id      = "$GroupId"
        user_id       = "$UserId"
        special_title = $Title
    }
    Write-Host ("接口返回: status={0} retcode={1}" -f $resp.status, $resp.retcode)
    Write-Host "请到 QQ 群成员列表核对头衔是否已生效。"
} else {
    Write-Host "== 3/3 跳过写操作（未加 -ApplyTitle 开关）==" -ForegroundColor Yellow
    Write-Host "只读验证通过后，加参数 -GroupId ... -UserId ... -Title ... -ApplyTitle 执行真实设置"
}
