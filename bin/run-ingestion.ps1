$env:DATABASE_URL        = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
$env:KAFKA_BROKERS       = "localhost:19092"
$env:GRPC_PORT           = "50051"
# Seed all 6 Docker cluster nodes for topology discovery
$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379,127.0.0.1:6380,127.0.0.1:6381,127.0.0.1:6382,127.0.0.1:6383,127.0.0.1:6384"
# Map Docker container announce-IPs to localhost ports (change prefix for k8s port-forwards)
$env:REDIS_IP_MAP        = "172.28.1.1:6379=127.0.0.1:6379,172.28.1.2:6379=127.0.0.1:6380,172.28.1.3:6379=127.0.0.1:6381,172.28.1.4:6379=127.0.0.1:6382,172.28.1.5:6379=127.0.0.1:6383,172.28.1.6:6379=127.0.0.1:6384"
& "C:\workspace\Driver\bin\ingestion.exe"
