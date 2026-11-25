# 注册 Windows 计划任务：每天 09:00 跑一次扫描
# 用法（管理员 PowerShell）:
#   .\scripts\register_daily_task.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Python = (Get-Command python -ErrorAction SilentlyContinue)?.Source
if (-not $Python) {
    $Python = (Get-Command py -ErrorAction SilentlyContinue)?.Source
}
if (-not $Python) {
    throw "未找到 python，请先安装并加入 PATH"
}

$TaskName = "XModelNewWordMonitorDaily"
$Action = New-ScheduledTaskAction `
    -Execute $Python `
    -Argument "main.py" `
    -WorkingDirectory $Root

$Trigger = New-ScheduledTaskTrigger -Daily -At 9:00am
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "每日扫描 X 最新视频/图片模型词" `
    -Force | Out-Null

Write-Host "已注册计划任务: $TaskName (每天 09:00)"
Write-Host "工作目录: $Root"
Write-Host "报告目录: $Root\data\reports"