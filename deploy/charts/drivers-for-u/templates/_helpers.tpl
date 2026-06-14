{{/* Expand the name of the chart. */}}
{{- define "drivers-for-u.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Create a default fully qualified app name. */}}
{{- define "drivers-for-u.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Hardened container securityContext. The runtime image is a scratch base running as
UID 10001 (see Dockerfile), so a read-only root FS + dropped capabilities are safe
for our static Go services. Do NOT apply to the Triton container (separate image).
*/}}
{{- define "drivers-for-u.securityContext" -}}
runAsNonRoot: true
runAsUser: 10001
runAsGroup: 10001
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/*
Kafka client security env (SASL_SSL). Include inside any Kafka-talking container's
`env:` list. No-op when kafka.tlsEnabled/saslEnabled are false, so clients stay
plaintext for local/dev. Every producer & consumer reads these via kafkacfg.FromEnv.
*/}}
{{- define "drivers-for-u.kafkaSecurityEnv" -}}
{{- if .Values.kafka.tlsEnabled }}
- name: KAFKA_TLS_ENABLED
  value: "true"
{{- end }}
{{- if .Values.kafka.saslEnabled }}
- name: KAFKA_SASL_USERNAME
  valueFrom:
    secretKeyRef:
      name: {{ include "drivers-for-u.name" . }}-app-secrets
      key: kafka-sasl-username
- name: KAFKA_SASL_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "drivers-for-u.name" . }}-app-secrets
      key: kafka-sasl-password
{{- end }}
{{- end -}}

{{/*
Redis client auth env. Include inside any Redis-talking container's `env:` list.
No-op when redis.authEnabled is false, so passwordless local/dev clusters keep
working. Every Redis client reads REDIS_PASSWORD via redis.ClusterOptions.Password.
*/}}
{{- define "drivers-for-u.redisAuthEnv" -}}
{{- if .Values.redis.authEnabled }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "drivers-for-u.name" . }}-app-secrets
      key: redis-password
{{- end }}
{{- end -}}
