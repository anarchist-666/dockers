[directories]
astetcdir => /home/container/etc/asterisk
astdbdir => /home/container/data
astkeydir => /home/container/data
astspooldir => /home/container/spool
astlogdir => /home/container/logs
astrundir => /home/container/run
; Остальное (модули, звуки, MOH, документация) — встроенные пути образа:
;   /usr/lib/asterisk/modules, /var/lib/asterisk/{sounds,moh,...}

[options]
verbose = {{VERBOSE}}
debug = {{DEBUG}}
nocolor = yes
timestamp = yes
defaultlanguage = en
transmit_silence = yes
