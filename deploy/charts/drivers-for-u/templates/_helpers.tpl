{{/* Expand the name of the chart. */}}
{{- define "drivers-for-u.name" -}}
{{- .Chart.Name | truncate 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Create a default fully qualified app name. */}}
{{- define "drivers-for-u.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | truncate 63 | trimSuffix "-" -}}
{{- end -}}
