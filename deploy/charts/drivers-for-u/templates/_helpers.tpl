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
