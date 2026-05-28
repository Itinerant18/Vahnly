# bin/start-port-forwards.ps1
$kubectl = "C:\Program Files\Docker\Docker\Resources\bin\kubectl.exe"

Write-Host "Cleaning up existing port forwards..."
Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "Establishing Kubernetes data tier port forwards..."
Start-Process -FilePath $kubectl -ArgumentList "port-forward svc/postgresql-service 5432:5432 -n dispatch" -WindowStyle Hidden
Start-Process -FilePath $kubectl -ArgumentList "port-forward svc/kafka-service 19092:19092 -n dispatch" -WindowStyle Hidden

# Redis Cluster port forwards
$podsJson = & $kubectl get pods -n dispatch -l app=redis-cluster -o json
if ($LASTEXITCODE -ne 0 -or -not $podsJson) {
    Write-Error "Failed to fetch Redis cluster pods."
    exit 1
}
$pods = $podsJson | ConvertFrom-Json
$ipMapList = @()
$port = 6379
foreach ($item in $pods.items) {
    $name = $item.metadata.name
    $ip = $item.status.podIP
    if ($ip) {
        $ipMapList += "${ip}:6379=127.0.0.1:${port}"
        Start-Process -FilePath $kubectl -ArgumentList "port-forward pod/$name ${port}:6379 -n dispatch" -WindowStyle Hidden
        $port++
    }
}

$redisIpMap = $ipMapList -join ","

Write-Host "=========================================================================="
Write-Host " Kubernetes Port Forwards established successfully!"
Write-Host "=========================================================================="
Write-Host "Copy and run the following command in your terminal before running services:"
Write-Host ""
Write-Host "`$env:REDIS_IP_MAP = `"$redisIpMap`""
Write-Host "`$env:DATABASE_URL = `"postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable`""
Write-Host "`$env:REDIS_CLUSTER_NODES = `"127.0.0.1:6379`""
Write-Host "`$env:KAFKA_BROKERS = `"localhost:19092`""
Write-Host "=========================================================================="
