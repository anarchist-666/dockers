[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:{{SIP_PORT}}
{{NAT_OPTS}}

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:{{SIP_PORT}}
{{NAT_OPTS}}
{{TLS_BLOCK}}
