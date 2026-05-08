cd /v3/user-service
docker build -t user-service:local .
docker save user-service:local | sudo k3s ctr images import -

kubectl apply -f /v3/k8s/user-service-config.yaml
kubectl apply -f /v3/k8s/user-service-service.yaml
kubectl apply -f /v3/k8s/user-service-deployment.yaml

# Apply the updated configs to link auth-service & nginx
kubectl apply -f /v3/k8s/auth-service-config.yaml
kubectl apply -f /v3/wss/k8s/nginx-wss.yaml

# Restart services to pick up changes
kubectl rollout restart deployment nginx-wss -n default
kubectl rollout restart deployment auth-service -n default
